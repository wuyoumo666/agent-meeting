import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isPureChatRoom, moderatorReady } from '../../shared/types'
import type { ActivityEntry, AgentWorkInfo, AppEvent, AppState, ManagerProject, Message, Room, WorkspaceState } from '../../shared/types'
import { personaDisplayLabel } from '../../shared/personas'
import Chat, { type RoomDraft } from './components/Chat'
import ConfirmDialog, { type Confirmation } from './components/ConfirmDialog'
import { agentColors } from './identity'
import Icon from './components/Icon'
import SplashScreen from './components/SplashScreen'

const Settings = lazy(() => import('./components/Settings'))
const RoomModal = lazy(() => import('./components/RoomModal'))

export interface AgentStatus {
  state: 'thinking' | 'idle' | 'error'
  detail?: string
}

type ChatEvent = Extract<AppEvent, { type: 'message' | 'stream' | 'done' }> & { revision?: number }
interface Discussion {
  roomId: string
  messages: Message[]
  pending: Set<string>
  revision: number
  before: string | null
}

const EMPTY_MESSAGES: Message[] = []
const EMPTY_PENDING = new Set<string>()
const EMPTY_STATUSES: Record<string, AgentStatus> = {}

function mergeEvents(discussion: Discussion, events: ChatEvent[]): Discussion {
  const changes = events.filter((ev) => (ev.revision ?? Infinity) > discussion.revision)
  if (changes.length === 0) return discussion
  const messages = [...discussion.messages]
  const pending = new Set(discussion.pending)
  const positions = new Map(messages.map((m, index) => [m.id, index]))
  for (const ev of changes) {
    if (ev.type === 'message') {
      const m = ev.message
      if (positions.has(m.id)) continue
      positions.set(m.id, messages.length)
      messages.push(m)
      if (m.kind === 'chat' && m.senderId !== 'user' && !m.text) pending.add(m.id)
      continue
    }
    const index = positions.get(ev.messageId)
    if (index === undefined) continue
    const m = messages[index]
    if (ev.type === 'stream') {
      messages[index] = { ...m, text: m.text + ev.delta }
    } else {
      messages[index] = { ...m, text: ev.text, senderName: ev.senderName ?? m.senderName }
      pending.delete(m.id)
    }
  }
  return { ...discussion, messages, pending, revision: changes.at(-1)?.revision ?? discussion.revision }
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [roomId, setRoomId] = useState('')
  const [discussion, setDiscussion] = useState<Discussion | null>(null)
  const [loadError, setLoadError] = useState('')
  const [statuses, setStatuses] = useState<Record<string, Record<string, AgentStatus>>>({})
  const [wsByRoom, setWsByRoom] = useState<Record<string, WorkspaceState>>({})
  const [managerByRoom, setManagerByRoom] = useState<Record<string, ManagerProject | null>>({})
  const [agentWork, setAgentWork] = useState<AgentWorkInfo | null>(null)
  const [activityByRoom, setActivityByRoom] = useState<Record<string, ActivityEntry[]>>({})
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [managerSettings, setManagerSettings] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches)
  const [archivesOpen, setArchivesOpen] = useState(false)
  const [archivePending, setArchivePending] = useState('')
  const [archiveError, setArchiveError] = useState('')
  const [dmError, setDmError] = useState('')
  const [sideArea, setSideArea] = useState<'office' | 'chat'>('office')
  const [roomModal, setRoomModal] = useState<{ room: Room | null; defaultKind?: 'group' | 'chat-group' } | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const discussionListener = useRef<((event: ChatEvent) => void) | null>(null)
  const roomIdRef = useRef('')
  const workspaceVersions = useRef(new Map<string, number>())
  const drafts = useRef(new Map<string, RoomDraft>())
  const archiveList = useRef<HTMLElement>(null)
  const drawer = useRef<HTMLDialogElement>(null)
  const drawerOpener = useRef<HTMLElement | null>(null)
  const openNav = useCallback((): void => {
    drawerOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setNavOpen(true)
  }, [])
  const toggleSidebar = useCallback((): void => {
    if (isNarrow) openNav()
    else setSidebarOpen((open) => !open)
  }, [isNarrow, openNav])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const sync = (): void => {
      setIsNarrow(mq.matches)
      if (!mq.matches) setNavOpen(false)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const element = drawer.current
    if (!element) return
    if (isNarrow && navOpen && !element.open) element.showModal()
    if ((!isNarrow || !navOpen) && element.open) element.close()
  }, [isNarrow, navOpen, Boolean(state)])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const s = await window.api.getState()
      setState(s)
      for (const id of drafts.current.keys()) {
        if (!s.rooms.some((r) => r.id === id)) drafts.current.delete(id)
      }
      setRoomId((cur) => s.rooms.some((r) => r.id === cur) ? cur : (s.rooms.find((r) => !r.archivedAt)?.id ?? ''))
      setLoadError('')
    } catch {
      setLoadError('无法加载会议室，请重试。')
    }
  }, [])

  useEffect(() => {
    return window.api.onEvent((ev) => {
      if (ev.type === 'message') {
        const unseen = !ev.message.internal && ev.message.senderId !== 'user' && (ev.message.roomId !== roomIdRef.current || document.hidden || !document.hasFocus())
        if (unseen) {
          setUnreadByRoom((u) => ({ ...u, [ev.message.roomId]: (u[ev.message.roomId] ?? 0) + 1 }))
        }
        discussionListener.current?.(ev)
        return
      }
      if (ev.type === 'state') {
        void refresh()
      } else if (ev.type === 'status') {
        setStatuses((s) => {
          const previous = s[ev.roomId]?.[ev.agentId]
          if (previous?.state === ev.state && previous.detail === ev.detail) return s
          return { ...s, [ev.roomId]: { ...s[ev.roomId], [ev.agentId]: { state: ev.state, detail: ev.detail } } }
        })
      } else if (ev.type === 'manager') {
        setManagerByRoom((projects) => ({ ...projects, [ev.roomId]: ev.project }))
      } else if (ev.type === 'activity') {
        const { roomId, agentName, text, ts, tool, modelRate } = ev
        setActivityByRoom((rooms) => {
          const entries = [...(rooms[roomId] ?? [])]
          const index = tool ? entries.findIndex((entry) => entry.tool?.id === tool.id) : -1
          const entry = { agentName, text, ts, tool, modelRate }
          if (index >= 0) entries[index] = entry
          else entries.push(entry)
          return { ...rooms, [roomId]: entries.slice(-200) }
        })
      } else if (ev.type === 'ws-status' || ev.type === 'ws-log') {
        const versions = workspaceVersions.current
        versions.set(ev.roomId, (versions.get(ev.roomId) ?? 0) + 1)
        setWsByRoom((w) => {
          const prev: WorkspaceState = w[ev.roomId] ?? { running: false, status: 'idle', log: [] }
          if (ev.type === 'ws-log') {
            const runs = prev.runs?.map((r) => r.id === ev.runId
              ? { ...r, log: [...r.log, ev.entry].slice(-600) }
              : r)
            return { ...w, [ev.roomId]: { ...prev, runs } }
          }
          const { type: _type, roomId: id, revision: _revision, ...status } = ev
          return { ...w, [id]: { ...status, running: ev.status === 'running', log: prev.log, runs: status.runs ?? prev.runs } }
        })
      } else {
        discussionListener.current?.(ev)
      }
    })
  }, [refresh])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    roomIdRef.current = roomId
    if (!roomId) return
    setUnreadByRoom((u) => {
      if (!u[roomId]) return u
      const next = { ...u }
      delete next[roomId]
      return next
    })
  }, [roomId])

  useEffect(() => {
    const onFocus = (): void => {
      const id = roomIdRef.current
      if (!id) return
      setUnreadByRoom((u) => {
        if (!u[id]) return u
        const next = { ...u }
        delete next[id]
        return next
      })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const loadEarlier = async (): Promise<void> => {
    const before = discussion?.roomId === roomId ? discussion.before : null
    if (!before) return
    const page = await window.api.getMessages(roomId, before)
    setDiscussion((current) => {
      if (current?.roomId !== roomId || current.before !== before) return current
      return { ...current, messages: [...page.messages, ...current.messages], before: page.before }
    })
  }
  useEffect(() => {
    if (!roomId) return
    setHistoryError('')
    let active = true
    let ready = false
    let frame = 0
    let queue: ChatEvent[] = []
    discussionListener.current = (ev) => {
      if ((ev.type === 'message' ? ev.message.roomId : ev.roomId) !== roomId) return
      queue.push(ev)
      if (ready && !frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          const events = queue
          queue = []
          setDiscussion((current) => current?.roomId === roomId ? mergeEvents(current, events) : current)
        })
      }
    }
    void window.api.getMessages(roomId).then((snapshot) => {
      if (!active) return
      const loaded = mergeEvents({ ...snapshot, roomId, pending: new Set(snapshot.pending) }, queue)
      queue = []
      ready = true
      setDiscussion(loaded)
    }).catch(() => { if (active) setHistoryError('无法读取本房间的消息。') })
    const version = workspaceVersions.current.get(roomId)
    void window.api.getManager(roomId).then((project) => {
      if (active) setManagerByRoom((projects) => {
        const current = projects[roomId]
        if (current && (!project || current.updatedAt >= project.updatedAt)) return projects
        return { ...projects, [roomId]: project }
      })
    }).catch(() => {})
    void window.api.getWorkspace(roomId).then((ws) => {
      if (active && version === workspaceVersions.current.get(roomId)) {
        setWsByRoom((w) => ({ ...w, [roomId]: ws }))
      }
    }).catch(() => {})
    return () => {
      active = false
      discussionListener.current = null
      if (frame) cancelAnimationFrame(frame)
    }
  }, [roomId, historyAttempt])

  const room = state?.rooms.find((r) => r.id === roomId) ?? null
  const colors = useMemo(() => agentColors(state?.agents ?? []), [state?.agents])
  const participants = useMemo(() => room && state
    ? room.participantIds.map((id) => state.agents.find((a) => a.id === id)).filter((a) => a != null)
    : [], [room, state])
  const groups = useMemo(() => (state?.rooms.filter((r) => (!r.kind || r.kind === 'group') && !r.archivedAt) ?? [])
    .sort((a, b) => Number(Boolean(unreadByRoom[b.id])) - Number(Boolean(unreadByRoom[a.id]))), [state, unreadByRoom])
  const dmRooms = useMemo(() => state?.rooms.filter((r) => r.kind === 'dm') ?? [], [state])
  const dmAgents = useMemo(() => (state?.agents.filter((a) => a.kind !== 'demo') ?? [])
    .sort((a, b) => {
      const ar = dmRooms.find((r) => r.participantIds.includes(a.id))
      const br = dmRooms.find((r) => r.participantIds.includes(b.id))
      return Number(Boolean(br && unreadByRoom[br.id])) - Number(Boolean(ar && unreadByRoom[ar.id]))
    }), [state, dmRooms, unreadByRoom])
  const chatGroups = useMemo(() => (state?.rooms.filter((r) => r.kind === 'chat-group' && !r.archivedAt) ?? [])
    .sort((a, b) => Number(Boolean(unreadByRoom[b.id])) - Number(Boolean(unreadByRoom[a.id]))), [state, unreadByRoom])
  const chatDmRooms = useMemo(() => state?.rooms.filter((r) => r.kind === 'chat-dm') ?? [], [state])
  const chatDmAgents = useMemo(() => (state?.agents.filter((a) => a.kind !== 'demo') ?? [])
    .sort((a, b) => {
      const ar = chatDmRooms.find((r) => r.participantIds.includes(a.id))
      const br = chatDmRooms.find((r) => r.participantIds.includes(b.id))
      return Number(Boolean(br && unreadByRoom[br.id])) - Number(Boolean(ar && unreadByRoom[ar.id]))
    }), [state, chatDmRooms, unreadByRoom])
  const officeUnread = useMemo(() => (state?.rooms ?? []).some((r) => !isPureChatRoom(r) && Boolean(unreadByRoom[r.id])), [state, unreadByRoom])
  const chatUnread = useMemo(() => (state?.rooms ?? []).some((r) => isPureChatRoom(r) && Boolean(unreadByRoom[r.id])), [state, unreadByRoom])
  const archivedRooms = useMemo(() => (state?.rooms.filter((r) => r.archivedAt) ?? [])
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)), [state])
  useEffect(() => {
    if (archivesOpen) archiveList.current?.scrollIntoView({ block: 'nearest' })
  }, [archivesOpen, archivedRooms.length, navOpen])

  useEffect(() => {
    if (!room || room.kind !== 'dm') {
      setAgentWork(null)
      return
    }
    const agentId = room.participantIds[0]
    if (!agentId) {
      setAgentWork(null)
      return
    }
    let live = true
    const load = (): void => {
      void window.api.getAgentWork(agentId)
        .then((work) => { if (live) setAgentWork(work) })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, 3000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [room?.id, room?.kind, room?.participantIds[0], wsByRoom])

  if (!state) {
    return (
      <>
        <SplashScreen key="splash" ready={false} error={loadError} onRetry={() => void refresh()} />
        <div className="boot">{loadError}</div>
      </>
    )
  }

  const chooseRoom = (id: string): void => {
    const target = state.rooms.find((r) => r.id === id)
    if (target) setSideArea(isPureChatRoom(target) ? 'chat' : 'office')
    setRoomId(id)
    setNavOpen(false)
  }

  const openDm = async (agentId: string, existing?: Room, kind: 'dm' | 'chat-dm' = 'dm'): Promise<void> => {
    setDmError('')
    setSideArea(kind === 'chat-dm' ? 'chat' : 'office')
    if (existing && !existing.archivedAt) {
      chooseRoom(existing.id)
      return
    }
    try {
      const id = await window.api.ensureDm(agentId, kind)
      if (!id) throw new Error('找不到成员')
      setRoomId(id)
      setNavOpen(false)
    } catch {
      setDmError('暂时无法打开这段私聊，请重试。')
    }
  }

  const confirmDeleteRoom = (r: Room): void => {
    setConfirmation({
      message: `删除「${r.name}」的聊天记录和会话任务？此操作无法撤销。成员和已保存到本地的文件会保留。`,
      label: '删除会话',
      action: () => window.api.deleteRoom(r.id)
    })
  }

  const changeArchive = async (id: string, archived: boolean, open = false): Promise<void> => {
    setArchivePending(id)
    setArchiveError('')
    try {
      await window.api.setRoomArchived(id, archived)
      if (archived) {
        setArchivesOpen(true)
        setRoomId((current) => current === id ? state.rooms.find((r) => r.id !== id && !r.archivedAt)?.id ?? '' : current)
      } else if (open) chooseRoom(id)
    } finally { setArchivePending('') }
  }
  const restoreFromList = async (id: string): Promise<void> => {
    try { await changeArchive(id, false, true) }
    catch { setArchiveError('恢复失败，请重试。') }
  }
  const withRestoredRoom = async (action: () => void | Promise<void>): Promise<void> => {
    if (!room) return
    if (room.archivedAt) await window.api.setRoomArchived(room.id, false)
    await action()
  }

  const renderSidebarInner = (inDrawer: boolean): React.JSX.Element => (
    <>
      <div className="brand drawer-brand">
        <span className="brand-mark" aria-hidden="true" />
        <h2 id={inDrawer ? 'drawer-title' : undefined}>我的智囊团</h2>
        <button
          className="icon-btn drawer-close"
          aria-label={inDrawer ? '关闭会话列表' : '收起侧边栏'}
          title={inDrawer ? '收起会话列表' : '收起侧边栏'}
          onClick={() => inDrawer ? setNavOpen(false) : setSidebarOpen(false)}
        >
          <Icon name={inDrawer ? 'close' : 'panel'} />
        </button>
      </div>
      <div className="side-area-tabs" role="tablist" aria-label="区域切换">
        <button
          role="tab"
          aria-selected={sideArea === 'office'}
          className={sideArea === 'office' ? 'side-area-tab active' : 'side-area-tab'}
          onClick={() => setSideArea('office')}
        >
          办公区
          {sideArea !== 'office' && officeUnread && <span className="unread-dot" title="办公区有新消息" />}
        </button>
        <button
          role="tab"
          aria-selected={sideArea === 'chat'}
          className={sideArea === 'chat' ? 'side-area-tab active' : 'side-area-tab'}
          onClick={() => setSideArea('chat')}
        >
          纯聊天
          {sideArea !== 'chat' && chatUnread && <span className="unread-dot" title="纯聊天有新消息" />}
        </button>
      </div>
      <button
        className="ghost-btn drawer-new"
        aria-label={sideArea === 'chat' ? '新建聊天群' : '新建群聊'}
        onClick={() => {
          if (inDrawer) setNavOpen(false)
          setRoomModal({ room: null, defaultKind: sideArea === 'chat' ? 'chat-group' : 'group' })
        }}
      >
        <Icon name="plus" />{sideArea === 'chat' ? '新建聊天群' : '新建群聊'}
      </button>
      <div className="side-conversations">
        {sideArea === 'office' ? (
          <>
            <div className="side-section">
              <span>群聊</span><span className="side-count">{groups.length}</span>
            </div>
            <nav className="room-list" aria-label="群聊">
              {groups.map((r) => (
                <div key={r.id} className={r.id === roomId ? 'room-item active' : 'room-item'}>
                  <button className="room-select" aria-current={r.id === roomId ? 'page' : undefined} title={r.name} onClick={() => chooseRoom(r.id)}>
                    <Icon name="chat" className="room-icon" /><span className="room-name">{r.name}</span>
                    {!!unreadByRoom[r.id] && <span className="unread-dot" title={`${unreadByRoom[r.id]} 条新消息`} />}
                  </button>
                  <button className="room-del icon-btn" aria-label={`删除会议室 ${r.name}`} title="删除会议室" onClick={() => confirmDeleteRoom(r)}>×</button>
                </div>
              ))}
              {groups.length === 0 && <p className="side-hint dim">{archivedRooms.some((r) => !isPureChatRoom(r) && r.kind !== 'dm') ? '群聊已收进归档' : '还没有群聊，点上方新建'}</p>}
            </nav>
            <div className="side-section">
              <span>私聊</span><span className="side-count">{dmAgents.length}</span>
            </div>
            <nav className="room-list" aria-label="私聊">
              {dmAgents.map((a) => {
                const dm = dmRooms.find((r) => r.participantIds.includes(a.id))
                return (
                  <div key={a.id} className={dm?.id === roomId ? 'room-item active' : 'room-item'}>
                    <button
                      className="room-select"
                      title={`和 ${a.name} 办公私聊`}
                      aria-current={dm?.id === roomId ? 'page' : undefined}
                      onClick={() => void openDm(a.id, dm, 'dm')}
                    >
                      <span className="avatar sm" style={{ '--identity': colors.get(a.id) } as React.CSSProperties} aria-hidden="true">{a.name.slice(0, 1)}</span>
                      <span className="room-name">{a.name}</span>
                      {dm && !!unreadByRoom[dm.id] && <span className="unread-dot" title={`${unreadByRoom[dm.id]} 条新消息`} />}
                      {dm?.archivedAt
                        ? <span className="dim small" title="点击恢复并继续原私聊">已归档</span>
                        : a.access === 'readonly' && <span className="dim small">只读</span>}
                    </button>
                  </div>
                )
              })}
              {dmAgents.length === 0 && <p className="side-hint dim">还没有参会者</p>}
            </nav>
          </>
        ) : (
          <>
            <div className="side-section">
              <span>聊天群 · 同台</span><span className="side-count">{chatGroups.length}</span>
            </div>
            <nav className="room-list" aria-label="纯聊天群">
              {chatGroups.map((r) => (
                <div key={r.id} className={r.id === roomId ? 'room-item active' : 'room-item'}>
                  <button className="room-select" aria-current={r.id === roomId ? 'page' : undefined} title={r.name} onClick={() => chooseRoom(r.id)}>
                    <Icon name="chat" className="room-icon" /><span className="room-name">{r.name}</span>
                    {!!unreadByRoom[r.id] && <span className="unread-dot" title={`${unreadByRoom[r.id]} 条新消息`} />}
                  </button>
                  <button className="room-del icon-btn" aria-label={`删除聊天群 ${r.name}`} title="删除聊天群" onClick={() => confirmDeleteRoom(r)}>×</button>
                </div>
              ))}
              {chatGroups.length === 0 && <p className="side-hint dim">点上方「新建聊天群」，可一键拉起《AI情公寓客厅》</p>}
            </nav>
            <div className="side-section">
              <span>各个 AI · 单聊</span><span className="side-count">{chatDmAgents.length}</span>
            </div>
            <nav className="room-list" aria-label="纯聊天单聊">
              {chatDmAgents.map((a) => {
                const dm = chatDmRooms.find((r) => r.participantIds.includes(a.id))
                const personaBadge = personaDisplayLabel(a)
                return (
                  <div key={a.id} className={dm?.id === roomId ? 'room-item active' : 'room-item'}>
                    <button
                      className="room-select"
                      title={`和 ${a.name} 纯聊天`}
                      aria-current={dm?.id === roomId ? 'page' : undefined}
                      onClick={() => void openDm(a.id, dm, 'chat-dm')}
                    >
                      <span className="avatar sm" style={{ '--identity': colors.get(a.id) } as React.CSSProperties} aria-hidden="true">{a.name.slice(0, 1)}</span>
                      <span className="room-name">{a.name}</span>
                      {personaBadge && <span className="persona-chip-badge">{personaBadge}</span>}
                      {dm && !!unreadByRoom[dm.id] && <span className="unread-dot" title={`${unreadByRoom[dm.id]} 条新消息`} />}
                      {dm?.archivedAt && <span className="dim small" title="点击恢复并继续">已归档</span>}
                    </button>
                  </div>
                )
              })}
              {chatDmAgents.length === 0 && <p className="side-hint dim">还没有成员，先去设置里添加</p>}
            </nav>
          </>
        )}
        {dmError && <p className="archive-error" role="alert">{dmError}</p>}
        {archivesOpen && <section ref={archiveList} className="archived-conversations" id="archived-conversations" aria-label="已归档会话">
          <div className="side-section"><span>已归档</span></div>
          <nav className="room-list" aria-label="归档列表">
            {archivedRooms.map((r) => <div key={r.id} className={r.id === roomId ? 'room-item active' : 'room-item'}>
              <button className="room-select" title={r.name} aria-current={r.id === roomId ? 'page' : undefined} onClick={() => chooseRoom(r.id)}>
                <Icon name="archive" className="room-icon" />
                <span className="archived-name"><span className="room-name">{r.name}</span><small>{r.kind === 'dm' ? '办公私聊' : r.kind === 'chat-dm' ? '纯聊单聊' : r.kind === 'chat-group' ? '纯聊群' : '办公群'}</small></span>
                {!!unreadByRoom[r.id] && <span className="unread-dot" title={`${unreadByRoom[r.id]} 条新消息`} />}
              </button>
              <button className="archive-restore" aria-label={`恢复会话 ${r.name}`} disabled={Boolean(archivePending)} onClick={() => void restoreFromList(r.id)}>{archivePending === r.id ? '恢复中' : '恢复'}</button>
              <button className="archive-delete" aria-label={`删除会话 ${r.name}`} disabled={Boolean(archivePending)} onClick={() => confirmDeleteRoom(r)}>删除</button>
            </div>)}
            {!archivedRooms.length && <p className="side-hint dim">还没有归档的会话</p>}
          </nav>
        </section>}
        {archiveError && <p className="archive-error" role="alert">{archiveError}</p>}
      </div>
      <div className="side-footer">
        <button className="ghost-btn archive-entry" aria-label="已归档会话" aria-expanded={archivesOpen} aria-controls="archived-conversations" onClick={() => setArchivesOpen((open) => !open)}>
          <Icon name="archive" />已归档 <span className="archive-count">{archivedRooms.length}</span>
        </button>
        <button className="ghost-btn" onClick={() => { if (inDrawer) setNavOpen(false); setSettingsOpen(true) }}><Icon name="settings" />设置</button>
      </div>
    </>
  )

  return (
    <>
      <SplashScreen key="splash" ready />
      <div className={!isNarrow && sidebarOpen ? 'app with-sidebar' : 'app'}>
      {!isNarrow && sidebarOpen && (
        <aside className="sidebar-dock" aria-label="会话列表">
          {renderSidebarInner(false)}
        </aside>
      )}
      {isNarrow && <dialog ref={drawer} id="conversation-drawer" className="sidebar" aria-labelledby="drawer-title"
        onCancel={(event) => { event.preventDefault(); setNavOpen(false) }}
        onClose={(event) => {
          if (event.currentTarget.open) return
          setNavOpen(false)
          if (document.querySelector('dialog[open]')) return
          const trigger = drawerOpener.current
          if (trigger?.isConnected && trigger.tabIndex >= 0 && trigger.getClientRects().length) trigger.focus()
          else [...document.querySelectorAll<HTMLButtonElement>('.nav-toggle')].find((button) => button.getClientRects().length)?.focus()
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) setNavOpen(false)
        }}>
        {renderSidebarInner(true)}
      </dialog>}

      <main className="main">
        {room ? (
          <Chat
            key={room.id}
            room={room}
            participants={participants}
            allAgents={state.agents}
            messages={discussion?.roomId === room.id ? discussion.messages : EMPTY_MESSAGES}
            pending={discussion?.roomId === room.id ? discussion.pending : EMPTY_PENDING}
            loading={discussion?.roomId !== room.id}
            loadError={historyError}
            onRetry={() => setHistoryAttempt((attempt) => attempt + 1)}
            hasEarlier={discussion?.roomId === room.id && Boolean(discussion.before)}
            onLoadEarlier={loadEarlier}
            statuses={statuses[room.id] ?? EMPTY_STATUSES}

            workspace={wsByRoom[room.id]}
            managerProject={managerByRoom[room.id]}
            managerReady={moderatorReady(state.moderator)}
            onManagerSettings={() => { setManagerSettings(true); setSettingsOpen(true) }}
            agentWork={agentWork}
            activity={activityByRoom[room.id]}
            onOpenRoom={chooseRoom}
            onOpenNav={toggleSidebar}
            navOpen={isNarrow ? navOpen : sidebarOpen}
            hasUnread={!sidebarOpen && Object.values(unreadByRoom).some((count) => count > 0)}
            savedDraft={drafts.current.get(room.id)}
            onDraftChange={(value) => drafts.current.set(room.id, value)}
            workDir={state.workDir}

            onStopWorkspace={() => void window.api.stopWorkspace(room.id)}
            onStopRun={(runId) => void window.api.stopRun(runId)}
            onApproveCommand={(id, allow) => void window.api.approveCommand(room.id, id, allow)}
            onSend={(text, atts, sendToWorkspace) => {
              return withRestoredRoom(() => window.api.send(room.id, text, atts, sendToWorkspace))
            }}

            onStop={() => void window.api.stop(room.id)}
            onEditRoom={() => setRoomModal({ room })}
            onArchive={() => changeArchive(room.id, true)}
            onRestore={() => changeArchive(room.id, false, true)}
            onDelete={() => confirmDeleteRoom(room)}
            onToggleMember={(id) => void window.api.toggleRoomMember(room.id, id)}
            onSaveAgent={(agent) => window.api.saveAgent(agent)}
            onSetAccess={(agentId, access) => {
              const agent = state.agents.find((a) => a.id === agentId)
              if (agent) void window.api.saveAgent({ ...agent, access })
            }}
          />
        ) : (
          <div className="no-rooms">
            {(isNarrow || !sidebarOpen) && <button className="ghost-btn nav-toggle" onClick={toggleSidebar}><Icon name="panel" />会话</button>}
            <div className="empty"><h1>{archivedRooms.length ? '会话已收进归档' : (sideArea === 'chat' ? '还没有纯聊天会话' : '还没有会议室')}</h1>
              {archivedRooms.length > 0 && <button className="ghost-btn" onClick={() => { setArchivesOpen(true); if (isNarrow) openNav(); else setSidebarOpen(true) }}>查看已归档</button>}
              <button className="primary-btn" onClick={() => setRoomModal({ room: null, defaultKind: sideArea === 'chat' ? 'chat-group' : 'group' })}>
                {sideArea === 'chat' ? '新建纯聊天群' : '新建会议室'}
              </button>
            </div>
          </div>
        )}
      </main>

      <Suspense fallback={<div className="modal-mask"><div className="modal boot">加载中…</div></div>}>
        {settingsOpen && <Settings state={state} initialTab={managerSettings ? 'moderator' : undefined} onClose={() => { setManagerSettings(false); setSettingsOpen(false) }} onConfirm={setConfirmation} />}

        {roomModal && <RoomModal room={roomModal.room} defaultKind={roomModal.defaultKind} agents={state.agents}
          onClose={() => setRoomModal(null)} onSaved={(id) => { setRoomModal(null); if (id) chooseRoom(id) }} />}
      </Suspense>
      {confirmation && <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />}
    </div>
    </>
  )
}
