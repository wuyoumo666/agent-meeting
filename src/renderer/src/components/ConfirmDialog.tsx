import { useEffect, useRef, useState } from 'react'

export interface Confirmation {
  message: string
  label: string
  action: () => Promise<void>
}

export default function ConfirmDialog({ confirmation, onClose }: {
  confirmation: Confirmation
  onClose: () => void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    cancel.current?.focus()
    return () => element.close()
  }, [])

  const accept = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await confirmation.action()
      onClose()
    } catch {
      setError('操作失败，请重试。')
      setBusy(false)
    }
  }

  return (
    <dialog
      className="modal confirm-dialog"
      ref={dialog}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}
    >
      <div className="modal-head"><b id="confirm-title">确认操作</b></div>
      <div className="modal-body">
        <p id="confirm-message">{confirmation.message}</p>
        {error && <p className="composer-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer">
        <button ref={cancel} className="ghost-btn" disabled={busy} onClick={onClose}>取消</button>
        <button className="danger-btn" disabled={busy} onClick={() => void accept()}>{confirmation.label}</button>
      </div>
    </dialog>
  )
}
