import { net } from 'electron'
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TransferObserver } from '../toolActivity'

const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
const TIMEOUT_MS = 45_000

/** 只允许公网 http/https，避免 bot 被诱导去读本机/局域网服务 */
export function assertHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('URL 格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http/https 网址')
  if (url.username || url.password) throw new Error('URL 不能包含账号密码')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local')) {
    throw new Error('不允许访问本机或局域网地址')
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) throw new Error('不允许访问本机或局域网地址')
  }
  if (host.includes(':') && /^(::1|fc|fd|fe80)/.test(host)) throw new Error('不允许访问本机或局域网地址')
  return url
}

async function request(url: URL, signal: AbortSignal, redirects = 0): Promise<Response> {
  const res = await net.fetch(url.href, {
    signal,
    redirect: 'manual',
    credentials: 'omit',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8',
      'User-Agent': 'AgentMeeting/1.0'
    }
  })
  if (![301, 302, 303, 307, 308].includes(res.status)) return res
  const location = res.headers.get('location')
  await res.body?.cancel()
  if (!location || redirects >= 5) throw new Error('网页重定向无效或次数过多')
  return request(assertHttpUrl(new URL(location, url).href), signal, redirects + 1)
}

async function readResponse(raw: string, signal: AbortSignal, max: number, onTransfer?: TransferObserver): Promise<{ res: Response; body: Buffer }> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const res = await request(assertHttpUrl(raw), AbortSignal.any([signal, timeout]))
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    const type = (res.headers.get('content-type') || '').toLowerCase()
    if (max === MAX_TEXT_BYTES && type && !/text|json|xml|html|javascript|css|csv|markdown/.test(type)) {
      await res.body?.cancel()
      return { res, body: Buffer.alloc(0) }
    }
    return { res, body: await readCapped(res, max, onTransfer) }
  } catch (e) {
    if (signal.aborted) throw new Error('已停止')
    if (timeout.aborted) throw new Error('请求超时（45 秒）')
    throw new Error('联网失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function readCapped(res: Response, max: number, onTransfer?: TransferObserver): Promise<Buffer> {
  const encoding = res.headers.get('content-encoding')?.toLowerCase()
  const length = encoding && encoding !== 'identity' ? 0 : Number(res.headers.get('content-length'))
  const started = performance.now()
  const report = (bytes: number): void => {
    const seconds = (performance.now() - started) / 1000
    onTransfer?.({
      bytes,
      totalBytes: Number.isSafeInteger(length) && length >= bytes && length > 0 ? length : undefined,
      bytesPerSecond: bytes > 0 && seconds >= 0.25 ? bytes / seconds : undefined
    })
  }
  if (!res.body) {
    const all = Buffer.from(await res.arrayBuffer())
    if (all.length > max) throw new Error(`内容超过 ${Math.floor(max / 1024 / 1024)} MB 限制`)
    if (onTransfer) report(all.length)
    return all
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > max) throw new Error(`内容超过 ${Math.floor(max / 1024 / 1024)} MB 限制`)
      chunks.push(value)
      if (onTransfer) report(total)
    }
  } finally {
    try { await reader.cancel() } catch { /* 已结束 */ }
  }
  if (onTransfer) report(total)
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}

/** 读取网页/API 的文本内容（最多 2MB，返回前 20000 字） */
export async function fetchUrl(raw: string, signal: AbortSignal, onTransfer?: TransferObserver): Promise<string> {
  const url = assertHttpUrl(raw)
  const { res, body } = await readResponse(raw, signal, MAX_TEXT_BYTES, onTransfer)
  const type = (res.headers.get('content-type') || '').toLowerCase()
  if (type && !/text|json|xml|html|javascript|css|csv|markdown/.test(type)) {
    const len = res.headers.get('content-length')
    return `已取回二进制内容（${type}${len ? `，${len} 字节` : ''}）。要保存到本地请用 download_file。`
  }
  const title = res.url && res.url !== url.href ? `（最终地址：${res.url}）` : ''
  return `HTTP ${res.status}${title}\n\n${body.toString('utf8').slice(0, 20000)}`
}

/** Bounded public text for built-in search adapters; redirects retain the same URL checks. */
export async function fetchPublicText(raw: string, signal: AbortSignal): Promise<string> {
  const { res, body } = await readResponse(raw, signal, MAX_TEXT_BYTES)
  const type = res.headers.get('content-type') || ''
  if (type && !/text|xml|json|html/i.test(type)) throw new Error('搜索入口未返回文字。')
  return body.toString('utf8')
}

/** 下载 http/https 文件到本地（最多 50MB） */
export async function downloadFile(raw: string, destination: () => string, signal: AbortSignal, onTransfer?: TransferObserver): Promise<string> {
  const url = assertHttpUrl(raw)
  const { body } = await readResponse(raw, signal, MAX_DOWNLOAD_BYTES, onTransfer)
  signal.throwIfAborted()
  const dest = destination()
  const existing = lstatSync(dest, { throwIfNoEntry: false })
  if (existing && (!existing.isFile() || existing.nlink > 1)) {
    throw new Error('只允许覆盖无其他硬链接的普通文件')
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, body)
  return `已下载 ${url.href} → ${dest}（${body.length} 字节）`
}
