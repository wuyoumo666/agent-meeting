import { nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AgentMsg } from './openai'

export interface VisualResult {
  summary: string
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }>
}

export const VISUAL_TOOLS = [
  { name: 'view_image', description: '实际查看一张本地图片，返回图像画面。用于检查截图、图表和渲染页；不是读取图片文件的文字。' },
  { name: 'view_pdf', description: '实际查看本地 PDF 的指定页，返回该页画面和总页数。page 从 1 开始，每次一页；仅查看过的页可称已完成视觉检查。' }
] as const

export function visualMessage(result: VisualResult): AgentMsg {
  return {
    role: 'user',
    content: result.content.map((item) => item.type === 'text' ? item
      : { type: 'image_url', image_url: { url: `data:${item.mimeType};base64,${item.data}` } })
  }
}

export function imageInputError(error: unknown): string | undefined {
  const text = error instanceof Error ? error.message : String(error)
  return /API HTTP (400|415|422):[^\n]*(image|vision|multimodal|图片|多模态)/i.test(text)
    ? '当前模型服务不接受图片输入，视觉检查未完成。请换用支持图像输入的模型或服务。'
    : undefined
}

/** The caller resolves the path through its normal file permissions first. */
export async function viewVisualFile(path: string, tool: string, page: unknown, signal: AbortSignal): Promise<VisualResult> {
  signal.throwIfAborted()
  const file = await open(path, 'r')
  let data: Buffer
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink > 1 || info.size > 20 * 1024 * 1024) throw new Error('视觉工具只支持不超过 20 MB 的普通文件。')
    data = await file.readFile({ signal })
    if (data.length > 20 * 1024 * 1024) throw new Error('文件过大。')
  } finally { await file.close() }
  signal.throwIfAborted()
  const hash = createHash('sha256').update(data).digest('hex')
  let image: Buffer
  let caption = basename(path)
  if (tool === 'view_pdf') {
    const number = page === undefined ? 1 : page
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) throw new Error('page 必须是从 1 开始的整数页码。')
    if (data.subarray(0, 5).toString() !== '%PDF-') throw new Error('文件不是有效的 PDF。')
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data })
    const cancel = (): void => { void parser.destroy().catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const info = await parser.getInfo()
      signal.throwIfAborted()
      if (number > info.total) throw new Error(`PDF 共 ${info.total} 页，没有第 ${number} 页。`)
      const result = await parser.getScreenshot({ partial: [number], desiredWidth: 1600, imageDataUrl: false, imageBuffer: true })
      signal.throwIfAborted()
      if (!result.pages[0]?.data?.length) throw new Error('未能渲染这一页。')
      image = Buffer.from(result.pages[0].data)
      caption += ` · 第 ${number}/${info.total} 页`
    } finally {
      signal.removeEventListener('abort', cancel)
      await parser.destroy().catch(() => {})
    }
  } else {
    const decoded = nativeImage.createFromBuffer(data)
    if (decoded.isEmpty()) throw new Error('无法解码图片，请提供 PNG、JPEG 或 WebP 等受支持的图片。')
    const size = decoded.getSize()
    image = Math.max(size.width, size.height) > 2200
      ? decoded.resize(size.width >= size.height ? { width: 2200 } : { height: 2200 }).toPNG()
      : decoded.toPNG()
  }
  signal.throwIfAborted()
  if (image.length > 8 * 1024 * 1024) throw new Error('图片输出过大，请裁剪或降低分辨率后再查看。')
  const summary = `已返回图像画面：${caption}\n源文件 SHA256：${hash}\n以下是工具取得的实际画面，仅代表本张图片或本页已返回，需根据画面判断内容。`
  return { summary, content: [{ type: 'text', text: summary }, { type: 'image', data: image.toString('base64'), mimeType: 'image/png' }] }
}
