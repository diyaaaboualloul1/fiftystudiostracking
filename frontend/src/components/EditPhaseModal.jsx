import { useEffect, useState } from 'react'
import Modal from './Modal'
import { useToast } from '../context/ToastContext'
import { apiPatch } from '../lib/api'
import { PHASE_STATUSES, phaseStatusLabel, parseApiError, toDateInputValue } from '../lib/domain'

/**
 * Allowed status transitions for an Edit of a phase (not create).
 * We exclude "active" and "completed" — those go through dedicated endpoints.
 */
const EDITABLE_STATUSES = PHASE_STATUSES.filter(
  (s) => s.value !== 'active' && s.value !== 'completed',
)

// Statuses that cannot be set via PATCH — they require dedicated endpoints.
const LOCKED_STATUSES = ['active', 'completed']

export default function EditPhaseModal({ open, onClose, phase, projectDeadline, onSaved }) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [status, setStatus] = useState('planned')
  const [waitingReason, setWaitingReason] = useState('')
  const [holdReason, setHoldReason] = useState('')
  const [errs, setErrs] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open && phase) {
      setTitle(phase.title || '')
      setDescription(phase.description || '')
      setDeadline(toDateInputValue(phase.deadline))
      setStatus(phase.status || 'planned')
      setWaitingReason(phase.waiting_reason || '')
      setHoldReason(phase.hold_reason || '')
      setErrs({})
    }
  }, [open, phase])

  async function submit(e) {
    e.preventDefault()
    if (!phase) return
    const err = {}
    if (!title || title.trim().length < 2) err.title = 'Title must be at least 2 characters.'
    if (status === 'waiting_for_client' && !waitingReason.trim()) {
      err.waiting_reason = 'Reason is required when status is "Waiting for client".'
    }
    if (status === 'on_hold' && !holdReason.trim()) {
      err.hold_reason = 'Reason is required when status is "On hold".'
    }
    if (deadline && projectDeadline && deadline > projectDeadline) {
      err.deadline = `Phase deadline cannot be after the project deadline (${projectDeadline}).`
    }
    setErrs(err)
    if (Object.keys(err).length) return

    setSubmitting(true)
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        deadline: deadline || null,
        version: phase.version,
      }
      // Only include status if the phase is in an editable status.
      // 'active' and 'completed' go through dedicated endpoints.
      if (!LOCKED_STATUSES.includes(phase.status)) {
        body.status = status
        body.waiting_reason = status === 'waiting_for_client' ? waitingReason.trim() : null
        body.hold_reason = status === 'on_hold' ? holdReason.trim() : null
      }
      const { phase: updated } = await apiPatch(
        `/phases/${phase.id}`,
        body,
        { headers: { 'If-Match': String(phase.version) } },
      )
      toast.success('Phase updated.')
      onSaved?.(updated)
      onClose?.()
    } catch (e) {
      const { status: code, message, field } = parseApiError(e)
      if (code === 409) {
        toast.error('Phase was modified by someone else. Refreshing…')
        onSaved?.(null, { conflict: true })
        onClose?.()
      } else if (field) {
        setErrs({ [field]: message })
        toast.error(message)
      } else {
        toast.error(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit phase ${phase?.number ?? ''} · ${phase?.title ?? ''}`}
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="edit-phase-form" className="btn btn-primary" disabled={submitting}>
            {submitting && <span className="spinner" />}
            <span>{submitting ? 'Saving…' : 'Save changes'}</span>
          </button>
        </>
      }
    >
      <form id="edit-phase-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="eph-title">Title</label>
          <input
            id="eph-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            autoFocus
          />
          {errs.title && <div className="field-error">{errs.title}</div>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="eph-desc">Description</label>
          <textarea
            id="eph-desc"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="(optional)"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="field-label" htmlFor="eph-deadline">Deadline</label>
            <input
              id="eph-deadline"
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
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="field-label">Status</label>
            {LOCKED_STATUSES.includes(phase?.status) ? (
              <>
                <span className={`status-pill status-${phase.status}`}>
                  {phaseStatusLabel(phase.status)}
                </span>
                <div className="field-hint">
                  {phase.status === 'active'
                    ? 'This phase is active. Use the archive or complete actions on the phase detail page to change it.'
                    : 'This phase is completed and cannot be edited.'}
                </div>
              </>
            ) : (
              <>
                <select
                  id="eph-status"
                  className="select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {EDITABLE_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <div className="field-hint">
                  To activate or complete, use the buttons on the phase detail page.
                </div>
              </>
            )}
          </div>
        </div>

        {status === 'waiting_for_client' && (
          <div className="field">
            <label className="field-label" htmlFor="eph-wr">Waiting reason</label>
            <textarea
              id="eph-wr"
              className="textarea textarea-compact"
              value={waitingReason}
              onChange={(e) => setWaitingReason(e.target.value)}
              placeholder="What are we waiting for from the client?"
              maxLength={500}
              required
            />
            {errs.waiting_reason && <div className="field-error">{errs.waiting_reason}</div>}
          </div>
        )}

        {status === 'on_hold' && (
          <div className="field">
            <label className="field-label" htmlFor="eph-hr">Hold reason</label>
            <textarea
              id="eph-hr"
              className="textarea textarea-compact"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              placeholder="Why is this phase on hold?"
              maxLength={500}
              required
            />
            {errs.hold_reason && <div className="field-error">{errs.hold_reason}</div>}
          </div>
        )}
      </form>
    </Modal>
  )
}
