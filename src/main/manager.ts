import { randomUUID } from 'node:crypto'
import type { Agent, AppEvent, DeliveryFile, ManagerProject, ManagerTask, Message, WorkEvidence, WorkSource } from '../shared/types'
import { moderatorReady } from '../shared/types'
import type { Store, WorkHandoff } from './store'
import { chatOnce, type AgentMsg, type ToolDef } from './adapters/openai'
import { inspectManagerFile, listManagerFiles, managerPath, snapshotDelivery } from './managerFiles'
import { imageInputError, visualMessage, viewVisualFile, VISUAL_TOOLS } from './adapters/visual'
import { workFailure } from './workEvidence'
import { accessedPage, webSearchSources } from './workEvidence'
import { executeFileTool, FILE_TOOLS, FILE_TOOL_NAMES } from './adapters/fileTools'
import { searchWeb, WEB_SEARCH_TOOL } from './adapters/webSearch'
import { fetchUrl } from './adapters/netTools'
import { CAPABILITY_TOOL } from './capabilities'
import type { ObserveTool } from './toolActivity'
import { modelRateObserver } from './modelRate'
import managerPolicy from './manager-policy.md?raw'

interface ManagerHost {
  dispatch(roomId: string, agentId: string, task: string, source: string, handoff: WorkHandoff): void
  cancel(roomId: string): void
  roots(roomId: string): string[]
  team(roomId: string): string
  capabilities?(roomId: string, agent: string | undefined, signal: AbortSignal): Promise<string>
  observeTool?(roomId: string): ObserveTool
  emit(event: AppEvent): void
  mutate<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T>
}
interface Runtime { running: boolean; dirty: boolean; controller?: AbortController; reason: string }
const active = (task: ManagerTask): boolean => task.status === 'queued' || task.status === 'running'
const terminal = (p: ManagerProject): boolean => ['delivered', 'idle'].includes(p.status)
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDef => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } }
})
const S = { type: 'string' }
const TOOLS: ToolDef[] = [
  ...FILE_TOOLS,
  WEB_SEARCH_TOOL,
  CAPABILITY_TOOL,
  tool('fetch_url', '实际读取公开网页正文。搜索结果仅是候选，引用前用此工具打开来源；二进制文档须下载后读取。', { url: S }, ['url']),
  tool('ask_member', '请一位可直接连接的 API 成员给出独立观点、评估方案或检查论证。纯文字咨询，无需工作目录。提供具体问题和希望关注的角度。', { agent: S, task: S, acceptance: S }, ['agent', 'task', 'acceptance']),
  tool('assign_task', '安排实际工作。根据成员的 kind（cli 适合本地文件/代码/脚本/PDF 加工；api 适合检索/分析/审阅）、runtime（模型/CLI 工具）、persona 与 busy 状态挑选最匹配且空闲的成员。只查资料或审阅优先选 API 成员并设 read_only=true（Gemini 也支持）。写清输入路径、产物位置和验收标准。', { agent: S, task: S, acceptance: S, read_only: { type: 'boolean' }, retry_of: S }, ['agent', 'task', 'acceptance']),
  tool('team_status', '查看本项目的实际任务与成员工作状态。结果会自动回来，不要轮询等待。', {}, []),
  tool('wait_for_team', '结束本轮并等待成员结果，软件会自动接续。用于无需再次向用户汇报的中间步骤。', {}, []),
  tool('list_files', '只读列出本会话成员工作目录的文件，默认共享工作目录。', { path: S }, []),
  tool('inspect_file', '实际读取成果文件并记录校验值。交付前必须调用，检查文字是否完整、满足要求。长文/图片/表格/版式应另派成员使用对应工具审阅。', { path: S }, ['path']),
  ...VISUAL_TOOLS.map((item) => tool(item.name, item.description, { path: S, ...(item.name === 'view_pdf' ? { page: { type: 'integer', minimum: 1 } } : {}) }, ['path'])),
  tool('ask_user', '关键需求仍有多种理解，或缺少会影响交付的条件时，先问用户一个聚焦的问题，可给简短选项。记录等待状态，用户答复后沿用同一项目。', { question: S }, ['question']),
  tool('close_task', '已失败任务由其他成员接替并解决后，记录原因并关闭旧任务。不能关闭正在运行的任务。', { task_id: S, reason: S }, ['task_id', 'reason']),
  tool('deliver_files', '用 inspect_file 检查后交付文件。summary 用两三句话写明完成内容、核对过什么、还有什么未完成。有未解决任务时可用 remaining 明确交付阶段成果。软件保存实际副本和工具来源。', { paths: { type: 'array', items: S, minItems: 1, maxItems: 8 }, summary: S, remaining: S }, ['paths', 'summary'])
]

