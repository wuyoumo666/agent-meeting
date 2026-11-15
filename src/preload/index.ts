import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Agent, AgentWorkInfo, AppEvent, AppState, Attachment, ConversationDelivery, HistoryPage, HistorySearch, ManagerProject, MemoryRecord, ModeratorUpdate, ProviderUpdate, Room, RulesFile, ScheduledTask, WorkTarget, WorkspaceState } from '../shared/types'

const api = {
  listDeliveries: (roomId: string, before?: string): Promise<{ items: ConversationDelivery[]; before: string | null }> => ipcRenderer.invoke('files:deliveries', roomId, before),
  getManager: (roomId: string): Promise<ManagerProject | null> => ipcRenderer.invoke('manager:get', roomId),
  resumeManager: (roomId: string): Promise<void> => ipcRenderer.invoke('manager:resume', roomId),
  deliveryFile: (roomId: string, messageId: string, index: number, action: 'open' | 'folder' | 'save'): Promise<boolean> => ipcRenderer.invoke('files:delivery', roomId, messageId, index, action),
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  getMessages: (roomId: string, before?: string): Promise<HistoryPage> => ipcRenderer.invoke('messages:list', roomId, before),
  searchMessages: (roomId: string, query: string, senderId: string, offset: number): Promise<HistorySearch> =>
    ipcRenderer.invoke('messages:search', roomId, query, senderId, offset),
  readMessage: (roomId: string, id: string): Promise<{ id: string; author: string; ts: number; text: string; attachments: string[] } | undefined> =>
    ipcRenderer.invoke('messages:read', roomId, id),
  exportMessages: (roomId: string): Promise<boolean> => ipcRenderer.invoke('messages:export', roomId),
  setWorkDir: (p: string): Promise<void> => ipcRenderer.invoke('settings:setWorkDir', p),
  setApprovalSound: (enabled: boolean): Promise<void> => ipcRenderer.invoke('settings:setApprovalSound', enabled),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  readFiles: (paths: string[]): Promise<Attachment[]> => ipcRenderer.invoke('files:read', paths),
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return (file as unknown as { path?: string }).path ?? ''
    }
  },
  saveProvider: (p: ProviderUpdate): Promise<void> => ipcRenderer.invoke('provider:save', p),
  deleteProvider: (id: string): Promise<void> => ipcRenderer.invoke('provider:delete', id),
  fetchModels: (baseUrl: string, apiKey?: string, providerId?: string): Promise<string[]> =>
    ipcRenderer.invoke('provider:fetchModels', baseUrl, apiKey, providerId),
  cliModels: (command: string): Promise<string[]> => ipcRenderer.invoke('cli:fetchModels', command),
  saveAgent: (a: Agent): Promise<void> => ipcRenderer.invoke('agent:save', a),
  deleteAgent: (id: string): Promise<void> => ipcRenderer.invoke('agent:delete', id),
  saveRoom: (r: Room): Promise<void> => ipcRenderer.invoke('room:save', r),
  ensureDm: (agentId: string): Promise<string | null> => ipcRenderer.invoke('dm:ensure', agentId),
  deleteRoom: (id: string): Promise<void> => ipcRenderer.invoke('room:delete', id),
  setRoomArchived: (id: string, archived: boolean): Promise<void> => ipcRenderer.invoke('room:archive', id, archived),
  toggleRoomMember: (roomId: string, agentId: string): Promise<void> => ipcRenderer.invoke('room:toggleMember', roomId, agentId),
  send: (roomId: string, text: string, attachments?: Attachment[], sendToWorkspace?: boolean): Promise<void> =>
    ipcRenderer.invoke('chat:send', roomId, text, attachments, sendToWorkspace),
  stop: (roomId: string): Promise<void> => ipcRenderer.invoke('chat:stop', roomId),
  saveScheduledTask: (task: ScheduledTask): Promise<void> => ipcRenderer.invoke('schedule:save', task),
  deleteScheduledTask: (id: string): Promise<void> => ipcRenderer.invoke('schedule:delete', id),
  getWorkspace: (roomId: string): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:get', roomId),
  getAgentWork: (agentId: string): Promise<AgentWorkInfo> => ipcRenderer.invoke('work:agent', agentId),
  getWorkTarget: (roomId: string, agentId: string): Promise<WorkTarget> => ipcRenderer.invoke('workspace:target', roomId, agentId),
  stopWorkspace: (roomId: string): Promise<void> => ipcRenderer.invoke('workspace:stop', roomId),
  stopRun: (runId: string): Promise<void> => ipcRenderer.invoke('workspace:stopRun', runId),
  approveCommand: (roomId: string, id: string, allow: boolean): Promise<void> => ipcRenderer.invoke('workspace:approve', roomId, id, allow),
  saveModerator: (cfg: ModeratorUpdate): Promise<void> => ipcRenderer.invoke('moderator:save', cfg),
  saveRules: (r: RulesFile): Promise<void> => ipcRenderer.invoke('rules:save', r),
  listMemories: (): Promise<Record<string, MemoryRecord[]>> => ipcRenderer.invoke('memory:list'),
  pinMemory: (roomId: string, id: string, pinned: boolean): Promise<void> => ipcRenderer.invoke('memory:pin', roomId, id, pinned),
  deleteMemory: (roomId: string, id: string): Promise<void> => ipcRenderer.invoke('memory:delete', roomId, id),
  clearMemories: (roomId: string): Promise<void> => ipcRenderer.invoke('memory:clear', roomId),
  onEvent: (cb: (ev: AppEvent & { revision?: number }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: AppEvent & { revision?: number }): void => cb(ev)
    ipcRenderer.on('event', listener)
    return () => ipcRenderer.removeListener('event', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
