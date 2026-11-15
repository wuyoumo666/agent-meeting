import { randomUUID } from 'node:crypto'
import type { ActivityTransfer, AppEvent } from '../shared/types'
import { describeTool } from './adapters/humanize'

export type TransferObserver = (progress: ActivityTransfer) => void
export type ObserveTool = (name: string, args?: Record<string, unknown>) => {
  transfer: TransferObserver
  finish: () => void
}

export function toolObserver(emit: (event: AppEvent) => void, roomId: string, agentName: string): ObserveTool {
  return (name, args) => {
    const ts = Date.now()
    const id = randomUUID()
    const text = name === 'run_command' ? '命令处理' : describeTool(name, args)
    let lastSent = ts
    let transfer: ActivityTransfer | undefined
    let finished = false
    const publish = (endedAt?: number): void => {
      emit({ type: 'activity', roomId, agentName, text, ts, tool: { id, name, endedAt, transfer } })
    }
    publish()
    return {
      transfer: (sample) => {
        if (finished) return
        transfer = sample
        const now = Date.now()
        if (now - lastSent >= 750) {
          lastSent = now
          publish()
        }
      },
      finish: () => {
        if (finished) return
        finished = true
        publish(Date.now())
      }
    }
  }
}
