import { assertHttpUrl, fetchPublicText } from './netTools'
import type { ToolDef } from './openai'

export const WEB_SEARCH_TOOL: ToolDef = { type: 'function', function: {
  name: 'web_search', description: '用公开关键词搜索网页，返回真实标题、链接和摘要。无需搜索密钥；结果摘要不代表已打开或核实正文，之后用 fetch_url 读来源。不得把密钥或私有原文作为查询。',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
} }
export interface WebSearchResult { query: string; engine: string; fetchedAt: number; results: Array<{ title: string; url: string; snippet: string }>; coverage: string }
const cache = new Map<string, WebSearchResult>()
const decode = (text: string): string => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, part: string) => {
  if (part.startsWith('#')) { const code = parseInt(part.slice(/^#x/i.test(part) ? 2 : 1), /^#x/i.test(part) ? 16 : 10); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '' }
  return ({ amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ' } as Record<string,string>)[part.toLowerCase()] ?? whole
})
const plain = (text: string): string => decode(text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g,' ').trim()
const attr = (tag: string, key: string): string => new RegExp('\\b' + key + '\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(tag)?.[1] ?? ''
function resultUrl(raw: string, engine: string): string | undefined {
  try {
    let url = new URL(decode(raw), engine === 'DuckDuckGo' ? 'https://html.duckduckgo.com/' : 'https://www.bing.com/')
    if (url.hostname.endsWith('duckduckgo.com') && url.searchParams.has('uddg')) url = new URL(url.searchParams.get('uddg')!)
    if (/(^|\.)(?:duckduckgo\.com|bing\.com)$/.test(url.hostname)) return undefined
    return url.href.length <= 1000 ? assertHttpUrl(url.href).href : undefined
  } catch { return undefined }
}
export function parseSearchResults(body: string, engine: 'DuckDuckGo' | 'Bing'): WebSearchResult['results'] {
  const results: WebSearchResult['results'] = []
  if (engine === 'Bing') {
    for (const item of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const field = (name: string): string => new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i').exec(item[1])?.[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1') ?? ''
      const url = resultUrl(field('link'), engine), title = plain(field('title')).slice(0,150)
      if (url && title && !results.some((r) => r.url === url)) results.push({ url, title, snippet: plain(field('description')).slice(0,240) })
      if (results.length >= 6) break
    }
  } else {
    for (const item of body.matchAll(/<a\b([^>]*\bclass\s*=\s*["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
      const url = resultUrl(attr(item[1], 'href'), engine), title = plain(item[2]).slice(0,150)
      const tail = body.slice((item.index ?? 0) + item[0].length, (item.index ?? 0) + item[0].length + 5000)
      const snippet = /<(?:a|td|div)\b[^>]*\bclass\s*=\s*["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td|div)>/i.exec(tail)?.[1] ?? ''
      if (url && title && !results.some((r) => r.url === url)) results.push({ url, title, snippet: plain(snippet).slice(0,240) })
      if (results.length >= 6) break
    }
  }
  return results
}
export async function searchWeb(query: unknown, signal: AbortSignal): Promise<string> {
  if (typeof query !== 'string' || !query.trim() || query.length > 240 || /[\r\n]/.test(query)) throw new Error('请输入 1–240 字符的单行公开检索词。')
  signal.throwIfAborted()
  const key = query.trim(), saved = cache.get(key)
  if (saved && Date.now() - saved.fetchedAt < 5 * 60_000) return JSON.stringify({ ...saved, cached: true })
  const errors: string[] = []
  for (const engine of ['DuckDuckGo', 'Bing'] as const) {
    const url = new URL(engine === 'DuckDuckGo' ? 'https://html.duckduckgo.com/html/' : 'https://www.bing.com/search')
    url.searchParams.set('q', key)
    if (engine === 'Bing') url.searchParams.set('format', 'rss')
    try {
      const body = await fetchPublicText(url.href, AbortSignal.any([signal, AbortSignal.timeout(15_000)]))
      signal.throwIfAborted()
      const results = parseSearchResults(body, engine)
      if (!results.length) throw new Error(/captcha|anomaly|challenge|verify you|机器人/i.test(body) ? '搜索入口要求验证' : '未取得可解析的结果')
      const result: WebSearchResult = { query: key, engine, fetchedAt: Date.now(), results, coverage: '仅搜索结果与摘要；需要用 fetch_url 打开原文核实，不得声称已审阅全文。' }
      if (cache.size >= 40) cache.delete(cache.keys().next().value!)
      cache.set(key, result)
      return JSON.stringify(result)
    } catch (error) {
      signal.throwIfAborted()
      errors.push(`${engine}：${error instanceof Error ? error.message.split('\n')[0].slice(0,120) : '请求失败'}`)
    }
  }
  throw new Error(`本次网页搜索未取得结果。${errors.join('；')}。可换公开关键词或直接提供网址；不能把失败当成已经搜索成功。`)
}
