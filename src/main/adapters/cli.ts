import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { REPLY_STYLE, type Agent, type ModelRate } from '../../shared/types'
import { describeTool } from './humanize'
import { abortable } from '../abortable'
import { modelRate } from '../modelRate'

export interface CliResult {
  text: string
  sessionId?: string
  model?: string
  toolFallback?: boolean
}

export interface CliRunOpts {
  readOnlyTask?: boolean
  /** 工作区预览并校验过的实际执行目录 */
  directory?: string
  /** 工作区模式：放开工具权限 */
  work?: boolean
  /** 讨论轮也按工作权限放开工具，让 CLI 自己决定要不要动手 */
  autonomous?: boolean
  /** MCP 配置文件路径：把软件的 download_file / run_command / start_work 等工具接给 CLI */
  mcpConfig?: string
  /** agy 的 --settings 文件（只用于放行 MCP 权限，不写入用户设置） */
  agySettings?: string
  /** 追加一段“会自己动手”的系统提示（CodeBuddy） */
  agentic?: boolean
  /** 实时活动日志（工具调用/文本） */
  onLog?: (kind: 'text' | 'tool' | 'info', text: string) => void
  onModelRate?: (rate: ModelRate) => void
  lastToolActivity?: () => number | undefined
  /** Acquire the file-mutation lock after CLI-specific configuration queues. */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>
}

const AGENTIC_PROMPT =
  '你是群聊里的执行成员，接住用户或同伴明确交给你的当前任务，交付实际成果。\n' +
  '- 常规步骤自行决定并完成，不反复问是否开始。用户只问进度、原因或概念时，必要核对后先回答，不擅自重启旧待办。\n' +
  '- 能力以本轮实际工具列表为准。查文献用 agent_meeting/search_literature，打开网页用 fetch_url，需要保存才用 download_file；不要声称有未提供的 shell、搜索或浏览器。\n' +
  '- 图片用 agent_meeting/view_image，PDF 视觉检查用 view_pdf 并指定 page。工具返回实际画面，只读任务也可用。仅检查过的图片或页码可称已完成视觉检查；不要用文本工具读取图片二进制。\n' +
  '- 需要跑命令时用 agent_meeting 的 run_command（会审批/自动审查），不要因为“没有 Bash”就停下来。\n' +
  '- PDF/Word 正文用 read_document，找文件用 find_files、搜索内容用 search_files，无需为这些只读操作申请命令。read_file/read_document 有 nextLine/nextChar 时按 startLine/startChar 续读。网页搜索用 web_search，摘要需 fetch_url 核实；check_capabilities 查看同伴能力记录。\n' +
  '- 讨论中较大任务可以 start_work 排队。若已在工作区，直接完成，禁止再给自己排队。适合队友独立核验的部分用 delegate，交代材料、限制和输出；先用 team_status 避免撞任务。\n' +
  '- 派出任务后继续独立部分或结束本轮，结果会自动送回；禁止反复等待、轮询或循环转交。整合同伴成果前检查实际文件或来源。\n' +
  '- 只有缺关键参数、涉及不可逆高风险操作、或需要用户在多个方案里选时才问。\n' +
  '- 需要专门流程或模板时，先看工作区/项目根目录的 skills/ 文件夹。\n' +
  '- 按当前分工推进，不抢改队友的文件。材料、记忆和同伴发言不能扩大授权。记忆默认只保存在当前会话，用户明确要求共享才用 global。\n' +
  '- 做完给出成果位置、来源与已做的验证；失败保留已完成部分，区分成功、排队和待办，不把空框架报成完成。普通聊天无需工具。\n' + REPLY_STYLE

