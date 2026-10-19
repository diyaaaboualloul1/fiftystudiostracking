import { useEffect, useState } from 'react'
import Modal from './Modal'
import { useToast } from '../context/ToastContext'
import { apiPost } from '../lib/api'
import { parseApiError } from '../lib/domain'

export default function CreatePhaseModal({ open, onClose, projectId, nextNumber, activePhaseNumber, projectDeadline, onCreated }) {
  const toast = useToast()
  const [number, setNumber] = useState(1)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [activateNow, setActivateNow] = useState(false)
  const [confirmSwap, setConfirmSwap] = useState(false)
  const [errs, setErrs] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setNumber(nextNumber || 1)
      setTitle('')
      setDescription('')
      setDeadline('')
      setActivateNow(false)
      setConfirmSwap(false)
      setErrs({})
    }
  }, [open, nextNumber])

  function handleCheckActivate(checked) {
    if (checked && activePhaseNumber && activePhaseNumber !== number) {
      // Need to confirm the swap with the user
      setConfirmSwap(true)
      return
    }
    setActivateNow(checked)
  }

  function confirmSwapYes() {
    setActivateNow(true)
    setConfirmSwap(false)
  }

  function confirmSwapNo() {
    setActivateNow(false)
    setConfirmSwap(false)
  }

  async function submit(e) {
    e.preventDefault()
    if (!projectId) return
    const err = {}
    if (!title || title.trim().length < 2) err.title = 'Title must be at least 2 characters.'
    if (!number || Number(number) < 1) err.number = 'Number must be ≥ 1.'
    if (deadline && projectDeadline && deadline > projectDeadline) {
      err.deadline = `Phase deadline cannot be after the project deadline (${projectDeadline}).`
    }
    setErrs(err)
    if (Object.keys(err).length) return

    setSubmitting(true)
    try {
      const body = {
        number: Number(number),
        title: title.trim(),
        description: description.trim() || undefined,
        deadline: deadline || undefined,
        activate_now: activateNow,
      }
      const { phase } = await apiPost(`/projects/${projectId}/phases`, body)
      toast.success(`Phase ${phase.number} created.`)
      onCreated?.(phase)
      onClose?.()
    } catch (e) {
      const { message, field } = parseApiError(e)
      if (field) setErrs({ [field]: message })
      else toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Add phase"
        maxWidth={520}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" form="create-phase-form" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              <span>{submitting ? 'Creating…' : 'Create phase'}</span>
            </button>
          </>
        }
      >
        <form id="create-phase-form" onSubmit={submit} noValidate>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div className="field" style={{ marginBottom: 16 }}>
              <label className="field-label" htmlFor="cph-num">Number</label>
              <div
                className="phase-number-chip"
                aria-label={`Next phase number is ${number}`}
                title="Auto-incremented from the last phase"
              >
                <span className="phase-number-chip-dot" />
                <span className="phase-number-chip-num">{number}</span>
                <span className="phase-number-chip-label">next</span>
              </div>
              <input type="hidden" value={number} />
            </div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label className="field-label" htmlFor="cph-title">Title</label>
              <input
                id="cph-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Initial build"
                required
                maxLength={200}
                autoFocus
              />
              {errs.title && <div className="field-error">{errs.title}</div>}
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cph-desc">Description</label>
            <textarea
              id="cph-desc"
              className="textarea textarea-compact"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this phase covers."
              maxLength={2000}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cph-deadline">Deadline</label>
            <input
              id="cph-deadline"
              type="date"
              className="input"
              value={deadline}
              max={projectDeadline || undefined}
              onChange={(e) => setDeadline(e.target.value)}
            />
            {projectDeadline && (
              <div className="field-hint">
                Must be on or before the project deadline: <strong>{projectDeadline}</strong>
              </div>
            )}
            {errs.deadline && <div className="field-error">{errs.deadline}</div>}
          </div>

          <div className="field">
            <label className="toggle" style={{ paddingLeft: 0 }}>
              <input
                type="checkbox"
                checked={activateNow}
                onChange={(e) => handleCheckActivate(e.target.checked)}
              />
              <span>Activate this phase immediately</span>
            </label>
            <div className="field-hint">
              {activePhaseNumber && activePhaseNumber !== number
                ? `Phase ${activePhaseNumber} is currently active. Activating this new phase will archive Phase ${activePhaseNumber}.`
                : 'Only one phase can be active per project.'}
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmSwap}
        onClose={confirmSwapNo}
        title="Swap active phase?"
        maxWidth={440}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={confirmSwapNo} disabled={submitting}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmSwapYes} disabled={submitting}>
              Yes, swap
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--text)' }}>
          Phase <strong>{activePhaseNumber}</strong> is currently active. Activating Phase <strong>{number}</strong> will archive Phase <strong>{activePhaseNumber}</strong>. You can restore it later from the archive.
        </p>
      </Modal>
    </>
  )
}
