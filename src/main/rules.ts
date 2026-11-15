import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { RulesFile } from '../shared/types'

/** 读取成员规则，兼容旧版 AGENTS.md。 */
export function loadRulesFile(path: string): RulesFile | null {
  try {
    if (!existsSync(path)) return null
    const s = readFileSync(path, 'utf8')
    const host = s.match(/## 主持模式[\s\S]*?```[^\n]*\n([\s\S]*?)```/)?.[1]?.trim()
    const free = s.match(/## 自由讨论[\s\S]*?```[^\n]*\n([\s\S]*?)```/)?.[1]?.trim()
    if (host) return { host, free }
  } catch {
    // 解析失败则用默认
  }
  return null
}

/** 把规则写回 AGENTS.md */
export function saveRulesFile(path: string, r: RulesFile): void {
  const md = [
    '# AI 会议室 · 规则（AGENTS.md）',
    '',
    '群聊里每个 AI 的行为规则。软件「设置 → 规则」里可直接编辑，保存后会写回本文件；',
    '你也可以直接改这个文件，重启应用生效。',
    '',
    '可用占位符：{{agent}} 参会者名字、{{room}} 房间名、{{names}} 群友名单、{{topic}} 当前问题、{{persona}} 人设。',
    '每条一行一条规则，支持中文；模型会尽量遵守。',
    '',
    '## 主持模式',
    '```',
    r.host,
    '```',
    '',
    ...(r.free ? ['## 自由讨论', '```', r.free, '```', ''] : [])
  ].join('\n')
  writeFileSync(path, md, 'utf8')
}