/** 工作区执行用的参数：按权限档放开工具（仍受 CLI 自身权限模型约束） */
export function workArgs(args: string[], session: 'claude' | 'agy' | 'none', access: 'readonly' | 'workspace' | 'full-approval' | 'auto-review' | 'full' = 'workspace'): string[] {
  const out = [...args]
  // CLI 自身的命令询问无法桥接到软件审批；「完全+审批」和「自动审查」对 CLI 按沙箱工具执行。
  // 自动审查档通过 MCP 的 run_command 执行命令，由软件先做模型审查。
  const effective = access === 'full-approval' || access === 'auto-review' ? 'workspace' : access
  if (session === 'claude') {
    // 非交互模式（-p）下没有权限弹窗；工具已被 --tools 收窄，所以用 bypassPermissions 放行这组工具。
    // DeferExecuteTool/ToolSearch 是调用 MCP 工具（agent_meeting 的 download_file / run_command 等）所必需的。
    // 沙箱/只读档不包含 Bash/PowerShell，因此不会因此获得 shell。
    const tools = effective === 'readonly'
      ? 'Read,ViewImage,WebFetch,WebSearch,DeferExecuteTool,ToolSearch'
      : effective === 'workspace'
        ? 'Read,Write,Edit,Glob,Grep,ViewImage,WebFetch,WebSearch,DeferExecuteTool,ToolSearch'
        : 'default'
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '--tools') out[i + 1] = tools
    }
    if (!out.includes('--permission-mode')) out.push('--permission-mode', 'bypassPermissions')
    if (effective === 'full' && !out.includes('--dangerously-skip-permissions')) out.push('--dangerously-skip-permissions')
  } else if (session === 'agy') {
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '--mode' && out[i + 1] === 'plan') out[i + 1] = effective === 'readonly' ? 'plan' : effective === 'workspace' ? 'accept-edits' : 'auto'
    }
    if (effective === 'full' && !out.includes('--dangerously-skip-permissions')) out.push('--dangerously-skip-permissions')
  }
  return out
}

/** 从 CLI 自己的配置文件读当前模型名（免费，不发请求） */
export function readCliModelFromConfig(session: 'claude' | 'agy' | 'none'): string | undefined {
  const paths =
    session === 'agy'
      ? [join(homedir(), '.gemini', 'antigravity-cli', 'settings.json')]
      : session === 'claude'
        ? [join(homedir(), '.codebuddy', 'settings.json'), join(homedir(), '.claude', 'settings.json')]
        : []
  for (const p of paths) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      if (typeof j.model === 'string' && j.model.trim()) return j.model.trim()
    } catch { /* 文件不存在或无 model 字段 */ }
  }
  return undefined
}

