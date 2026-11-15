/** 明确给出的检索词由软件直接提交给 Crossref。 */
export function directLiteratureQuery(task: string): { query: string; fromYear?: number } | undefined {
  const firstLine = task.split('\n', 1)[0].trim()
  const command = /^(?:查文献|搜文献|检索文献)[：:]\s*(.*)$/u.exec(firstLine)
  if (!command) return undefined
  const year = /(?:^|[\s，,])((?:19|20)\d{2})\s*年?\s*(及以后|以后|以来|起|及之后|之后)\s*$/u.exec(command[1])
  const query = (year ? command[1].slice(0, year.index) : command[1]).trim()
  const fromYear = year ? Number(year[1]) + (year[2] === '之后' ? 1 : 0) : undefined
  return { query, fromYear }
}

export function workIntent(task: string): 'literature' | 'connection' | undefined {
  const instruction = task.trim().replace(/^(?:[：:，,\s]|请|麻烦|能不能|可以|你|帮我|去|先|再|继续|联网|上网|实际)+/u, '')
  if (/^(?:测试|检查|试试)(?:一下)?(?:能不能|是否能?|可不可以|可以)?(?:联网|上网|访问外网)/u.test(instruction) &&
      !/https?:\/\//i.test(task.split('\n', 1)[0])) return 'connection'

  if (/^(?:搜索|检索|查找|查一?下|搜|找)[^\n。！？?]{0,60}(?:综述|文献|论文)/u.test(instruction) &&
      !/(?:了吗|过吗|是什么意思|(?:怎么|如何|用什么|要不要|有没有必要).*)[。！!？?\s]*$/u.test(instruction)) {
    return 'literature'
  }
  return undefined
}
