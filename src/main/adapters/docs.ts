import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

/** 从文档提取纯文本（.doc/.docx/.pdf），失败返回 undefined */
export async function extractDocText(path: string): Promise<string | undefined> {
  const ext = extname(path).toLowerCase()
  try {
    if (ext === '.doc' || ext === '.docx') {
      const { default: WordExtractor } = await import('word-extractor')
      const ex = new WordExtractor()
      const doc = await ex.extract(path)
      const body = (doc.getBody() || '').trim()
      return body || undefined
    }
    if (ext === '.pdf') {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: await readFile(path) })
      try {
        const result = await parser.getText()
        return result.text.trim() || undefined
      } finally {
        await parser.destroy()
      }
    }
  } catch {
    return undefined
  }
  return undefined
}
