#!/usr/bin/env node
/*
 * Agent Meeting 的本地 MCP 工具桥。
 * 由 CodeBuddy/agy 作为 stdio MCP server 启动，把工具调用转发回 Electron 主进程的本地 HTTP 桥。
 * 只使用 Node 内置模块；stdout 只能输出 JSON-RPC，日志一律走 stderr。
 */
'use strict'

const BRIDGE_URL = process.env.AM_BRIDGE_URL || ''
const BRIDGE_TOKEN = process.env.AM_BRIDGE_TOKEN || ''
const ROOM_ID = process.env.AM_ROOM_ID || ''
const AGENT_ID = process.env.AM_AGENT_ID || ''
const RUN_ID = process.env.AM_RUN_ID || ''
const COMMAND_WAIT = process.env.AM_COMMAND_WAIT === '1'

const TOOLS = [
  {
    name: 'list_dir',
    description: '列出共享工作目录或其子目录下的文件。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
  },
  {
    name: 'read_file',
    description: '分段读取文本，返回行号、SHA256和nextLine/nextChar。用startLine/startChar续读，不把开头当全文。PDF/Word用read_document。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, startChar: { type: 'integer', minimum: 0 }, maxLines: { type: 'integer', minimum: 1, maximum: 300 } }, required: ['path'] }
  },
  {
    name: 'read_document', description: '提取PDF、DOC、DOCX正文，可按行续读。PDF可指定page页码；提取文字不代表看过版式。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, page: { type: 'integer', minimum: 1 }, startLine: { type: 'integer', minimum: 1 }, startChar: { type: 'integer', minimum: 0 }, maxLines: { type: 'integer', minimum: 1, maximum: 300 } }, required: ['path'] }
  },
  {
    name: 'find_files', description: '递归找文件，不运行命令。不跟随链接，默认跳过.git和node_modules。pattern支持*、?或文件名片段；用nextOffset续查。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['pattern'] }
  },
  {
    name: 'search_files', description: '按普通文字搜索文件内容，返回路径、行号和短上下文，无需命令审批。文档请用read_document。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string' }, pattern: { type: 'string' }, caseSensitive: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 } }, required: ['query'] }
  },
  {
    name: 'web_search', description: '用公开关键词搜索网页，返回真实标题、链接和摘要，无需搜索密钥。摘要不代表已核实原文，需fetch_url打开来源。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'check_capabilities', description: '查看本群能力记录；传一个成员的完整名字时检测其API工具调用和看图能力，结果缓存。不读写用户文件；本地模型以实际回执为准。',
    inputSchema: { type: 'object', properties: { agent: { type: 'string' } } }
  },
  {
    name: 'view_image',
    description: '实际查看本地图片，返回图像画面。只读模式可用，请勿用 read_file 读取图片二进制。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'view_pdf',
    description: '查看 PDF 指定页的实际画面，并返回总页数与文件校验值。page 从 1 开始，每次一页；只读模式可用。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, page: { type: 'integer', minimum: 1 } }, required: ['path'] }
  },
  {
    name: 'write_file',
    description: '按应用工作权限将 UTF-8 文本写入工作目录。可创建子目录。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }
  },
  {
    name: 'search_literature',
    description: '使用公开关键词检索 Crossref 文献，返回候选题名和 DOI。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, fromYear: { type: 'integer' } }, required: ['query'] }
  },
  {
    name: 'fetch_url',
    description: '打开一个 http/https 网页或 API 并返回文本内容（联网查资料；不能访问本机/局域网）。',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: '完整网址' } }, required: ['url'] }
  },
  {
    name: 'download_file',
    description: '从 http/https 网址下载文件并保存到共享工作目录。沙箱/只读档也可用（只读档会拒绝）；不需要 shell。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '文件网址' },
        path: { type: 'string', description: '保存路径（相对共享工作目录；完全权限可用绝对路径）' }
      },
      required: ['url', 'path']
    }
  },
  {
    name: 'run_command',
    description: '执行一条 shell 命令，说明用途；应用按当前权限自动审查或请求用户批准，获准后执行。' +
      (COMMAND_WAIT ? '若仍在等待，请调用 wait_command 取回同一条命令的结果。' : ''),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        reason: { type: 'string', description: '为什么需要执行、要做什么' }
      },
      required: ['command', 'reason']
    }
  },
  ...(COMMAND_WAIT ? [{
    name: 'wait_command',
    description: '继续等待当前工作区命令的结果。只等待已提交的命令，不重新执行。收到仍在等待的回执时可以再次等待。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }] : []),
  {
    name: 'team_status',
    description: '查看当前群聊同伴正在执行、排队和最近完成的任务。结果会自动送回，不要反复轮询。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'start_work',
    description: '把一个较长的任务交给软件后台排队执行，当前回合结束后自动开始，结果会回到聊天。',
    inputSchema: {
      type: 'object',
      properties: { task: { type: 'string' }, title: { type: 'string' } },
      required: ['task']
    }
  },
  {
    name: 'delegate',
    description: '把独立任务交给本群另一位 bot；写清对象、材料、约束和交付物。完成或失败会自动通知你；派出后继续独立部分或结束本轮，不要等待或轮询。',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: 'string', description: '参会者名字' }, task: { type: 'string' } },
      required: ['agent', 'task']
    }
  },
  {
    name: 'search_history',
    description: '在当前会话中搜索历史消息。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'memory_search',
    description: '搜索长期记忆/项目进度。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'list_skills',
    description: '列出本地 skills 目录里的技能/模板文件。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'read_skill',
    description: '读取一个技能/模板文件的完整内容（先用 list_skills 看名字）。',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'memory_save',
    description: '存入长期记忆。scope=global 全项目共享（项目结论/决定），room=仅当前会话（默认，适合私聊/局部信息）。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        scope: { type: 'string', enum: ['room', 'global'] },
        pinned: { type: 'boolean', description: '置顶后每轮都会注入' },
        kind: { type: 'string', enum: ['note', 'fact', 'decision', 'progress', 'preference'] }
      },
      required: ['text']
    }
  },
  {
    name: 'recall_context',
    description: '向 AI 主持人查询更早的项目前情。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  }
]

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } })
}

