import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const IMAGE_LIMIT = 12 * 1024 * 1024

const IMAGE_EXTENSIONS = {
  jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif', bmp: '.bmp'
} as const

export type ImageFormat = keyof typeof IMAGE_EXTENSIONS

export function storeImage(directory: string, format: ImageFormat, data: Buffer): string {
  if (data.length === 0 || data.length > IMAGE_LIMIT) throw new Error('附件图片超出大小限制。')
  const filename = createHash('sha256').update(data).digest('hex') + IMAGE_EXTENSIONS[format]
  const target = join(directory, filename)
  const before = statSync(target, { throwIfNoEntry: false })
  if (before?.isFile() && before.size === data.length && readFileSync(target).equals(data)) return target
  mkdirSync(directory, { recursive: true })
  const temp = join(directory, randomUUID() + '.tmp')
  try {
    writeFileSync(temp, data, { flag: 'wx' })
    renameSync(temp, target)
  } finally {
    try { rmSync(temp, { force: true }) } catch { /* The data may already have been moved. */ }
  }
  return target
}

export function decodeInlineImage(url: string): { format: ImageFormat; data: Buffer } | undefined {
  const header = /^data:image\/(jpeg|png|webp|gif|bmp);base64,/.exec(url)
  if (!header || url.length - header[0].length > Math.ceil(IMAGE_LIMIT / 3) * 4) return undefined
  const encoded = url.slice(header[0].length)
  const data = Buffer.from(encoded, 'base64')
  if (data.length === 0 || data.length > IMAGE_LIMIT || data.toString('base64') !== encoded) return undefined
  return { format: header[1] as ImageFormat, data }
}
