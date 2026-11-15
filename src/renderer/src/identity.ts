import { AGENT_COLORS, type Agent } from '../../shared/types'

/** Keep chosen hues where possible, and separate members who share the same hue. */
export function agentColors(agents: Agent[]): Map<string, string> {
  const colors = new Map<string, string>()
  const preferred = (color: string): string => /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : ''
  const reserved = new Set(agents.map((agent) => preferred(agent.color)).filter(Boolean))
  const used = new Set<string>()
  for (const agent of agents) {
    let color = preferred(agent.color)
    if (!color || used.has(color)) {
      color = AGENT_COLORS.find((value) => !used.has(value) && !reserved.has(value))
        ?? AGENT_COLORS.find((value) => !used.has(value))
        ?? `hsl(${Math.round(colors.size * 137.508) % 360} 48% 48%)`
    }
    colors.set(agent.id, color)
    used.add(color)
  }
  return colors
}
