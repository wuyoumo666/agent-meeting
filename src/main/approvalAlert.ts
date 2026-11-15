import type { AppEvent } from '../shared/types'

/** Notify only newly pending human decisions, regardless of the selected room or window focus. */
export class ApprovalAlert {
  private pending = new Map<string, Set<string>>()
  private lastSound = -Infinity

  constructor(private enabled: () => boolean, private play: () => void, private now = Date.now) {}

  accept(event: AppEvent): void {
    if (event.type !== 'ws-status') return
    const ids = new Set([event.pending?.id, ...(event.runs ?? []).map((run) => run.pending?.id)].filter((id): id is string => !!id))
    const previous = this.pending.get(event.roomId)
    const added = [...ids].some((id) => !previous?.has(id))
    if (ids.size) this.pending.set(event.roomId, ids)
    else this.pending.delete(event.roomId)
    if (!added || !this.enabled() || this.now() - this.lastSound < 1500) return
    this.lastSound = this.now()
    try { this.play() } catch { /* Audio must never interrupt a task or its approval card. */ }
  }
}
