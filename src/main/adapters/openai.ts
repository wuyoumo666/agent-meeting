import http from 'node:http'
import https from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import type { ModelRate, Provider, ReasoningEffort } from '../../shared/types'
import { workFailure } from '../workEvidence'
import { modelRate } from '../modelRate'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export interface AgentMsg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

const normBase = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '')
const MODEL_REQUEST_TIMEOUT_MS = 120_000

export class ModelRequestTimeoutError extends Error {
  constructor() {
    super('模型服务本次请求超过 2 分钟没有完成，已结束等待。')
    this.name = 'ModelRequestTimeoutError'
  }
}

class ModelHttpError extends Error {
  constructor(readonly status: number, body: string, readonly retryAfter?: string) {
    super(`API HTTP ${status}: ${body.slice(0, 300)}`)
  }
}

// 用 Node 原生 http/https 直连，不走系统代理（避免 FlClash 等劫持 127.0.0.1 导致 fetch failed）
function nodeRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('模型地址须以 http:// 或 https:// 开头')
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, { method: opts.method ?? 'GET', headers: opts.headers, signal: opts.signal }, resolve)
    req.on('error', reject)
    req.setTimeout(MODEL_REQUEST_TIMEOUT_MS, () => req.destroy(new ModelRequestTimeoutError()))
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

function readBody(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = ''
    res.setEncoding('utf8')
    res.on('data', (d) => { s += d })
    res.on('end', () => resolve(s))
    res.on('error', reject)
  })
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await nodeRequest(normBase(baseUrl) + '/models', {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(20_000)
  })
  const text = await readBody(res)
  if (!res.statusCode || res.statusCode >= 400) {
    throw new Error(`获取模型失败 HTTP ${res.statusCode}: ${text.slice(0, 200)}`)
  }
  const json = JSON.parse(text) as { data?: Array<{ id: string }> }
  const ids = (json.data ?? []).map((m) => m.id).filter(Boolean)
  if (ids.length === 0) throw new Error('接口返回了空的模型列表')
  return ids.sort()
}

export async function streamChat(
  provider: Provider,
  model: string,
  messages: ChatMsg[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
  reasoningEffort?: ReasoningEffort
): Promise<string> {
  const res = await nodeRequest(normBase(provider.baseUrl) + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify({ model, messages, stream: true, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }),
    signal
  })
  if (!res.statusCode || res.statusCode >= 400) {
    throw new Error(`API HTTP ${res.statusCode}: ${(await readBody(res)).slice(0, 300)}`)
  }

  return new Promise((resolve, reject) => {
    let buf = ''
    let full = ''
    const parseLine = (line: string): void => {
      if (!line.trimStart().startsWith('data:')) return
      const payload = line.trimStart().slice(5).trim()
      if (!payload || payload === '[DONE]') return
      let json
      try {
        json = JSON.parse(payload)
      } catch {
        return
      }
      if (json?.error) {
        reject(new Error(typeof json.error.message === 'string' ? json.error.message : '模型服务返回错误'))
        res.destroy()
        return
      }
      const content = json?.choices?.[0]?.delta?.content
      if (typeof content === 'string' && content) {
        full += content
        onDelta(content)
      }
    }
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      lines.forEach(parseLine)
    })
    res.on('end', () => {
      parseLine(buf)
      if (full.trim()) resolve(full)
      else reject(new Error('API 返回了空回复'))
    })
    res.on('error', reject)
  })
}

/** 非流式单次对话（可带工具），用于 API 模型的工具循环 */
export async function chatOnce(
  provider: Provider,
  model: string,
  messages: AgentMsg[],
  tools: ToolDef[] | undefined,
  signal: AbortSignal,
  onRetry?: (text: string) => void,
  reasoningEffort?: ReasoningEffort,
  options?: { retryTimeout?: boolean; onModelRate?: (rate: ModelRate) => void }
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  // Retry only the model HTTP request, never a completed tool or a whole turn.
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try { return await chatOnceAttempt(provider, model, messages, tools, signal, reasoningEffort, options?.onModelRate) }
    catch (error) {
      if (signal.aborted) throw error
      if (options?.retryTimeout && attempt === 0 && error instanceof ModelRequestTimeoutError) {
        onRetry?.('经理连接的模型响应超时，正在重试这一步')
        continue
      }
      if (attempt >= 2 || !(error instanceof ModelHttpError) ||
        ![408, 429, 500, 502, 503, 504].includes(error.status) || !workFailure(error).transient) throw error
      const value = error.retryAfter?.trim() ?? ''
      const requested = value ? (/^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()) : NaN
      const wait = Math.min(15000, Math.max(1000, Number.isFinite(requested) ? requested : 1000 * 2 ** attempt))
      onRetry?.(`模型服务${error.status === 429 ? '暂时限流' : `暂时不可用（${error.status}）`}，${Math.ceil(wait / 1000)} 秒后重试（${attempt + 1}/2）`)
      await delay(wait, undefined, { signal })
    }
  }
}

async function chatOnceAttempt(
  provider: Provider, model: string, messages: AgentMsg[], tools: ToolDef[] | undefined, signal: AbortSignal,
  reasoningEffort?: ReasoningEffort, onModelRate?: (rate: ModelRate) => void
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  signal.throwIfAborted()
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), MODEL_REQUEST_TIMEOUT_MS)
  try {
    const body: Record<string, unknown> = { model, messages }
    if (reasoningEffort) body.reasoning_effort = reasoningEffort
    if (tools && tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }
    const started = performance.now()
    const res = await nodeRequest(normBase(provider.baseUrl) + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, deadline.signal])
    })
    const text = await readBody(res)
    if (!res.statusCode || res.statusCode >= 400) {
      throw new ModelHttpError(res.statusCode ?? 0, text, Array.isArray(res.headers['retry-after']) ? res.headers['retry-after'][0] : res.headers['retry-after'])
    }
    const j = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>
      usage?: { completion_tokens?: unknown; output_tokens?: unknown }
    }
    const msg = j.choices?.[0]?.message ?? {}
    if (onModelRate) {
      const rate = modelRate(j.usage?.completion_tokens ?? j.usage?.output_tokens, performance.now() - started, 'api-request')
      if (rate) onModelRate(rate)
    }
    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : []
    }
  } catch (error) {
    if (deadline.signal.aborted && !signal.aborted) throw new ModelRequestTimeoutError()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
