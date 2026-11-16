import { useEffect, useMemo, useRef, useState } from 'react'
import type { Agent, AppState, CliConfig, MemoryRecord, ModeratorSettings, ModeratorUpdate, ProviderSettings, ProviderUpdate, ReasoningEffort, Room, RulesFile, ScheduledTask } from '../../../shared/types'
import { AGENT_COLORS, CLI_PRESETS, DEFAULT_RULES, GLOBAL_MEMORY_KEY, isPureChatRoom, PRESET_MODELS, REASONING_LEVELS } from '../../../shared/types'
import { findPersonaPreset, PERSONA_PRESETS, personaDisplayLabel } from '../../../shared/personas'
import type { Confirmation } from './ConfirmDialog'
import WorkAccess, { accessLabel } from './WorkAccess'

interface Props {
  initialTab?: keyof typeof sections
  state: AppState
  onClose: () => void
  onConfirm: (confirmation: Confirmation) => void
}

type ProviderDraft = ProviderUpdate & { hasApiKey: boolean }

const emptyProvider = (): ProviderDraft => ({
  id: crypto.randomUUID(), name: '', baseUrl: '', hasApiKey: false, models: []
})

const emptyAgent = (): Agent => ({
  id: crypto.randomUUID(), name: '', color: AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)],
  kind: 'api', persona: '', providerId: '', model: ''
})

const sections = {
  providers: '模型服务',
  agents: '参会者与权限',
  general: '通用',
  moderator: '主持人',
  advanced: '高级设置',
  rules: '讨论规则',
  memory: '记忆',
  schedule: '定时任务'
} as const

const agentTypes = { api: 'API 模型', cli: '本地工具', demo: '离线演示' }
const advancedTabs = ['rules', 'memory', 'schedule'] as const
const primaryTabs = ['providers', 'agents', 'general', 'moderator', 'advanced'] as const

