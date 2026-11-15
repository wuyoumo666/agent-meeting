import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { join, basename, extname } from 'node:path'
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Store } from './store'
import { Orchestrator } from './orchestrator'
import { ApprovalAlert } from './approvalAlert'
import { startToolBridge, type ToolBridge } from './bridge'
import { fetchModels } from './adapters/openai'
import { spawnCli } from './adapters/cli'
import { extractDocText } from './adapters/docs'
import { exportMarkdown, searchHistory } from './history'
import { OPENABLE_DELIVERY, verifyDelivery } from './managerFiles'
import type { Agent, AppEvent, Attachment, ModeratorUpdate, ProviderUpdate, Room, RulesFile, ScheduledTask } from '../shared/types'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let trayBalloonShown = false
let minimizeHideTimer: NodeJS.Timeout | null = null
let lastShownAt = 0
let store: Store
let orchestrator: Orchestrator
let toolBridge: ToolBridge | null = null
let eventRevision = 0
const approvalAlert = new ApprovalAlert(() => store?.getApprovalSound() ?? true, () => shell.beep())

// 防止 Windows 下隐藏到托盘再恢复时，Chromium 原生遮挡检测卡死窗口渲染和点击事件
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

function getAppIconPath(): string {
  return join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'bubble-icon.ico' : 'icon.png')
}

function clearMinimizeHideTimer(): void {
  if (!minimizeHideTimer) return
  clearTimeout(minimizeHideTimer)
  minimizeHideTimer = null
}

function showMainWindow(): void {
  clearMinimizeHideTimer()
  lastShownAt = Date.now()
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.moveTop()
  win.focus()
  win.webContents.focus()
  win.webContents.invalidate()
}

function hideToTray(): void {
  clearMinimizeHideTimer()
  if (!win || win.isDestroyed() || isQuitting) return
  win.hide()
  if (process.platform === 'win32' && tray && !trayBalloonShown) {
    trayBalloonShown = true
    tray.displayBalloon({
      iconType: 'info',
      title: '我的智囊团已收起至系统托盘',
      content: '点击右下角托盘图标可随时恢复，右键菜单可彻底退出。'
    })
  }
}

function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(getAppIconPath())
  tray = new Tray(icon)
  tray.setToolTip('我的智囊团')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '退出我的智囊团',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ]))
  tray.on('click', () => {
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) {
      showMainWindow()
      return
    }
    if (Date.now() - lastShownAt < 500) {
      showMainWindow()
      return
    }
    if (win.isFocused()) {
      hideToTray()
    } else {
      showMainWindow()
    }
  })
  tray.on('double-click', () => showMainWindow())
}

const broadcast = (ev: AppEvent): void => {
  approvalAlert.accept(ev)
  if (win && !win.isDestroyed()) win.webContents.send('event', { ...ev, revision: ++eventRevision })
}
const stateChanged = (): void => broadcast({ type: 'state' })

