import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, unlink } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, normalize } from 'node:path'
import { createHash } from 'node:crypto'
import type { DeliveryFile } from '../shared/types'
import { resolveWorkspacePath } from './workspacePath'
import { extractDocText } from './adapters/docs'

const MAX_FILE = 50 * 1024 * 1024
const TEXT = new Set(['.txt', '.md', '.csv', '.json', '.html', '.css', '.js', '.ts', '.tsx', '.py', '.xml', '.yaml', '.yml', '.log', '.svg'])
export const OPENABLE_DELIVERY = new Set(['.txt', '.md', '.csv', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.gif'])
const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

/** Only server-selected workspaces are eligible. Model text never grants path access. */
export function managerPath(roots: string[], input: string): string {
  if (!input || input.length > 1500) throw new Error('请提供工作目录内的文件路径。')
  for (const root of roots) {
    try { return resolveWorkspacePath(root, input) } catch { /* Try the next approved root. */ }
    if (!isAbsolute(input)) break
  }
  throw new Error('只能检查本会话成员的工作目录，不能读取其他位置或目录联接。')
}

export async function inspectManagerFile(roots: string[], input: string): Promise<{ file: DeliveryFile; content: string; coverage: string }> {
  const path = managerPath(roots, input)
  const info = await stat(path)
  if (!info.isFile() || info.size === 0 || info.size > MAX_FILE || info.nlink > 1) throw new Error('文件必须非空、不超过 50 MB，且不是硬链接。')
  const data = await readFile(path)
  if (data.length > MAX_FILE) throw new Error('文件过大。')
  const ext = extname(path).toLowerCase()
  let content = ''
  let coverage = '只核对文件存在、大小和校验值；二进制内容须交给成员使用相应工具检查。'
  if (TEXT.has(ext)) {
    if (data.includes(0)) throw new Error('文件内容与文本扩展名不符。')
    content = data.toString('utf8')
    coverage = content.length <= 14000 ? '已读取全文' : '只读取开头和结尾，长文须另派成员完整审阅'
    if (content.length > 14000) content = content.slice(0, 10000) + '\n…中间省略…\n' + content.slice(-4000)
  } else if (['.doc', '.docx', '.pdf'].includes(ext)) {
    if (data.length > 20 * 1024 * 1024) throw new Error('待验收文档请控制在 20 MB 以内。')
    if (ext === '.pdf' && data.subarray(0, 5).toString() !== '%PDF-') throw new Error('文件不是有效的 PDF。')
    const extracted = await extractDocText(path)
    if (extracted) {
      content = extracted.length <= 14000 ? extracted : extracted.slice(0, 10000) + '\n…中间省略…\n' + extracted.slice(-4000)
      coverage = extracted.length <= 14000 ? '已提取全文；不代表完成版式检查' : '已提取首尾文字；须另行检查全文和版式'
    } else {
      coverage = '未提取到文档文字，须让成员用合适工具检查可读性和内容。'
    }
  }
  return { file: { path, name: basename(path), size: data.length, sha256: digest(data), checkedAt: Date.now() }, content, coverage }
}

export async function listManagerFiles(roots: string[], input = '.'): Promise<string> {
  const path = managerPath(roots, input)
  const names = await readdir(path, { withFileTypes: true })
  return JSON.stringify({ directory: path, entries: names.slice(0, 100).map((e) => ({ name: e.name, directory: e.isDirectory() })), truncated: names.length > 100 })
}

export async function verifyDelivery(file: DeliveryFile): Promise<void> {
  const info = await lstat(file.path)
  const canonical = (path: string): string => process.platform === 'win32' ? normalize(path).toLowerCase() : normalize(path)
  if (!info.isFile() || info.size !== file.size || info.nlink > 1 || info.size > MAX_FILE ||
    canonical(await realpath(file.path)) !== canonical(file.path) || digest(await readFile(file.path)) !== file.sha256) {
    throw new Error('文件在交付后发生变化，请让经理重新检查并交付。')
  }
}

/** A separate immutable snapshot prevents later worker edits from changing an old delivery. */
export async function snapshotDelivery(roots: string[], projectId: string, files: DeliveryFile[], signal: AbortSignal): Promise<DeliveryFile[]> {
  const folder = managerPath(roots, join('交付', projectId))
  await mkdir(folder, { recursive: true })
  const copied: DeliveryFile[] = []
  try {
    for (const file of files) {
      signal.throwIfAborted()
      const source = managerPath(roots, file.path)
      await verifyDelivery({ ...file, path: source })
      const target = managerPath(roots, join(folder, `${Date.now()}-${copied.length + 1}-${file.name}`))
      await copyFile(source, target, constants.COPYFILE_EXCL)
      const saved = { ...file, path: target }
      copied.push(saved)
      await verifyDelivery(saved)
    }
    signal.throwIfAborted()
    return copied
  } catch (error) {
    for (const file of copied) await unlink(file.path).catch(() => {})
    throw error
  }
}
