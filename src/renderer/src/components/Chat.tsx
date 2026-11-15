import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ActivityEntry, Agent, AgentWorkInfo, Attachment, ManagerProject, Message, ModelRate, Room, WorkTarget, WorkspaceState } from '../../../shared/types'
import { findMentions } from '../../../shared/mentions'
import type { AgentStatus } from '../App'
import Members from './Members'
import { AccessSelect } from './WorkAccess'
import { agentColors } from '../identity'
import { DeliveryCards, ManagerPanel, SourceLinks } from './ManagerPanel'
import Icon from './Icon'

const HelpModal = lazy(() => import('./HelpModal'))
const DeliveryModal = lazy(() => import('./DeliveryModal'))
const HistoryModal = lazy(() => import('./HistoryModal'))
const markdownPlugins = [remarkGfm]
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

export interface RoomDraft {
  text: string
  attachments: Attachment[]
}

interface Props {
  room: Room
  participants: Agent[]
  allAgents: Agent[]
  messages: Message[]
  pending: Set<string>
  loading: boolean
  loadError: string
  onRetry: () => void
  hasEarlier: boolean
  onLoadEarlier: () => Promise<void>
  onOpenNav: () => void
  navOpen?: boolean
  hasUnread?: boolean
  savedDraft?: RoomDraft
  onDraftChange: (draft: RoomDraft) => void
  statuses: Record<string, AgentStatus>
  workspace?: WorkspaceState
  managerProject?: ManagerProject | null
  managerReady: boolean
  onManagerSettings: () => void
  agentWork?: AgentWorkInfo | null
  activity?: ActivityEntry[]
  onOpenRoom: (roomId: string) => void
  workDir?: string
  onStopWorkspace: () => void
  onStopRun: (runId: string) => void
  onApproveCommand: (id: string, allow: boolean) => void
  onSend: (text: string, attachments: Attachment[], sendToWorkspace: boolean) => Promise<void>
  onStop: () => void
  onEditRoom: () => void
  onArchive: () => Promise<void>
  onRestore: () => Promise<void>
  onDelete: () => void
  onToggleMember: (id: string) => void
  onSetAccess: (id: string, access: Agent['access']) => void
}

// CommonMark 不认 **紧贴中文引号** 的加粗（如 **“…”**），把引号挪到加粗外层；代码块/行内代码不动
function normalizeMd(text: string): string {
  const open = '“”"\'「『《（(【\\['
  const close = '“”"\'」』》）)】\\]'
  const re = new RegExp(`\\*\\*([${open}])([^*]+?)([${close}])\\*\\*`, 'g')
  return text
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(re, '$1**$2**$3')))
    .join('')
}

const MessageRow = memo(function MessageRow({ message: m, streaming, color }: { message: Message; streaming: boolean; color: string }) {
  if (m.kind === 'system') return <div id={'msg-' + m.id} className="sys-msg">{m.text}</div>
  if (!m.text && !m.attachments?.length && !streaming) return null
  return (
    <article id={'msg-' + m.id} className={m.senderId === 'user' ? 'msg msg-own' : 'msg msg-bot'} style={{ '--identity': color } as React.CSSProperties}>
      <div className="avatar" aria-hidden="true">
        {m.senderName.slice(0, 1)}
      </div>
      <div className="msg-body">
        <div className="msg-meta"><b>{m.senderName}</b><time className="dim">{timeFormat.format(m.ts)}</time></div>
        <div className="msg-text markdown">
          {streaming
            ? <span className="stream-text">{m.text}<span className="cursor" aria-label="正在生成">▍</span></span>
            : <ReactMarkdown remarkPlugins={markdownPlugins}>{normalizeMd(m.text)}</ReactMarkdown>}
        </div>
        {!!m.attachments?.length && (
          <div className="msg-atts">
            {m.attachments.map((a, i) => a.kind === 'image' && a.dataUrl
              ? <img key={i} src={a.dataUrl} className="msg-img" alt={a.name} loading="lazy" decoding="async" />
              : <span key={i} className="msg-att">{a.name}</span>)}
          </div>
        )}
        {!!m.deliveries?.length && <DeliveryCards message={m} />}
        <SourceLinks sources={m.sources} />
      </div>
    </article>
  )
})

