import { createHash, randomBytes, randomInt } from 'node:crypto'
import { nativeImage } from 'electron'
import type { ModelCapabilities, Provider } from '../shared/types'
import { chatOnce } from './adapters/openai'
import { imageInputError } from './adapters/visual'
import { workFailure } from './workEvidence'
import { abortable } from './abortable'

export const CAPABILITY_TOOL = { type: 'function' as const, function: {
  name: 'check_capabilities', description: '查看本群成员实际能力检测记录。无 agent 时只读汇总；传成员名字时检测其 API 工具调用和视觉能力（缓存24小时，失败短暂缓存）。检测仅用合成图片和回声工具，不读写用户文件。本地工具需按实际回执核验，不冒称已通过测试。',
  parameters: { type: 'object', properties: { agent: { type: 'string' } } }
} }
export function capabilityFingerprint(provider: Provider, model: string): string {
  return createHash('sha256').update(JSON.stringify([provider.baseUrl.replace(/\/+$/,''), model, provider.apiKey ?? ''])).digest('hex')
}
export function unknownCapabilities(fingerprint: string): ModelCapabilities {
  return { fingerprint, checkedAt: 0, tools: 'unknown', vision: 'unknown', toolDetail: '尚未检测模型的工具调用。', visionDetail: '尚未检测图片理解，不能仅凭模型名判断。' }
}
export class CapabilityChecks {
  private pending = new Map<string, Promise<ModelCapabilities>>()
  constructor(private read: (key: string) => ModelCapabilities | undefined, private save: (record: ModelCapabilities) => void) {}
  peek(provider: Provider, model: string): ModelCapabilities {
    const key = capabilityFingerprint(provider, model)
    const record = this.read(key)
    if (!record) return unknownCapabilities(key)
    const ttl = ['failed','unknown'].includes(record.tools) || ['failed','unknown'].includes(record.vision) ? 5 * 60_000 : 24 * 60 * 60_000
    return Date.now() - record.checkedAt < ttl ? record : unknownCapabilities(key)
  }
  async check(provider: Provider, model: string, signal: AbortSignal): Promise<ModelCapabilities> {
    signal.throwIfAborted()
    const cached = this.peek(provider, model)
    if (cached.checkedAt) return cached
    const key = cached.fingerprint, running = this.pending.get(key)
    if (running) return abortable(running, signal)
    const run = this.probe(provider, model, signal, cached).finally(() => this.pending.delete(key))
    this.pending.set(key, run)
    return run
  }
  private async probe(provider: Provider, model: string, signal: AbortSignal, result: ModelCapabilities): Promise<ModelCapabilities> {
    const token = randomBytes(6).toString('hex')
    try {
      const response = await chatOnce(provider, model, [{ role: 'user', content: `这是无副作用的工具连接测试。请调用 capability_echo，token 参数必须是 ${token}，不要用文字代替调用。` }], [{ type: 'function', function: {
        name: 'capability_echo', description: '返回测试字符串，不访问文件或网络。', parameters: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] }
      } }], AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
      const call = response.toolCalls.find((call) => call.function.name === 'capability_echo')
      let valid = false
      try { valid = !!call && JSON.parse(call.function.arguments).token === token } catch { /* Not a valid call. */ }
      result.tools = valid ? 'supported' : 'unknown'
      result.toolDetail = valid ? '实际收到正确的测试工具调用。' : '模型未按测试要求调用工具，本次未确认；不能据此宣称完全不支持。'
    } catch (error) {
      signal.throwIfAborted()
      result.tools = /API HTTP (400|415|422).*tools?.*(not support|unsupported|不支持)/i.test(String(error)) ? 'unsupported' : 'failed'
      result.toolDetail = workFailure(error).reason
    }
    try {
      const side = 144, selected = randomInt(9), data = Buffer.alloc(side * side * 4, 255)
      for (let y=0;y<side;y++) for(let x=0;x<side;x++) {
        const row=Math.floor(y/48), col=Math.floor(x/48), index=(y*side+x)*4
        if (x%48<4 || y%48<4 || x%48>43 || y%48>43) continue
        const red=row*3+col===selected
        data[index]=red?35:220; data[index+1]=red?35:110; data[index+2]=red?230:40; data[index+3]=255
      }
      const png=nativeImage.createFromBitmap(data,{width:side,height:side}).toPNG()
      const response = await chatOnce(provider, model, [{ role:'user', content:[
        {type:'text',text:'图片是3×3方格，只有一个红色格子，其余为蓝色。从左到右、从上到下编号1到9。只输出JSON：{"redCell":红格编号}。看不到图片则输出{"redCell":0}。'},
        {type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}}
      ] }], undefined, AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
      let valid=false
      try { valid=JSON.parse(response.content.match(/\{[^}]*\}/)?.[0] ?? '{}').redCell === selected+1 } catch { /* Keep unknown. */ }
      result.vision=valid?'supported':'unknown'
      result.visionDetail=valid?'正确识别合成图片中的随机红色方格。':'服务接受了图片，但本次识图测试未答对，视觉能力仍待确认。'
    } catch(error) {
      signal.throwIfAborted()
      result.vision=imageInputError(error)?'unsupported':'failed'
      result.visionDetail=imageInputError(error) ?? workFailure(error).reason
    }
    signal.throwIfAborted()
    result.checkedAt=Date.now()
    this.save(result)
    return result
  }
}
