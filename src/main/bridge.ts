import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Orchestrator } from './orchestrator'

export interface ToolBridgeInfo {
  /** 本地桥地址，例如 http://127.0.0.1:12345 */
  url: string
  /** 仅本次进程有效的随机令牌 */
  token: string
  /** MCP 配置文件和脚本的落盘目录 */
  configDir: string
  /** 已复制到用户目录的 MCP server 脚本 */
  scriptPath: string
}

export interface ToolBridge extends ToolBridgeInfo {
  close: () => void
}

const MAX_BODY = 256 * 1024
const TOOL_TIMEOUT_MS = 10 * 60 * 1000
const COMMAND_REQUEST_TIMEOUT_MS = 20 * 60 * 1000

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      raw += chunk
      if (raw.length > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

/**
 * 启动给 CLI 用的本地工具桥：MCP server 子进程通过它把 download_file / run_command /
 * start_work / delegate 等调用转回主进程，复用软件的权限和审批逻辑。
 * 只绑定 127.0.0.1，并要求随机 Bearer token。
 */
export async function startToolBridge(
  orch: Orchestrator,
  opts: { userData: string; appPath: string }
): Promise<ToolBridge> {
  const token = randomUUID()
  const configDir = join(opts.userData, 'mcp')
  mkdirSync(configDir, { recursive: true })
  const source = join(opts.appPath, 'resources', 'agent-meeting-mcp.cjs')
  const scriptPath = join(configDir, 'agent-meeting-mcp.cjs')
  copyFileSync(source, scriptPath)

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/tool') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Not found' }))
        return
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }))
        return
      }
      let body: { roomId?: unknown; agentId?: unknown; runId?: unknown; tool?: unknown; args?: unknown }
      try {
        body = JSON.parse(await readBody(req))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : '无效请求' }))
        return
      }
      const roomId = typeof body.roomId === 'string' ? body.roomId : ''
      const agentId = typeof body.agentId === 'string' ? body.agentId : ''
      const runId = typeof body.runId === 'string' && body.runId ? body.runId : undefined
      const tool = typeof body.tool === 'string' ? body.tool : ''
      const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args)
        ? body.args as Record<string, unknown>
        : {}
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), tool === 'run_command' ? COMMAND_REQUEST_TIMEOUT_MS : TOOL_TIMEOUT_MS)
      res.on('close', () => ctl.abort())
      try {
        const result = await orch.runBridgeTool(roomId, agentId, tool, args, ctl.signal, runId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, result }))
      } catch (e) {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
        }
      } finally {
        clearTimeout(timer)
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('无法启动本地工具桥')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    configDir,
    scriptPath,
    close: () => server.close()
  }
}
