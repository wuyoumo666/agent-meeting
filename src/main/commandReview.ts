import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, isAbsolute, resolve } from 'node:path'
import { resolveWorkspacePath } from './workspacePath'
import type { ToolDef } from './adapters/openai'

export interface CommandInspection {
  directory: string
  preview: string
  inspect: (name: string, args: Record<string, unknown>) => string
  assertUnchanged: () => void
}

function readInspectedFile(path: string): Buffer {
  const before = lstatSync(path)
  if (!before.isFile() || before.nlink > 1 || before.size > 1024 * 1024) {
    throw new Error('只读核对限于 1 MB 以内、无其他硬链接的普通文本文件。')
  }
  const file = openSync(path, 'r')
  try {
    const info = fstatSync(file)
    if (!info.isFile() || info.nlink > 1 || info.size > 1024 * 1024 ||
        info.dev !== before.dev || info.ino !== before.ino) {
      throw new Error('文件正在变化，请重新核对。')
    }
    const data = Buffer.alloc(info.size + 1)
    let size = 0
    while (size < data.length) {
      const count = readSync(file, data, size, data.length - size, null)
      if (!count) break
      size += count
    }
    if (size !== info.size || fstatSync(file).mtimeMs !== info.mtimeMs) throw new Error('文件正在变化，请重新核对。')
    return data.subarray(0, size)
  } finally { closeSync(file) }
}

const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

export const REVIEW_TOOLS: ToolDef[] = [
  { type: 'function', function: { name: 'read_file', description: '只读核对本任务目录内的脚本或配置。返回行号、总行数、校验值；长文件用 startLine 继续读。路径默认相对于命令执行目录，也可用绝对路径。', parameters: { type: 'object', properties: {
    path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, maxLines: { type: 'integer', minimum: 1, maximum: 400 }
  }, required: ['path'] } } },
  { type: 'function', function: { name: 'list_dir', description: '只读列出任务目录，确认脚本和配置位置。不会执行任何程序。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }
]

/** Inspect commands as data. Never evaluate shell substitutions or run reviewed code. */
export function commandInspection(command: string, directory: string, approvedRoots: string[]): CommandInspection {
  const roots = [...new Set([directory, ...approvedRoots].filter(Boolean))]
  const snapshots = new Map<string, string | null>()
  let changedDuringReview = false
  const remember = (path: string, hash: string | null): void => {
    if (snapshots.has(path) && snapshots.get(path) !== hash) {
      changedDuringReview = true
      throw new Error('文件在本次审查期间发生变化，请重新核对。')
    }
    snapshots.set(path, hash)
  }
  const checkPath = (input: string, cwd: string): string => {
    const path = isAbsolute(input) ? input : resolve(cwd, input)
    for (const root of roots) {
      try { return resolveWorkspacePath(root, path) } catch { /* Try another configured task root. */ }
    }
    throw new Error('只能核对已配置的共享目录和当前成员工作目录，不跟随目录联接。')
  }
  let cwd = directory
  const scripts: string[] = []
  // This only finds literal references. Variables and shell expressions stay unresolved.
  const segments = command.match(/(?:"[^"]*"|'[^']*'|[^&|;"'])+/g) ?? []
  for (const segment of segments) {
    const tokens = (segment.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((value) => value.replace(/^(["'])([\s\S]*)\1$/, '$2'))
    const head = tokens[0]?.replace(/^@/, '').toLowerCase()
    if (head === 'cd' || head === 'chdir' || head === 'set-location') {
      const input = tokens.slice(1).filter((value) => !/^(\/d|-literalpath|-path)$/i.test(value))[0]
      if (input && !/[%$`*?]/.test(input)) {
        try { cwd = checkPath(input, cwd) } catch { /* Do not grant access based on command text. */ }
      }
      continue
    }
    // Inspect only directly invoked scripts, not strings inside python -c / node -e.
    const executable = basename(head ?? '').replace(/\.exe$/, '')
    const interpreter = /^(python(?:[\d.]+)?|py|node|pwsh|powershell|cmd|bash|sh)$/.test(executable)
    const inline = interpreter && tokens.some((value) => /^(?:-c|-e|--eval|-command|-encodedcommand|-enc)$/i.test(value))
    if (inline) continue
    const candidates = interpreter ? tokens.slice(1) : tokens.slice(0, 1)
    const script = candidates.find((value) => /\.(?:py|[cm]?js|ps1|bat|cmd|sh)$/i.test(value) && !/[%$`*?<>]/.test(value))
    if (script) {
      try { scripts.push(checkPath(script, cwd)) } catch { /* Reviewer sees the original command and can request missing facts. */ }
    }
    if (['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd'].includes(executable)) {
      try { scripts.push(checkPath('package.json', cwd)) } catch { /* No inferred access. */ }
    }
  }
  const inspect = (name: string, args: Record<string, unknown>): string => {
    if (!['read_file', 'list_dir'].includes(name)) throw new Error('审查只能读取文件或列出目录，不能执行或修改。')
    const path = checkPath(typeof args.path === 'string' ? args.path : '.', cwd)
    if (name === 'list_dir') {
      const entries = readdirSync(path, { withFileTypes: true })
      return JSON.stringify({ directory: path, entries: entries.slice(0, 150).map((entry) => ({ name: entry.name, directory: entry.isDirectory() })), truncated: entries.length > 150 })
    }
    let bytes: Buffer
    try { bytes = readInspectedFile(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') remember(path, null)
      throw error
    }
    const sha256 = digest(bytes)
    remember(path, sha256)
    const utf16 = bytes[0] === 255 && bytes[1] === 254
    const text = (utf16 ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8')).replace(/^\uFEFF/, '')
    if (text.includes('\0')) throw new Error('这是二进制文件，不能作为脚本读取。')
    const lines = text.split(/\r?\n/)
    const start = args.startLine === undefined ? 1 : Number(args.startLine)
    const count = args.maxLines === undefined ? 200 : Number(args.maxLines)
    if (!Number.isInteger(start) || start < 1 || start > lines.length || !Number.isInteger(count) || count < 1 || count > 400) throw new Error('startLine 须在文件行号范围内，maxLines 须为 1–400。')
    let end = start - 1
    let content = ''
    while (end < lines.length && end < start - 1 + count) {
      const line = `${end + 1}: ${lines[end]}\n`
      if (content.length + line.length > 20000) break
      content += line
      end++
    }
    if (!content) throw new Error(`第 ${start} 行超过单次 20000 字符限制；该行尚未核对，不能声称已读取全文。`)
    return JSON.stringify({ path, sha256, totalLines: lines.length, startLine: start, endLine: end, complete: start === 1 && end === lines.length, nextLine: end < lines.length ? end + 1 : undefined, content })
  }
  const previews = [...new Set(scripts)].slice(0, 2).map((path) => {
    try { return inspect('read_file', { path, maxLines: 100 }) }
    catch (error) { return JSON.stringify({ path, error: error instanceof Error ? error.message : String(error) }) }
  })
  const assertUnchanged = (): void => {
    if (changedDuringReview) throw new Error('文件在审查期间发生变化，请重新提交命令审查。')
    for (const [path, hash] of snapshots) {
      try {
        const file = checkPath(path, cwd)
        if (hash === null ? !lstatSync(file, { throwIfNoEntry: false }) : digest(readInspectedFile(file)) === hash) continue
      } catch { /* A file which cannot be rechecked invalidates its approval. */ }
      throw new Error(`已核对的文件发生变化：${basename(path)}。请重新提交命令审查。`)
    }
  }
  return { directory: cwd, inspect, assertUnchanged, preview: previews.join('\n').slice(0, 44000) }
}