/** 模型名 → 合法的 @ 提及名（无空格） */
export function modelToHandle(model: string): string {
  return model.replace(/[()（）]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

export function spawnCli(command: string, args: string[], cwd?: string): ReturnType<typeof spawn> {
  if (process.platform !== 'win32') return spawn(command, args, { cwd, windowsHide: true })
  const dirs = [cwd ?? process.cwd(), ...(process.env.PATH ?? '').split(';').filter(Boolean)]
  const names = extname(command) ? [command] : [command + '.exe', command + '.com', command + '.cmd', command + '.bat']
  const file = dirs.flatMap((dir) => names.map((name) => isAbsolute(name) ? name : resolvePath(dir, name)))
    .find(existsSync)
  if (!file) throw new Error(`找不到命令「${command}」，请检查命令名或填写完整路径`)
  if (!/\.(?:cmd|bat)$/i.test(file)) return spawn(file, args, { cwd, windowsHide: true })
  if ([file, ...args].some((value) => /["%&|<>^!\r\n]/.test(value))) {
    throw new Error('批处理命令无法安全传入这些参数，请使用原生 .exe 或通过标准输入传入消息')
  }
  return spawn(`"${file}"`, args.map((arg) => `"${arg}"`), { cwd, shell: true, windowsHide: true })
}

const killTree = (pid: number): void => {
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {
      try { process.kill(pid) } catch { /* already dead */ }
    })
  } else {
    try { process.kill(pid, 'SIGTERM') } catch { /* already dead */ }
  }
}

/**
 * 通用 CLI adapter：子进程 + stdin 喂 prompt，按 outputMode 解析输出。
 * - claude-stream: codebuddy/claude 的 stream-json（assistant 块 + result）
 * - last-file:     codex exec --output-last-message，stdout 只作状态
 * - json:          gemini --output-format json，取 response 字段
 * - text:          原始 stdout
 */
export function runCli(
  agent: Agent,
  prompt: string,
  prevSessionId: string | undefined,
  onDelta: (text: string) => void,
  onStatus: (detail: string) => void,
  signal: AbortSignal,
  fallbackCwd?: string,
  opts?: CliRunOpts
): Promise<CliResult> {
  const cfg = agent.cli
  if (!cfg?.command.trim()) return Promise.reject(new Error('未设置本地工具的启动命令'))
  const launch = (): Promise<CliResult> => {
    const run = (options?: CliRunOpts): Promise<CliResult> => {
      const fn = () => runCliInner(agent, prompt, prevSessionId, onDelta, onStatus, signal, fallbackCwd, options)
      return opts?.exclusive ? opts.exclusive(fn) : fn()
    }
    if (opts?.mcpConfig && cfg.session === 'agy') {
      const settings = agyMcpSettingsFile()
      return withAgyMcpConfig(opts.mcpConfig, signal, () =>
        run({ ...opts, agySettings: settings }))
    }
    return run(opts)
  }
  return launch().catch(async (error: unknown) => {
    if (cfg.session !== 'agy' || !opts?.autonomous || !(error instanceof AgyToolPermissionError) || signal.aborted) throw error
    onStatus('Gemini 工具未获授权，正在补一条文字回复…')
    const retry = await runCliInner(agent,
      prompt + '\n\n上一轮未能使用工具。本次只用已给出的内容给用户一条简短文字答复。不要调用任何工具，也不要声称已经读取文件、执行命令或查过资料。需要工具才能回答时，只说明缺少哪项结果。',
      undefined, onDelta, onStatus, signal, fallbackCwd)
    return { ...retry, toolFallback: true }
  })
}

class AgyToolPermissionError extends Error {}

/** agy 的 MCP 配置是全局文件；每次运行前合并、结束后恢复，并用队列避免并发覆盖 */
const AGY_MCP_CONFIG = join(homedir(), '.gemini', 'config', 'mcp_config.json')
let agyConfigQueue: Promise<void> = Promise.resolve()

function agyMcpSettingsFile(): string {
  const file = join(tmpdir(), 'agent-meeting-agy-mcp-settings.json')
  // Only the app bridge is pre-approved here. The app checks each bridged operation.
  writeFileSync(file, JSON.stringify({ permissions: { allow: ['mcp(agent_meeting/*)'] } }), 'utf8')
  return file
}

async function withAgyMcpConfig<T>(configPath: string, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  let release!: () => void
  const previous = agyConfigQueue
  agyConfigQueue = new Promise<void>((resolve) => { release = resolve })
  try { await abortable(previous, signal) }
  catch (error) { void previous.then(release, release); throw error }
  let previousText: string | null = null
  let installed = false
  try {
    signal.throwIfAborted()
    mkdirSync(dirname(AGY_MCP_CONFIG), { recursive: true })
    try { previousText = readFileSync(AGY_MCP_CONFIG, 'utf8') } catch { previousText = null }
    const source = JSON.parse(readFileSync(configPath, 'utf8')) as { mcpServers?: Record<string, unknown> }
    const existing = previousText?.trim() ? JSON.parse(previousText) as { mcpServers?: Record<string, unknown> } : {}
    const merged = { ...existing, mcpServers: { ...(existing.mcpServers ?? {}), ...(source.mcpServers ?? {}) } }
    writeFileSync(AGY_MCP_CONFIG, JSON.stringify(merged, null, 2), 'utf8')
    installed = true
    return await fn()
  } finally {
    try {
      if (installed) {
        if (previousText === null) unlinkSync(AGY_MCP_CONFIG)
        else writeFileSync(AGY_MCP_CONFIG, previousText, 'utf8')
      }
    } catch {
      // 恢复失败时保留现场，下一次运行仍会覆盖 agent_meeting 项
    }
    release()
  }
}

function runCliInner(
  agent: Agent,
  prompt: string,
  prevSessionId: string | undefined,
  onDelta: (text: string) => void,
  onStatus: (detail: string) => void,
  signal: AbortSignal,
  fallbackCwd?: string,
  opts?: CliRunOpts
): Promise<CliResult> {
  const cfg = agent.cli
  if (!cfg?.command.trim()) return Promise.reject(new Error('未设置本地工具的启动命令'))
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    let args = cfg.args
    if (opts?.work || opts?.autonomous) args = workArgs(args, cfg.session, opts.readOnlyTask ? 'readonly' : agent.access)
    args = [...args]
    if (opts?.mcpConfig && cfg.session === 'claude') args.push('--strict-mcp-config', '--mcp-config', opts.mcpConfig)
    if (opts?.agySettings && cfg.session === 'agy') args.push('--settings', opts.agySettings)
    if (opts?.agentic && cfg.session === 'claude') args.push('--append-system-prompt', AGENTIC_PROMPT)
    let newSessionId: string | undefined
    if (cfg.session === 'claude') {
      if (prevSessionId) {
        args.push('-r', prevSessionId)
      } else {
        newSessionId = randomUUID()
        args.push('--session-id', newSessionId)
      }
    } else if (cfg.session === 'agy' && prevSessionId) {
      args.push('--conversation', prevSessionId)
    }
    if (cfg.model?.trim()) args.push('--model', cfg.model.trim())
    if (agent.reasoningEffort && (cfg.session === 'claude' || cfg.session === 'agy')) {
      args = args.filter((arg, index, all) => arg !== '--effort' && all[index - 1] !== '--effort' && !arg.startsWith('--effort='))
      args.push('--effort', agent.reasoningEffort)
    }
    const outfile = join(tmpdir(), `agent-meeting-${randomUUID()}.txt`)
    args = args.map((a) => a.replaceAll('{{outfile}}', outfile).replaceAll('{{prompt}}', prompt))

    const child = spawnCli(cfg.command.trim(), args, opts?.directory ?? (cfg.cwd || fallbackCwd || undefined))

    let stdout = ''
    let stderr = ''
    let assistantText = ''
    let resultText = ''
    let detectedModel: string | undefined
    let lineBuf = ''
    let settled = false
    let aborted = false
    let timeoutReason = ''
    let resultError = ''
    let rate: ModelRate | undefined

    const stopForTimeout = (reason: string): void => {
      timeoutReason = reason
      onStatus(reason)
      if (child.pid) killTree(child.pid)
    }
    // 有工具或文字输出时继续等待。总时限防止持续输出的异常进程无限运行。
    const idleLimit = 5 * 60 * 1000
    let lastOutputAt = Date.now()
    const checkIdle = (): void => {
      const remaining = idleLimit - (Date.now() - Math.max(lastOutputAt, opts?.lastToolActivity?.() ?? 0))
      if (remaining > 0) idleTimer = setTimeout(checkIdle, remaining)
      else stopForTimeout('本地工具连续 5 分钟无活动，已停止。已写入的文件保留。')
    }
    let idleTimer = setTimeout(checkIdle, idleLimit)
    const totalTimer = setTimeout(() => stopForTimeout('本地工具本次运行已达 20 分钟，已停止。已写入的文件保留。'), 20 * 60 * 1000)

    const onAbort = (): void => {
      aborted = true
      if (child.pid) killTree(child.pid)
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      clearTimeout(idleTimer)
      clearTimeout(totalTimer)
      signal.removeEventListener('abort', onAbort)
      if (cfg.outputMode === 'last-file') {
        try { rmSync(outfile, { force: true }) } catch { /* ignore */ }
      }
    }
    const fail = (e: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(e)
    }
    const ok = (r: CliResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(r)
    }

    const handleStreamLine = (line: string): void => {
      const t = line.trim()
      if (!t.startsWith('{')) return
      try {
        const ev = JSON.parse(t)
        if (ev.type === 'system' && ev.subtype === 'init') {
          if (ev.session_id) newSessionId = ev.session_id
          if (typeof ev.model === 'string') detectedModel = ev.model
        } else if (ev.type === 'assistant') {
          const blocks = ev.message?.content ?? []
          for (const b of blocks) {
            if (b.type === 'text' && b.text) {
              assistantText += b.text
              onDelta(b.text)
              opts?.onLog?.('text', b.text)
            } else if (b.type === 'tool_use' && b.name) {
              opts?.onLog?.('tool', describeTool(b.name, b.input))
            }
          }
        } else if (ev.type === 'result') {
          if (ev.is_error) resultError = typeof ev.result === 'string' ? ev.result : '本地工具报告执行失败'
          if (typeof ev.result === 'string') resultText = ev.result
          if (ev.session_id) newSessionId = ev.session_id
          rate = modelRate(ev.usage?.output_tokens, ev.duration_api_ms, 'cli-api')
        }
      } catch { /* 非 JSON 行忽略 */ }
    }

    // agy 的 stream-json：{event:'init'|'step_update'|'result'}
    const handleAgyLine = (line: string): void => {
      const t = line.trim()
      if (!t.startsWith('{')) return
      try {
        const ev = JSON.parse(t)
        if (ev.conversation_id) newSessionId = ev.conversation_id
        if (ev.event === 'step_update') {
          const s = ev.step_update
          if (s?.step_type === 'agent_response') {
            if (typeof s.text_delta === 'string' && s.text_delta) {
              assistantText += s.text_delta
              onDelta(s.text_delta)
            }
            if (s.state === 'DONE' && typeof s.duration_seconds === 'number' && !signal.aborted) {
              const sample = modelRate(s.usage?.output_tokens, s.duration_seconds * 1000, 'cli-step')
              if (sample) opts?.onModelRate?.(sample)
            }
          }
        } else if (ev.event === 'result') {
          if (typeof ev.result?.error === 'string' && ev.result.error) resultError = ev.result.error
          if (typeof ev.result?.response === 'string') resultText = ev.result.response
          if (ev.result?.conversation_id) newSessionId = ev.result.conversation_id
        }
      } catch { /* 非 JSON 行忽略 */ }
    }

    child.stdout!.setEncoding('utf8').on('data', (s: string) => {
      if (s.trim()) lastOutputAt = Date.now()
      if (cfg.outputMode === 'text' || cfg.outputMode === 'json') stdout += s
      else stdout = (stdout + s).slice(-4000)
      if (cfg.outputMode === 'claude-stream') {
        lineBuf += s
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''
        lines.forEach(handleStreamLine)
      } else if (cfg.outputMode === 'agy-stream') {
        lineBuf += s
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''
        lines.forEach(handleAgyLine)
      } else if (cfg.outputMode === 'text') {
        const clean = stripAnsi(s)
        if (clean) onDelta(clean)
      } else {
        const lastLine = stripAnsi(s).split('\n').map((x) => x.trim()).filter(Boolean).pop()
        if (lastLine) onStatus(lastLine.slice(0, 80))
      }
    })
    child.stderr!.setEncoding('utf8').on('data', (s: string) => { stderr = (stderr + s).slice(-2000) })

    child.on('error', (e) => fail(new Error(`无法启动命令 "${cfg.command}"：${e.message}`)))
    child.on('close', (code) => {
      if (aborted) return fail(new Error('已手动停止'))
      if (timeoutReason) return fail(new Error(timeoutReason))
      if (cfg.outputMode === 'claude-stream' && lineBuf.trim()) handleStreamLine(lineBuf)
      if (cfg.outputMode === 'agy-stream' && lineBuf.trim()) handleAgyLine(lineBuf)
      const toolDenied = /required the ["']([^"']+)["'] permission|([\w_]+) permission[^\n]*auto-denied/i.exec(stripAnsi(stderr))
      if (cfg.outputMode === 'agy-stream' && !resultText.trim() && !assistantText.trim() && toolDenied) {
        return fail(new AgyToolPermissionError(`Gemini 的后台工具未获授权（${toolDenied[1] || toolDenied[2]}）。请用应用提供的工具，命令会走应用审批。`))
      }
      if (code !== 0 || resultError) {
        const detail = stripAnsi(resultError || stderr || stdout).trim().slice(-400)
        return fail(new Error(`本地工具执行失败（退出码 ${code}）${detail ? '：' + detail : ''}`))
      }
      let text = ''
      if (cfg.outputMode === 'claude-stream' || cfg.outputMode === 'agy-stream') {
        text = resultText || assistantText
      } else if (cfg.outputMode === 'last-file') {
        try { text = readFileSync(outfile, 'utf8') } catch { text = '' }
        if (!text.trim()) text = stripAnsi(stdout)
      } else if (cfg.outputMode === 'json') {
        const clean = stripAnsi(stdout).trim()
        try {
          const j = JSON.parse(clean)
          const response = j.response ?? j.result ?? j.text
          text = typeof response === 'string' ? response : clean
          if (j.conversation_id) newSessionId = j.conversation_id
        } catch {
          text = clean
        }
      } else {
        text = stripAnsi(stdout)
      }
      if (!text.trim()) {
        return fail(new Error(`CLI 退出码 ${code}，无输出。${stderr ? 'stderr: ' + stripAnsi(stderr).slice(-300) : ''}`))
      }
      if (rate) opts?.onModelRate?.(rate)
      ok({ text: text.trim(), sessionId: newSessionId ?? prevSessionId, model: detectedModel })
    })

    if (cfg.promptVia === 'stdin') {
      child.stdin!.on('error', () => { /* 进程早退时 EPIPE 忽略 */ })
      child.stdin!.end(prompt)
    } else {
      child.stdin!.end()
    }
  })
}
