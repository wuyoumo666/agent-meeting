import { open, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname, relative } from 'node:path'
import { resolveWorkspacePath } from '../workspacePath'
import type { ToolDef } from './openai'

const S = { type: 'string' }
const pagination = { startLine: { type: 'integer', minimum: 1 }, startChar: { type: 'integer', minimum: 0 }, maxLines: { type: 'integer', minimum: 1, maximum: 300 } }
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDef => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } })
export const FILE_TOOLS = [
  tool('read_file', '分段读取文本并返回行号、总行数、SHA256。若有 nextLine/nextChar，用 startLine/startChar 续读，不能把一段当全文。PDF/Word 用 read_document。', { path: S, ...pagination }, ['path']),
  tool('read_document', '提取 PDF、DOC、DOCX 正文，可按行续读；PDF 可指定 page 页码（从1开始）。文字提取不代表版式检查，扫描件无文字时用 view_pdf。', { path: S, page: { type: 'integer', minimum: 1 }, ...pagination }, ['path']),
  tool('find_files', '在指定目录内递归找文件，无需命令审批。不跟随链接，默认跳过 .git/node_modules。pattern 支持 * 和 ? 或文件名片段；有 nextOffset 时继续。', { path: S, pattern: S, offset: { type: 'integer', minimum: 0 } }, ['pattern']),
  tool('search_files', '按普通文字搜索文件内容，返回文件路径、行号和短上下文，无需运行命令。PDF/Word 请先 read_document。可用 pattern 限定文件名；有 nextOffset 时继续。', { path: S, query: S, pattern: S, caseSensitive: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 } }, ['query'])
]
export const FILE_TOOL_NAMES = new Set(FILE_TOOLS.map((item) => item.function.name))
const int = (value: unknown, fallback: number, min: number, max: number): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`数值参数必须在 ${min}–${max} 之间。`)
  return value
}
const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

async function bytes(path: string, max: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink > 1 || info.size > max) throw new Error(`仅支持无其他硬链接、不超过 ${max / 1024 / 1024} MB 的普通文件。`)
    const data = await file.readFile({ signal })
    if (data.length > max || data.length !== info.size || (await file.stat()).mtimeMs !== info.mtimeMs) throw new Error('文件过大或正在变化，请重新读取。')
    return data
  } finally { await file.close() }
}
function textOf(data: Buffer): string {
  let text: string
  try { text = data[0] === 255 && data[1] === 254 ? data.subarray(2).toString('utf16le') : new TextDecoder('utf-8', { fatal: true }).decode(data) }
  catch { throw new Error('不是可读取的 UTF-8/UTF-16 文本。文档用 read_document，图片用 view_image。') }
  if (text.includes('\0') || /[\x01-\x08\x0e-\x1f]/.test(text)) throw new Error('不是可读取的普通文本。文档请用 read_document，图片请用 view_image。')
  return text.replace(/^\uFEFF/, '')
}
export function textPage(text: string, args: Record<string, unknown>, metadata: Record<string, unknown>): string {
  const lines = text.split(/\r?\n/)
  const start = int(args.startLine, 1, 1, lines.length)
  const startChar = int(args.startChar, 0, 0, lines[start - 1].length)
  const limit = int(args.maxLines, 120, 1, 300)
  let line = start - 1, char = startChar, content = '', consumed = 0
  while (line < lines.length && consumed < limit && content.length < 5000) {
    const rest = lines[line].slice(char)
    const amount = Math.min(rest.length, 5000 - content.length)
    content += rest.slice(0, amount)
    char += amount
    if (char < lines[line].length) break
    if (line + 1 < lines.length && content.length === 5000) break
    line++; char = 0; consumed++
    if (line < lines.length && content.length < 5000) content += '\n'
  }
  return JSON.stringify({ ...metadata, totalLines: lines.length, startLine: start, startChar, endLine: char ? line + 1 : line,
    complete: start === 1 && startChar === 0 && line === lines.length, hasMore: line < lines.length,
    nextLine: line < lines.length ? line + 1 : undefined, nextChar: line < lines.length ? char : undefined, content })
}

export async function readTextPage(path: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  if (['.png','.jpg','.jpeg','.webp','.gif','.bmp'].includes(extname(path).toLowerCase())) throw new Error('这是图片，请使用 view_image 获取实际画面。')
  if (['.pdf', '.doc', '.docx'].includes(extname(path).toLowerCase())) throw new Error('这是文档，请使用 read_document 提取正文。')
  const data = await bytes(path, 4 * 1024 * 1024, signal)
  return textPage(textOf(data), args, { path, sha256: digest(data), kind: 'text' })
}

