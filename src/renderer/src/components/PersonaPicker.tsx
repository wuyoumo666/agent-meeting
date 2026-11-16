import { useState } from 'react'
import type { Agent } from '../../../shared/types'
import { findPersonaPreset, PERSONA_PRESETS } from '../../../shared/personas'

interface Props {
  agents: Agent[]
  initialAgentId?: string
  onSaveAgent: (agent: Agent) => Promise<void>
  onClose: () => void
}

export default function PersonaPicker({ agents, initialAgentId, onSaveAgent, onClose }: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(initialAgentId && agents.some((a) => a.id === initialAgentId) ? initialAgentId : (agents[0]?.id ?? ''))
  const currentAgent = agents.find((a) => a.id === selectedId) ?? agents[0]
  const [customDraft, setCustomDraft] = useState(
    currentAgent?.chatPersona ?? findPersonaPreset(currentAgent?.chatPreset)?.prompt ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!currentAgent) {
    return (
      <div className="persona-pop">
        <div className="members-head">
          <b>角色设定</b>
          <button className="icon-btn" aria-label="关闭角色设定" onClick={onClose}>×</button>
        </div>
        <p className="dim small" style={{ padding: 10 }}>还没有可用成员，请先在设置中添加成员。</p>
      </div>
    )
  }

  const selectAgent = (agent: Agent): void => {
    setSelectedId(agent.id)
    setCustomDraft(agent.chatPersona ?? findPersonaPreset(agent.chatPreset)?.prompt ?? '')
    setError('')
  }

  const applyPreset = async (presetId: string): Promise<void> => {
    if (saving) return
    const preset = findPersonaPreset(presetId)
    const next: Agent = {
      ...currentAgent,
      chatPreset: presetId || undefined,
      chatPersona: preset ? undefined : presetId === 'custom' ? customDraft : undefined
    }
    setSaving(true)
    setError('')
    try {
      await onSaveAgent(next)
      setCustomDraft(preset ? preset.prompt : '')
    } catch {
      setError('保存人设失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  const saveCustomText = async (): Promise<void> => {
    if (saving) return
    const trimmed = customDraft.trim()
    const preset = findPersonaPreset(currentAgent.chatPreset)
    const nextPreset = preset
      ? currentAgent.chatPreset
      : (trimmed ? 'custom' : undefined)
    const nextPersona = preset && trimmed === preset.prompt.trim() ? undefined : (trimmed || undefined)
    setSaving(true)
    setError('')
    try {
      await onSaveAgent({ ...currentAgent, chatPreset: nextPreset, chatPersona: nextPersona })
    } catch {
      setError('保存人设失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  const activePreset = findPersonaPreset(currentAgent.chatPreset)

  return (
    <div className="persona-pop" role="region" aria-label="纯聊天角色设定">
      <div className="members-head">
        <b>🎭 角色设定 · {currentAgent.name}</b>
        <span className="dim small">仅在纯聊天区生效，立即应用</span>
        <button className="icon-btn" aria-label="关闭角色设定" onClick={onClose}>×</button>
      </div>

      {agents.length > 1 && (
        <div className="persona-agent-tabs" role="tablist" aria-label="选择要设置人设的成员">
          {agents.map((a) => {
            const p = findPersonaPreset(a.chatPreset)
            return (
              <button
                key={a.id}
                role="tab"
                aria-selected={a.id === currentAgent.id}
                className={a.id === currentAgent.id ? 'persona-agent-tab active' : 'persona-agent-tab'}
                onClick={() => selectAgent(a)}
              >
                <span className="avatar sm" style={{ '--identity': a.color } as React.CSSProperties} aria-hidden="true">{a.name.slice(0, 1)}</span>
                <span>{a.name}</span>
                {p && <span className="persona-chip-badge">{p.badge}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="persona-grid">
        <button
          className={!currentAgent.chatPreset && !currentAgent.chatPersona?.trim() ? 'persona-card active' : 'persona-card'}
          disabled={saving}
          onClick={() => void applyPreset('')}
        >
          <div className="persona-card-head">
            <b>自然聊天（默认）</b>
          </div>
          <p>不使用角色扮演设定，以原本性格轻松闲聊。</p>
        </button>

        {PERSONA_PRESETS.map((preset) => {
          const active = currentAgent.chatPreset === preset.id
          return (
            <button
              key={preset.id}
              className={active ? 'persona-card active' : 'persona-card'}
              style={{ '--persona-accent': preset.color } as React.CSSProperties}
              disabled={saving}
              onClick={() => void applyPreset(preset.id)}
            >
              <div className="persona-card-head">
                <i className="persona-dot" style={{ background: preset.color }} aria-hidden="true" />
                <b>{preset.name}</b>
                <span className="dim small">{preset.aliases}</span>
              </div>
              <p>{preset.tagline}</p>
            </button>
          )
        })}
      </div>

      <div className="persona-custom-box">
        <div className="persona-custom-head">
          <span className="dim small">
            {activePreset
              ? `当前内置《AI情公寓》性格 · ${activePreset.name}（只含性格与口癖、不强制演固定场景，可微调）`
              : '自定义聊天人设（可自由编写性格与说话风格）'}
          </span>
          {activePreset && customDraft.trim() !== activePreset.prompt.trim() && (
            <button className="ghost-btn" disabled={saving} onClick={() => void applyPreset(activePreset.id)}>
              恢复默认词条
            </button>
          )}
        </div>
        <textarea
          rows={3}
          value={customDraft}
          disabled={saving}
          onChange={(e) => setCustomDraft(e.target.value)}
          placeholder="也可留空使用默认，或在这里输入/微调角色设定…"
        />
        <div className="persona-custom-actions">
          {error && <span className="composer-error">{error}</span>}
          <button
            className="primary-btn"
            disabled={saving || customDraft.trim() === (currentAgent.chatPersona ?? activePreset?.prompt ?? '').trim()}
            onClick={() => void saveCustomText()}
          >
            {saving ? '保存中…' : '保存设定'}
          </button>
        </div>
      </div>
    </div>
  )
}
