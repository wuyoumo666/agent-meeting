import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string }
}

interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface Client {
  server: string
  child: ChildProcessWithoutNullStreams
  tools: McpTool[]
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>
  close: () => void
}

export interface McpToolDef {
  /** 对外暴露的完整工具名：mcp__server__tool */
  name: string
  description: string
  parameters: Record<string, unknown>
  server: string
  tool: string
}

export interface McpConnections {
  tools: McpToolDef[]
  call: (fullName: string, args: Record<string, unknown>) => Promise<string>
  close: () => void
}

const INIT_TIMEOUT = 20_000
const CALL_TIMEOUT = 120_000

function openClient(server: string, config: McpServerConfig, signal?: AbortSignal): Promise<Client> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    if (!config.command?.trim()) return reject(new Error(`MCP ${server} 缺少 command`))
    const child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    let buffer = ''
    let nextId = 1
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
    let closed = false
    const failAll = (error: Error): void => {
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.reject(error)
      }
      pending.clear()
    }
    const close = (): void => {
      closed = true
      signal?.removeEventListener('abort', onAbort)
      failAll(new Error('MCP 连接已关闭'))
      try { child.kill() } catch { /* 已退出 */ }
    }
    const onAbort = (): void => close()
    signal?.addEventListener('abort', onAbort, { once: true })
    const onLine = (line: string): void => {
      if (!line.trim()) return
      let msg: JsonRpcMessage
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.id !== undefined && msg.id !== null && pending.has(Number(msg.id))) {
        const p = pending.get(Number(msg.id))!
        pending.delete(Number(msg.id))
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(msg.error.message || 'MCP 错误'))
        else p.resolve(msg.result)
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (buffer.length > 4 * 1024 * 1024) { close(); return }
      for (;;) {
        const i = buffer.indexOf('\n')
        if (i < 0) break
        const line = buffer.slice(0, i)
        buffer = buffer.slice(i + 1)
        onLine(line)
      }
    })
    child.stderr.on('data', () => { /* MCP server 的日志不进入 UI */ })
    child.stdin.on('error', (error) => { failAll(error); close() })
    child.on('error', (e) => {
      closed = true
      signal?.removeEventListener('abort', onAbort)
      failAll(e instanceof Error ? e : new Error(String(e)))
    })
    child.on('close', () => {
      closed = true
      signal?.removeEventListener('abort', onAbort)
      failAll(new Error('MCP server 已退出'))
    })
    const request = (method: string, params?: unknown, timeoutMs = INIT_TIMEOUT): Promise<unknown> => {
      if (signal?.aborted) return Promise.reject(signal.reason)
      if (closed) return Promise.reject(new Error('MCP server 已退出'))
      const id = nextId++
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rej(new Error(`MCP 请求超时：${method}`))
        }, timeoutMs)
        pending.set(id, { resolve: res, reject: rej, timer })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (error) => {
          if (error) { clearTimeout(timer); pending.delete(id); rej(error) }
        })
      })
    }
    ;(async () => {
      try {
        await request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'agent-meeting', version: '1.0.0' }
        })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
        const listed = await request('tools/list') as { tools?: McpTool[] }
        const tools = Array.isArray(listed?.tools) ? listed.tools.filter((t) => t && typeof t.name === 'string') : []
        resolve({
          server,
          child,
          tools,
          request: (method, params, timeoutMs) => request(method, params, timeoutMs),
          close
        })
      } catch (e) {
        close()
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })()
  })
}

/** 读取 mcp.json 并连接所有 stdio MCP server；失败的 server 会被跳过 */
export async function openMcpServers(configPath: string, signal?: AbortSignal): Promise<McpConnections> {
  signal?.throwIfAborted()
  let config: { mcpServers?: Record<string, McpServerConfig> } = {}
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return { tools: [], call: async () => { throw new Error('mcp.json 不存在或格式不正确') }, close: () => {} }
  }
  const clients: Client[] = []
  const tools: McpToolDef[] = []
  const byName = new Map<string, { client: Client; tool: string }>()
  for (const [server, cfg] of Object.entries(config.mcpServers ?? {})) {
    try {
      const client = await openClient(server, cfg, signal)
      clients.push(client)
      for (const tool of client.tools) {
        const fullName = `mcp__${server}__${tool.name}`
        tools.push({
          name: fullName,
          description: tool.description || `MCP ${server} / ${tool.name}`,
          parameters: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
          server,
          tool: tool.name
        })
        byName.set(fullName, { client, tool: tool.name })
      }
    } catch (e) {
      if (signal?.aborted) {
        for (const client of clients) client.close()
        throw signal.reason
      }
      console.error(`[mcp] ${server} 连接失败：`, e)
    }
  }
  return {
    tools,
    call: async (fullName, args) => {
      const target = byName.get(fullName)
      if (!target) throw new Error(`未知 MCP 工具：${fullName}`)
      const result = await target.client.request('tools/call', { name: target.tool, arguments: args }, CALL_TIMEOUT) as {
        content?: Array<{ type?: string; text?: string }>
        isError?: boolean
      }
      const text = (result?.content ?? []).map((c) => c?.text ?? '').filter(Boolean).join('\n')
      if (result?.isError) throw new Error(text || 'MCP 工具返回错误')
      return text || '（MCP 工具已执行，无文本输出）'
    },
    close: () => {
      for (const client of clients) client.close()
    }
  }
}
