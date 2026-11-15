import type { Agent } from './types'

export function findMentions(agents: Agent[], text: string): Array<{ agent: Agent; index: number }> {
  const ordered = [...agents].sort((a, b) => b.name.length - a.name.length)
  const mentions: Array<{ agent: Agent; index: number }> = []
  for (const match of text.matchAll(/@/g)) {
    const tail = text.slice(match.index + 1)
    const agent = ordered.find((a) => tail.startsWith(a.name) && !/^[\p{L}\p{N}_-]/u.test(tail.slice(a.name.length)))
    if (agent && !/[\w.+%-]$/.test(text.slice(0, match.index))) mentions.push({ agent, index: match.index })
  }
  return mentions
}
