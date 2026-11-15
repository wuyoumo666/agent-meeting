import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Agent, AgentSession, AppState, ManagerProject, MemoryRecord, Message, ModelCapabilities, ModeratorConfig, ModeratorUpdate, Provider, ProviderUpdate, Room, RulesFile, ScheduledTask } from '../shared/types'
import { AGENT_COLORS, CLI_PRESETS, DEFAULT_RULES } from '../shared/types'
import { readCliModelFromConfig, modelToHandle } from './adapters/cli'
import { loadRulesFile, saveRulesFile } from './rules'
import { WindowsCredentials } from './credentials'

interface SessionInfo {
  sessionId?: string
  lastSeenTs?: number
  roomScoped?: boolean
}

type SavedCredential = { apiKey?: string; credentialRef?: string }
type SavedProvider = Omit<Provider, 'apiKey'> & SavedCredential
type SavedModerator = Omit<ModeratorConfig, 'apiKey'> & SavedCredential

/** 排队中的工作区任务（只保存尚未开始执行的，避免重启后重复跑已完成的任务） */
export interface PendingWork {
  roomId: string
  agentId: string
  task: string
  expectedDirectory?: string
  queuedAt: number
  sourceMessage?: string
  handoff?: WorkHandoff
}

/** Keep the original user request and delegation chain when a job is queued. */
export interface WorkHandoff {
  manager?: { projectId: string; taskId: string; attempt: number; opinion?: boolean; readOnly?: boolean }
  sourceMessage?: string
  requesterId?: string
  path: string[]
  context: string
}

interface Db extends Omit<AppState, 'providers' | 'moderator'> {
  capabilityChecks?: Record<string, ModelCapabilities>
  managerProjects?: Record<string, ManagerProject>
  providers: SavedProvider[]
  moderator?: SavedModerator
  messages: Message[]
  sessions: Record<string, SessionInfo>
  /** 每个房间的长期记忆（项目进度记录） */
  memories?: Record<string, MemoryRecord[]>
  /** 每个房间已归档到的消息时间戳 */
  compactedTs?: Record<string, number>
  /** 每个 bot 的独立会话（key = agent:agentId，跨群聊/私聊共享） */
  agentSessions?: Record<string, AgentSession>
  /** 尚未开始的工作区任务，应用重启后恢复排队 */
  pendingWork?: PendingWork[]
}

const DEFAULT_MODERATOR: SavedModerator = { enabled: false, baseUrl: '', model: '' }

const emptyDb = (): Db => ({ providers: [], agents: [], rooms: [], messages: [], sessions: {}, workDir: '', moderator: { ...DEFAULT_MODERATOR }, memories: {}, compactedTs: {}, scheduledTasks: [] })

export class Store {
  private db: Db
  private messagesByRoom = new Map<string, Message[]>()
  private messagesById = new Map<string, Message>()
  private file: string
  private agentsMd: string
  private skillsDir: string
  private rules: RulesFile
  private saveTimer: NodeJS.Timeout | null = null
  private readonly credentials: WindowsCredentials
  private keys = new Map<string, string>()
  private credentialNotice?: string
  private credentialQueue = Promise.resolve()

  constructor() {
    this.file = join(app.getPath('userData'), 'data.json')
    this.credentials = new WindowsCredentials(app.getPath('userData'))
    this.agentsMd = join(app.getAppPath(), 'AGENTS.md')
    this.skillsDir = join(app.getAppPath(), 'skills')
    this.db = this.load()
    for (const message of this.db.messages) this.indexMessage(message)
    this.rules = loadRulesFile(this.agentsMd) ?? { ...DEFAULT_RULES }
    if (this.db.agents.length === 0 && this.db.rooms.length === 0) this.seed()
    else this.migrate()
  }

