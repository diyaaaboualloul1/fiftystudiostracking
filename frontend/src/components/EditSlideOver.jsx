import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconX, IconEditTask, IconCalendar, IconAlertTriangle, IconChevronRight, IconInfo } from './Icons'
import { editStatusLabel, fmtDeadline, isOverdue } from '../lib/domain'
import StatusInfoModal from './StatusInfoModal'

/* ---------- Slide-over for edit preview ----------
   Simple, read-only preview. Shows the essentials (status, description,
   assignee, deadline) + a breadcrumb. No edit, no notes, no toggle. */
export default function EditSlideOver({ edit, onClose, members, project, phase }) {
  const open = Boolean(edit)
  const [statusHelpOpen, setStatusHelpOpen] = useState(false)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!edit) return null

  const overdue = isOverdue(edit)
  const member = members?.find((m) => (m.user_id ?? m.id) === edit.assignee_id)
  const memberUser = member?.user ?? member
  const assigneeName = memberUser?.name || (edit.assignee_id ? `User #${edit.assignee_id}` : null)
  const assigneeInitial = (memberUser?.name || '?').slice(0, 1).toUpperCase()

  return (
    <div className="slideover-backdrop" onClick={onClose}>
      <aside
        className="slideover-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="slideover-head">
          <div className="slideover-head-icon">
            <IconEditTask size={20} />
          </div>
          <div className="slideover-head-body">
            {project && phase && (
              <div className="slideover-breadcrumb">
                {project.id ? (
                  <Link to={`/projects/${project.id}`} onClick={onClose} className="slideover-breadcrumb-link">
                    {project.name}
                  </Link>
                ) : (
                  <span>{project.name}</span>
                )}
                <IconChevronRight size={11} />
                {phase.id ? (
                  <Link
                    to={`/projects/${project.id}/phases/${phase.id}`}
                    onClick={onClose}
                    className="slideover-breadcrumb-link"
                  >
                    Phase {phase.number}
                  </Link>
                ) : (
                  <span>Phase {phase.number}</span>
                )}
                <IconChevronRight size={11} />
                <span className="slideover-breadcrumb-current">Edit</span>
              </div>
            )}
            <span className="slideover-head-badge">
              <IconEditTask size={9} />
              <span>EDIT</span>
            </span>
            <h2 className="slideover-head-title">{edit.title}</h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="slideover-body">
          <div className="slideover-field">
            <div className="slideover-field-label">Status</div>
            <span className={`status-pill status-${edit.status}`}>
              {editStatusLabel(edit.status)}
            </span>
            <button
              type="button"
              className="status-info-btn"
              onClick={() => setStatusHelpOpen(true)}
              title="What do these statuses mean?"
              aria-label="Status help"
            >
              <IconInfo size={11} />
            </button>
          </div>

          {edit.description && (
            <div className="slideover-field">
              <div className="slideover-field-label">Description</div>
              <div className="slideover-field-text">{edit.description}</div>
            </div>
          )}

          <div className="slideover-field">
            <div className="slideover-field-label">Assignee</div>
            {assigneeName ? (
              <div className="slideover-assignee">
                <span className="avatar avatar-sm" style={{ width: 26, height: 26, fontSize: 11 }}>
                  {assigneeInitial}
                </span>
                <span>{assigneeName}</span>
              </div>
            ) : (
              <div className="slideover-field-text" style={{ color: 'var(--text-dim)' }}>Unassigned</div>
            )}
          </div>

          {edit.deadline && (
            <div className="slideover-field">
              <div className="slideover-field-label">Deadline</div>
              <div
                className="slideover-field-text"
                style={overdue ? { color: '#fca5a5' } : undefined}
              >
                <IconCalendar size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {fmtDeadline(edit.deadline)}
                {overdue && (
                  <span className="overdue-badge" style={{ marginLeft: 8, fontSize: 10 }}>
                    <IconAlertTriangle size={10} /> Overdue
                  </span>
                )}
              </div>
            </div>
          )}

          {edit.waiting_reason && edit.status === 'waiting_for_client' && (
            <div className="slideover-field">
              <div className="slideover-field-label" style={{ color: 'var(--warning)' }}>Waiting for client</div>
              <div className="slideover-field-text">{edit.waiting_reason}</div>
            </div>
          )}

          {edit.cancellation_reason && edit.status === 'cancelled' && (
            <div className="slideover-field">
              <div className="slideover-field-label" style={{ color: 'var(--status-cancelled-fg)' }}>Cancellation reason</div>
              <div className="slideover-field-text">{edit.cancellation_reason}</div>
            </div>
          )}
        </div>

        <footer className="slideover-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </aside>
      <StatusInfoModal
        open={statusHelpOpen}
        onClose={() => setStatusHelpOpen(false)}
        entity="edit"
      />
    </div>
  )
}
