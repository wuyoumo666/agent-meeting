import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { HistorySearch, Room } from '../../../shared/types'

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
const plugins = [remarkGfm]
const PAGE_SIZE = 30

export default function HistoryModal({ room, onClose }: { room: Room; onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<HistorySearch>()
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState<Awaited<ReturnType<typeof window.api.readMessage>>>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      void window.api.searchMessages(room.id, query, author, offset).then((data) => {
        if (active) setResult(data)
      }).catch(() => { if (active) setError('搜索失败，请重试。') })
        .finally(() => { if (active) setLoading(false) })
    }, 180)
    return () => { active = false; clearTimeout(timer) }
  }, [room.id, query, author, offset, retry])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    setMessage(undefined)
    void window.api.readMessage(room.id, selectedId).then((data) => {
      if (active) {
        setMessage(data)
        if (!data) setError('这条消息已无法读取。')
      }
    }).catch(() => { if (active) setError('这条消息已无法读取。') })
    return () => { active = false }
  }, [room.id, selectedId])

  const resetDetail = (): void => { setSelectedId(''); setError('') }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal wide history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <div className="modal-head"><b id="history-title">搜索会议记录</b><button className="icon-btn" aria-label="关闭搜索" onClick={onClose}>×</button></div>
        {!selectedId && <div className="history-filters">
          <label>关键词<input type="search" autoFocus value={query} placeholder="搜索消息或附件名称"
            onChange={(e) => { setQuery(e.target.value); setOffset(0) }} /></label>
          <label>发言人<select value={author} onChange={(e) => { setAuthor(e.target.value); setOffset(0) }}>
            <option value="">全部发言人</option>
            {result?.authors.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
        </div>}
        <div className="modal-body">
          {selectedId ? (
            message && message.id === selectedId ? <>
              <div className="history-meta"><b>{message.author}</b><time>{dateFormat.format(message.ts)}</time></div>
              <div className="markdown"><ReactMarkdown remarkPlugins={plugins}>{message.text}</ReactMarkdown></div>
              {message.attachments.length > 0 && <p className="dim small">附件：{message.attachments.join('、')}</p>}
            </> : !error && <p role="status">正在读取消息…</p>
          ) : loading ? <p role="status">正在搜索…</p>
            : !error && (result?.matches.length ? <div className="history-results">
              {result.matches.map((match) => (
                <button key={match.id} onClick={() => setSelectedId(match.id)} className="history-result">
                  <span className="history-meta"><b>{match.author}</b><time>{dateFormat.format(match.ts)}</time></span>
                  <span>{match.preview}</span>
                </button>
              ))}
            </div> : <p className="dim">没找到符合条件的消息。</p>)}
          {error && <p className="composer-error" role="alert">{error}</p>}
        </div>
        <div className="modal-footer history-footer">
          {selectedId ? <button className="ghost-btn" onClick={resetDetail}>返回搜索结果</button>
            : error ? <button className="ghost-btn" onClick={() => setRetry((value) => value + 1)}>重试</button>
            : result && <>
              <span className="dim small" role="status">{result.total} 条记录</span>
              <button className="ghost-btn" disabled={loading || offset === 0} onClick={() => setOffset((value) => value - PAGE_SIZE)}>上一页</button>
              <button className="ghost-btn" disabled={loading || offset + PAGE_SIZE >= result.total} onClick={() => setOffset((value) => value + PAGE_SIZE)}>下一页</button>
            </>}
        </div>
      </div>
    </div>
  )
}

