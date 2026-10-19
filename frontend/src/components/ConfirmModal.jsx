import { useEffect, useState } from 'react'
import Modal from './Modal'
import { IconAlertTriangle } from './Icons'

/**
 * Reusable confirm dialog.
 * - title:        Dialog title
 * - body:         React node (rendered in modal body, optional)
 * - danger:       boolean — if true, the confirm button is destructive (red)
 * - confirmLabel: button text (default "Confirm")
 * - cancelLabel:  button text (default "Cancel")
 * - reasonField:  { label, required, placeholder } — adds a textarea that
 *                 must be filled before Confirm is enabled. Returns the value
 *                 via the onConfirm callback.
 * - onConfirm:    async () => void  (caller shows toasts on error)
 * - onClose:      () => void
 */
export default function ConfirmModal({
  open,
  title = 'Are you sure?',
  body,
  danger = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  reasonField,
  onConfirm,
  onClose,
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setBusy(false)
    }
  }, [open])

  async function go() {
    if (reasonField?.required && !reason.trim()) return
    setBusy(true)
    try {
      await onConfirm?.(reason.trim() || undefined)
    } finally {
      setBusy(false)
    }
  }

  const reasonOk = !reasonField?.required || reason.trim().length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={go}
            disabled={busy || !reasonOk}
          >
            {busy && <span className="spinner" />}
            <span>{busy ? 'Working…' : confirmLabel}</span>
          </button>
        </>
      }
    >
      <div className="confirm-body">
        <div className="confirm-icon">
          <IconAlertTriangle size={28} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {body && <p style={{ marginBottom: reasonField ? 14 : 0 }}>{body}</p>}
          {reasonField && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">
                {reasonField.label}
                {reasonField.required && <span style={{ color: 'var(--danger)' }}> *</span>}
              </label>
              <textarea
                className="textarea textarea-compact"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonField.placeholder || 'Why?'}
                maxLength={500}
                autoFocus
              />
              <div className="field-hint">
                Logged to the project activity feed.
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
