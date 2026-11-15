/** 把工具调用翻译成人话，给看不懂代码的用户看 */
export function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const a = input ?? {}
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = a[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  const n = (name || '').toLowerCase()
  const target = pick('file_path', 'path', 'file', 'target', 'dir', 'directory', 'pattern', 'query', 'url', 'command', 'cmd', 'description', 'prompt')
  const short = target.length > 80 ? target.slice(0, 80) + '…' : target
  const withTarget = (label: string): string => (short ? `${label}：${short}` : label)
  if (n === 'view_pdf') return withTarget(`正在查看 PDF 第 ${typeof a.page === 'number' ? a.page : 1} 页`)
  if (n === 'read_document') return withTarget('正在读取文档正文')
  if (n === 'inspect_file') return withTarget('正在核对交付文件')
  if (n === 'deliver_files') return '正在保存交付副本'
  if (n === 'find_files') return withTarget('正在查找文件')
  if (n === 'search_files') return withTarget('正在搜索文件内容')
  if (n === 'web_search') return withTarget('正在搜索网页')
  if (n === 'check_capabilities') return '正在核对成员能力'

  if (n === 'search_literature') return withTarget('正在检索 Crossref 文献')
  if (n === 'start_work' || n === 'delegate') return withTarget('正在安排任务')
  if (n === 'memory_save') return '正在记入长期记忆'
  if (n === 'memory_search' || n === 'search_history') return withTarget('正在查历史记忆')
  if (n.includes('download')) return withTarget('正在下载文件')
  if (n === 'run_command' || n.includes('bash') || n.includes('shell') || n.includes('power') || n.includes('command') || n.includes('exec')) {
    return withTarget('正在运行命令')
  }
  if (n.includes('write') || n.includes('create') || n.includes('save')) return withTarget('正在写入文件')
  if (n.includes('edit') || n.includes('patch') || n.includes('replace') || n.includes('apply') || n.includes('multi')) return withTarget('正在修改文件')
  if (n.includes('image') || n.includes('photo') || n.includes('screenshot')) return '正在查看图片'
  if (n.includes('read') || n.includes('view') || n.includes('open') || n.includes('cat')) return withTarget('正在读取')
  if (n.includes('list') || n === 'ls' || n.includes('glob') || n.includes('dir')) return withTarget('正在查看目录')
  if (n.includes('grep') || n.includes('search') || n.includes('find')) return withTarget('正在搜索代码')
  if (n.includes('recall') || n.includes('memory')) return withTarget('正在向主持人查前情')
  if (n.includes('web') || n.includes('fetch') || n.includes('http')) return withTarget('正在联网读取')
  if (n.includes('test')) return withTarget('正在跑测试')
  return withTarget(`正在使用 ${name}`)
}