export class Manager {
  private runtimes = new Map<string, Runtime>()
  constructor(private store: Store, private host: ManagerHost) {}

  get(roomId: string): ManagerProject | null { return this.store.getManagerProject(roomId) }
  private save(p: ManagerProject): void {
    p.updatedAt = Date.now()
    this.store.saveManagerProject(p)
    this.host.emit({ type: 'manager', roomId: p.roomId, project: structuredClone(p) })
  }
  private post(roomId: string, text: string, deliveries?: DeliveryFile[], sources?: WorkSource[]): void {
    if (!this.store.getRoom(roomId)) return
    if (!deliveries?.length && !sources?.length) {
      const previous = this.store.getMessages(roomId).filter((m) => m.kind === 'chat' && !m.internal).at(-1)
      if (previous?.senderId === 'moderator' && previous.text === text) return
    }
    const m: Message = { id: randomUUID(), roomId, senderId: 'moderator', senderName: '经理', color: '#3678bf', text, ts: Date.now(), kind: 'chat', deliveries, sources }
    this.store.addMessage(m)
    this.host.emit({ type: 'message', message: m })
  }
  receive(message: Message): void {
    let p = this.get(message.roomId)
    if (!p || terminal(p)) p = { id: randomUUID(), roomId: message.roomId, sourceMessage: message.id, request: message.text || '处理所附材料', tasks: [], status: 'planning', note: '', updatedAt: Date.now(), automaticTurns: 0 }
    p.sourceMessage = message.id
    p.automaticTurns = 0
    if (p.status === 'stopped') p.status = 'planning'
    this.save(p)
    this.wake(message.roomId, '用户提出了新要求，优先回应最新消息，结合本项目已有任务推进；进度询问不能重派旧任务。', true)
  }
  resume(roomId: string): void {
    const p = this.get(roomId)
    if (!p || !moderatorReady(this.store.getModerator()) || !['blocked', 'stopped'].includes(p.status)) {
      throw new Error('这个会话没有需要继续的经理任务。')
    }
    if (this.runtimes.get(roomId)?.running || p.tasks.some(active)) return
    p.automaticTurns = 0
    p.status = 'planning'
    this.save(p)
    this.wake(roomId, '用户要求继续。先检查已保留成果和错误原因，再决定补做；应用重启前的操作不能假定完成。')
  }
  stop(roomId: string): void {
    const rt = this.runtimes.get(roomId)
    if (rt) { rt.dirty = false; rt.controller?.abort() }
    const p = this.get(roomId)
    if (!p || terminal(p)) return
    p.status = 'stopped'
    p.note = '已停止，现有成果和分工记录已保留。'
    for (const t of p.tasks.filter(active)) { t.status = 'interrupted'; t.result = '用户停止任务；继续前检查已有成果。'; t.updatedAt = Date.now() }
    this.save(p)
    this.host.cancel(roomId)
  }
  recover(): void {
    for (const room of this.store.state.rooms) {
      const p = this.get(room.id)
      if (!p || !['planning', 'working', 'reviewing'].includes(p.status) && !p.tasks.some(active)) continue
      for (const t of p.tasks.filter(active)) { t.status = 'interrupted'; t.result = '应用重启，执行结果待核对。'; t.updatedAt = Date.now() }
      p.status = 'blocked'
      p.note = '应用重启，已保留成果；点“继续处理”后经理会先检查现场。'
      this.save(p)
    }
  }
  started(roomId: string, tag: NonNullable<WorkHandoff['manager']>, runId: string): void {
    const p = this.get(roomId)
    const t = p?.id === tag.projectId ? p.tasks.find((t) => t.id === tag.taskId) : undefined
    if (!p || !t || t.attempts !== tag.attempt || p.status === 'stopped') return
    t.runId = runId; t.status = 'running'; t.updatedAt = Date.now()
    this.save(p)
  }
  completed(roomId: string, tag: NonNullable<WorkHandoff['manager']>, result: string, error = false, evidence?: WorkEvidence, stopped = false): void {
    const p = this.get(roomId)
    const t = p?.id === tag.projectId ? p.tasks.find((t) => t.id === tag.taskId) : undefined
    if (!p || !t || t.attempts !== tag.attempt || !active(t)) return
    if (evidence) {
      const existing = t.evidence?.sources ?? []
      t.evidence = {
        sources: [...new Map([...existing, ...evidence.sources].map((source) => [source.url, source])).values()].slice(0, 24),
        mayHaveChangedFiles: Boolean(t.evidence?.mayHaveChangedFiles || evidence.mayHaveChangedFiles)
      }
    }
    const failure = error ? workFailure(result) : undefined
    t.status = stopped ? 'interrupted' : error ? 'error' : 'done'
    t.result = (stopped ? '用户停止任务；继续前检查已有成果。' : failure ? failure.reason + '\n' + result : result).slice(0, 10000)
    t.updatedAt = Date.now()
    if (failure?.transient && !stopped && (t.readOnly || t.opinion) && !t.evidence?.mayHaveChangedFiles && t.attempts === 1) {
      const replacement = this.members(roomId).find((a) => a.kind === 'api' && a.id !== t.agentId && !p.tasks.some((other) => active(other) && other.agentId === a.id))
      if (replacement) {
        t.previousFailure = { agentName: t.agentName, reason: failure.reason }
        p.status = 'working'
        p.note = `${t.agentName}暂未返回，已安排${replacement.name}接手。`
        const context = `沿用本项目需求：${p.request.slice(0, 3500)}\n原成员未能完成。已有回报：\n${t.result.slice(0, 4500)}\n实际取得的来源：${JSON.stringify(t.evidence?.sources ?? []).slice(0, 4500)}`
        this.assign(p, t, replacement, context)
        if (t.status !== 'error') return
      }
    }
    this.save(p)
    if (p.status !== 'stopped') this.wake(roomId, `有成员任务返回。按实际回报核对结果。失败时保留已完成部分；可能改动过现场的任务先检查，停止的任务不自动重派。`)
  }