  async loadCredentials(): Promise<void> {
    const configs = [...this.db.providers, ...(this.db.moderator ? [this.db.moderator] : [])]
    const pending = configs.filter((config) => config.apiKey || config.credentialRef)
    const refs = pending.map((config) => config.credentialRef ?? ('id' in config ? 'migrated-provider-' + config.id : 'migrated-moderator'))
    if (!pending.length) return
    try {
      const results = await this.credentials.apply(pending.map((config, i) => config.apiKey
        ? { operation: 'write', target: this.credentials.target(refs[i]), value: config.apiKey }
        : { operation: 'read', target: this.credentials.target(refs[i]) }))
      const migrated: { config: SavedCredential; original: string; previous?: string }[] = []
      results.forEach((result, i) => {
        const config = pending[i]
        if (!result.ok || (!config.apiKey && !result.value)) {
          this.credentialNotice = '部分 API 密钥暂时无法迁入或读取。请在对应设置中检查密钥。'
          return
        }
        const key = config.apiKey || result.value!
        this.keys.set(refs[i], key)
        if (config.apiKey) {
          migrated.push({ config, original: key, previous: config.credentialRef })
          config.credentialRef = refs[i]
          delete config.apiKey
        }
      })
      if (!migrated.length) return
      try { this.flush() } catch (error) {
        for (const { config, original, previous } of migrated) {
          config.apiKey = original
          config.credentialRef = previous
        }
        throw error
      }
    } catch {
      this.credentialNotice = '暂时无法完成 Windows 凭据迁移。请在设置中检查，原密钥仍可用于现有连接。'
    }
  }

  private credentialKey(config: SavedCredential): string {
    return config.apiKey || (config.credentialRef ? this.keys.get(config.credentialRef) ?? '' : '')
  }

  private updateCredential(action: () => Promise<void>): Promise<void> {
    const result = this.credentialQueue.then(action)
    this.credentialQueue = result.then(() => {}, () => {})
    return result
  }

  private async replaceCredential(key: string | undefined, previous: SavedCredential, apply: (credential: SavedCredential) => () => void): Promise<void> {
    let ref = previous.credentialRef
    if (key) {
      if (Buffer.byteLength(key) > 2560) throw new Error('API 密钥超过 Windows 凭据管理器的长度限制。')
      ref = randomUUID()
      const [result] = await this.credentials.apply([{ operation: 'write', target: this.credentials.target(ref), value: key }])
      if (!result.ok) throw new Error('无法保存 API 密钥到 Windows 凭据管理器。')
      this.keys.set(ref, key)
    } else if (key === '') {
      ref = undefined
    }
    const undo = apply({ credentialRef: ref, apiKey: key === undefined ? previous.apiKey : undefined })
    try { this.flush() } catch {
      undo()
      if (ref && ref !== previous.credentialRef) await this.removeCredential(ref)
      throw new Error('无法保存设置，请重试。')
    }
    if (previous.credentialRef && previous.credentialRef !== ref) await this.removeCredential(previous.credentialRef)
  }

  private async removeCredential(ref: string): Promise<void> {
    this.keys.delete(ref)
    try {
      const [result] = await this.credentials.apply([{ operation: 'delete', target: this.credentials.target(ref) }])
      if (!result.ok) throw new Error()
    } catch {
      this.credentialNotice = '旧密钥仍在 Windows 凭据管理器中，当前配置已停止使用它。'
    }
  }

  getRules(): RulesFile {
    return this.rules
  }
  getSkillsDir(): string {
    return this.skillsDir
  }
  getMcpConfigPath(): string {
    return join(app.getAppPath(), 'mcp.json')
  }
  getCapability(fingerprint: string): ModelCapabilities | undefined { return this.db.capabilityChecks?.[fingerprint] }
  saveCapability(record: ModelCapabilities): void {
    const checks = this.db.capabilityChecks ??= {}
    checks[record.fingerprint] = record
    for (const old of Object.values(checks).sort((a,b) => b.checkedAt - a.checkedAt).slice(40)) delete checks[old.fingerprint]
    this.save()
  }
  setRules(r: RulesFile): void {
    this.rules = r
    try {
      saveRulesFile(this.agentsMd, r)
    } catch {
      // 文件不可写则仅内存生效
    }
  }

