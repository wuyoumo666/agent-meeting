import type { AppEvent, ModelRate } from '../shared/types'

export function modelRate(outputTokens: unknown, elapsedMs: unknown, basis: ModelRate['basis']): ModelRate | undefined {
  if (typeof outputTokens !== 'number' || !Number.isSafeInteger(outputTokens) || outputTokens <= 0) return
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return
  return { outputTokens, elapsedMs, basis }
}

export function modelRateObserver(emit: (event: AppEvent) => void, roomId: string, agentName: string): (rate: ModelRate) => void {
  return (rate) => emit({ type: 'activity', roomId, agentName, ts: Date.now(), text: '模型已返回', modelRate: rate })
}