  private members(roomId: string): Agent[] {
    return (this.store.getRoom(roomId)?.participantIds ?? []).map((id) => this.store.getAgent(id)).filter((agent): agent is Agent => {
      if (agent?.kind === 'cli') return Boolean(agent.cli?.command?.trim())
      return agent?.kind === 'api' && Boolean(agent.model && agent.providerId && this.store.getProvider(agent.providerId)?.baseUrl.trim())
    })
  }

  private assign(p: ManagerProject, t: ManagerTask, agent: Agent, context: string): void {
    t.agentId = agent.id
    t.agentName = agent.name
    t.status = 'queued'
    t.attempts++
    t.runId = undefined
    t.result = undefined
    t.updatedAt = Date.now()
    this.save(p)
    try {
      this.host.dispatch(p.roomId, agent.id, `${t.task}\n\n经理的验收标准：${t.acceptance}\n请回报实际结果、依据、文件路径和卡点，由经理继续协调。`, p.sourceMessage, {
        sourceMessage: p.sourceMessage, path: [], context,
        manager: { projectId: p.id, taskId: t.id, attempt: t.attempts, opinion: t.opinion, readOnly: t.readOnly }
      })
      const sent: Message = {
        id: randomUUID(), roomId: p.roomId, senderId: 'moderator', senderName: '经理', color: '#3678bf',
        text: `**交给 ${agent.name}**\n\n${t.task}\n\n验收要求：${t.acceptance}`,
        ts: Date.now(), kind: 'chat', internal: true
      }
      this.store.addMessage(sent)
      this.host.emit({ type: 'message', message: sent })
    } catch (error) {
      t.status = 'error'
      t.result = workFailure(error).reason
      this.save(p)
    }
  }