/** 粗略判断是否文本：没有 NUL，控制字符很少。用于没有扩展名/未知扩展名的文件 */
function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return true
  if (buf.includes(0)) return false
  const sample = Math.min(buf.length, 4096)
  let bad = 0
  for (let i = 0; i < sample; i++) {
    const b = buf[i]
    if (b < 7 || (b > 13 && b < 32)) bad++
  }
  return bad / sample < 0.02
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 600,
    minHeight: 600,
    title: '我的智囊团',
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.on('minimize', () => {
    clearMinimizeHideTimer()
    minimizeHideTimer = setTimeout(() => {
      minimizeHideTimer = null
      if (win && !win.isDestroyed() && win.isMinimized() && !isQuitting) hideToTray()
    }, 120)
  })
  win.on('restore', () => {
    clearMinimizeHideTimer()
    if (win && !win.isDestroyed()) win.webContents.invalidate()
  })
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideToTray()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:setApprovalSound', (_e, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('无效的提示音设置。')
    store.setApprovalSound(enabled)
    stateChanged()
  })
  ipcMain.handle('state:get', () => store.state)
  ipcMain.handle('manager:get', (_e, roomId: string) => orchestrator.getManager(roomId))
  ipcMain.handle('files:deliveries', (_e, roomId: string, before?: string) => {
    const messages = store.getMessages(roomId).filter((m) => m.senderId === 'moderator' && (m.deliveries?.length || m.sources?.length))
    const end = before ? messages.findIndex((m) => m.id === before) : messages.length
    if (end < 0) throw new Error('请重新打开交付列表。')
    const start = Math.max(0, end - 20)
    return {
      items: messages.slice(start, end).reverse().map(({ id, text, ts, deliveries, sources }) =>
        ({ id, roomId, text, ts, deliveries, sources })),
      before: start ? messages[start].id : null
    }
  })
  ipcMain.handle('manager:resume', (_e, roomId: string) => orchestrator.resumeManager(roomId))
  ipcMain.handle('files:delivery', async (_e, roomId: string, messageId: string, index: number, action: string) => {
    if (!Number.isInteger(index) || !['open', 'folder', 'save'].includes(action)) throw new Error('无效的文件操作。')
    const message = store.getMessages(roomId).find((m) => m.id === messageId && m.senderId === 'moderator')
    const file = message?.deliveries?.[index]
    if (!file) throw new Error('找不到交付文件，请重新打开会话。')
    await verifyDelivery(file)
    if (action === 'folder') { shell.showItemInFolder(file.path); return true }
    if (action === 'open') {
      if (!OPENABLE_DELIVERY.has(extname(file.name).toLowerCase())) throw new Error('此类文件请另存或打开文件夹后查看。')
      const error = await shell.openPath(file.path)
      if (error) throw new Error(error)
      return true
    }
    if (!win) return false
    const result = await dialog.showSaveDialog(win, { title: '另存交付文件', defaultPath: join(app.getPath('documents'), file.name) })
    if (result.canceled || !result.filePath) return false
    if (result.filePath.toLowerCase() === file.path.toLowerCase()) return true
    await verifyDelivery(file)
    await copyFile(file.path, result.filePath)
    return true
  })
  ipcMain.handle('messages:list', (_e, roomId: string, before?: string) => ({ ...orchestrator.getDiscussion(roomId, before), revision: eventRevision }))
  ipcMain.handle('messages:search', (_e, roomId: string, query: string, senderId: string, offset: number) =>
    searchHistory(store.getMessages(roomId), query, senderId, offset))
  ipcMain.handle('messages:read', (_e, roomId: string, id: string) => {
    const m = store.getMessages(roomId).find((message) => message.id === id)
    return m && {
      id: m.id, author: m.senderName, ts: m.ts, text: m.text, attachments: m.attachments?.map((file) => file.name) ?? []
    }
  })
  ipcMain.handle('messages:export', async (_e, roomId: string) => {
    const room = store.getRoom(roomId)
    if (!win || !room) return false
    const filename = room.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100).trim()
    const save = await dialog.showSaveDialog(win, {
      title: '导出会议记录',
      defaultPath: join(app.getPath('documents'), `会议记录-${filename || '未命名'}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (save.canceled || !save.filePath) return false
    if (!store.getRoom(roomId)) throw new Error('会议室已删除。')
    const file = /\.md$/i.test(save.filePath) ? save.filePath : save.filePath + '.md'
    await writeFile(file, exportMarkdown(room.name, store.getMessages(roomId)), {
      encoding: 'utf8', flag: file === save.filePath ? 'w' : 'wx'
    })
    return true
  })

  ipcMain.handle('settings:setWorkDir', (_e, p: string) => {
    store.setWorkDir(p)
    stateChanged()
  })
  ipcMain.handle('dialog:pickFolder', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: '选择共享工作目录',
      defaultPath: store.getWorkDir() || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:pickFiles', async () => {
    if (!win) return []
    const r = await dialog.showOpenDialog(win, {
      title: '选择要发送的文件/图片',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片与文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'txt', 'md', 'json', 'csv', 'py', 'ts', 'js', 'log', 'yaml', 'yml', 'pdf', 'doc', 'docx'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('files:read', async (_e, paths: string[]) => {
    const IMG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
    const DOC = new Set(['.doc', '.docx', '.pdf'])
    const out: Attachment[] = []
    for (const p of paths) {
      try {
        const st = await stat(p)
        if (!st.isFile()) continue
        const ext = extname(p).toLowerCase()
        const name = basename(p)
        if (IMG.has(ext)) {
          if (st.size > 12 * 1024 * 1024) {
            out.push({ name, path: p, kind: 'file', size: st.size })
            continue
          }
          const buf = await readFile(p)
          const mime = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : ext === '.gif' ? 'gif' : ext === '.bmp' ? 'bmp' : 'jpeg'
          out.push({ name, path: p, kind: 'image', size: st.size, dataUrl: `data:image/${mime};base64,${buf.toString('base64')}` })
        } else if (DOC.has(ext)) {
          const text = st.size <= 20 * 1024 * 1024 ? await extractDocText(p) : undefined
          out.push({ name, path: p, kind: 'file', size: st.size, text: text ? text.slice(0, 12000) : undefined })
        } else if (st.size < 2 * 1024 * 1024) {
          // 常见文本/代码 + 未知扩展名：能按 UTF-8 读就内联，读不了就只给路径
          const buf = await readFile(p)
          const text = looksLikeText(buf) ? buf.toString('utf8').slice(0, 8000) : undefined
          out.push({ name, path: p, kind: 'file', size: st.size, text })
        } else {
          out.push({ name, path: p, kind: 'file', size: st.size })
        }
      } catch {
        // 跳过不可读文件
      }
    }
    return out
  })

  ipcMain.handle('provider:save', async (_e, p: ProviderUpdate) => {
    await store.saveProvider({ ...p, id: p.id || randomUUID() })
    stateChanged()
  })
  ipcMain.handle('provider:delete', async (_e, id: string) => {
    await store.deleteProvider(id)
    stateChanged()
  })
  ipcMain.handle('provider:fetchModels', (_e, baseUrl: string, apiKey?: string, providerId?: string) =>
    fetchModels(baseUrl, store.modelListKey(baseUrl, apiKey, providerId)))

  ipcMain.handle('cli:fetchModels', (_e, command: string) => {
    if (!/agy/i.test(command)) {
      return Promise.reject(new Error('该 CLI 不支持自动列出模型，请从建议中选择或手输模型 ID'))
    }
    return new Promise<string[]>((resolve, reject) => {
      const child = spawnCli(command.trim(), ['models'])
      let out = ''
      child.stderr?.resume()
      const timer = setTimeout(() => { child.kill(); reject(new Error('获取模型超时')) }, 20000)
      child.stdout!.setEncoding('utf8').on('data', (d) => { out += d })
      child.on('error', (e) => { clearTimeout(timer); reject(e) })
      child.on('close', () => {
        clearTimeout(timer)
        const ids = out.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t')[0].trim()).filter(Boolean)
        if (ids.length) resolve([...new Set(ids)])
        else reject(new Error('未解析到模型列表'))
      })
    })
  })

  ipcMain.handle('agent:save', (_e, a: Agent) => {
    if (!a.id) a.id = randomUUID()
    store.saveAgent(a)
    stateChanged()
  })
  ipcMain.handle('agent:delete', (_e, id: string) => {
    store.deleteAgent(id)
    stateChanged()
  })

  ipcMain.handle('room:save', (_e, r: Room) => {
    if (!r.id) r.id = randomUUID()
    store.saveRoom(r)
    stateChanged()
  })
  ipcMain.handle('room:delete', (_e, id: string) => {
    orchestrator.disposeRoom(id)
    store.deleteRoom(id)
    stateChanged()
  })
  ipcMain.handle('room:archive', (_e, id: string, archived: boolean) => {
    if (typeof id !== 'string' || typeof archived !== 'boolean') throw new Error('无效的归档操作。')
    store.setRoomArchived(id, archived)
    stateChanged()
  })
  ipcMain.handle('room:toggleMember', (_e, roomId: string, agentId: string) => {
    const room = store.getRoom(roomId)
    if (!room || !store.getAgent(agentId)) return
    const participantIds = room.participantIds.includes(agentId)
      ? room.participantIds.filter((id) => id !== agentId)
      : [...room.participantIds, agentId]
    store.saveRoom({ ...room, participantIds })
    stateChanged()
  })
  ipcMain.handle('dm:ensure', (_e, agentId: string) => {
    const id = store.ensureDm(agentId)
    stateChanged()
    return id ?? null
  })

  ipcMain.handle('chat:send', (_e, roomId: string, text: string, attachments?: Attachment[], sendToWorkspace?: boolean) =>
    orchestrator.sendUserMessage(roomId, text, attachments, sendToWorkspace === true))
  ipcMain.handle('chat:stop', (_e, roomId: string) => orchestrator.stop(roomId))
  ipcMain.handle('schedule:save', (_e, task: ScheduledTask) => {
    store.saveScheduledTask(task)
    stateChanged()
  })
  ipcMain.handle('schedule:delete', (_e, id: string) => {
    store.deleteScheduledTask(id)
    stateChanged()
  })

  ipcMain.handle('work:agent', (_e, agentId: string) => orchestrator.getAgentWork(agentId))
  ipcMain.handle('workspace:get', (_e, roomId: string) => orchestrator.getWorkspace(roomId))
  ipcMain.handle('workspace:target', (_e, roomId: string, agentId: string) => orchestrator.workTarget(roomId, agentId))
  ipcMain.handle('workspace:stop', (_e, roomId: string) => orchestrator.stopWorkspace(roomId))
  ipcMain.handle('workspace:stopRun', (_e, runId: string) => orchestrator.stopRun(runId))
  ipcMain.handle('workspace:approve', (_e, roomId: string, id: string, allow: boolean) => orchestrator.approveCommand(roomId, id, allow))

  ipcMain.handle('moderator:save', async (_e, cfg: ModeratorUpdate) => {    await store.setModerator(cfg)
    stateChanged()
  })

  ipcMain.handle('rules:save', (_e, r: RulesFile) => {
    store.setRules(r)
    stateChanged()
  })

  ipcMain.handle('memory:list', () => store.getAllMemories())
  ipcMain.handle('memory:pin', (_e, roomId: string, id: string, pinned: boolean) => {
    store.setMemoryPinned(roomId, id, pinned)
  })
  ipcMain.handle('memory:delete', (_e, roomId: string, id: string) => {
    store.deleteMemory(roomId, id)
    stateChanged()
  })
  ipcMain.handle('memory:clear', (_e, roomId: string) => {
    store.clearMemories(roomId)
    stateChanged()
  })
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'light'
    store = new Store()
    await store.loadCredentials()
    orchestrator = new Orchestrator(store, broadcast)
    try {
      toolBridge = await startToolBridge(orchestrator, {
        userData: app.getPath('userData'),
        appPath: app.getAppPath()
      })
      orchestrator.setToolBridge(toolBridge)
    } catch (e) {
      console.error('[bridge] 本地工具桥启动失败，CLI 将只能用自己的工具：', e)
    }
    orchestrator.resumePendingWork()
    registerIpc()
    createTray()
    createWindow()
    app.on('activate', () => {
      showMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (!isQuitting && tray) return
  toolBridge?.close()
  store?.flushNow()
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  isQuitting = true
  tray?.destroy()
  tray = null
  toolBridge?.close()
  store?.flushNow()
})