const MessageList = memo(function MessageList({ messages, pending, colors }: { messages: Message[]; pending: Set<string>; colors: Map<string, string> }) {
  return messages.map((message) => <MessageRow key={message.id} message={message} streaming={pending.has(message.id)} color={colors.get(message.senderId) || message.color || '#4877ac'} />)
})

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} 毫秒`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function ActivityMetrics({ entry, now }: { entry: ActivityEntry; now: number }): React.JSX.Element | null {
  const tool = entry.tool
  if (!tool) return null
  const transfer = tool.transfer
  const percent = transfer?.totalBytes ? Math.floor(100 * transfer.bytes / transfer.totalBytes) : undefined
  const elapsed = Math.max(0, (tool.endedAt ?? now) - entry.ts)
  const duration = tool.endedAt !== undefined
    ? `用时 ${formatElapsed(elapsed)}`
    : `已等 ${elapsed < 1000 ? '0 秒' : formatElapsed(elapsed)}`
  const speed = transfer?.bytesPerSecond ? `${formatBytes(transfer.bytesPerSecond)}/s` : undefined
  return <span className="activity-metrics" title={[duration, speed && '平均传输速度 ' + speed, transfer && '已传输 ' + formatBytes(transfer.bytes)].filter(Boolean).join(' · ')}>
    {duration}
    {!!transfer?.bytes && <span>{speed ?? formatBytes(transfer.bytes)}</span>}
    {percent !== undefined && <b aria-label={`传输 ${percent}%`}><span className="activity-transfer-label">传输 </span>{percent}%</b>}
  </span>
}

const rateBasis = {
  'api-request': '从发送请求到收到完整回复',
  'cli-api': '本轮模型请求用时',
  'cli-step': '该段模型回复用时'
}

function TokenSpeed({ rate, recent = false }: { rate: ModelRate; recent?: boolean }): React.JSX.Element {
  const speed = (1000 * rate.outputTokens / rate.elapsedMs).toFixed(1)
  const detail = `${rate.outputTokens} 输出 token · ${(rate.elapsedMs / 1000).toFixed(2)} 秒（${rateBasis[rate.basis]}）`
  return <span className="activity-token-speed" title={detail}>
    {recent && <span className="activity-speed-prefix">上次 </span>}
    <b>{speed}</b> token/s
    {!recent && <span className="dim"> · {detail}</span>}
  </span>
}

function ActivityStrip({ label, note, current, history, rateAgent, assignment, open, onOpenChange, onStop }: {
  label: string
  note?: string
  current: ActivityEntry[]
  history?: ActivityEntry[]
  rateAgent?: string
  assignment?: { returned: number; total: number }
  open: boolean
  onOpenChange: (open: boolean) => void
  onStop?: () => void
}): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [now, setNow] = useState(Date.now)
  const key = current.map((item) => item.ts + ':' + item.agentName).join('|')
  const length = current.length
  useEffect(() => {
    setIndex(0)
  }, [key])
  useEffect(() => {
    if (open || length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => setIndex((value) => (value + 1) % length), 3500)
    return () => clearInterval(timer)
  }, [open, length, key])
  const activity = current[index] ?? current[0]
  const currentAgent = activity?.agentName ?? rateAgent
  const rate = useMemo(() => history?.filter((entry) => entry.modelRate && entry.agentName === currentAgent).at(-1)?.modelRate, [history, currentAgent])
  const hasLiveTool = open && Boolean(history?.some((entry) => entry.tool && entry.tool.endedAt === undefined))
  useEffect(() => {
    if (!hasLiveTool) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasLiveTool])
  const percent = assignment ? Math.floor(100 * assignment.returned / assignment.total) : undefined
  const trigger = useRef<HTMLButtonElement>(null)
  const close = (): void => {
    onOpenChange(false)
    trigger.current?.focus()
  }
  return (
    <div className="thinking-bar" onKeyDown={(event) => {
      if (open && event.key === 'Escape') { event.stopPropagation(); close() }
    }}>
      <span className="thinking-label" role="status">{onStop && <i className="live-dot" />}<span>{label}</span></span>
      {history?.length ? (
        <button ref={trigger} className="activity-ticker" title="查看活动记录" aria-expanded={open} onClick={() => onOpenChange(!open)}>
          <span className="activity-text">{activity ? <>
            <b>{activity.agentName}</b><span className="activity-separator" aria-hidden="true"> · </span>
            <span className="activity-action">{activity.text}</span>
          </> : note || '活动记录'}</span>
          {rate && <TokenSpeed rate={rate} recent />}
          <span aria-hidden="true" className="activity-chevron" />
        </button>
      ) : note && <span className="manager-activity-note">{note}</span>}
      {assignment && percent !== undefined && (
        <span className="activity-assignment" title={`已回报 ${assignment.returned} / ${assignment.total} 项已分配任务`}>
          <span>分工 <b>{percent}%</b></span>
          <progress aria-label="已分配任务的成员回报进度" value={assignment.returned} max={assignment.total} />
        </span>
      )}
      {onStop && <button className="danger-btn" onClick={onStop}>停止</button>}
      {open && !!history?.length && (
        <section className="activity-panel" aria-label="活动记录">
          <div className="activity-panel-head">
            <b>活动记录</b>
            <span className="dim small">{history.length} 条</span>
            <button className="icon-btn" aria-label="关闭活动记录" onClick={close}>×</button>
          </div>
          <div className="activity-list">
            {[...history].reverse().map((entry, i) => (
              <div className="activity-row" key={entry.tool?.id ?? entry.ts + '-' + i}>
                <time className="dim small">{timeFormat.format(entry.ts)}</time>
                <b>{entry.agentName}</b>
                <div className="activity-row-detail">
                  <span>{entry.tool?.endedAt !== undefined ? entry.text.replace(/^正在/, '') : entry.text}</span>
                  {entry.modelRate && <TokenSpeed rate={entry.modelRate} />}
                  <ActivityMetrics entry={entry} now={now} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/** 聊天内嵌的「正在干活」卡片：支持多个 bot 并行 */
function RunItem({ run, onStop, onApprove }: {
  run: NonNullable<WorkspaceState['runs']>[number]
  onStop: () => void
  onApprove: (id: string, allow: boolean) => void
}): React.JSX.Element {
  const running = run.status === 'running'
  const approval = run.pending
  const last = [...run.log].reverse().find((e) => e.kind === 'tool' || e.kind === 'text')
  const detail = run.status === 'error' ? run.summary || last?.text : last?.text
  return (
    <article className="run-card" data-status={approval ? 'approval' : run.status}>
      <div className="run-card-head">
        {running && <i className="live-dot" aria-hidden="true" />}
        <b>{approval?.agentName ?? run.agentName ?? '任务'}</b>
        <span className="run-status">{approval ? '等待命令批准' : running ? '任务进行中' : '任务出错'}</span>
        {running && <button className="ghost-btn" onClick={onStop}>停止任务</button>}
      </div>
      {run.task && <div className="run-card-task" title={run.task}>{run.task}</div>}
      {!approval && detail && <div className="run-card-line">{detail}</div>}
      {approval && (
        <div className="run-card-approve">
          {approval.reason && <div className="run-card-line">{approval.reason}</div>}
          <code className="run-cmd">{approval.command}</code>
          <div className="run-card-actions">
            <button className="ghost-btn" onClick={() => onApprove(approval.id, false)}>拒绝</button>
            <button className="primary-btn" onClick={() => onApprove(approval.id, true)}>允许执行</button>
          </div>
        </div>
      )}
    </article>
  )
}

function RunCard({ ws, approvalsOnly, onStop, onStopRun, onApprove }: {
  ws?: WorkspaceState
  approvalsOnly?: boolean
  onStop: () => void
  onStopRun: (runId: string) => void
  onApprove: (id: string, allow: boolean) => void
}): React.JSX.Element | null {
  if (!ws) return null
  let runs = ws.runs?.length
    ? [...ws.runs]
    : []
  // 讨论轮的命令审批没有独立 run，用一张兼容卡片显示
  if (ws.pending && !runs.some((r) => r.pending?.id === ws.pending!.id)) {
    runs.push({
      id: 'legacy', agentId: ws.agentId, agentName: ws.agentName, task: ws.task,
      status: 'done', startedAt: ws.startedAt, endedAt: ws.endedAt, summary: ws.summary,
      log: ws.log, pending: ws.pending
    })
  }
  if (!runs.length) {
    runs = [{
      id: 'legacy', agentId: ws.agentId, agentName: ws.agentName, task: ws.task,
      status: (ws.status === 'idle' ? 'done' : ws.status) as 'running' | 'done' | 'replied' | 'error',
      startedAt: ws.startedAt, endedAt: ws.endedAt, summary: ws.summary, log: ws.log, pending: ws.pending
    }]
  }
  const visible = runs.filter((r) => r.pending || (!approvalsOnly && (r.status === 'running' || r.status === 'error')))
  if (!visible.length) return null
  return <div className="run-list" aria-label="任务与审批">{visible.map((run) => (
    <RunItem
      key={run.id}
      run={run}
      onStop={() => run.id === 'legacy' ? onStop() : onStopRun(run.id)}
      onApprove={onApprove}
    />
  ))}</div>
}

export default function Chat(props: Props): React.JSX.Element {
  const { room, participants, messages, pending, statuses, workspace, agentWork, activity } = props
  const colors = useMemo(() => agentColors(props.allAgents), [props.allAgents])
  const isDm = room.kind === 'dm'
  const managerMode = !isDm && props.managerReady
  const managerRunning = managerMode && ['planning', 'working', 'reviewing'].includes(props.managerProject?.status ?? '')
  const visibleMessages = useMemo(() => managerMode
    ? messages.filter((m) => !m.internal && (m.senderId === 'user' || m.senderId === 'moderator'))
    : messages, [managerMode, messages])
  const teamMessages = useMemo(() => managerMode ? messages.filter((m) =>
    m.internal || (m.senderId !== 'user' && m.senderId !== 'moderator')) : [], [managerMode, messages])
  const teamRef = useRef<HTMLDivElement>(null)
  const teamStick = useRef(true)
  const [teamAtBottom, setTeamAtBottom] = useState(true)
  const [teamTab, setTeamTab] = useState<'stream' | 'tasks'>('stream')
  const [draft, setDraft] = useState(props.savedDraft?.text ?? '')
  const [attachments, setAttachments] = useState<Attachment[]>(props.savedDraft?.attachments ?? [])
  const [dragging, setDragging] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deliveriesOpen, setDeliveriesOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [olderLoading, setOlderLoading] = useState(false)
  const [olderError, setOlderError] = useState('')
  const [composerError, setComposerError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendToWorkspace, setSendToWorkspace] = useState(false)
  const [targetPreview, setTargetPreview] = useState<{ agentId: string; target: WorkTarget }>()
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const olderAnchor = useRef<{ id: string; first: string; offset: number } | null>(null)
  const stickRef = useRef(true)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const onDraftChange = useRef(props.onDraftChange)
  useEffect(() => {
    if (!managerMode || teamTab !== 'stream') return
    if (teamStick.current && teamRef.current) {
      teamRef.current.scrollTop = teamRef.current.scrollHeight
    }
  }, [teamMessages, managerMode, teamTab])

  useEffect(() => {
    if (!managerMode || teamTab !== 'stream' || props.loading) return
    const frame = requestAnimationFrame(() => {
      const el = teamRef.current
      if (el) el.scrollTop = el.scrollHeight
      teamStick.current = true
      setTeamAtBottom(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [room.id, props.loading, teamTab, managerMode])

  const recentActions = useMemo(() => {
    if (!activity?.length) return []
    const running = (workspace?.runs ?? []).filter((run) => run.status === 'running')
    const activeNames = new Set([
      ...running.map((run) => run.agentName),
      ...props.allAgents.filter((agent) => statuses[agent.id]?.state === 'thinking').map((agent) => agent.name)
    ])
    if (managerRunning) activeNames.add('经理')
    const latest = new Map<string, ActivityEntry>()
    const measuring = new Map<string, ActivityEntry>()
    const starts = new Map(running.map((run) => [run.agentName, run.startedAt]))
    const approvals = new Set(running.filter((run) => run.pending).map((run) => run.agentName))
    const eventTime = (entry: ActivityEntry): number => entry.tool?.endedAt ?? entry.ts
    for (const item of activity) {
      if (item.modelRate || !activeNames.has(item.agentName) || item.ts < (starts.get(item.agentName) ?? 0)) continue
      const previous = latest.get(item.agentName)
      if (!previous || eventTime(previous) <= eventTime(item)) latest.set(item.agentName, item)
      if (item.tool && item.tool.endedAt === undefined) measuring.set(item.agentName, item)
    }
    const actions: ActivityEntry[] = []
    for (const [name, entry] of latest) {
      const live = measuring.get(name)
      if (live) {
        const text = approvals.has(name) && live.tool?.name === 'run_command'
          ? '等待你批准命令'
          : !entry.tool && entry.ts >= live.ts ? entry.text : live.text
        actions.push({ ...live, text })
      } else if (name !== '经理') {
        actions.push(entry.tool ? { ...entry, text: '工具已返回，正在整理结果' } : entry)
      }
    }
    return actions.sort((a, b) => b.ts - a.ts)
  }, [activity, workspace?.runs, statuses, props.allAgents, managerRunning])

  useEffect(() => {
    if (managerMode) setSendToWorkspace(false)
  }, [managerMode])

  const taskRecipients = useMemo(() => {
    if (!sendToWorkspace) return []
    const ids = new Set(findMentions(participants, draft.trim()).map(({ agent }) => agent.id))
    return ids.size ? participants.filter((agent) => ids.has(agent.id)) : isDm ? participants.slice(0, 1) : []
  }, [sendToWorkspace, isDm, participants, draft])
  const taskAgent = taskRecipients.length === 1 ? taskRecipients[0] : undefined
  const taskAgentId = taskAgent?.id
  const preview = targetPreview?.agentId === taskAgentId ? targetPreview?.target : undefined

  useEffect(() => {
    if (!taskAgentId) return
    let current = true
    void window.api.getWorkTarget(room.id, taskAgentId).then((target) => {
      if (current) setTargetPreview({ agentId: taskAgentId, target })
    }).catch(() => {
      if (current) setTargetPreview({ agentId: taskAgentId, target: { name: '', directory: '', error: '暂时无法读取工作目录。' } })
    })
    return () => { current = false }
  }, [room.id, taskAgentId, taskAgent?.cli?.cwd, props.workDir])

  useEffect(() => {
    onDraftChange.current({ text: draft, attachments })
  }, [draft, attachments])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [visibleMessages, props.loading])

  useLayoutEffect(() => {
    const anchor = olderAnchor.current
    const scroller = scrollRef.current
    if (!anchor || !scroller || messages[0]?.id === anchor.first) return
    const row = document.getElementById('msg-' + anchor.id)
    if (row) scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset
    olderAnchor.current = null
  }, [messages])

  const loadEarlier = async (): Promise<void> => {
    if (olderLoading) return
    const scroller = scrollRef.current
    const anchor = scroller && Array.from(scroller.children).find((row) => row.id.startsWith('msg-') && row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top)
    if (anchor && scroller && messages[0]) {
      stickRef.current = false
      olderAnchor.current = { id: anchor.id.slice(4), first: messages[0].id, offset: anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top }
    }
    setOlderLoading(true)
    setOlderError('')
    try {
      await props.onLoadEarlier()
    } catch {
      olderAnchor.current = null
      setOlderError('加载较早消息失败，请重试。')
    } finally {
      setOlderLoading(false)
    }
  }

  const exportHistory = async (): Promise<void> => {
    if (exporting) return
    setExporting(true)
    setExportStatus('')
    try {
      if (await window.api.exportMessages(room.id)) setExportStatus('会议记录已导出。')
    } catch {
      setExportStatus('导出失败，请选择可写入的位置后重试。')
    } finally {
      setExporting(false)
    }
  }

  const changeArchive = async (): Promise<void> => {
    if (archiveBusy) return
    setArchiveBusy(true)
    setArchiveError('')
    try {
      await (room.archivedAt ? props.onRestore() : props.onArchive())
      setMoreOpen(false)
    } catch {
      setArchiveError('会话状态未能保存，请重试。')
    } finally { setArchiveBusy(false) }
  }

  // 切回聊天时自动滚到底
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
      stickRef.current = true
      setAtBottom(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [room.id])

  const thinking = Object.entries(statuses).filter(([id, status]) => id !== 'moderator' && status.state === 'thinking')
    .map(([id]) => props.allAgents.find((agent) => agent.id === id)?.name ?? '参会者')

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null || managerMode) return []
    const q = mentionQuery.toLowerCase()
    return participants.filter((a) => a.name.toLowerCase().includes(q))
  }, [mentionQuery, participants, managerMode])

  const updateMention = (value: string, cursor: number): void => {
    const before = value.slice(0, cursor)
    const m = /@([^\s@]*)$/.exec(before)
    setMentionQuery(m ? m[1] : null)
  }

  const insertMention = (name: string): void => {
    const ta = taRef.current
    if (!ta) return
    const cursor = ta.selectionStart ?? draft.length
    const prefix = draft.slice(0, cursor)
    const replacing = /@[^\s@]*$/.test(prefix)
    const before = replacing ? prefix.replace(/@[^\s@]*$/, '@' + name + ' ') :
      prefix + (prefix && !/\s$/.test(prefix) ? ' ' : '') + '@' + name + ' '
    const after = replacing ? draft.slice(cursor).replace(/^[^\s@]*/, '') : draft.slice(cursor)
    const next = before + after
    setDraft(next)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(before.length, before.length)
    })
  }

  const addFiles = async (): Promise<void> => {
    try {
      const paths = await window.api.pickFiles()
      if (paths.length === 0) return
      await readAttachments(paths)
    } catch {
      setComposerError('无法打开附件选择器。')
    }
  }

  const onDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    if (e.dataTransfer?.types?.includes('Files')) setDragging(true)
  }
  const onDragLeave = (e: React.DragEvent): void => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    setDragging(false)
  }
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
    if (paths.length === 0) return
    await readAttachments(paths)
  }

  const readAttachments = async (paths: string[]): Promise<void> => {
    try {
      const atts = await window.api.readFiles(paths)
      setAttachments((cur) => [...cur, ...atts])
      const skipped = paths.length - atts.length
      const unreadable = atts.filter((a) => /\.(?:docx?|pdf)$/i.test(a.name) && !a.text).length
      setComposerError([
        skipped > 0 ? `${skipped} 个附件未能添加。图片上限为 12 MB。` : '',
        unreadable > 0 ? `${unreadable} 个文档未提取到文字，只附上文件名和路径。` : ''
      ].filter(Boolean).join(' '))
    } catch {
      setComposerError('无法读取附件，请重试。')
    }
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (sending || (!text && attachments.length === 0)) return
    setSending(true)
    try {
      await props.onSend(text, attachments, !managerMode && sendToWorkspace)
      setDraft('')
      setAttachments([])
      setComposerError('')
      setMentionQuery(null)
      if (sendToWorkspace) {
        setSendToWorkspace(false)
      }
      stickRef.current = true
    } catch (error) {
      setComposerError(sendToWorkspace && error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
        : '消息发送失败，请重试。')
    } finally {
      setSending(false)
    }
  }

  const anyRunning = thinking.length > 0
  const workRunning = !!workspace?.running
  const assignments = managerRunning ? props.managerProject?.tasks.filter((task) => task.status !== 'closed') : undefined
  const assignment = assignments?.length
    ? { returned: assignments.filter((task) => task.status === 'done').length, total: assignments.length }
    : undefined
  const runningNow = anyRunning || workRunning || managerRunning
  const thinkingLabel = anyRunning ? thinking.join('、') + ' 正在回答' : (workspace?.agentName ?? '成员') + ' 正在处理'
  const rateAgent = workRunning ? workspace?.agentName : thinking[0] ?? (managerRunning ? '经理' : workspace?.agentName)

  return (
    <div className="chat" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragging && <div className="drop-overlay">松开即可添加文件 / 图片</div>}
      <header className="chat-header">
        <div className="chat-heading">
          <button
            className={props.navOpen ? 'ghost-btn nav-toggle is-open' : 'ghost-btn nav-toggle'}
            aria-label={props.navOpen ? '收起会话列表' : '打开会话列表'}
            title={props.navOpen ? '收起会话列表' : '打开会话列表'}
            aria-expanded={props.navOpen ?? false}
            aria-controls="conversation-drawer"
            onClick={props.onOpenNav}
          >
            <span className="rail-icon"><Icon name="panel" />{props.hasUnread && <i className="rail-unread" />}</span>
          </button>
          <h1 title={room.name}>{room.name}</h1>
          <div className="chat-actions">
            <button className="ghost-btn pane-deliveries header-deliveries" aria-label="交付记录" title="查看文件与来源" onClick={() => setDeliveriesOpen(true)}><Icon name="files" /><span className="wide-label">交付记录</span><span className="short-label" aria-hidden="true">交付</span></button>
            {isDm && participants[0] && participants[0].kind !== 'demo' && (
              <div className="access-quick">
                <span className="dim small" aria-hidden="true">工作权限</span>
                <AccessSelect agent={participants[0]} onChange={(access) => props.onSetAccess(participants[0].id, access)} />
              </div>
            )}
            {!isDm && <button className="ghost-btn members-button" aria-label={`成员 ${participants.length}`} aria-expanded={membersOpen} title="管理参会者和工作权限" onClick={() => { setMoreOpen(false); setMembersOpen((v) => !v) }}><Icon name="users" /><span className="button-label">成员</span><span className="member-count">{participants.length}</span></button>}
            <div className="more-wrap" onKeyDown={(e) => { if (e.key === 'Escape') setMoreOpen(false) }}>
              <button className="icon-btn more-btn" title="更多操作" aria-label="更多操作" aria-expanded={moreOpen} onClick={() => { setMembersOpen(false); setMoreOpen((v) => !v) }}><Icon name="more" /></button>
              {moreOpen && (
                <div className="more-menu" aria-label="更多操作">
                  {!isDm && !managerMode && <button onClick={() => { setMoreOpen(false); props.onManagerSettings() }}>配置主持人</button>}
                  <button onClick={() => { setMoreOpen(false); setHistoryOpen(true) }}>搜索记录</button>
                  {!!activity?.length && <button onClick={() => { setMoreOpen(false); setActivityOpen(true) }}>活动记录</button>}
                  <button disabled={exporting} onClick={() => { setMoreOpen(false); void exportHistory() }}>导出 Markdown</button>
                  {!isDm && <button onClick={() => { setMoreOpen(false); props.onEditRoom() }}>群聊设置</button>}
                  <button disabled={archiveBusy} title={room.archivedAt ? '恢复到会话列表' : '收起会话并保留记录，正在执行的任务会继续'} onClick={() => void changeArchive()}>{room.archivedAt ? '恢复会话' : '归档会话'}</button>
                  <button onClick={() => { setMoreOpen(false); setHelpOpen(true) }}>使用帮助</button>
                  <button className="delete-conversation" disabled={archiveBusy} onClick={() => { setMoreOpen(false); props.onDelete() }}>删除会话</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {!isDm && !managerMode && (
          <div className="chat-navigation">
            <div className="chips" aria-label="当前参会者">
            {participants.map((a) => {
              const st = statuses[a.id]?.state ?? 'idle'
              return (
                <button
                  key={a.id}
                  className={`chip st-${st}`}
                  title={managerMode ? a.name : `@${a.name}${statuses[a.id]?.detail ? ' · ' + statuses[a.id].detail : ''}`}
                  disabled={managerMode}
                  onClick={() => insertMention(a.name)}
                >
                  <i style={{ background: colors.get(a.id) || a.color }} />
                  {a.name}
                </button>
              )
            })}
            </div>
          </div>
        )}
      </header>
      {room.archivedAt && <div className="archive-banner" role="status">
        <span>已归档 · 发送新消息可恢复到列表</span>
        <button className="ghost-btn" disabled={archiveBusy} onClick={() => void changeArchive()}>恢复会话</button>
      </div>}
      {archiveError && <div className="archive-error" role="alert">{archiveError}</div>}
      {exportStatus && <div className="history-notice" role="status">{exportStatus}<button className="icon-btn" aria-label="关闭导出提示" onClick={() => setExportStatus('')}>×</button></div>}

      {membersOpen && (
        <Members
          agents={props.allAgents}
          participantIds={room.participantIds}
          onToggle={props.onToggleMember}
          onAccess={props.onSetAccess}
          onClose={() => setMembersOpen(false)}
        />
      )}

      {(runningNow || activityOpen) && <ActivityStrip
        key={room.id}
        label={runningNow ? managerMode ? '处理中' : thinkingLabel : '最近活动'}
        note={managerMode ? props.managerProject?.note : undefined}
        current={recentActions}
        history={activity}
        rateAgent={rateAgent}
        assignment={assignment}
        open={activityOpen}
        onOpenChange={setActivityOpen}
        onStop={runningNow ? (workRunning && !managerMode && !anyRunning ? props.onStopWorkspace : props.onStop) : undefined}
      />}

      {isDm && agentWork && (agentWork.active?.roomId !== room.id || agentWork.queued > 0) && (
        <div className="agent-work-banner" title="这个 bot 在别的聊天里还有工作；点「查看」跳过去">
          {agentWork.active && agentWork.active.roomId !== room.id && (
            <span title={agentWork.active.task}>正在「{agentWork.active.roomName}」执行任务</span>
          )}
          {agentWork.queued > 0 && <span className="dim">{agentWork.queued} 个任务排队</span>}
          {agentWork.active && agentWork.active.roomId !== room.id && (
            <button className="ghost-btn" onClick={() => props.onOpenRoom(agentWork.active!.roomId)}>查看</button>
          )}
        </div>
      )}
      <div className={managerMode ? 'chat-panes' : 'chat-panes single'}>
      <section className="user-pane" aria-label={managerMode ? '我和经理' : '聊天'}>
      {!managerMode && props.managerProject && !isDm && <ManagerPanel project={props.managerProject} ready={props.managerReady} onSettings={props.onManagerSettings} onStop={props.onStop} />}
      {!managerMode && <RunCard ws={workspace} onStop={props.onStopWorkspace} onStopRun={props.onStopRun} onApprove={props.onApproveCommand} />}
      <div
        className="messages"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
          stickRef.current = bottom
          setAtBottom(bottom)
        }}
      >
        {props.loadError ? (
          <div className="chat-empty"><p role="alert">{props.loadError}</p><button className="ghost-btn" onClick={props.onRetry}>重试</button></div>
        ) : props.loading ? (
          <div className="chat-empty" role="status">加载消息…</div>
        ) : visibleMessages.length === 0 && !props.hasEarlier ? (
          <div className="chat-empty room-welcome">
            <span className="welcome-mark brand-mark" aria-hidden="true" />
            <p className="empty-title">{managerMode ? '和经理说说你要做什么' : '开始讨论'}</p>
            <p>{managerMode ? '直接提问或交代任务，经理会按需找成员讨论或执行。' : isDm ? `给 ${room.name} 发消息，它会单独回复你；需要它动手就点「派活」。` : participants.length ? '直接提问，或输入 @ 指定一位成员。' : '在「成员」里添加参会者，然后发个问题。'}</p>
          </div>
        ) : <>
          {props.hasEarlier && <div className="history-earlier">
            <button className="ghost-btn" disabled={olderLoading} onClick={() => void loadEarlier()}>{olderLoading ? '加载中…' : '加载更早的消息'}</button>
            {olderError && <p className="composer-error" role="alert">{olderError}</p>}
          </div>}
          <MessageList messages={visibleMessages} pending={pending} colors={colors} />
        </>}
      </div>

      <div className="composer-wrap">
        {!atBottom && (
          <button
            className="to-bottom"
            onClick={() => {
              const el = scrollRef.current
              if (el) el.scrollTop = el.scrollHeight
              stickRef.current = true
              setAtBottom(true)
            }}
          >
            ⤓ 回到底部
          </button>
        )}

        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className="mention-pop">
            {mentionCandidates.map((a) => (
              <div key={a.id} className="mention-item" onMouseDown={(e) => { e.preventDefault(); insertMention(a.name) }}>
                <i style={{ background: colors.get(a.id) || a.color }} /> {a.name}
              </div>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="att-preview">
            {attachments.map((a, i) =>
              a.kind === 'image' && a.dataUrl ? (
                <span key={a.path + i} className="att-item">
                  <img src={a.dataUrl} className="att-thumb" alt={a.name} />
                  <button className="att-x" onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}>×</button>
                </span>
              ) : (
                <span key={a.path + i} className="att-item att-file">
                  {a.name}
                  <button className="att-x" onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}>×</button>
                </span>
              )
            )}
          </div>
        )}
        {composerError && <p className="composer-error" role="alert">{composerError}</p>}
        <div className="composer">
          {!managerMode && sendToWorkspace && <div className="dispatch-preview">
            {taskAgent ? <>
              <span><b>执行者</b> {taskAgent.name}</span>
              <span><b>目录</b> {preview?.directory || (preview?.error ? '未就绪' : '正在确认…')}</span>
              {preview?.error && <span className="dispatch-error">{preview.error}</span>}
            </> : <span>{taskRecipients.length > 1 ? '一次只派给一位参会者。' : '用 @ 选择一位参会者。'}</span>}
          </div>}
          <textarea
            ref={taRef}
            value={draft}
            aria-label="消息"
            title="Enter 发送，Shift+Enter 换行"
            placeholder={managerMode ? '告诉经理你想要什么成果…' : isDm
              ? sendToWorkspace ? `给 ${room.name} 派活：写清要它做的事…` : `给 ${room.name} 发消息…`
              : sendToWorkspace ? '输入 @ 点名一位参会者，再写任务…' : '写消息，输入 @ 点名…'}
            readOnly={sending}
            onChange={(e) => {
              setDraft(e.target.value)
              updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Escape') setMentionQuery(null)
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (mentionQuery !== null && mentionCandidates.length > 0) insertMention(mentionCandidates[0].name)
                else void send()
              }
            }}
            rows={2}
          />
          <div className="composer-actions">
            <button className="ghost-btn att-btn" onClick={() => void addFiles()} disabled={sending}><Icon name="attach" />附件</button>
            {!managerMode && <button
              className="ghost-btn work-toggle"
              aria-pressed={sendToWorkspace}
              title="把这条消息作为任务派给参会者"
              disabled={sending}
              onClick={() => {
                setSendToWorkspace((enabled) => !enabled)
                setComposerError('')
              }}
            ><Icon name="task" />派活</button>}
            <button className="primary-btn" onClick={() => void send()} disabled={sending || (!draft.trim() && attachments.length === 0)}>
              {managerMode ? '发给经理' : sendToWorkspace ? '派发' : '发送'}
              <Icon name="send" />
            </button>
          </div>
        </div>
      </div>

      </section>
      {managerMode && (() => {
        const tasks = props.managerProject?.tasks ?? []
        const activeCount = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length
        const issueCount = tasks.filter((t) => t.status === 'error' || t.status === 'interrupted').length
        const blocked = props.managerProject?.status === 'blocked'
        return <section className="team-pane" aria-label="经理和成员">
          <div className="pane-head team-head">
            <div className="team-tabs" role="tablist" aria-label="团队视图">
              <button
                role="tab"
                aria-selected={teamTab === 'stream'}
                className={teamTab === 'stream' ? 'team-tab active' : 'team-tab'}
                onClick={() => setTeamTab('stream')}
              >
                协作动态{teamMessages.length > 0 && <span className="tab-count">{teamMessages.length}</span>}
              </button>
              <button
                role="tab"
                aria-selected={teamTab === 'tasks'}
                className={teamTab === 'tasks' ? 'team-tab active' : 'team-tab'}
                onClick={() => setTeamTab('tasks')}
              >
                任务进度
                {activeCount > 0 && <span className="tab-count live">{activeCount}</span>}
                {issueCount > 0 && <span className="tab-count warn">{issueCount}</span>}
                {activeCount === 0 && issueCount === 0 && tasks.length > 0 && <span className="tab-count">{tasks.length}</span>}
              </button>
            </div>
          </div>
          <div className="team-pinned">
            <RunCard ws={workspace} approvalsOnly onStop={props.onStopWorkspace} onStopRun={props.onStopRun} onApprove={props.onApproveCommand} />
            {teamTab === 'stream' && (blocked || !props.managerReady) && (
              <button className="team-alert-bar" onClick={() => setTeamTab('tasks')}>
                <span>{!props.managerReady ? '未启用主持人模型，点击查看' : (props.managerProject?.note || '经理需要你的处理')}</span>
                <span className="team-alert-link">查看任务</span>
              </button>
            )}
          </div>
          {teamTab === 'tasks' ? (
            <div className="team-tasks-scroll">
              <ManagerPanel compact project={props.managerProject} ready={props.managerReady} onSettings={props.onManagerSettings} onStop={props.onStop} />
              {!props.managerProject?.tasks.length && props.managerReady && !['planning', 'working', 'reviewing', 'blocked', 'stopped'].includes(props.managerProject?.status ?? '') && (
                <p className="team-empty dim">经理拆分并派出子任务后，进度和验收细节会显示在这里。</p>
              )}
            </div>
          ) : (
            <div className="team-messages-wrap">
              <div className="team-messages" ref={teamRef} onScroll={(e) => {
                const element = e.currentTarget
                const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 90
                teamStick.current = bottom
                setTeamAtBottom(bottom)
              }}>
                {props.hasEarlier && <div className="history-earlier">
                  <button className="ghost-btn" disabled={olderLoading} onClick={() => void loadEarlier()}>加载更早的记录</button>
                </div>}
                {!teamMessages.length && <p className="team-empty dim">成员的分工和回报会出现在这里。</p>}
                <MessageList messages={teamMessages} pending={pending} colors={colors} />
              </div>
              {!teamAtBottom && (
                <button
                  className="to-bottom team-to-bottom"
                  aria-label="协作动态回到底部"
                  onClick={() => {
                    const el = teamRef.current
                    if (el) el.scrollTop = el.scrollHeight
                    teamStick.current = true
                    setTeamAtBottom(true)
                  }}
                >
                  ⤓ 回到底部
                </button>
              )}
            </div>
          )}
        </section>
      })()}
      </div>
      <Suspense fallback={null}>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {historyOpen && <HistoryModal room={room} onClose={() => setHistoryOpen(false)} />}
      {deliveriesOpen && <DeliveryModal roomId={room.id} onClose={() => setDeliveriesOpen(false)} />}
      </Suspense>
    </div>
  )
}
