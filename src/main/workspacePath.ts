import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** 把相对路径限制在工作目录内，防越界 */
export function resolveWorkspacePath(workDir: string, p: string): string {
  const base = realpathSync(workDir)
  const abs = resolve(base, p || '.')
  const rel = relative(base, abs)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error('路径越界：只允许在工作目录内操作')
  }
  let current = base
  for (const part of rel ? rel.split(sep) : []) {
    if (process.platform === 'win32' && (/[:. ]$|:/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
      throw new Error('路径包含 Windows 保留名称或字符')
    }
    current = resolve(current, part)
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error('工作区文件工具不能跟随符号链接或目录联接')
    }
  }
  return abs
}
