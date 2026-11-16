import { useState } from 'react'
import type { Agent, Room } from '../../../shared/types'
import { personaDisplayLabel } from '../../../shared/personas'

interface Props {
  room: Room | null
  defaultKind?: 'group' | 'chat-group'
  agents: Agent[]
  onClose: () => void
  onSaved: (id: string) => void
}

export default function RoomModal({ room, defaultKind = 'group', agents, onClose, onSaved }: Props): React.JSX.Element {
  const effectiveKind = room?.kind ?? defaultKind
  const isPureGroup = effectiveKind === 'chat-group'
  const [name, setName] = useState(room?.name ?? '')
  const [ids, setIds] = useState<string[]>(room?.participantIds ?? [])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const toggle = (id: string): void =>
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const applyApartmentPreset = (): void => {
    if (!name.trim()) setName('AI情公寓客厅')
    setIds(agents.filter((a) => a.kind !== 'demo').map((a) => a.id))
  }

  const save = async (): Promise<void> => {
    if (!name.trim() || saving) return
    const r: Room = {
      ...room,
      id: room?.id ?? crypto.randomUUID(),
      name: name.trim(),
      participantIds: ids,
      createdAt: room?.createdAt ?? Date.now(),
      kind: room?.kind ?? defaultKind
    }
    setSaving(true)
    setSaveError('')
    try {
      await window.api.saveRoom(r)
      onSaved(r.id)
    } catch {
      setSaveError('会话保存失败，请重试。')
      setSaving(false)
    }
  }

  return (
    <div className="modal-mask" onClick={() => { if (!saving) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b id="room-dialog-title">{room ? (isPureGroup ? '聊天群设置' : '房间设置') : (isPureGroup ? '新建纯聊天群' : '新建群聊')}</b>
          <button className="icon-btn" disabled={saving} aria-label="关闭房间设置" onClick={onClose}>×</button>
        </div>
        <div className="modal-body form">
          <label>{isPureGroup ? '聊天群名称' : '房间名'}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={isPureGroup ? '如：AI情公寓客厅' : '如：方案评审'} /></label>
          {!room && isPureGroup && agents.some((a) => a.kind !== 'demo') && (
            <div className="form-row">
              <button type="button" className="ghost-btn" onClick={applyApartmentPreset}>
                🏠 一键填好：AI情公寓客厅（拉入全员）
              </button>
            </div>
          )}
          <div>
            <div className="dim small" style={{ marginBottom: 6 }}>{isPureGroup ? '加入聊天群的 AI 成员' : '参会者'}</div>
            {agents.length === 0 && <p className="dim">还没有成员，先去设置里添加。</p>}
            {agents.map((a) => {
              const badge = isPureGroup ? personaDisplayLabel(a) : ''
              return (
                <label key={a.id} className="check-row">
                  <input type="checkbox" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />
                  <div className="avatar sm" style={{ '--identity': a.color } as React.CSSProperties}>{a.name.slice(0, 1)}</div>
                  <span>{a.name}</span>
                  {badge && <span className="persona-chip-badge">{badge}</span>}
                  <span className="dim small">{a.kind === 'api' ? 'API' : a.kind === 'cli' ? 'CLI' : '演示'}</span>
                </label>
              )
            })}
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