async function callBridge(name, args, signal) {
  if (!BRIDGE_URL || !BRIDGE_TOKEN || !ROOM_ID || !AGENT_ID) {
    throw new Error('Agent Meeting 工具桥未配置（缺少环境变量）')
  }
  const res = await fetch(BRIDGE_URL + '/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + BRIDGE_TOKEN },
    body: JSON.stringify({ roomId: ROOM_ID, agentId: AGENT_ID, runId: RUN_ID || undefined, tool: name, args: args || {} }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)])
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('工具桥返回了无效响应：' + text.slice(0, 300))
  }
  if (!res.ok || !data.ok) throw new Error(data.error || '工具调用失败（HTTP ' + res.status + '）')
  return data.result
}

const calls = new Map()

async function handle(message) {
  const { id, method, params } = message
  if (method === 'initialize') {
    const version = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05'
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: 'agent_meeting', version: '1.0.0' }
      }
    })
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'notifications/cancelled') {
    calls.get(params?.requestId)?.abort()
    return
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
    return
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    return
  }
  if (method === 'tools/call') {
    const name = String((params && params.name) || '').replace(/^mcp__agent_meeting__/, '')
    const args = (params && params.arguments) || {}
    const controller = new AbortController()
    calls.set(id, controller)
    try {
      const result = await callBridge(name, args, controller.signal)
      send({ jsonrpc: '2.0', id, result: { content: result && Array.isArray(result.content) ? result.content : [{ type: 'text', text: String(result ?? '') }], isError: false } })
    } catch (e) {
      if (controller.signal.aborted) return
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true }
      })
    } finally {
      calls.delete(id)
    }
    return
  }
  sendError(id, -32601, 'Method not found: ' + method)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      sendError(null, -32700, 'Parse error')
      continue
    }
    if (Array.isArray(message)) {
      for (const item of message) void handle(item)
    } else if (message && typeof message === 'object') {
      void handle(message)
    }
  }
})
process.stdin.on('end', () => process.exit(0))
process.on('uncaughtException', (e) => {
  process.stderr.write('[agent-meeting-mcp] ' + (e && e.stack ? e.stack : String(e)) + '\n')
  process.exit(1)
})
