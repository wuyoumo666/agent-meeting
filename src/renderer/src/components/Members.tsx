import type { Agent } from '../../../shared/types'
import { personaDisplayLabel } from '../../../shared/personas'
import { AccessSelect } from './WorkAccess'

interface Props {
  agents: Agent[]
  participantIds: string[]
  pureChat?: boolean
  onToggle: (id: string) => void
  onAccess: (id: string, access: Agent['access']) => void
  onClose: () => void
}

export default function Members({ agents, participantIds, pureChat, onToggle, onAccess, onClose }: Props): React.JSX.Element {
  return (
    <div className="members-pop">
      <div className="members-head">
        <b>{pureChat ? '聊天群成员' : '群聊成员'}</b>
        <span className="dim small">{participantIds.length} 人已加入</span>
        <button className="icon-btn" aria-label="关闭群聊成员" onClick={onClose}>×</button>
      </div>
      {agents.length === 0 && <p className="dim small" style={{ padding: 10 }}>还没有成员，去设置里添加。</p>}
      <div className="members-list">
        {agents.map((a) => {
          const badge = pureChat ? personaDisplayLabel(a) : ''
          return (
            <div key={a.id} className="members-row">
              <label className="members-person" title={a.name}>
                <input type="checkbox" checked={participantIds.includes(a.id)} onChange={() => onToggle(a.id)} />
                <span className="avatar sm" style={{ '--identity': a.color } as React.CSSProperties} aria-hidden="true">{a.name.slice(0, 1)}</span>
                <span className="members-name">{a.name}</span>
              </label>
              {pureChat
                ? (badge ? <span className="persona-chip-badge">{badge}</span> : <span className="dim small">默认聊天</span>)
                : (a.kind === 'demo' ? <span className="dim small">离线演示</span>
                  : <AccessSelect className="members-access" agent={a} onChange={(access) => onAccess(a.id, access)} />)}
            </div>
          )
        })}
      </div>
      {!pureChat && agents.some((agent) => agent.kind !== 'demo') && <p className="members-note">修改工作权限后立即生效，适用于该参会者的所有聊天。</p>}
    </div>
  )
}
