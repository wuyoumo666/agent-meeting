/** Cancel a queue wait without releasing the lock of the work ahead of it. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const stop = (): void => reject(signal.reason ?? new Error('已停止'))
    signal.addEventListener('abort', stop, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
  })
}