export async function readDocumentPage(path: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const ext = extname(path).toLowerCase()
  if (!['.pdf', '.doc', '.docx'].includes(ext)) throw new Error('read_document 支持 PDF、DOC、DOCX；普通文本用 read_file。')
  const data = await bytes(path, 20 * 1024 * 1024, signal)
  let text = '', page: number | undefined, totalPages: number | undefined
  if (ext === '.pdf') {
    if (data.subarray(0, 5).toString() !== '%PDF-') throw new Error('文件不是有效 PDF。')
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data })
    const cancel = (): void => { void parser.destroy().catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const info = await parser.getInfo()
      totalPages = info.total
      if (args.page !== undefined) page = int(args.page, 1, 1, info.total)
      const result = await parser.getText(page ? { partial: [page] } : {})
      text = result.pages.map((p) => `--- 第 ${p.num} 页 ---\n${p.text}`).join('\n\n')
      if (!result.pages.some((p) => p.text.trim())) throw new Error('未提取到正文，可能为扫描件；请用 view_pdf 逐页看图。')
    } finally { signal.removeEventListener('abort', cancel); await parser.destroy().catch(() => {}) }
  } else {
    if (args.page !== undefined) throw new Error('Word 正文不提供可靠页码，请按 startLine 续读；版式需另行检查。')
    const { default: WordExtractor } = await import('word-extractor')
    const document = await new WordExtractor().extract(data)
    text = document.getBody() || ''
    if (!text.trim()) throw new Error('文档未提取到正文。')
  }
  signal.throwIfAborted()
  if (text.length > 4 * 1024 * 1024) throw new Error('正文过长，请限定 PDF 页码后读取。')
  return textPage(text, args, { path, sha256: digest(data), kind: 'document', page, totalPages, scope: page ? `仅 PDF 第 ${page} 页` : '文档正文', coverage: 'complete 仅指当前选择范围的文字；文字提取不代表看过页面版式。' })
}

const skips = new Set(['node_modules', '.git', '.svn', '.hg'])
const binary = new Set(['.png','.jpg','.jpeg','.webp','.gif','.bmp','.ico','.pdf','.doc','.docx','.zip','.exe','.dll','.woff','.woff2','.ttf','.mp4','.mp3','.xlsx','.pptx'])
function matches(name: string, input: unknown): boolean {
  const value = typeof input === 'string' ? input : ''
  if (!value || value === '*') return true
  if (value.length > 160) throw new Error('文件名条件最长 160 字符。')
  if (!/[*?]/.test(value)) return name.toLowerCase().includes(value.toLowerCase())
  const pattern = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp('^' + pattern + '$', 'i').test(name)
}
export async function searchLocalFiles(root: string, args: Record<string, unknown>, contentSearch: boolean, signal: AbortSignal): Promise<string> {
  const query = typeof args.query === 'string' ? args.query : ''
  if (contentSearch && (!query || query.length > 300 || /[\r\n]/.test(query))) throw new Error('内容搜索请输入 1–300 字符的单行普通文字。')
  if (!contentSearch && (typeof args.pattern !== 'string' || !args.pattern.trim())) throw new Error('请输入文件名片段或 * 等文件名条件。')
  if (args.pattern !== undefined && typeof args.pattern !== 'string') throw new Error('文件名条件应为文字。')
  if (args.caseSensitive !== undefined && typeof args.caseSensitive !== 'boolean') throw new Error('caseSensitive 必须为 true 或 false。')
  const offset = int(args.offset, 0, 0, 100000)
  const found: Array<Record<string, unknown>> = []
  let visited = 0, hits = 0, stopped = false, skipped = 0, readBytes = 0, outputSize = 0, pageFull = false
  const started = Date.now()
  const push = (item: Record<string, unknown>): boolean => {
    if (found.length >= 30 || outputSize + JSON.stringify(item).length > 8500) { stopped = true; pageFull = true; return false }
    outputSize += JSON.stringify(item).length
    found.push(item)
    return true
  }
  const needle = args.caseSensitive ? query : query.toLowerCase()
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 12) { stopped = true; return }
    const entries = (await readdir(resolveWorkspacePath(root, directory), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      signal.throwIfAborted()
      if (++visited > 4000 || readBytes > 16 * 1024 * 1024 || Date.now() - started > 5000 || pageFull) { stopped = true; return }
      if (entry.isSymbolicLink()) { skipped++; continue }
      const path = resolveWorkspacePath(root, directory + '/' + entry.name)
      if (entry.isDirectory()) {
        if (!skips.has(entry.name)) await walk(path, depth + 1)
      } else if (entry.isFile() && matches(entry.name, args.pattern)) {
        if (!contentSearch) {
          if (hits++ >= offset && !push({ path, relative: relative(root, path) })) return
        } else if (!binary.has(extname(entry.name).toLowerCase())) {
          try {
            const data = await bytes(path, 1024 * 1024, signal)
            readBytes += data.length
            const text = textOf(data)
            const lines = text.split(/\r?\n/)
            for (let index = 0; index < lines.length; index++) {
              const position = (args.caseSensitive ? lines[index] : lines[index].toLowerCase()).indexOf(needle)
              if (position < 0) continue
              if (hits++ >= offset && !push({ path, line: index + 1, text: lines[index].slice(Math.max(0, position - 60), position + query.length + 120) })) break
            }
          } catch (error) { signal.throwIfAborted(); skipped++ }
        }
      }
      if (visited > 4000 || pageFull || readBytes > 16 * 1024 * 1024 || Date.now() - started > 5000) { stopped = true; return }
    }
  }
  await walk(root, 0)
  return JSON.stringify({ directory: root, results: found, visited, skipped, limited: stopped, nextOffset: pageFull ? offset + found.length : undefined,
    note: stopped ? '结果或扫描达到上限；可按 nextOffset 续查，或缩小目录/文件名条件。' : undefined })
}

export async function executeFileTool(name: string, args: Record<string, unknown>, path: string, signal: AbortSignal): Promise<string> {
  if (name === 'read_file') return readTextPage(path, args, signal)
  if (name === 'read_document') return readDocumentPage(path, args, signal)
  if (name === 'find_files' || name === 'search_files') return searchLocalFiles(path, args, name === 'search_files', signal)
  throw new Error('未知文件读取工具。')
}
