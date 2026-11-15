import { useId } from 'react'
import type { Agent } from '../../../shared/types'

type Access = NonNullable<Agent['access']>

const modes: Record<Access, { label: string; commands: string; files: string }> = {
  readonly: { label: '只读', commands: '不运行命令', files: '可读取工作目录。' },
  workspace: { label: '仅工作目录', commands: '每条命令都问你', files: '内置文件工具只能在工作目录内读写。' },
  'full-approval': { label: '全文件权限', commands: '每条命令都问你', files: '内置文件工具也能读写工作目录之外的文件。' },
  'auto-review': { label: '自动审查', commands: '先由模型审查命令', files: '内置文件工具也能读写工作目录之外的文件。' },
  full: { label: '完全信任', commands: '命令直接执行', files: '内置文件工具也能读写工作目录之外的文件。' }
}

const allModes = Object.keys(modes) as Access[]

function availableModes(kind: Agent['kind']): Access[] {
  return kind === 'api' ? allModes : allModes.filter((mode) => mode !== 'full-approval')
}

function selectedMode(agent: Agent): Access {
  const mode = agent.access ?? 'workspace'
  return availableModes(agent.kind).includes(mode) ? mode : 'workspace'
}

export function accessLabel(agent: Agent): string {
  return modes[selectedMode(agent)].label
}

export function AccessSelect({ agent, onChange, className }: {
  agent: Agent
  onChange: (access: Access) => void
  className?: string
}): React.JSX.Element {
  const current = modes[selectedMode(agent)]
  return (
    <select className={className} aria-label={`${agent.name}的工作权限`} title={`${current.label} · ${current.commands}`} value={selectedMode(agent)}
      onChange={(event) => onChange(event.target.value as Access)}>
      {availableModes(agent.kind).map((access) => <option key={access} value={access}>
        {modes[access].label}
      </option>)}
    </select>
  )
}

export default function WorkAccess({ agent, reviewer, onChange }: {
  agent: Agent
  reviewer?: string
  onChange: (access: Access) => void
}): React.JSX.Element {
  const name = useId()
  const access = selectedMode(agent)
  const current = modes[access]
  const files = agent.kind !== 'cli' ? current.files
    : access === 'readonly' ? '应用提供的文件工具仅供读取。'
      : access === 'workspace' ? '应用提供的下载工具只能把文件存进工作目录。'
        : '应用提供的下载工具可以把文件存到工作目录之外。'

  return (
    <fieldset className="access-settings" aria-describedby={`${name}-summary`}>
      <legend>工作权限</legend>
      <div className="access-layout">
        <div className="access-options">
          {availableModes(agent.kind).map((mode) => (
            <label className="access-option" key={mode}>
              <input type="radio" name={name} value={mode} checked={access === mode} onChange={() => onChange(mode)} />
              <span className="access-label">{modes[mode].label}</span>
              <span className="access-caption">{mode === 'auto-review' && !reviewer ? '无模型时问你' : modes[mode].commands}</span>
            </label>
          ))}
        </div>
        <div className="access-summary" id={`${name}-summary`} aria-live="polite">
          <h4>{current.label}</h4>
          {access === 'auto-review' ? (
            <>
              <p>任务内的常规操作自动审核，先核对相关文件，再决定是否执行。</p>
              <p>{files}</p>
              <details>
                <summary>高级设置 · 自动审查说明</summary>
                <p>{reviewer ? `由${reviewer}审查命令。群聊里可交给经理复审；仍有重大影响或授权缺口时才请你确认。明确危险的命令会被拒绝。` : '没有可用的审查模型。通过应用执行命令时会请你确认。'}</p>
              </details>
            </>
          ) : <p>{current.commands}。{files}</p>}
          {agent.kind === 'cli' && <p>本地工具自身的命令权限由工具管理。</p>}
        </div>
      </div>
    </fieldset>
  )
}
