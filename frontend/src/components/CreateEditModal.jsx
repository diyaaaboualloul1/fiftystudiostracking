import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { useToast } from '../context/ToastContext'
import { apiPost } from '../lib/api'
import { EDIT_STATUSES, parseApiError } from '../lib/domain'

export default function CreateEditModal({ open, onClose, phaseId, members = [], onCreated, defaultStatus = 'to_do' }) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [status, setStatus] = useState(defaultStatus)
  const [waitingReason, setWaitingReason] = useState('')
  const [cancellationReason, setCancellationReason] = useState('')
  const [errs, setErrs] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setAssigneeId('')
      setStatus(defaultStatus)
      setWaitingReason('')
      setCancellationReason('')
      setErrs({})
    }
  }, [open, defaultStatus])

  const memberOpts = useMemo(() => members || [], [members])

  async function submit(e) {
    e.preventDefault()
    if (!phaseId) return
    const err = {}
    if (!title || title.trim().length < 2) err.title = 'Title must be at least 2 characters.'
    if (status === 'waiting_for_client' && !waitingReason.trim()) {
      err.waiting_reason = 'Reason is required when status is "Waiting for client".'
    }
    if (status === 'cancelled' && !cancellationReason.trim()) {
      err.cancellation_reason = 'Reason is required when status is "Cancelled".'
    }
    setErrs(err)
    if (Object.keys(err).length) return

    setSubmitting(true)
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        assignee_id: assigneeId ? Number(assigneeId) : undefined,
        status,
        waiting_reason: status === 'waiting_for_client' ? waitingReason.trim() : undefined,
        cancellation_reason: status === 'cancelled' ? cancellationReason.trim() : undefined,
      }
      const { edit } = await apiPost(`/phases/${phaseId}/edits`, body)
      toast.success('Edit created.')
      onCreated?.(edit)
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
    <Modal
      open={open}
      onClose={onClose}
      title="New edit"
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="create-edit-form" className="btn btn-primary" disabled={submitting}>
            {submitting && <span className="spinner" />}
            <span>{submitting ? 'Creating…' : 'Create edit'}</span>
          </button>
        </>
      }
    >
      <form id="create-edit-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="ce-title">Title</label>
          <input
            id="ce-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add hero banner"
            required
            maxLength={200}
            autoFocus
          />
          {errs.title && <div className="field-error">{errs.title}</div>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ce-desc">Description</label>
          <textarea
            id="ce-desc"
            className="textarea textarea-compact"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="(optional)"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="field-label" htmlFor="ce-assignee">Assignee</label>
            <select
              id="ce-assignee"
              className="select"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {memberOpts.map((m) => {
                // Backend returns members as flat rows from a JOIN with users:
                // { id, name, email, role, ... }. Older code expected
                // { user_id, user: { name } }. Support both.
                const id = m.user_id ?? m.id
                const name = m.user?.name ?? m.name ?? `User #${id}`
                const role = m.user?.role ?? m.role
                const label = role && role !== 'worker' ? `${name} (${role})` : name
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                )
              })}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ce-status">Status</label>
          <select
            id="ce-status"
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {EDIT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {status === 'waiting_for_client' && (
          <div className="field">
            <label className="field-label" htmlFor="ce-wr">Waiting reason</label>
            <textarea
              id="ce-wr"
              className="textarea textarea-compact"
              value={waitingReason}
              onChange={(e) => setWaitingReason(e.target.value)}
              maxLength={500}
              required
            />
            {errs.waiting_reason && <div className="field-error">{errs.waiting_reason}</div>}
          </div>
        )}

        {status === 'cancelled' && (
          <div className="field">
            <label className="field-label" htmlFor="ce-cr">Cancellation reason</label>
            <textarea
              id="ce-cr"
              className="textarea textarea-compact"
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              maxLength={500}
              required
            />
            {errs.cancellation_reason && <div className="field-error">{errs.cancellation_reason}</div>}
          </div>
        )}
      </form>
    </Modal>
  )
}
