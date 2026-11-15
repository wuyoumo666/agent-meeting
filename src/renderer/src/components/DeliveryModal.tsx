import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ConversationDelivery } from '../../../shared/types'
import { DeliveryCards, SourceLinks } from './ManagerPanel'

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

export default function DeliveryModal({ roomId, onClose }: { roomId: string; onClose: () => void }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [items, setItems] = useState<ConversationDelivery[]>([])
  const [before, setBefore] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    dialog.current?.showModal()
    let live = true
    void window.api.listDeliveries(roomId).then((page) => {
      if (!live) return
      setItems(page.items)
      setBefore(page.before)
    }).catch(() => { if (live) setError('暂时无法读取交付记录。') })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [roomId])

  const loadMore = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const page = await window.api.listDeliveries(roomId, before ?? undefined)
      setItems((previous) => [...new Map([...previous, ...page.items].map((item) => [item.id, item])).values()])
      setBefore(page.before)
    } catch { setError('加载失败，请重试。') }
    finally { setBusy(false) }
  }

  return <dialog className="modal wide delivery-dialog" ref={dialog} aria-labelledby="delivery-title" onCancel={onClose}>
    <div className="modal-head">
      <b id="delivery-title">本会话交付</b>
      <button className="icon-btn" aria-label="关闭交付列表" onClick={onClose}>×</button>
    </div>
    <div className="modal-body conversation-deliveries">
      {!busy && !items.length && !error && <p className="dim">这段会话还没有交付的文件或来源。</p>}
      {items.map((item) => <article key={item.id}>
        <time className="dim small" dateTime={new Date(item.ts).toISOString()}>{dateFormat.format(item.ts)}</time>
        {item.text && <div className="markdown"><ReactMarkdown>{item.text}</ReactMarkdown></div>}
        {!!item.deliveries?.length && <DeliveryCards message={item} />}
        <SourceLinks sources={item.sources} />
      </article>)}
      {busy && <p className="dim" role="status">正在加载交付…</p>}
      {error && <p className="composer-error" role="alert">{error}</p>}
      {(before || error) && <button className="ghost-btn" disabled={busy} onClick={() => void loadMore()}>{error ? '重试' : '加载更早的交付'}</button>}
    </div>
  </dialog>
}