  /** 老数据迁移：保证恰有一个 agy 参会者；CLI agent 身份跟随底层模型名 */
  private migrate(): void {
    let changed = false
    // 用稳定的 session 标记识别 agy（名字会随模型改变，不能用名字判断）
    const agys = this.db.agents.filter((a) => a.cli?.session === 'agy')
    if (agys.length === 0) {
      const agy: Agent = {
        id: randomUUID(), name: 'agy', color: AGENT_COLORS[4], kind: 'cli',
        persona: '你是 Antigravity（agy），一个本地编程 agent。讨论时聚焦实现方案。',
        cli: { ...CLI_PRESETS.agy.cli, args: [...CLI_PRESETS.agy.cli.args] }
      }
      this.db.agents.push(agy)
      const room = this.db.rooms[0]
      if (room) {
        for (const name of ['CodeBuddy', 'agy']) {
          const a = this.db.agents.find((x) => x.name === name)
          if (a && !room.participantIds.includes(a.id)) room.participantIds.push(a.id)
        }
      }
      changed = true
    } else if (agys.length > 1) {
      // 历史 bug 产生的重复 agy：保留第一个，其余移除
      const keep = agys[0].id
      const drop = new Set(agys.slice(1).map((a) => a.id))
      this.db.agents = this.db.agents.filter((a) => !drop.has(a.id))
      for (const r of this.db.rooms) {
        r.participantIds = r.participantIds.filter((id) => !drop.has(id))
        if (!r.participantIds.includes(keep)) r.participantIds.push(keep)
      }
      changed = true
    }
    for (const a of this.db.agents) {
      if (a.kind !== 'cli' || a.autoName === false || !a.cli) continue
      // 旧版 agy 预设（json 无流式）升级到 stream-json
      if (a.cli.session === 'agy' && a.cli.outputMode === 'json') {
        a.cli = { ...CLI_PRESETS.agy.cli, args: [...CLI_PRESETS.agy.cli.args], cwd: a.cli.cwd }
        changed = true
      }
      // codebuddy：把「--tools ""」（禁所有工具）或旧版「Read」升级为「Read,ViewImage」（可读文本+看图片）
      if (a.cli.session === 'claude') {
        const ti = a.cli.args.indexOf('--tools')
        if (ti >= 0 && (a.cli.args[ti + 1] === '' || a.cli.args[ti + 1] === 'Read')) {
          a.cli.args[ti + 1] = 'Read,ViewImage'
          changed = true
        }
      }
      const model = readCliModelFromConfig(a.cli.session)
      if (!model) continue
      const handle = modelToHandle(model)
      if (handle && handle !== a.name && !this.db.agents.some((x) => x.id !== a.id && x.name === handle)) {
        a.name = handle
        changed = true
      }
    }
    if (changed) this.flush()
  }

  private load(): Db {
    try {
      if (existsSync(this.file)) {
        return { ...emptyDb(), ...JSON.parse(readFileSync(this.file, 'utf8')) }
      }
    } catch (e) {
      console.error('[store] load failed, starting fresh:', e)
    }
    return emptyDb()
  }

