import type { HistorySearch, Message } from '../shared/types'

const SEARCH_LIMIT = 30
const VISIBLE = (message: Message): boolean => Boolean(message.text.trim() || message.attachments?.length || message.deliveries?.length || message.sources?.length)

export function searchHistory(messages: readonly Message[], query: string, senderId: string, offset: number): HistorySearch {
  const keyword = query.trim().toLowerCase()
  const authors = new Map<string, string>()
  const matches: HistorySearch['matches'] = []
  let total = 0
  const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!VISIBLE(m)) continue
    if (!authors.has(m.senderId)) authors.set(m.senderId, m.senderName)
    if (senderId && m.senderId !== senderId) continue
    const body = [m.text, ...(m.attachments ?? []).map((file) => file.name),
      ...(m.deliveries ?? []).map((file) => file.name), ...(m.sources ?? []).map((source) => source.title)].join('\n')
    const index = keyword ? body.toLowerCase().indexOf(keyword) : 0
    if (index < 0) continue
    if (total >= start && matches.length < SEARCH_LIMIT) {
      const first = Math.max(0, index - 45)
      const last = Math.min(body.length, Math.max(first + 130, index + Math.min(keyword.length, 130)))
      matches.push({
        id: m.id, author: m.senderName, ts: m.ts,
        preview: (first ? '…' : '') + body.slice(first, last).trim() + (last < body.length ? '…' : '')
      })
    }
    total++
  }
  return { total, matches, authors: Array.from(authors, ([id, name]) => ({ id, name })) }
}

const heading = (text: string): string => text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()<>#!|~]/g, '\\$&').trim()
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

export function exportMarkdown(roomName: string, messages: readonly Message[]): string {
  const sections = messages.filter(VISIBLE).map((m) => {
    const files = [...(m.attachments ?? []), ...(m.deliveries ?? [])]
    const citations = m.sources?.map((source) => '- ' + heading(source.title) + ' · ' + source.url).join('\n')
    const body = [m.text.trim(), files.length ? '附件及交付：' + files.map((file) => heading(file.name)).join('、') : '', citations].filter(Boolean).join('\n\n')
    return '## ' + heading(m.senderName) + ' · ' + dateFormat.format(m.ts) + '\n\n' + body
  })
  return ['# ' + heading(roomName), ...sections].join('\n\n') + '\n'
}

