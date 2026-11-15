import { useState } from 'react'
import type { ConversationDelivery, ManagerProject, ManagerTask, WorkSource } from '../../../shared/types'

const projectLabels = {
  idle: '本轮已回复', planning: '经理正在处理', working: '成员正在执行',
  reviewing: '经理正在检查成果', delivered: '已交付', blocked: '经理暂时无法继续', stopped: '任务已停止'
}
const taskLabels = {
  queued: '排队中', running: '执行中', done: '已回报', error: '未完成', interrupted: '已中断', closed: '已处置'
}
const unfinished = (task: ManagerTask): boolean => task.status === 'error' || task.status === 'interrupted'

function taskSummary(task: ManagerTask): string {
  const summary = task.task.replace(/^用户授权继续[，。]\s*/, '').split(/[，。；\r\n]/u)[0].trim()
  if (!summary) return '查看任务内容'
  return summary.length > 42 ? summary.slice(0, 41) + '…' : summary
}

function taskIssue(task: ManagerTask): string {
  const reason = task.result?.split(/\r?\n/)[0].trim() ?? ''
  const limit = reason.match(/运行已达 (\d+) 分钟/)
  if (limit) return `达到 ${limit[1]} 分钟运行上限，已有文件保留`
  const inactivity = reason.match(/连续 (\d+) 分钟无活动/)
  if (inactivity) return `${inactivity[1]} 分钟无进展，已有文件保留`
  if (/工具权限未通过/.test(reason)) return '工具权限未通过'
  if (/^用户停止任务/.test(reason)) return '已按你的要求停止'
  if (/^应用重启/.test(reason)) return '应用重启，执行结果待核对'
  return reason || taskLabels[task.status]
}

export function ManagerPanel({ project, ready, onSettings, onStop, compact = false }: {
  project?: ManagerProject | null
  ready: boolean
  onSettings: () => void
  onStop: () => void
  compact?: boolean
}): React.JSX.Element | null {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const resume = async (roomId: string): Promise<void> => {
    setError('')
    setBusy(true)
    try { await window.api.resumeManager(roomId) }
    catch { setError('暂时无法继续，请稍后重试。') }
    finally { setBusy(false) }
  }
  if (!ready) return <div className="manager-progress"><div className="manager-bar">
    <span>请先启用主持人的模型，经理才能接收需求。</span>
    <button className="ghost-btn" onClick={onSettings}>配置主持人</button>
  </div></div>
  if (!project || (project.status === 'idle' && !project.tasks.length)) return null
  const executing = project.tasks.filter((task) => task.status === 'running').length
  const queued = project.tasks.filter((task) => task.status === 'queued').length
  const running = executing + queued > 0 || ['planning', 'working', 'reviewing'].includes(project.status)
  const issues = project.tasks.filter(unfinished)
  const returned = project.tasks.filter((task) => task.status === 'done' || task.status === 'closed').length
  const blocked = project.status === 'blocked'
  const waitingForReply = blocked && project.note === '等待补充信息'
  const managerFailed = blocked && project.note.startsWith('经理暂时未完成处理：')
  const restarted = blocked && project.note.startsWith('应用重启')
  const partial = blocked && project.note.startsWith('已交付阶段成果')
  const canResume = !running && !waitingForReply && (blocked || project.status === 'stopped')
  let title = projectLabels[project.status]
  let explanation = ''
  if (waitingForReply) {
    title = '等你回复经理'
    explanation = '请在「我和经理」里回答最新问题。'
  } else if (managerFailed) {
    title = '经理本轮没能完成'
    explanation = project.note.replace('经理暂时未完成处理：', '')
  } else if (restarted) {
    title = '应用重启，任务已暂停'
    explanation = '已有成果保留。'
  } else if (blocked && issues.length) {
    title = `${partial ? '已交付阶段成果 · ' : ''}${issues.length} 项任务未完成`
  } else if (blocked) {
    explanation = project.note
  } else if (project.status === 'stopped') {
    explanation = '已有成果保留。'
  } else if (running && /接手|重试/.test(project.note)) {
    title = project.note
  } else if (running && project.note.startsWith('等待成员回报：')) {
    explanation = project.note.slice('等待成员回报：'.length)
  }
  const progress = [
    executing > 0 ? `${executing} 项执行中` : '',
    queued > 0 ? `${queued} 项排队中` : '',
    returned > 0 ? `${returned} 项已回报或处理` : ''
  ].filter(Boolean).join(' · ')
  const showIssues = blocked && !waitingForReply && issues.length > 0
  const taskList = project.tasks.length > 0 ? (
    <div className="manager-task-list">
      {[...issues, ...project.tasks.filter((task) => !unfinished(task))].map((task) => (
        <details className="manager-task" key={task.id}>
          <summary>
            <span className="manager-task-title">{taskSummary(task)}</span>
            <span className={`task-badge st-${task.status}`}>{taskLabels[task.status]}</span>
          </summary>
          <p className="dim small">负责人 · {task.agentName}</p>
          <p>{task.task}</p>
          <p className="dim">验收要求：{task.acceptance}</p>
          {task.previousFailure && <p className="dim">{task.previousFailure.agentName} · {task.previousFailure.reason}</p>}
          {task.result && <p className="manager-result">{task.result}</p>}
        </details>
      ))}
    </div>
  ) : null

  return <section className={compact ? 'manager-progress compact' : 'manager-progress'} aria-label="经理任务进度">
    <div className="manager-bar">
      <div className="manager-summary" role="status">
        <b>{running && <i className="live-dot" aria-hidden="true" />}{title}</b>
        {explanation && <p className="dim small">{explanation}</p>}
        {!blocked && progress && <p className="dim small">{progress}</p>}
      </div>
      {running && !compact && <button className="ghost-btn" onClick={onStop}>停止</button>}
    </div>
    {showIssues && <ul className="manager-issues">
      {issues.slice(0, 2).map((task) => <li key={task.id}>
        <b title={task.task}>{taskSummary(task)}</b>
        <span className="dim small">{task.agentName} · {taskIssue(task)}</span>
      </li>)}
    </ul>}
    {canResume && <div className="manager-next">
      <button className="ghost-btn" disabled={busy} aria-describedby="manager-resume-hint" onClick={() => void resume(project.roomId)}>{busy ? '正在请求经理…' : '让经理继续'}</button>
      <span id="manager-resume-hint" className="dim small">先检查已有成果，再决定如何补做。</span>
    </div>}
    {taskList && (compact ? taskList : <details className="manager-details">
      <summary>查看任务明细 · {project.tasks.length} 项</summary>
      {taskList}
    </details>)}
    {error && <p className="composer-error" role="alert">{error}</p>}
  </section>
}