export default function Settings({ state, initialTab = 'providers', onClose, onConfirm }: Props): React.JSX.Element {
  const [tab, setTab] = useState<keyof typeof sections>(initialTab)
  const [editP, setEditP] = useState<ProviderDraft | null>(null)
  const [editA, setEditA] = useState<Agent | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const editing = Boolean(editP || editA)
  const wasEditing = useRef(false)
  const existingAgent = state.agents.find((agent) => agent.id === editA?.id)
  const existingProvider = state.providers.find((provider) => provider.id === editP?.id)
  const title = editA ? (existingAgent ? `编辑 ${existingAgent.name}` : '添加参会者')
    : editP ? (existingProvider ? `编辑 ${existingProvider.name}` : '添加模型服务') : sections[tab]
  const closeEditor = (): void => { setEditP(null); setEditA(null) }

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const opener = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.getClientRects().length) opener.focus()
    }
  }, [])

  useEffect(() => {
    if (editing || wasEditing.current) heading.current?.focus()
    wasEditing.current = editing
  }, [editing])

  const selectTab = (next: keyof typeof sections): void => {
    setTab(next)
    if (next !== 'providers') setEditP(null)
    if (next !== 'agents') setEditA(null)
  }

  return (
    <dialog ref={dialog} className="modal settings-modal" aria-labelledby="settings-heading"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) onClose()
      }}
      onCancel={(event) => { event.preventDefault(); if (editing) closeEditor(); else onClose() }}>
      <div className="modal-head">
        <h2 id="settings-heading">设置</h2>
        <button className="icon-btn" aria-label="关闭设置" onClick={onClose}>×</button>
      </div>

      <div className="settings-layout">
        <nav className="tabs settings-nav" aria-label="设置分类">
          {primaryTabs.map((key) => {
            const selected = tab === key || (key === 'advanced' && advancedTabs.some((advanced) => advanced === tab))
            return <button key={key} className={selected ? 'tab active' : 'tab'} aria-current={selected ? 'page' : undefined} onClick={() => selectTab(key)}>{sections[key]}</button>
          })}
        </nav>
        <section className="settings-content" aria-labelledby="settings-section">
          <div className="settings-heading-row">
            <div className="settings-heading-text">
              {editing && <button className="settings-back" onClick={closeEditor}>‹ {sections[tab]}</button>}
              <h3 id="settings-section" ref={heading} tabIndex={-1}>{title}</h3>
              {!editing && tab === 'providers' && <p>管理服务地址、API 密钥和可用模型。</p>}
              {!editing && tab === 'agents' && <p>配置群聊和私聊使用的模型及工作权限。</p>}
            </div>
            {!editing && tab === 'providers' && <button className="primary-btn" onClick={() => setEditP(emptyProvider())}>添加模型服务</button>}
            {!editing && tab === 'agents' && <button className="primary-btn" onClick={() => setEditA(emptyAgent())}>添加参会者</button>}
          </div>
          {tab === 'providers' && editP ? (
            <ProviderForm value={editP} notice={state.credentialNotice} onChange={setEditP} onCancel={closeEditor}
              onSave={async () => { await window.api.saveProvider(editP); setEditP(null) }} />
          ) : tab === 'agents' && editA ? (
            <AgentForm value={editA} providers={state.providers} moderator={state.moderator} onChange={setEditA} onCancel={closeEditor}
              onSave={async (agent) => { await window.api.saveAgent(agent); setEditA(null) }} />
          ) : <div className="settings-scroll" key={tab}>
            {tab === 'advanced' && <div className="advanced-settings">
              {advancedTabs.map((key) => <button key={key} className="ghost-btn" onClick={() => selectTab(key)}>{sections[key]}</button>)}
            </div>}
            {advancedTabs.some((key) => key === tab) && <div className="advanced-settings">
              <button className="ghost-btn" onClick={() => selectTab('advanced')}>‹ 高级设置</button>
            </div>}
            {state.credentialNotice && (tab === 'providers' || tab === 'moderator') &&
              <p className="composer-error" role="alert">{state.credentialNotice}</p>}
            {tab === 'memory' && <MemoryPanel rooms={state.rooms} onConfirm={onConfirm} />}
            {tab === 'schedule' && <SchedulePanel rooms={state.rooms} agents={state.agents} tasks={state.scheduledTasks ?? []} />}
            {tab === 'rules' && (
              <RulesForm value={state.rules ?? DEFAULT_RULES} onSave={(r) => void window.api.saveRules(r)} />
            )}
            {tab === 'moderator' && (
              <ModeratorForm
                providers={state.providers}
                value={state.moderator ?? { enabled: false, baseUrl: '', hasApiKey: false, model: '' }}
                onSave={window.api.saveModerator}
              />
            )}
            {tab === 'general' && (
              <div className="form">
                <ApprovalSound value={state.approvalSound !== false} />
                <p className="dim">参会者默认在共享目录处理文件。本地工具可在参会者设置中指定自己的目录。</p>
                <label htmlFor="shared-work-directory">共享工作目录</label>
                <div className="form-row">
                  <input id="shared-work-directory" value={state.workDir ?? ''} readOnly placeholder="尚未选择共享目录" />
                  <button className="primary-btn" onClick={async () => { const p = await window.api.pickFolder(); if (p) await window.api.setWorkDir(p) }}>选择文件夹…</button>
                </div>
                {state.workDir && (
                  <div className="form-row">
                    <button className="ghost-btn" onClick={() => void window.api.setWorkDir('')}>清除共享目录</button>
                    <span className="dim small">已为本地工具单独设置的目录仍可使用。</span>
                  </div>
                )}
              </div>
            )}
            {tab === 'providers' && (
              <div className="settings-list">
                {!state.providers.length && <p className="settings-empty">添加服务后，即可把它的模型设为参会者。</p>}
                {state.providers.map((p) => (
                  <div key={p.id} className="list-row">
                    <div>
                      <b>{p.name}</b>
                      <div className="dim small">{p.baseUrl}</div>
                      <div className="dim small">{p.models.length} 个模型 · {p.hasApiKey ? '已配置密钥' : '未配置密钥'}</div>
                    </div>
                    <div>
                      <button className="ghost-btn" onClick={() => setEditP({ ...p })}>编辑</button>
                      <button className="danger-btn" onClick={() => onConfirm({
                        message: `删除服务「${p.name}」？`, label: '删除服务', action: () => window.api.deleteProvider(p.id)
                      })}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'agents' && (
              <div className="settings-list">
                {!state.agents.length && <p className="settings-empty">添加参会者后，即可在群聊中邀请它加入讨论。</p>}
                {state.agents.map((a) => {
                  const chatBadge = personaDisplayLabel(a)
                  return (
                    <div key={a.id} className="list-row">
                      <div className="row-left">
                        <div className="avatar sm" style={{ '--identity': a.color } as React.CSSProperties} aria-hidden="true">{a.name.slice(0, 1)}</div>
                        <div>
                          <b>{a.name}</b>
                          <div className="dim small">
                            {agentTypes[a.kind]}{a.kind === 'api' ? ` · ${a.model || '未选模型'}` : a.kind === 'cli' && a.cli?.command ? ` · ${a.cli.command}` : ''}
                            {chatBadge ? ` · 纯聊人设：${chatBadge}` : ''}
                          </div>
                        </div>
                      </div>
                      <div>
                        {a.kind !== 'demo' && <span className="settings-permission-label">{accessLabel(a)}</span>}
                        <button className="ghost-btn" onClick={() => setEditA({ ...a, cli: a.cli ? { ...a.cli, args: [...a.cli.args] } : undefined })}>编辑</button>
                        <button className="danger-btn" onClick={() => onConfirm({
                          message: `删除参会者「${a.name}」？`, label: '删除参会者', action: () => window.api.deleteAgent(a.id)
                        })}>删除</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>}
        </section>
      </div>
    </dialog>
  )
}

function ApprovalSound({ value }: { value: boolean }): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return <div className="approval-sound-setting">
    <label className="check-row">
      <input type="checkbox" checked={value} disabled={saving} onChange={async (event) => {
        setSaving(true)
        setError('')
        try { await window.api.setApprovalSound(event.target.checked) }
        catch { setError('提示音设置未保存，请重试。') }
        finally { setSaving(false) }
      }} />
      需要我批准时播放提示音
    </label>
    <p className="dim small">新审批响一次，短时间多条合并提醒；自动审查通过时保持安静。</p>
    {error && <p className="composer-error" role="alert">{error}</p>}
  </div>
}

function KeyField({ stored, value, onChange }: {
  stored: boolean
  value?: string
  onChange: (value?: string) => void
}): React.JSX.Element {
  return <div className="credential-field">
    <label>API 密钥
      <input type="password" autoComplete="new-password" value={value ?? ''}
        placeholder={stored ? '留空保留，输入新密钥可替换' : '无密钥的本地服务可留空'}
        onChange={(e) => onChange(e.target.value || undefined)} />
    </label>
    <div className="form-row">
      <span className="dim small">{value === '' ? '保存后移除密钥。' : '密钥保存在 Windows 凭据管理器。'}</span>
      {stored && <button type="button" className="ghost-btn" onClick={() => onChange(value === '' ? undefined : '')}>
        {value === '' ? '撤销移除' : '移除密钥'}
      </button>}
    </div>
  </div>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作失败，请重试。'
}

function EditorFooter({ saving, disabled, message, onCancel }: {
  saving: boolean
  disabled: boolean
  message?: string
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="settings-footer">
      {message && <p className="composer-error" role="alert">{message}</p>}
      <div className="settings-footer-actions">
        <button type="button" className="ghost-btn" disabled={saving} onClick={onCancel}>取消</button>
        <button type="submit" className="primary-btn" disabled={saving || disabled}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  )
}

function ProviderForm({ value, notice, onChange, onSave, onCancel }: {
  value: ProviderDraft
  notice?: string
  onChange: (p: ProviderDraft) => void
  onSave: () => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const doFetch = async (): Promise<void> => {
    setFetching(true)
    setFetchMsg('')
    try {
      const models = await window.api.fetchModels(value.baseUrl, value.apiKey, value.id)
      onChange({ ...value, models })
      setFetchMsg(`已获取 ${models.length} 个模型`)
    } catch (e) {
      setFetchMsg(`获取失败：${errorText(e)}`)
    } finally {
      setFetching(false)
    }
  }

  const invalid = fetching || !value.name.trim() || !value.baseUrl.trim()
  return (
    <form className="settings-editor" onSubmit={async (event) => {
      event.preventDefault()
      if (invalid || saving) return
      setSaveError('')
      setSaving(true)
      try { await onSave() } catch (error) { setSaveError(errorText(error)); setSaving(false) }
    }}>
      <div className="settings-scroll form">
        {notice && <p className="composer-error" role="alert">{notice}</p>}
        <label>服务名称<input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="如：DeepSeek 官方" /></label>
        <label>服务地址（Base URL）<input value={value.baseUrl} onChange={(e) => onChange({ ...value, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" /></label>
        <KeyField stored={value.hasApiKey} value={value.apiKey} onChange={(apiKey) => onChange({ ...value, apiKey })} />
        <section className="settings-block form" aria-labelledby="provider-models">
          <div className="settings-inline-heading">
            <h4 id="provider-models">可用模型 <span>{value.models.length} 个</span></h4>
            <button type="button" className="ghost-btn settings-secondary" onClick={() => void doFetch()} disabled={fetching || !value.baseUrl}>
              {fetching ? '获取中…' : '获取模型列表'}
            </button>
          </div>
          {fetchMsg && <p className="dim small" role="status">{fetchMsg}</p>}
          {value.models.length > 0 && (
            <ul className="settings-models">
              {value.models.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
        </section>
      </div>
      <EditorFooter saving={saving} disabled={invalid} message={saveError} onCancel={onCancel} />
    </form>
  )
}

function roomKindTitle(r?: Room): string {
  if (!r) return '已删除的会议室'
  if (r.kind === 'dm') return `办公私聊 · ${r.name}`
  if (r.kind === 'chat-dm') return `纯聊私聊 · ${r.name}`
  if (r.kind === 'chat-group') return `纯聊群 · ${r.name}`
  return r.name
}

function SchedulePanel({ rooms, agents, tasks }: { rooms: Room[]; agents: Agent[]; tasks: ScheduledTask[] }): React.JSX.Element {
  const firstRoom = rooms.find((r) => !isPureChatRoom(r) && r.kind !== 'dm' && r.participantIds.length > 0) ?? rooms.find((r) => r.participantIds.length > 0)
  const [roomId, setRoomId] = useState(firstRoom?.id ?? '')
  const room = rooms.find((r) => r.id === roomId)
  const participants = useMemo(
    () => (room?.participantIds ?? []).map((id) => agents.find((a) => a.id === id)).filter((a): a is Agent => Boolean(a)),
    [room, agents]
  )
  const [agentId, setAgentId] = useState(participants[0]?.id ?? '')
  const [task, setTask] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedAgent = participants.find((a) => a.id === agentId) ?? participants[0]

  const changeRoom = (id: string): void => {
    setRoomId(id)
    const next = rooms.find((r) => r.id === id)
    const first = next?.participantIds.map((pid) => agents.find((a) => a.id === pid)).find(Boolean)
    setAgentId(first?.id ?? '')
  }

  const add = async (): Promise<void> => {
    if (!room || !selectedAgent || !task.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const every = Math.max(1, Math.min(7 * 24 * 60, Math.round(minutes || 60)))
      await window.api.saveScheduledTask({
        id: crypto.randomUUID(),
        roomId: room.id,
        agentId: selectedAgent.id,
        task: task.trim(),
        everyMinutes: every,
        nextAt: Date.now() + every * 60_000,
        enabled: true,
        createdAt: Date.now()
      })
      setTask('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存定时任务失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="form">
      <p className="dim">定时让参会者执行任务，结果会发回所选聊天。请先为执行者设置工作目录。</p>
      {!rooms.length && <p className="settings-empty">创建会议室后即可添加定时任务。</p>}
      {!!rooms.length && (
        <div className="schedule-form settings-field-grid">
          <label>会议室
            <select value={roomId} onChange={(e) => changeRoom(e.target.value)}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{roomKindTitle(r)}</option>)}
            </select>
          </label>
          <label>执行者
            <select value={selectedAgent?.id ?? ''} onChange={(e) => setAgentId(e.target.value)}>
              {participants.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>间隔（分钟）
            <input type="number" min={1} max={10080} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
          <label className="schedule-task">任务
            <textarea rows={3} value={task} onChange={(e) => setTask(e.target.value)} placeholder="例如：检查工作目录里的新文件并整理进度" />
          </label>
          <button className="primary-btn" onClick={() => void add()} disabled={saving || !task.trim() || !selectedAgent}>
            {saving ? '保存中…' : '添加定时任务'}
          </button>
        </div>
      )}
      {error && <p className="composer-error" role="alert">{error}</p>}
      <h4 className="settings-block">已添加的任务</h4>
      {tasks.length === 0 && <p className="settings-empty">还没有定时任务。</p>}
      {tasks.map((t) => {
        const r = rooms.find((x) => x.id === t.roomId)
        const a = agents.find((x) => x.id === t.agentId)
        return (
          <div key={t.id} className="mem-room">
            <div className="mem-room-head">
              <b>{roomKindTitle(r)} · {a?.name ?? '已删除的 bot'}</b>
              <span className="dim small">每 {t.everyMinutes} 分钟</span>
              <button
                className="ghost-btn"
                onClick={() => void window.api.saveScheduledTask({ ...t, enabled: !t.enabled })}
              >{t.enabled ? '停用' : '启用'}</button>
              <button className="danger-btn" onClick={() => void window.api.deleteScheduledTask(t.id)}>删除</button>
            </div>
            <div className="mem-text">{t.task}</div>
            <div className="dim small">
              {t.enabled ? `下次执行 ${new Date(t.nextAt).toLocaleString('zh-CN')}` : '已停用'}
              {t.lastRunAt ? ` · 上次：${new Date(t.lastRunAt).toLocaleString('zh-CN')}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MemoryPanel({ rooms, onConfirm }: { rooms: Room[]; onConfirm: Props['onConfirm'] }): React.JSX.Element {
  const [mems, setMems] = useState<Record<string, MemoryRecord[]>>()
  const [loadError, setLoadError] = useState('')
  const load = async (): Promise<void> => {
    setLoadError('')
    try { setMems(await window.api.listMemories()) } catch (error) { setLoadError(errorText(error)) }
  }
  useEffect(() => {
    void load()
  }, [])
  const nameOf = (id: string): string => id === GLOBAL_MEMORY_KEY ? '全局记忆' : (rooms.find((r) => r.id === id)?.name ?? id)
  const entries = Object.entries(mems ?? {})
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => (a === GLOBAL_MEMORY_KEY ? -1 : b === GLOBAL_MEMORY_KEY ? 1 : 0))
  const kindLabel: Record<string, string> = { progress: '进度', note: '笔记', fact: '事实', decision: '决定', preference: '偏好' }

  return (
    <div className="form">
      <p className="dim small">
        参会者会在每轮讨论中看到置顶记忆，并按话题查阅相关的普通记忆。全局记忆对所有聊天开放。
      </p>
      {loadError ? <div className="form-row"><p className="composer-error" role="alert">{loadError}</p><button className="ghost-btn" onClick={() => void load()}>重试</button></div>
        : !mems ? <p className="dim" role="status">正在读取记忆…</p>
          : !entries.length && <p className="settings-empty">还没有记忆。主持人归档的讨论进度会出现在这里。</p>}
      {entries.map(([roomId, list]) => (
        <div key={roomId} className="mem-room">
          <div className="mem-room-head">
            <b>{nameOf(roomId)}</b>
            <span className="dim small">{list.length} 段</span>
            <button
              className="danger-btn"
              onClick={() => onConfirm({
                message: `清空「${nameOf(roomId)}」的全部记忆？`,
                label: '清空记忆',
                action: async () => {
                  await window.api.clearMemories(roomId)
                  await load()
                }
              })}
            >
              清空
            </button>
          </div>
          {list.map((m) => (
            <div key={m.id} className="mem-item">
              <div className="mem-item-head">
                <span className="dim small">{new Date(m.ts).toLocaleString('zh-CN')}</span>
                <span className="dim small">{kindLabel[m.kind ?? 'note'] ?? '笔记'}</span>
                <button
                  className="ghost-btn mem-pin-btn"
                  title={m.pinned ? '取消置顶（不再每轮注入）' : '置顶（每轮都注入）'}
                  aria-pressed={Boolean(m.pinned)}
                  onClick={async () => {
                    await window.api.pinMemory(roomId, m.id, !m.pinned)
                    await load()
                  }}
                >
                  {m.pinned ? '已置顶' : '置顶'}
                </button>
                <button
                  className="icon-btn"
                  title="删除这段记忆"
                  onClick={async () => {
                    await window.api.deleteMemory(roomId, m.id)
                    await load()
                  }}
                >
                  ×
                </button>
              </div>
              <div className="mem-text">{m.text}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function RulesForm({ value, onSave }: { value: RulesFile; onSave: (r: RulesFile) => void }): React.JSX.Element {
  const [r, setR] = useState<RulesFile>(value)
  const [saved, setSaved] = useState(false)
  return (
    <div className="form">
      <p className="dim small">
        这里可以定制成员怎么发言和协作。占位符：{'{{agent}}'} 名字、{'{{room}}'} 房间、{'{{names}}'} 群友、{'{{topic}}'} 议题、{'{{persona}}'} 人设。保存后写回项目根目录的 <b>AGENTS.md</b>，也可直接改那个文件（重启生效）。
      </p>
      <label>成员发言与工作规则
        <textarea rows={11} value={r.host} onChange={(e) => { setR({ ...r, host: e.target.value }); setSaved(false) }} />
      </label>
      <div className="form-actions">
        <button className="primary-btn" onClick={() => { onSave(r); setSaved(true) }}>保存</button>
        <button className="ghost-btn" onClick={() => { setR({ ...r, host: DEFAULT_RULES.host }); setSaved(false) }}>恢复默认</button>
        {saved && <span className="dim small">已保存（下次发言生效）</span>}
      </div>
    </div>
  )
}

function ModelPicker({ value, models, onChange, disabled, label = '模型', emptyLabel = '选择模型' }: {
  value: string
  models: string[]
  onChange: (model: string) => void
  disabled?: boolean
  label?: string
  emptyLabel?: string
}): React.JSX.Element {
  const [custom, setCustom] = useState(false)
  const options = [...new Set([...models, value].filter(Boolean))]
  return <>
    <label>{label}
      <select aria-label={label} disabled={disabled} value={custom ? '__custom__' : value} onChange={(event) => {
        if (event.target.value === '__custom__') setCustom(true)
        else { setCustom(false); onChange(event.target.value) }
      }}>
        <option value="">{emptyLabel}</option>
        {options.map((model) => <option key={model} value={model}>{model}</option>)}
        <option value="__custom__">自定义输入…</option>
      </select>
    </label>
    {custom && <label className="settings-wide-field">自定义模型 ID
      <input aria-label="自定义模型 ID" value={value} onChange={(event) => onChange(event.target.value)} placeholder="填写服务提供的完整模型 ID" />
    </label>}
  </>
}

function ReasoningSelect({ value, onChange }: { value?: ReasoningEffort; onChange: (value?: ReasoningEffort) => void }): React.JSX.Element {
  return <label>思考强度
    <select aria-label="思考强度" value={value ?? ''} onChange={(event) => onChange(event.target.value ? event.target.value as ReasoningEffort : undefined)}>
      <option value="">默认（跟随模型）</option>
      {REASONING_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
    </select>
  </label>
}

function ModeratorForm({ value, providers, onSave }: { value: ModeratorSettings; providers: ProviderSettings[]; onSave: (c: ModeratorUpdate) => Promise<void> }): React.JSX.Element {
  const [cfg, setCfg] = useState<ModeratorUpdate>(value)
  const provider = providers.find((item) => item.id === cfg.providerId)
  const models = cfg.models ?? provider?.models ?? []
  const [fetching, setFetching] = useState(false)
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const update = (patch: Partial<ModeratorUpdate>): void => {
    setCfg((current) => ({ ...current, ...patch }))
    setSaveStatus('')
  }
  const fetchM = async (): Promise<void> => {
    setFetching(true)
    setMsg('')
    try {
      const ms = await window.api.fetchModels(provider?.baseUrl ?? cfg.baseUrl, cfg.apiKey, cfg.providerId)
      update({ models: ms })
      setMsg(`已获取 ${ms.length} 个模型`)
    } catch (e) {
      setMsg(`获取失败：${errorText(e)}`)
    } finally {
      setFetching(false)
    }
  }
  return (
    <div className="form">
      <p className="dim">启用后，群聊由主持人接待。它会直接回答简单问题，按需请成员讨论或执行任务。请选择支持工具调用的模型。</p>
      <div className="settings-block moderator-options">
        <label className="check-row">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <span>启用 AI 主持人</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={cfg.reviewCommands !== false} onChange={(e) => update({ reviewCommands: e.target.checked })} />
          <span>让经理终审快速审查未直接放行的命令</span>
        </label>
        <p className="dim small">开启后，快速副模型或成员拿不准的命令会自动升级给经理主模型做最终裁决并尽量自动放行，减少弹窗等待人工确认。</p>
      </div>
      <label>模型服务
        <select aria-label="主持人的模型服务" disabled={fetching || saving} value={cfg.providerId ?? ''} onChange={(event) => {
          const selected = providers.find((item) => item.id === event.target.value)
          update({
            providerId: selected?.id, baseUrl: selected?.baseUrl ?? '',
            model: '', models: selected?.models ?? [], apiKey: selected ? undefined : ''
          })
          setMsg('')
          setSaveStatus('')
        }}>
          <option value="">单独配置服务地址和密钥</option>
          {cfg.providerId && !provider && <option value={cfg.providerId}>原服务已移除，请重新选择</option>}
          {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {!cfg.providerId && <label>服务地址（Base URL）
        <input disabled={fetching || saving} value={cfg.baseUrl} onChange={(event) => {
          update({ baseUrl: event.target.value, models: [] })
          setMsg('')
        }} placeholder="如 http://127.0.0.1:3425/v1" />
      </label>}
      <div className="settings-field-grid">
        <ModelPicker key={cfg.providerId ?? 'custom'} value={cfg.model} models={models} disabled={fetching || saving} onChange={(model) => update({ model })} />
        <ReasoningSelect value={cfg.reasoningEffort} onChange={(reasoningEffort) => update({ reasoningEffort })} />
      </div>
      <p className="dim small">经理每次派单、复审命令和验收交付都会调用该模型；建议思考强度选「默认」或「低/中」，设为「高」以上会显著拉长每轮等待时间。</p>
      {cfg.providerId
        ? <p className="dim small">使用所选模型服务的地址和密钥。</p>
        : <KeyField stored={!value.providerId && value.hasApiKey} value={cfg.apiKey} onChange={(apiKey) => update({ apiKey })} />}
      <div className="form-row">
        <button className="ghost-btn settings-secondary" onClick={() => void fetchM()} disabled={fetching || !cfg.baseUrl}>{fetching ? '获取中…' : '获取模型列表'}</button>
        <span className="dim small">{msg}</span>
      </div>

      <section className="settings-block form" aria-labelledby="moderator-fast-section">
        <h4 id="moderator-fast-section">快速副模型（可选 · 双模型分流提速）</h4>
        <p className="dim small">
          开启后：命令安全审查、成员中途例行跟进和记忆整理自动走快速模型（秒级响应）；需求规划与最终成品验收仍由上方主模型把关。
        </p>
        {(() => {
          const fastProvider = providers.find((item) => item.id === cfg.fastProviderId)
          const fastModels = cfg.fastProviderId ? (fastProvider?.models ?? []) : models
          return (
            <div className="settings-field-grid">
              <label>快速模型服务
                <select
                  aria-label="快速模型服务"
                  disabled={saving}
                  value={cfg.fastProviderId ?? ''}
                  onChange={(event) => update({ fastProviderId: event.target.value || undefined, fastModel: '' })}
                >
                  <option value="">同主持人主服务</option>
                  {cfg.fastProviderId && !fastProvider && <option value={cfg.fastProviderId}>原服务已移除，请重选</option>}
                  {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <ModelPicker
                key={`fast-${cfg.fastProviderId ?? cfg.providerId ?? 'custom'}`}
                label="快速副模型（如 Flash）"
                emptyLabel="不启用（全流程使用主模型）"
                value={cfg.fastModel ?? ''}
                models={fastModels}
                disabled={saving}
                onChange={(fastModel) => update({ fastModel: fastModel || undefined })}
              />
            </div>
          )
        })()}
      </section>

      <div className="form-actions">
        <button className="primary-btn" disabled={saving || fetching || (cfg.enabled && (!cfg.model.trim() || !cfg.baseUrl.trim() || (!!cfg.providerId && !provider)))} onClick={async () => {
          setSaving(true)
          setSaveStatus('')
          try {
            await onSave(cfg)
            setCfg((current) => current.apiKey === cfg.apiKey ? { ...current, apiKey: undefined } : current)
            setSaveStatus('已保存。')
          } catch (error) { setSaveStatus(errorText(error)) }
          finally { setSaving(false) }
        }}>{saving ? '保存中…' : '保存'}</button>
        {saveStatus && <span className="dim small" role="status">{saveStatus}</span>}
      </div>
    </div>
  )
}

function AgentForm({ value, providers, moderator, onChange, onSave, onCancel }: {
  value: Agent
  providers: ProviderSettings[]
  moderator?: ModeratorSettings
  onChange: (a: Agent) => void
  onSave: (a: Agent) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const cli: CliConfig = value.cli ?? { ...CLI_PRESETS.custom.cli, args: [] }
  const guessPreset = value.cli
    ? (Object.entries(CLI_PRESETS).find(([, p]) => p.cli.command === value.cli!.command)?.[0] ?? 'custom')
    : 'codebuddy'
  const [preset, setPreset] = useState(guessPreset)
  const [origName] = useState(value.name)
  const baseModels = cli.models?.length ? cli.models : (PRESET_MODELS[guessPreset] ?? [])
  const [cliModels, setCliModels] = useState<string[]>(baseModels)
  const modelOptions = useMemo(() => {
    const list = [...cliModels]
    if (cli.model && !list.includes(cli.model)) list.push(cli.model)
    return list
  }, [cliModels, cli.model])
  const [customModel, setCustomModel] = useState(!!cli.model && !baseModels.includes(cli.model))
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const provider = providers.find((p) => p.id === value.providerId)
  const reviewer = value.kind === 'api' && provider && value.model ? '这个参会者的模型'
    : moderator?.enabled && moderator.baseUrl.trim() && moderator.model.trim() ? '主持人模型' : undefined

  const setCli = (patch: Partial<CliConfig>): void => onChange({ ...value, cli: { ...cli, ...patch } })
  const applyPreset = (key: string): void => {
    setPreset(key)
    setCliModels(PRESET_MODELS[key] ?? [])
    const p = CLI_PRESETS[key]
    if (p) onChange({ ...value, kind: 'cli', access: value.access === 'full-approval' ? 'workspace' : value.access, cli: { ...p.cli, args: [...p.cli.args] } })
  }
  const fetchCliModels = async (): Promise<void> => {
    setFetching(true)
    setFetchMsg('')
    try {
      const ms = await window.api.cliModels(cli.command)
      setCliModels(ms)
      setCli({ models: ms })
      setFetchMsg(`已获取 ${ms.length} 个模型`)
    } catch (e) {
      setFetchMsg(`获取失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setFetching(false)
    }
  }

  const nameOk = value.name.trim().length > 0 && !/\s/.test(value.name.trim())
  const ready =
    nameOk &&
    (value.kind === 'demo' ||
      (value.kind === 'api' && !!value.providerId && !!value.model) ||
      (value.kind === 'cli' && !!cli.command.trim()))

  return (
    <form className="settings-editor" onSubmit={async (event) => {
      event.preventDefault()
      if (!ready || saving || fetching) return
      setSaveError('')
      setSaving(true)
      try {
        await onSave({ ...value, name: value.name.trim(), autoName: value.name.trim() !== origName ? false : value.autoName })
      } catch (error) {
        setSaveError(errorText(error))
        setSaving(false)
      }
    }}>
      <div className="settings-scroll form">
        <section className="settings-block form" aria-labelledby="agent-connection">
          <h4 id="agent-connection">模型配置</h4>
          <div className="settings-field-grid">
            <label>显示名称
              <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="用于 @ 点名，不含空格" />
            </label>
            <label>连接方式
              <select value={value.kind} onChange={(e) => {
                const kind = e.target.value as Agent['kind']
                if (kind === 'cli') applyPreset(preset)
                else onChange({ ...value, kind })
              }}>
                <option value="api">API 模型</option>
                <option value="cli">本地工具（CLI）</option>
                <option value="demo">离线演示</option>
              </select>
            </label>
            {value.kind === 'api' && (
              <>
                <label>模型服务
                  <select value={value.providerId} onChange={(e) => onChange({ ...value, providerId: e.target.value, model: '' })}>
                    <option value="">选择服务</option>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <ModelPicker key={value.providerId ?? ''} value={value.model ?? ''} models={provider?.models ?? []} onChange={(model) => onChange({ ...value, model })} />
                <ReasoningSelect value={value.reasoningEffort} onChange={(reasoningEffort) => onChange({ ...value, reasoningEffort })} />
              </>
            )}

            {value.kind === 'cli' && (
              <>
                <label>工具预设
                  <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
                    {Object.entries(CLI_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                <label>启动命令<input value={cli.command} onChange={(e) => setCli({ command: e.target.value })} placeholder="如 agy、codex" /></label>
                <label>模型（默认 = CLI 自身设置）
                  <select
                    value={customModel ? '__custom__' : (cli.model ?? '')}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '__custom__') setCustomModel(true)
                      else { setCustomModel(false); setCli({ model: v }) }
                    }}
                  >
                    <option value="">默认（CLI 自身设置）</option>
                    {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    <option value="__custom__">自定义输入…</option>
                  </select>
                </label>
                {customModel && (
                  <label>自定义模型 ID
                    <input value={cli.model ?? ''} onChange={(e) => setCli({ model: e.target.value })} placeholder="输入模型 ID" />
                  </label>
                )}
                {(cli.session === 'claude' || cli.session === 'agy') &&
                  <ReasoningSelect value={value.reasoningEffort} onChange={(reasoningEffort) => onChange({ ...value, reasoningEffort })} />}
                <label>工作目录
                  <input value={cli.cwd} onChange={(e) => setCli({ cwd: e.target.value })} placeholder="留空使用共享目录" />
                </label>
              </>
            )}
          </div>
          {provider && value.kind === 'api' && provider.models.length === 0 && <p className="dim small">可直接输入模型 ID，也可在「模型服务」中获取列表。</p>}
        </section>

        {value.kind !== 'demo' && <WorkAccess agent={value} reviewer={reviewer} onChange={(access) => onChange({ ...value, access })} />}

        {value.kind === 'cli' && (
          <details className="settings-details">
            <summary>高级设置</summary>
            <div className="form">
              <div className="form-row">
                <button type="button" className="ghost-btn settings-secondary" onClick={() => void fetchCliModels()} disabled={fetching || !cli.command}>
                  {fetching ? '获取中…' : '获取模型列表'}
                </button>
                <span className="dim small" role="status">{fetchMsg || 'agy 支持自动获取，其它工具可手动输入。'}</span>
              </div>
              <label>启动参数（空格分隔）
                <input value={cli.args.join(' ')} onChange={(e) => setCli({ args: e.target.value.split(/\s+/).filter(Boolean) })} />
              </label>
              <div className="settings-field-grid">
                <label>输出解析
                  <select value={cli.outputMode} onChange={(e) => setCli({ outputMode: e.target.value as CliConfig['outputMode'] })}>
                    <option value="claude-stream">stream-json（codebuddy / claude）</option>
                    <option value="agy-stream">stream-json（agy）</option>
                    <option value="last-file">末尾消息文件（codex，参数含 {'{{outfile}}'}）</option>
                    <option value="json">JSON 的 response 字段（gemini）</option>
                    <option value="text">原始 stdout</option>
                  </select>
                </label>
                <label>会话续接
                  <select value={cli.session} onChange={(e) => setCli({ session: e.target.value as CliConfig['session'] })}>
                    <option value="claude">--session-id / -r（codebuddy / claude）</option>
                    <option value="agy">--conversation（agy）</option>
                    <option value="none">无（每轮新进程）</option>
                  </select>
                </label>
              </div>
              <p className="dim small">预设参数会影响本地工具提供的能力。多个参会者处理同一批文件时，可以分别设置工作目录。</p>
            </div>
          </details>
        )}

        <label className="settings-block">办公人设（可选，用于经理模式与工作区）
          <textarea rows={3} value={value.persona} onChange={(e) => onChange({ ...value, persona: e.target.value })} placeholder="如：你是资深后端架构师，发言聚焦可行性与风险…" />
        </label>

        <section className="settings-block form" aria-labelledby="agent-chat-persona">
          <h4 id="agent-chat-persona">纯聊天角色设定（娱乐 / 《AI情公寓》）</h4>
          <label>内置角色预设
            <select
              value={value.chatPreset ?? (value.chatPersona?.trim() ? 'custom' : '')}
              onChange={(e) => {
                const id = e.target.value
                const preset = findPersonaPreset(id)
                onChange({
                  ...value,
                  chatPreset: id || undefined,
                  chatPersona: preset ? undefined : id === 'custom' ? (value.chatPersona ?? '') : undefined
                })
              }}
            >
              <option value="">默认自然聊天（不使用特殊人设）</option>
              <optgroup label="《AI情公寓》性格预设（只含性格口癖，不强制演场景）">
                {PERSONA_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}｜{p.aliases}</option>
                ))}
              </optgroup>
              <option value="custom">自定义纯聊天人设…</option>
            </select>
          </label>
          {(() => {
            const preset = findPersonaPreset(value.chatPreset)
            const showTextarea = Boolean(preset || value.chatPreset === 'custom' || value.chatPersona?.trim())
            return (
              <>
                <p className="dim small">
                  {preset
                    ? `「${preset.tagline}」—— 仅在「纯聊天」区生效，只注入性格与说话方式、不带场景旁白，不影响办公模式。`
                    : '仅在「纯聊天」区域生效，可以挑选《AI情公寓》性格预设或自由编写，把成员当聊天 AI 玩。'}
                </p>
                {showTextarea && (
                  <>
                    <textarea
                      rows={5}
                      value={value.chatPersona ?? preset?.prompt ?? ''}
                      onChange={(e) => {
                        const val = e.target.value
                        onChange({
                          ...value,
                          chatPreset: value.chatPreset || 'custom',
                          chatPersona: preset && val.trim() === preset.prompt.trim() ? undefined : val
                        })
                      }}
                      placeholder="在这里查看、微调角色词条，或编写自己的纯聊天人设…"
                    />
                    {preset && (value.chatPersona ?? '').trim() !== preset.prompt.trim() && (
                      <div className="form-row">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => onChange({ ...value, chatPersona: preset.prompt })}
                        >
                          恢复 {preset.name} 默认词条
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )
          })()}
        </section>
      </div>
      <EditorFooter saving={saving} disabled={!ready || fetching} message={saveError || (!nameOk && value.name.trim() ? '显示名称不能含空格。' : undefined)} onCancel={onCancel} />
    </form>
  )
}
