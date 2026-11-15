import type { WorkSource } from '../shared/types'

export function webSearchSources(result: string): WorkSource[] {
  try {
    const data = JSON.parse(result) as { results?: Array<{ title?: unknown; url?: unknown }> }
    return (data.results ?? []).flatMap((item) => {
      const source = accessedPage(item.url)
      return source ? [{ ...source, title: typeof item.title === 'string' ? item.title.slice(0,300) : source.title, kind: 'search' as const }] : []
    })
  } catch { return [] }
}

/** Source labels originate in actual tool responses, never in the model's prose. */
export function literatureSources(result: string): WorkSource[] {
  return result.split('\n').flatMap((line) => {
    const match = /^- (.*?) \| (https:\/\/doi\.org\/\S+)$/u.exec(line)
    return match ? [{ title: match[1].split(' | ')[0].slice(0, 300), url: match[2], kind: 'bibliography' as const }] : []
  })
}

export function accessedPage(url: unknown): WorkSource | undefined {
  if (typeof url !== 'string' || url.length > 2000) return undefined
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined
    // Avoid surfacing query parameters that may contain credentials.
    for (const key of parsed.searchParams.keys()) {
      if (/token|key|secret|signature|auth|password|session/i.test(key)) return undefined
    }
    return { title: parsed.hostname + (parsed.pathname === '/' ? '' : parsed.pathname.slice(0, 120)), url: parsed.href, kind: 'page' }
  } catch { return undefined }
}

export function workFailure(error: unknown): { reason: string; transient: boolean } {
  const message = error instanceof Error ? error.message : String(error)
  const status = /(?:HTTP\s+|(?:^|\s)\()([45]\d{2})\b/i.exec(message)?.[1]
  if (/模型服务本次请求超过 2 分钟没有完成/.test(message)) {
    return { reason: '模型服务在 2 分钟内未返回完整回复。', transient: true }
  }
  if (/insufficient[ _-](?:account[ _-])?(?:balance|credits?)|credit balance.*(?:low|empty|insufficient)|余额不足/i.test(message)) {
    return { reason: '模型服务账户余额不足，请充值或更换模型服务。', transient: false }
  }
  if (/insufficient_quota|billing_hard_limit_reached|额度(?:不足|用尽)/i.test(message)) {
    return { reason: '模型服务额度已用尽，请检查账户额度或更换模型服务。', transient: false }
  }
  if (status === '429' || /rate.?limit|限流/i.test(message)) return { reason: '服务请求太多，暂时限流。', transient: true }
  if (status === '401') return { reason: '服务认证失败（HTTP 401），请在对应模型服务设置中检查密钥。', transient: false }
  if (status === '403') return { reason: '服务拒绝了请求（HTTP 403），请检查模型权限或服务账户状态。', transient: false }
  if (/工具.*(?:授权|批准|权限)|permission|approval/i.test(message)) return { reason: '工具权限未通过，请查看任务记录。', transient: false }
  if (status === '408' || /超时|timeout|没有响应|超过 .{1,20}没有完成|ETIMEDOUT/i.test(message)) return { reason: '等待服务或工具返回超时。', transient: true }
  if (status && Number(status) >= 500 || /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|fetch failed|无输出|没有返回答复/i.test(message)) {
    return { reason: '服务连接异常或没有返回结果。', transient: true }
  }
  return { reason: message.split('\n')[0].replace(/Bearer\s+\S+|sk-[\w-]+/gi, '[已隐藏]').slice(0, 200), transient: false }
}