  private seed(): void {
    const demoA: Agent = {
      id: randomUUID(), name: '演示甲', color: AGENT_COLORS[0], kind: 'demo',
      persona: '离线演示 agent，用于验证群聊链路。'
    }
    const demoB: Agent = {
      id: randomUUID(), name: '演示乙', color: AGENT_COLORS[2], kind: 'demo',
      persona: '离线演示 agent，用于验证群聊链路。'
    }
    const codebuddy: Agent = {
      id: randomUUID(), name: 'CodeBuddy', color: AGENT_COLORS[1], kind: 'cli',
      persona: '你是 CodeBuddy，一个本地编程 agent。讨论时聚焦技术方案。',
      cli: { ...CLI_PRESETS.codebuddy.cli, args: [...CLI_PRESETS.codebuddy.cli.args] }
    }
    const agy: Agent = {
      id: randomUUID(), name: 'agy', color: AGENT_COLORS[4], kind: 'cli',
      persona: '你是 Antigravity（agy），一个本地编程 agent。讨论时聚焦实现方案。',
      cli: { ...CLI_PRESETS.agy.cli, args: [...CLI_PRESETS.agy.cli.args] }
    }
    const provider: Provider = {
      id: randomUUID(), name: 'DeepSeek（示例）', baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner']
    }
    const room: Room = {
      id: randomUUID(), name: '默认会议室',
      participantIds: [demoA.id, demoB.id, codebuddy.id, agy.id], createdAt: Date.now()
    }
    this.db.agents = [demoA, demoB, codebuddy, agy]
    this.db.providers = [provider]
    this.db.rooms = [room]
    this.flush()
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 300)
  }

  flushNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.flush()
  }

  get state(): AppState {
    const moderator = { ...DEFAULT_MODERATOR, ...this.db.moderator }
    return {
      providers: this.db.providers.map(({ apiKey, credentialRef, ...config }) => ({ ...config, hasApiKey: Boolean(apiKey || credentialRef) })),
      agents: this.db.agents, rooms: this.db.rooms, workDir: this.db.workDir, approvalSound: this.db.approvalSound !== false,
      moderator: {
        enabled: moderator.enabled, providerId: moderator.providerId, reviewCommands: moderator.reviewCommands,
        baseUrl: (moderator.providerId ? this.db.providers.find((p) => p.id === moderator.providerId)?.baseUrl : moderator.baseUrl) ?? '',
        model: moderator.model, models: moderator.models, reasoningEffort: moderator.reasoningEffort,
        hasApiKey: Boolean(moderator.providerId
          ? this.db.providers.some((p) => p.id === moderator.providerId && (p.apiKey || p.credentialRef))
          : moderator.apiKey || moderator.credentialRef)
      },
      rules: { ...this.rules }, credentialNotice: this.credentialNotice,
      scheduledTasks: [...(this.db.scheduledTasks ?? [])]
    }
  }

  getModerator(): ModeratorConfig {
    const cfg = { ...DEFAULT_MODERATOR, ...this.db.moderator }
    const provider = cfg.providerId ? this.getProvider(cfg.providerId) : undefined
    return {
      enabled: cfg.enabled, providerId: cfg.providerId, reviewCommands: cfg.reviewCommands,
      baseUrl: cfg.providerId ? provider?.baseUrl ?? '' : cfg.baseUrl,
      model: cfg.model, models: cfg.models, reasoningEffort: cfg.reasoningEffort,
      apiKey: cfg.providerId ? provider?.apiKey ?? '' : this.credentialKey(cfg)
    }
  }
  setModerator({ apiKey, enabled, baseUrl, model, models, reviewCommands, providerId, reasoningEffort }: ModeratorUpdate): Promise<void> {
    return this.updateCredential(async () => {
      const previous = this.db.moderator
      if (providerId) {
        const provider = this.getProvider(providerId)
        if (!provider) throw new Error('所选模型服务已不存在，请重新选择。')
        await this.replaceCredential('', previous ?? {}, () => {
          this.db.moderator = { enabled, providerId, baseUrl: provider.baseUrl, model, models, reasoningEffort, reviewCommands: reviewCommands ?? previous?.reviewCommands }
          return () => { this.db.moderator = previous }
        })
        return
      }
      this.checkKeyEndpoint(previous, baseUrl, apiKey)
      await this.replaceCredential(apiKey, previous ?? {}, (credential) => {
        this.db.moderator = { enabled, baseUrl, model, models, reasoningEffort, reviewCommands: reviewCommands ?? previous?.reviewCommands, ...credential }
        return () => { this.db.moderator = previous }
      })
    })
  }

  getWorkDir(): string {
    return this.db.workDir ?? ''
  }
  setWorkDir(p: string): void {
    this.db.workDir = p
    this.save()
  }

  getApprovalSound(): boolean { return this.db.approvalSound !== false }
  setApprovalSound(enabled: boolean): void {
    this.db.approvalSound = enabled
    this.save()
  }

  // ---- 长期记忆（项目进度） ----
  getMemories(roomId: string): MemoryRecord[] {
    return this.db.memories?.[roomId] ?? []
  }
  addMemory(roomId: string, rec: MemoryRecord): void {
    if (!this.db.memories) this.db.memories = {}
    if (!this.db.memories[roomId]) this.db.memories[roomId] = []
    this.db.memories[roomId].push(rec)
    this.save()
  }
  setMemories(roomId: string, list: MemoryRecord[]): void {
    if (!this.db.memories) this.db.memories = {}
    this.db.memories[roomId] = list
    this.save()
  }
  setMemoryPinned(roomId: string, id: string, pinned: boolean): void {
    const list = this.db.memories?.[roomId]
    if (!list) return
    const rec = list.find((m) => m.id === id)
    if (!rec) return
    rec.pinned = pinned
    this.save()
  }
  getAllMemories(): Record<string, MemoryRecord[]> {
    return this.db.memories ?? {}
  }
  deleteMemory(roomId: string, id: string): void {
    const list = this.db.memories?.[roomId]
    if (!list) return
    this.db.memories![roomId] = list.filter((m) => m.id !== id)
    this.save()
  }
  clearMemories(roomId: string): void {
    if (this.db.memories) this.db.memories[roomId] = []
    this.save()
  }
  getCompactedTs(roomId: string): number {
    return this.db.compactedTs?.[roomId] ?? 0
  }
  setCompactedTs(roomId: string, ts: number): void {
    if (!this.db.compactedTs) this.db.compactedTs = {}
    this.db.compactedTs[roomId] = ts
    this.save()
  }

  // ---- providers ----
  saveProvider({ id, name, baseUrl, models, apiKey }: ProviderUpdate): Promise<void> {
    return this.updateCredential(async () => {
      const previous = this.db.providers
      const current = previous.find((provider) => provider.id === id)
      this.checkKeyEndpoint(current, baseUrl, apiKey)
      await this.replaceCredential(apiKey, current ?? {}, (credential) => {
        const saved = { id, name, baseUrl, models, ...credential }
        this.db.providers = current ? previous.map((provider) => provider.id === id ? saved : provider) : [...previous, saved]
        return () => { this.db.providers = previous }
      })
    })
  }
  deleteProvider(id: string): Promise<void> {
    return this.updateCredential(async () => {
      const previous = this.db.providers
      const current = previous.find((provider) => provider.id === id)
      if (!current) return
      await this.replaceCredential('', current, () => {
        this.db.providers = previous.filter((provider) => provider.id !== id)
        return () => { this.db.providers = previous }
      })
    })
  }
  getProvider(id: string): Provider | undefined {
    const p = this.db.providers.find((x) => x.id === id)
    return p && { id: p.id, name: p.name, baseUrl: p.baseUrl, models: p.models, apiKey: this.credentialKey(p) }
  }

  private checkKeyEndpoint(config: (SavedCredential & { baseUrl: string }) | undefined, baseUrl: string, key: string | undefined): void {
    const normalize = (url: string): string => url.trim().replace(/\/+$/, '')
    if (key === undefined && config && (config.apiKey || config.credentialRef) && normalize(config.baseUrl) !== normalize(baseUrl)) {
      throw new Error('地址已改变。请填写该地址的密钥，或选择移除已保存的密钥。')
    }
  }

  modelListKey(baseUrl: string, input: string | undefined, id?: string): string {
    if (input !== undefined) return input
    const config = id === undefined ? this.db.moderator : this.db.providers.find((p) => p.id === id)
    this.checkKeyEndpoint(config, baseUrl, input)
    return config ? this.credentialKey(config) : ''
  }

  // ---- agents ----
  saveAgent(a: Agent): void {
    const i = this.db.agents.findIndex((x) => x.id === a.id)
    if (i >= 0) this.db.agents[i] = a
    else this.db.agents.push(a)
    for (const r of this.db.rooms) {
      if (r.kind === 'dm' && r.participantIds.includes(a.id)) r.name = a.name
    }
    this.save()
  }
  deleteAgent(id: string): void {
    this.db.agents = this.db.agents.filter((x) => x.id !== id)
    this.db.rooms = this.db.rooms.filter((r) => !(r.kind === 'dm' && r.participantIds.includes(id)))
    for (const r of this.db.rooms) r.participantIds = r.participantIds.filter((x) => x !== id)
    if (this.db.agentSessions) {
      for (const key of Object.keys(this.db.agentSessions)) {
        if (key === `agent:${id}` || key.endsWith(`:${id}`)) delete this.db.agentSessions[key]
      }
    }
    this.save()
  }

  /** 取或建一个 bot 的私聊会话 */
  ensureDm(agentId: string): string | undefined {
    const agent = this.db.agents.find((a) => a.id === agentId)
    if (!agent) return undefined
    const existing = this.db.rooms.find((r) => r.kind === 'dm' && r.participantIds.includes(agentId))
    if (existing) {
      if (existing.archivedAt) this.setRoomArchived(existing.id, false)
      return existing.id
    }
    const room: Room = {
      id: randomUUID(), name: agent.name, participantIds: [agentId], createdAt: Date.now(), kind: 'dm'
    }
    this.db.rooms.push(room)
    this.save()
    return room.id
  }
  getAgent(id: string): Agent | undefined {
    return this.db.agents.find((x) => x.id === id)
  }

  // ---- rooms ----
  getManagerProject(roomId: string): ManagerProject | null {
    return this.db.managerProjects?.[roomId] ?? null
  }
  saveManagerProject(project: ManagerProject): void {
    if (!this.getRoom(project.roomId)) return
    const projects = this.db.managerProjects ??= {}
    projects[project.roomId] = project
    this.save()
  }

  saveRoom(r: Room): void {
    const i = this.db.rooms.findIndex((x) => x.id === r.id)
    if (i >= 0) this.db.rooms[i] = { ...this.db.rooms[i], ...r }
    else this.db.rooms.push(r)
    this.save()
  }
  setRoomArchived(id: string, archived: boolean): void {
    const room = this.db.rooms.find((r) => r.id === id)
    if (!room) throw new Error('找不到这个会话，请刷新后重试。')
    if (archived) room.archivedAt ??= Date.now()
    else delete room.archivedAt
    this.save()
  }
  deleteRoom(id: string): void {
    if (this.db.managerProjects) delete this.db.managerProjects[id]
    this.db.rooms = this.db.rooms.filter((r) => r.id !== id)
    if (this.db.scheduledTasks) this.db.scheduledTasks = this.db.scheduledTasks.filter((task) => task.roomId !== id)
    this.db.messages = this.db.messages.filter((m) => m.roomId !== id)
    for (const message of this.messagesByRoom.get(id) ?? []) this.messagesById.delete(message.id)
    this.messagesByRoom.delete(id)
    for (const key of Object.keys(this.db.sessions)) {
      if (key.startsWith(id + ':')) delete this.db.sessions[key]
    }
    for (const key of Object.keys(this.db.agentSessions ?? {})) {
      if (key.startsWith(`room:${id}:`)) delete this.db.agentSessions?.[key]
    }
    if (this.db.memories) delete this.db.memories[id]
    if (this.db.compactedTs) delete this.db.compactedTs[id]
    this.save()
  }
  getRoom(id: string): Room | undefined {
    return this.db.rooms.find((x) => x.id === id)
  }

  // ---- 按房间保存模型上下文，旧的混合会话保留在磁盘但不再读取 ----
  getAgentSession(roomId: string, agentId: string): AgentSession {
    const key = `room:${roomId}:${agentId}`
    if (!this.db.agentSessions) this.db.agentSessions = {}
    if (!this.db.agentSessions[key]) {
      this.db.agentSessions[key] = { summary: '', entries: [], lastSeenTs: 0, updatedAt: Date.now() }
    }
    return this.db.agentSessions[key]
  }
  saveAgentSession(roomId: string, agentId: string, session: AgentSession): void {
    if (!this.getRoom(roomId)) return
    if (!this.db.agentSessions) this.db.agentSessions = {}
    session.updatedAt = Date.now()
    this.db.agentSessions[`room:${roomId}:${agentId}`] = session
    this.save()
  }

  // ---- 排队中的工作区任务（重启恢复） ----
  getPendingWork(): PendingWork[] {
    return [...(this.db.pendingWork ?? [])]
  }
  savePendingWork(items: PendingWork[]): void {
    this.db.pendingWork = items
    this.save()
  }

  // ---- 定时任务 ----
  getScheduledTasks(): ScheduledTask[] {
    return [...(this.db.scheduledTasks ?? [])]
  }
  saveScheduledTask(task: ScheduledTask): void {
    if (!this.db.scheduledTasks) this.db.scheduledTasks = []
    const i = this.db.scheduledTasks.findIndex((t) => t.id === task.id)
    if (i >= 0) this.db.scheduledTasks[i] = task
    else this.db.scheduledTasks.push(task)
    this.save()
  }
  deleteScheduledTask(id: string): void {
    if (!this.db.scheduledTasks) return
    this.db.scheduledTasks = this.db.scheduledTasks.filter((t) => t.id !== id)
    this.save()
  }

  // ---- messages ----
  private indexMessage(message: Message): void {
    const roomMessages = this.messagesByRoom.get(message.roomId)
    if (roomMessages) roomMessages.push(message)
    else this.messagesByRoom.set(message.roomId, [message])
    this.messagesById.set(message.id, message)
  }

  addMessage(m: Message): void {
    this.db.messages.push(m)
    this.indexMessage(m)
    this.save()
  }
  updateMessage(id: string, text: string): void {
    const m = this.messagesById.get(id)
    if (m) {
      m.text = text
      this.save()
    }
  }
  getMessages(roomId: string): readonly Message[] {
    return this.messagesByRoom.get(roomId) ?? []
  }

  // ---- cli sessions ----
  getSession(roomId: string, agentId: string): SessionInfo {
    const key = `${roomId}:${agentId}`
    if (!this.db.sessions[key]) this.db.sessions[key] = {}
    return this.db.sessions[key]
  }
}
