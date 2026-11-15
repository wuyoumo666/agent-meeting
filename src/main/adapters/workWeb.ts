import { net } from 'electron'

interface Publication {
  type?: string
  DOI?: string
  title?: string[]
  author?: Array<{ given?: string; family?: string; name?: string }>
  published?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
}

export async function searchLiterature(query: string, fromYear: number | undefined, signal: AbortSignal): Promise<string> {
  const url = new URL('https://api.crossref.org/v1/works')
  url.searchParams.set('query.bibliographic', query)
  url.searchParams.set('rows', '12')
  url.searchParams.set('select', 'DOI,title,author,published,container-title,type')
  if (fromYear !== undefined) url.searchParams.set('filter', `from-pub-date:${fromYear}-01-01`)
  const response = await net.fetch(url.href, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
  if (!response.ok) throw new Error(`Crossref 返回 HTTP ${response.status}`)
  const payload = await response.json() as { message?: { items?: Publication[] } }
  if (!Array.isArray(payload.message?.items)) throw new Error('Crossref 未返回可读的检索结果')
  const entries = payload.message.items
    .filter((item) => item.type !== 'peer-review' && item.DOI && item.title?.[0])
    .slice(0, 8)
  const citations = entries.map((item) => {
    const authors = item.author?.slice(0, 4).map((a) => a.name || [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean)
    const year = item.published?.['date-parts']?.[0]?.[0]
    const doi = item.DOI!.split('/').map(encodeURIComponent).join('/')
    return [item.title![0], authors?.join(', '), year, item['container-title']?.[0], `https://doi.org/${doi}`]
      .filter(Boolean).join(' | ')
  })
  const scope = `Crossref 检索「${query}」${fromYear ? `（${fromYear} 年起）` : ''}`
  if (!citations.length) return `${scope}未找到候选文献。`
  return `${scope}返回 ${citations.length} 条候选文献。以下为书目信息，综述类型及正文内容需进一步核实。\n${citations.map((entry) => '- ' + entry).join('\n')}`
}

export async function checkConnection(signal: AbortSignal): Promise<string> {
  const url = 'https://example.com/'
  const response = await net.fetch(url, {
    method: 'HEAD', signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)])
  })
  if (!response.ok) throw new Error(`访问 ${url} 时收到 HTTP ${response.status}，未通过此次联网测试。`)
  return `软件实际访问 ${url}，收到 HTTP ${response.status}。该测试站点可访问。`
}