  private sources(p: ManagerProject): WorkSource[] {
    const sources = new Map<string, WorkSource>()
    for (const source of [...(p.sources ?? []), ...p.tasks.flatMap((task) => task.evidence?.sources ?? [])]) {
      if (sources.get(source.url)?.kind !== 'page' || source.kind === 'page') sources.set(source.url, source)
    }
    return [...sources.values()].slice(0, 24)
  }
  private wake(roomId: string, reason: string, interrupt = false): void {
    let rt = this.runtimes.get(roomId)
    if (!rt) { rt = { running: false, dirty: false, reason }; this.runtimes.set(roomId, rt) }
    rt.dirty = true; rt.reason = reason
    if (interrupt) rt.controller?.abort()
    if (!rt.running) void this.pump(roomId, rt)
  }
  private async pump(roomId: string, rt: Runtime): Promise<void> {
    rt.running = true
    try {
      while (rt.dirty) {
        rt.dirty = false
        const p = this.get(roomId)
        if (!p || terminal(p) || p.status === 'stopped' || !this.store.getRoom(roomId)) break
        const ctl = new AbortController(); rt.controller = ctl
        try { await this.turn(p, rt.reason, ctl.signal, () => rt.dirty) }
        catch (error) {
          if (ctl.signal.aborted) continue
          if (!this.store.getRoom(roomId)) break
          const failure = workFailure(error)
          if (failure.transient && rt.dirty) continue
          if (failure.transient && p.tasks.some(active)) {
            p.status = 'working'
            p.note = `等待成员回报：${failure.reason} 收到回报后经理会自动接续。`
            this.save(p)
            continue
          }
          p.status = 'blocked'; p.note = `经理暂时未完成处理：${failure.reason}`
          this.save(p); this.post(roomId, p.note + ' 已保留任务与成果，可以继续处理。')
        }
      }
    } finally { rt.running = false; rt.controller = undefined }
  }
  private async turn(p: ManagerProject, reason: string, signal: AbortSignal, hasNewEvent: () => boolean): Promise<void> {
    const cfg = this.store.getModerator()
    if (!moderatorReady(cfg)) throw new Error('请在设置 → 主持人中配置并启用经理使用的模型。')
    if (++p.automaticTurns > 18) throw new Error('本项目已连续协调 18 轮，请确认进度后继续。')
    const room = this.store.getRoom(p.roomId)!
    const members = this.members(p.roomId)
    const roots = this.host.roots(p.roomId)
    p.status = p.tasks.some(active) ? 'working' : p.tasks.length ? 'reviewing' : 'planning'
    if (p.status !== 'working' || !p.note.includes('接手')) {
      p.note = p.status === 'working' ? '经理正在跟进成员任务' : p.status === 'reviewing' ? '经理正在检查成果' : '经理正在处理你的要求'
    }
    this.save(p)
    const messages = this.store.getMessages(p.roomId)
    const history = messages.filter((m) => m.kind === 'chat' && !m.internal).slice(-20)
    const recentDeliveries = messages.filter((m) => m.deliveries?.length).slice(-3)
      .flatMap((m) => m.deliveries ?? []).map(({ name, path }) => ({ name, path }))
    const input: AgentMsg[] = [{ role: 'system', content: [
      managerPolicy,
      `当前群聊：${room.name}。常规答复两三句，用户要求完整内容时按要求展开。用户点名成员时优先采纳。`,
      `可用成员：${JSON.stringify(members.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        runtime: a.kind === 'cli' ? (a.cli?.session && a.cli.session !== 'none' ? a.cli.session : a.cli?.command || 'cli') : a.model,
        busy: p.tasks.some((other) => active(other) && other.agentId === a.id),
        canGiveOpinion: a.kind === 'api',
        access: a.access ?? 'workspace',
        persona: a.persona?.slice(0, 600)
      })))}。选人时对照任务类型、成员 runtime/kind/persona/capabilities 与 busy 状态择优指派；用户点名成员时优先采纳。请本地成员参与时用 assign_task 指明只评估或需要实际执行什么。`,
      this.host.capabilities ? `当前能力记录：${await this.host.capabilities(p.roomId, undefined, signal)}` : '',
      `获准的工作目录：${JSON.stringify(roots)}。相对路径默认第一个目录。交付副本由软件保存，保留源文件。`
    ].join('\n') }, { role: 'user', content: `触发原因：${reason}\n项目需求：${p.request}\n本会话近期交付副本：${JSON.stringify(recentDeliveries)}\n实际分工和回报：${JSON.stringify(p.tasks.map((task) => ({ ...task, task: task.task.slice(0, 1600), result: task.result?.slice(0, 3500) })))}\n本会话最近消息：\n${history.map((m) => `[${m.senderId === 'user' ? '用户' : m.senderName}] ${m.text.slice(0, 2200)}${m.attachments?.map((a) => `\n附件 ${a.name} (${a.path}): ${a.text?.slice(0, 7000) ?? '未提取到文字，需成员实际读取'}`).join('') ?? ''}`).join('\n').slice(-26000)}` }]
    const provider = { ...cfg, id: 'manager', name: '经理', models: [cfg.model] }
    const checked = new Map<string, DeliveryFile>()
    const listed = new Set<string>()
    const observeTool = this.host.observeTool?.(p.roomId)
    const onModelRate = modelRateObserver(this.host.emit, p.roomId, '经理')
    let delivered = false
    let deliveryError = ''
    let visualAvailable = true
    for (let step = 0; step < 13; step++) {
      signal.throwIfAborted()
      let result
      try {
        result = await chatOnce(provider, cfg.model, input,
          step < 12 ? TOOLS.filter((item) => visualAvailable || !VISUAL_TOOLS.some((visual) => visual.name === item.function.name)) : undefined,
          signal, (detail) => { p.note = detail; this.save(p) }, cfg.reasoningEffort, { retryTimeout: true, onModelRate })
      } catch (error) {
        if (!visualAvailable || !imageInputError(error) || !input.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'))) throw error
        visualAvailable = false
        for (const message of input) {
          if (Array.isArray(message.content)) message.content = message.content.map((part) =>
            part.type === 'image_url' ? { type: 'text', text: '[经理模型未能接收这张画面，视觉检查未完成]' } : part)
        }
        input.push({ role: 'user', content: '经理模型不接受图片输入。请安排支持图像输入的成员使用 view_image/view_pdf 完成视觉检查，再根据其实际回报验收。' })
        continue
      }
      signal.throwIfAborted()
      if (!result.toolCalls?.length) {
        const reply = result.content.trim()
        if (!reply) throw new Error('主持人模型没有返回答复，请重试或检查模型配置。')
        if (deliveryError && !p.tasks.some(active)) throw new Error(`文件还未交付。\n${deliveryError}`)
        const resting = !hasNewEvent() && !p.tasks.some(active)
        if (!delivered) this.post(p.roomId, reply, undefined, resting ? this.sources(p) : undefined)
        if (!delivered) {
          const failed = p.tasks.some((t) => t.status === 'error' || t.status === 'interrupted')
          if (hasNewEvent()) {
            p.status = 'reviewing'
            p.note = '已收到新回报，经理正在接手'
          } else if (p.tasks.some(active)) {
            p.status = 'working'
            if (!p.note.includes('接手')) p.note = '成员正在执行，结果返回后经理会自动检查'
          } else if (failed) {
            p.status = 'blocked'
            const task = p.tasks.find((item) => item.status === 'error' || item.status === 'interrupted')!
            p.note = `${task.agentName} · ${workFailure(task.result || '任务未完成').reason}`
          } else {
            p.status = 'idle'
            p.note = '本轮已回复'
          }
          this.save(p)
        }
        return
      }
      input.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls })
      const pictures: AgentMsg[] = []
      for (const call of result.toolCalls) {
        signal.throwIfAborted()
        let output: string
        const name = call.function.name
        let activity: ReturnType<ObserveTool> | undefined
        try {
          if (delivered) throw new Error('已交付，本轮不得继续派工或重复交付。')
          const args = JSON.parse(call.function.arguments) as Record<string, unknown>
          if (FILE_TOOL_NAMES.has(name) || ['web_search', 'fetch_url', 'list_files', 'view_image', 'view_pdf', 'inspect_file', 'deliver_files', 'check_capabilities'].includes(name)) {
            activity = observeTool?.(name, args)
          }
          if (name === 'check_capabilities') {
            if (!this.host.capabilities) throw new Error('当前没有能力检测入口。')
            output = await this.host.capabilities(p.roomId, str(args.agent) || undefined, signal)
          } else if (FILE_TOOL_NAMES.has(name)) {
            output = await executeFileTool(name, args, managerPath(roots, str(args.path) || '.'), signal)
          } else if (name === 'web_search' || name === 'fetch_url') {
            output = name === 'web_search' ? await searchWeb(args.query, signal) : await fetchUrl(str(args.url), signal, activity?.transfer)
            const page = name === 'fetch_url' && output.startsWith('HTTP 2') ? accessedPage(args.url) : undefined
            const sources = name === 'web_search' ? webSearchSources(output) : page ? [page] : []
            for (const source of sources) {
              const list = p.sources ??= [], at = list.findIndex((item) => item.url === source.url)
              if (at >= 0 && (source.kind === 'page' || list[at].kind !== 'page')) list[at] = source
              else if (at < 0 && list.length < 24) list.push(source)
            }
            this.save(p)
          } else if (name === 'assign_task' || name === 'ask_member') {
            const agent = members.find((a) => a.id === str(args.agent) || a.name === str(args.agent))
            if (!agent || !this.store.getRoom(p.roomId)?.participantIds.includes(agent.id)) throw new Error('成员不存在或已移出，请使用完整成员名。')
            if (name === 'ask_member' && agent.kind !== 'api') throw new Error('该成员通过本地工具运行。请改用 assign_task 并写清咨询范围，或选择 API 成员。')
            const task = str(args.task), acceptance = str(args.acceptance)
            const readOnly = name === 'assign_task' && args.read_only === true
            if (readOnly && agent.kind !== 'api' && agent.cli?.session !== 'agy') throw new Error('请选择 API 或 Gemini 成员执行只读任务。')
            if (!task || !acceptance || task.length > 10000 || acceptance.length > 2000) throw new Error('请提供具体任务（不超过 10000 字）和验收标准（不超过 2000 字）。')
            let t = str(args.retry_of) ? p.tasks.find((t) => t.id === str(args.retry_of)) : undefined
            if (str(args.retry_of) && (!t || !['error', 'interrupted'].includes(t.status) || t.attempts >= 2)) throw new Error('只能重试失败/中断任务，最多重试一次。')
            if (t?.status === 'interrupted' && /用户停止/.test(t.result ?? '') &&
              !/用户要求继续|用户提出了新要求/.test(reason)) throw new Error('用户已经停止这一项，请等用户要求继续。')
            if (t && (t.runId || t.evidence?.mayHaveChangedFiles) && !t.readOnly && !t.opinion && !checked.size && !listed.size) throw new Error('上次可能已动过文件。请先查看相关目录并检查已有成果，再只补剩余工作。')
            if (t) t.previousFailure = { agentName: t.agentName, reason: workFailure(t.result ?? '').reason }
            if (!t && p.tasks.some((x) => x.task === task && x.status !== 'closed' && (x.agentId === agent.id || x.status === 'error' || x.status === 'interrupted'))) throw new Error('已派过相同任务，请查看回报。接手失败的任务时用 retry_of。')
            if (!t && p.tasks.filter(active).length >= 16) throw new Error('当前排队或执行中的任务已达 16 项，请等待已有任务回报后再派新任务。已结束的历史任务不占名额。')
            if (!t) { t = { id: randomUUID(), agentId: agent.id, agentName: agent.name, task, acceptance, status: 'queued', attempts: 0, updatedAt: Date.now() }; p.tasks.push(t) }
            t.task = task
            t.acceptance = acceptance
            t.readOnly = readOnly
            t.opinion = name === 'ask_member'
            this.assign(p, t, agent, input[1].content as string)
            if (t.status === 'error') throw new Error(t.result)
            output = JSON.stringify({ task_id: t.id, status: t.status, message: '任务已真正登记；结果自动返回，请结束本轮等待回报。' })
          } else if (name === 'wait_for_team') {
            if (!p.tasks.some(active) && !hasNewEvent()) throw new Error('成员结果已经返回，请查看分工回报并给用户结论。')
            p.status = hasNewEvent() ? 'reviewing' : 'working'
            if (!p.note.includes('接手')) p.note = hasNewEvent() ? '已收到新回报，经理正在接手' : '等待成员回报'
            this.save(p)
            return
          } else if (name === 'team_status') output = JSON.stringify({ tasks: p.tasks, members: this.host.team(p.roomId) })
          else if (name === 'list_files') {
            const path = str(args.path) || '.'
            output = await listManagerFiles(roots, path)
            listed.add(path)
          }
          else if (name === 'view_image' || name === 'view_pdf') {
            const image = await viewVisualFile(managerPath(roots, str(args.path)), name, args.page, signal)
            output = image.summary
            pictures.push(visualMessage(image))
          }
          else if (name === 'inspect_file') {
            const inspected = await inspectManagerFile(roots, str(args.path))
            signal.throwIfAborted()
            checked.set(inspected.file.path, { ...inspected.file, coverage: inspected.coverage })
            output = JSON.stringify(inspected)
          } else if (name === 'close_task') {
            const t = p.tasks.find((t) => t.id === str(args.task_id))
            if (!t || !['error', 'interrupted'].includes(t.status) || !str(args.reason)) throw new Error('只能关闭已失败/中断任务，需说明由什么成果替代或问题如何解决。')
            t.status = 'closed'; t.result = `${t.result ?? ''}\n经理处置：${str(args.reason).slice(0, 1200)}`; t.updatedAt = Date.now(); this.save(p); output = '旧任务已关闭，原因已记录。'
          } else if (name === 'ask_user') {
            const question = str(args.question)
            if (!question || question.length > 500 || p.tasks.some(active)) throw new Error('请等正在执行的任务返回，再提出一个具体问题。')
            p.status = 'blocked'
            p.note = '等待补充信息'
            this.save(p)
            this.post(p.roomId, question)
            return
          } else if (name === 'deliver_files') {
            const remaining = str(args.remaining).slice(0, 1000)
            const unresolved = p.tasks.some((t) => t.status === 'error' || t.status === 'interrupted')
            if (p.tasks.some(active) || (unresolved && !remaining)) throw new Error('请等待成员返回；有未解决任务时请注明阶段成果和还差什么。')
            const paths = Array.isArray(args.paths) ? args.paths.map(str) : []
            if (!paths.length || paths.length > 8 || new Set(paths).size !== paths.length || !str(args.summary)) throw new Error('需提供 1–8 个不同的已检查文件及交付说明。')
            const files = paths.map((path) => [...checked.values()].find((file) => file.path === path))
            if (files.some((file) => !file)) throw new Error('文件尚未检查，请先 inspect_file，再用回执里的完整路径交付。')
            const snapshots = await this.host.mutate(signal, () => snapshotDelivery(roots, p.id, files as DeliveryFile[], signal))
            signal.throwIfAborted()
            p.status = unresolved ? 'blocked' : 'delivered'
            p.note = unresolved ? '已交付阶段成果，还有任务待处理。' : `已交付 ${snapshots.length} 个文件`
            this.save(p)
            const recap = [str(args.summary).slice(0, 2400), remaining && `待完成：${remaining}`].filter(Boolean).join('\n\n')
            this.post(p.roomId, recap, snapshots, this.sources(p))
            delivered = true; output = '文件已保存为交付副本并显示卡片。本轮直接结束，无需重复通知。'
          } else throw new Error('未知经理工具。')
        } catch (error) {
          signal.throwIfAborted()
          output = `操作未完成：${error instanceof Error ? error.message : String(error)}`
          if (name === 'deliver_files') deliveryError = output
        } finally {
          activity?.finish()
        }
        input.push({ role: 'tool', tool_call_id: call.id, content: output })
      }
      input.push(...pictures)
      if (delivered) return
    }
    throw new Error('本轮协调步骤已达上限，现有分工与成果已保留。')
  }
}
