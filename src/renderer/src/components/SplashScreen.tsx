import { useEffect, useMemo, useState } from 'react'

const SPLASH_IMAGES = Object.entries(
  import.meta.glob<string>('../assets/splash/*.{gif,webp,apng,png}', { eager: true, import: 'default' })
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)

const STORAGE_KEY = 'splash:last-index'
const MIN_SHOW_MS = 1600
const FADE_MS = 340

function pickRotatedIndex(total: number): number {
  if (total <= 1) return 0
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const prev = raw === null ? 0 : Number.parseInt(raw, 10)
    if (!Number.isFinite(prev) || prev < 0) return total > 1 ? 1 : 0
    return (prev + 1) % total
  } catch {
    return 0
  }
}

interface Props {
  ready: boolean
  error?: string
  onRetry?: () => void
}

export default function SplashScreen({ ready, error, onRetry }: Props): React.JSX.Element | null {
  const [minElapsed, setMinElapsed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [done, setDone] = useState(false)

  const imageIndex = useMemo(() => pickRotatedIndex(SPLASH_IMAGES.length), [])
  const imageUrl = SPLASH_IMAGES[imageIndex] ?? ''

  useEffect(() => {
    if (SPLASH_IMAGES.length === 0) return
    try {
      window.localStorage.setItem(STORAGE_KEY, String(imageIndex))
    } catch {
      // ignore storage errors
    }
  }, [imageIndex])

  useEffect(() => {
    const timer = window.setTimeout(() => setMinElapsed(true), MIN_SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!ready || error) return
    if (!minElapsed && !dismissed) return
    setLeaving(true)
    const timer = window.setTimeout(() => setDone(true), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [ready, error, minElapsed, dismissed])

  useEffect(() => {
    if (!ready || done) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDismissed(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, done])

  if (done) return null

  return (
    <div
      className={leaving ? 'splash-screen is-leaving' : 'splash-screen'}
      role="status"
      aria-live="polite"
      aria-label="应用加载中"
    >
      <div className="splash-center">
        {imageUrl ? (
          <div className="splash-art-wrap">
            <img className="splash-art" src={imageUrl} alt="加载动画" draggable={false} />
          </div>
        ) : (
          <span className="brand-mark splash-fallback-mark" aria-hidden="true" />
        )}

        <div className="splash-brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>我的智囊团</strong>
        </div>

        {error ? (
          <div className="splash-error">
            <p>{error}</p>
            {onRetry && (
              <button className="primary-btn" onClick={onRetry}>
                重新连接
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="splash-status">{ready ? '已就绪，正在进入会议室…' : '正在唤醒你的智囊团…'}</p>
            <div className="splash-bar" aria-hidden="true">
              <span className="splash-bar-fill" />
            </div>
            {ready && (
              <button className="ghost-btn splash-skip" onClick={() => setDismissed(true)}>
                跳过
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