export function DeliveryCards({ message }: { message: ConversationDelivery }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const run = async (index: number, action: 'open' | 'folder' | 'save'): Promise<void> => {
    setFeedback('')
    setBusy(true)
    try {
      if (await window.api.deliveryFile(message.roomId, message.id, index, action) && action === 'save') setFeedback('文件已另存。')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '文件操作失败。')
    } finally { setBusy(false) }
  }
  return <div className="delivery-list" aria-label="交付文件">
    {message.deliveries?.map((file, index) => <div className="delivery-card" key={file.path}>
      <div className="delivery-name">
        <b>{file.name}</b><span className="dim small">{file.size < 1024 ? file.size + ' B' : (file.size / 1024).toFixed(1) + ' KB'} · 交付副本</span>
        {file.coverage && <span className="dim small">{file.coverage}</span>}
      </div>
      <div className="delivery-actions">
        {/\.(txt|md|csv|pdf|docx?|xlsx?|pptx?|png|jpe?g|webp|gif)$/i.test(file.name) &&
          <button className="ghost-btn" disabled={busy} onClick={() => void run(index, 'open')}>打开</button>}
        <button className="ghost-btn" disabled={busy} onClick={() => void run(index, 'save')}>另存为</button>
        <button className="ghost-btn" disabled={busy} onClick={() => void run(index, 'folder')}>文件夹</button>
      </div>
    </div>)}
    {feedback && <p className="small" role="status">{feedback}</p>}
  </div>
}

export function SourceLinks({ sources }: { sources?: WorkSource[] }): React.JSX.Element | null {
  if (!sources?.length) return null
  return <details className="delivery-sources">
    <summary>实际取得的来源 · {sources.length} 条</summary>
    <ul>{sources.map((source) => <li key={source.url}>
      <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
      <span className="dim small">{source.kind === 'bibliography' ? '候选书目' : source.kind === 'search' ? '搜索结果 · 正文待核实' : '已访问网页'}</span>
    </li>)}</ul>
  </details>
}
