import { useState } from 'react'
import type { Agent, Room } from '../../../shared/types'

interface Props {
  room: Room | null
  agents: Agent[]
  onClose: () => void
  onSaved: (id: string) => void
}

export default function RoomModal({ room, agents, onClose, onSaved }: Props): React.JSX.Element {
  const [name, setName] = useState(room?.name ?? '')
  const [ids, setIds] = useState<string[]>(room?.participantIds ?? [])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const toggle = (id: string): void =>
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const save = async (): Promise<void> => {
    if (!name.trim() || saving) return
    const r: Room = {
      ...room,
      id: room?.id ?? crypto.randomUUID(),
      name: name.trim(),
      participantIds: ids,
      createdAt: room?.createdAt ?? Date.now(),
    }
    setSaving(true)
    setSaveError('')
    try {
      await window.api.saveRoom(r)
      onSaved(r.id)
    } catch {
      setSaveError('会议室保存失败，请重试。')
      setSaving(false)
    }
  }

  return (
    <div className="modal-mask" onClick={() => { if (!saving) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b id="room-dialog-title">{room ? '房间设置' : '新建会议室'}</b>
          <button className="icon-btn" disabled={saving} aria-label="关闭房间设置" onClick={onClose}>×</button>
        </div>
        <div className="modal-body form">
          <label>房间名<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="如：方案评审" /></label>
          <div>
            <div className="dim small" style={{ marginBottom: 6 }}>参会者</div>
            {agents.length === 0 && <p className="dim">还没有参会者，先去设置里添加。</p>}
            {agents.map((a) => (
              <label key={a.id} className="check-row">
                <input type="checkbox" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
                <div className="avatar sm" style={{ '--identity': a.color } as React.CSSProperties}>{a.name.slice(0, 1)}</div>
                <span>{a.name}</span>
                <span className="dim small">{a.kind === 'api' ? 'API' : a.kind === 'cli' ? 'CLI' : '演示'}</span>
              </label>
            ))}
          </div>
          {saveError && <p className="composer-error" role="alert">{saveError}</p>}
        </div>
        <div className="modal-footer">
          <button className="ghost-btn" disabled={saving} onClick={onClose}>取消</button>
          <button className="primary-btn" disabled={!name.trim() || saving} onClick={() => void save()}>保存</button>
        </div>
      </div>
    </div>
  )
}
