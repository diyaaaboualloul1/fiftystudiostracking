import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import RoleGuard from '../components/RoleGuard'
import ActionMenu from '../components/ActionMenu'
import ConfirmModal from '../components/ConfirmModal'
import CreateEditModal from '../components/CreateEditModal'
import EditPhaseModal from '../components/EditPhaseModal'
import EditSlideOver from '../components/EditSlideOver'
import StatusInfoModal from '../components/StatusInfoModal'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import {
  EDIT_STATUSES,
  KANBAN_COLUMNS,
  editStatusLabel,
  phaseStatusLabel,
  fmtDate,
  fmtDeadline,
  isOverdue,
  progressPercent,
  progressLabel,
  userDisplayName,
  userInitials,
  parseApiError,
} from '../lib/domain'
import {
  IconPhase,
  IconEditTask,
  IconHash,
  IconCalendar,
  IconAlertTriangle,
  IconArchive,
  IconRestore,
  IconCheck,
  IconEdit,
  IconArrowRight,
  IconPlay,
  IconStop,
  IconPlus,
  IconNote,
  IconMoreH,
  IconInfo,
} from '../components/Icons'

const TABS = [
  { key: 'board', label: 'Edits board' },
]

export default function PhaseDetailPage() {
  const { pid, id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user: me } = useAuth()

  const [phase, setPhase] = useState(null)
  const [project, setProject] = useState(null)
  const [edits, setEdits] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('board')
  const [editModal, setEditModal] = useState(false)
  const [slideOverEdit, setSlideOverEdit] = useState(null)
  const [editPhase, setEditPhase] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeAck, setCompleteAck] = useState(false)
  const [forceCompleting, setForceCompleting] = useState(false)
  const [statusHelpOpen, setStatusHelpOpen] = useState(false)

  const isAdmin = me?.role === 'admin'
  // Member / owner can edit phases of the project they belong to.
  const isProjectOwner = project?.owner_id === me?.id
  const isProjectMember = Array.isArray(project?.members) && project.members.some((m) => m.id === me?.id)
  const canManageProject = isAdmin || isProjectOwner || isProjectMember

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [phaseData, projData] = await Promise.all([
        apiGet(`/phases/${id}`),
        apiGet(`/projects/${pid}`),
      ])
      setPhase(phaseData.phase || phaseData)
      setEdits(phaseData.phase?.edits || phaseData.edits || [])
      setProject(projData.project || projData)
    } catch (e) {
      const { status, message } = parseApiError(e)
      if (status === 404) {
        toast.error('Phase not found.')
        navigate(`/projects/${pid}`, { replace: true })
      } else {
        toast.error(message)
      }
    } finally {
      setLoading(false)
    }
  }, [id, pid, toast, navigate])

  useEffect(() => {
    load()
  }, [load])

  const onActivate = async () => {
    try {
      await apiPost(`/phases/${id}/activate`, {})
      toast.success('Phase activated.')
      load()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }

  const onComplete = async () => {
    setCompleteAck(false)
    setCompleteOpen(true)
  }

  const doComplete = async () => {
    // If there are unfinished edits, bulk-mark them as 'done' first
    const unfinished = edits.filter((e) => e.status !== 'done' && e.status !== 'cancelled')
    if (unfinished.length > 0) {
      setForceCompleting(true)
      try {
        for (const edit of unfinished) {
          try {
            await apiPatch(
              `/edits/${edit.id}`,
              { status: 'done', version: edit.version },
              { headers: { 'If-Match': String(edit.version) } },
            )
            setEdits((prev) => prev.map((e) => (e.id === edit.id ? { ...e, status: 'done' } : e)))
          } catch (editErr) {
            const { status: editStatus, message: editMessage } = parseApiError(editErr)
            if (editStatus === 409) {
              toast.error(`Edit "${edit.title}" was modified. Refreshing…`)
              load()
            } else {
              toast.error(editMessage)
            }
            setForceCompleting(false)
            return
          }
        }
      } finally {
        setForceCompleting(false)
      }
    }

    // Now complete the phase
    try {
      await apiPost(`/phases/${id}/complete`, completeAck ? { confirm_original_delivery: true } : {})
      toast.success(completeAck ? 'Phase completed. Original delivery set.' : 'Phase completed.')
      setCompleteOpen(false)
      load()
    } catch (e) {
      const { status, message, needsConfirmation, suggestedDate } = parseApiError(e)
      if (status === 409 && needsConfirmation) {
        setCompleteAck(true)
        toast.info(`Re-confirm to set original delivery to ${fmtDate(suggestedDate || new Date())}.`)
      } else {
        toast.error(message)
      }
    }
  }

  const onArchive = async (reason) => {
    try {
      await apiPost(`/phases/${id}/archive`, { reason })
      toast.success('Phase archived.')
      setArchiveOpen(false)
      load()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }
  const onRestore = async () => {
    try {
      await apiPost(`/phases/${id}/restore`, {})
      toast.success('Phase restored.')
      setRestoreOpen(false)
      load()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }

  if (loading || !phase) {
    return (
      <AppShell title="Phase" subtitle="Loading…">
        <div className="page-loading"><div className="spinner spinner-lg spinner-primary" /></div>
      </AppShell>
    )
  }

  const overdue = phase.overdue
  const phaseMembers = project?.members || []
  const isArchived = Boolean(phase.archived_at)

  const actionItems = []
  if (canManageProject && !isArchived && phase.status === 'planned') {
    actionItems.push({ label: 'Activate phase', icon: <IconPlay size={14} />, onClick: onActivate })
  }
  if (canManageProject && !isArchived && ['active', 'waiting_for_client', 'on_hold'].includes(phase.status)) {
    actionItems.push({ label: 'Complete phase', icon: <IconCheck size={14} />, onClick: onComplete })
  }
  if (canManageProject) {
    actionItems.push({ label: 'Edit phase', icon: <IconEdit size={14} />, onClick: () => setEditPhase(true) })
  }
  if (isAdmin && !isArchived) {
    actionItems.push({ label: 'Archive phase', icon: <IconArchive size={14} />, danger: true, onClick: () => setArchiveOpen(true) })
  } else if (isAdmin && isArchived) {
    actionItems.push({ label: 'Restore phase', icon: <IconRestore size={14} />, onClick: onRestore })
  }

  return (
    <AppShell
      title=""
      subtitle=""
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/projects/${pid}?tab=phases`} className="btn btn-ghost btn-sm">
            ← {project?.name || 'Project'}
          </Link>
        </div>
      }
    >
      {isArchived && (
        <div className="archived-banner">
          <div className="archived-banner-icon"><IconArchive size={16} /></div>
          <div className="archived-banner-body">
            <strong>Archived</strong> on {fmtDate(phase.archived_at)}
            {phase.archive_reason && <> — "{phase.archive_reason}"</>}
          </div>
        </div>
      )}

      <div className="phase-page-context">
        <Link to={`/projects/${pid}`} className="phase-page-context-project">
          {project?.name || 'Project'}
        </Link>
        <span className="phase-page-context-sep">/</span>
        <span className="phase-page-context-label">Phase {phase.number}</span>
      </div>

      <div className={`project-mini-header ${isArchived ? 'is-archived' : ''}`}>
        <div className="phase-row-mini-num">{phase.number}</div>
        <h1 className="project-mini-header-name">{phase.title}</h1>
        <div className="project-mini-header-meta">
          <span className={`status-dot status-${phase.status}`} title={phaseStatusLabel(phase.status)} />
          <span>{phaseStatusLabel(phase.status)}</span>
          <button
            type="button"
            className="status-info-btn"
            onClick={() => setStatusHelpOpen(true)}
            title="What do these statuses mean?"
            aria-label="Status help"
          >
            <IconInfo size={12} />
          </button>
          {phase.deadline && (
            <>
              <span className="project-mini-header-sep">·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <IconCalendar size={12} /> {fmtDeadline(phase.deadline)}
              </span>
            </>
          )}
          {phase.progress && (
            <>
              <span className="project-mini-header-sep">·</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {progressLabel(phase.progress)} ({progressPercent(phase.progress)}%)
              </span>
            </>
          )}
          {overdue && (
            <>
              <span className="project-mini-header-sep">·</span>
              <span className="overdue-badge" style={{ fontSize: 10 }}>
                <IconAlertTriangle size={10} /> Overdue
              </span>
            </>
          )}
        </div>
        {actionItems.length > 0 && (
          <div className="project-mini-header-actions">
            <ActionMenu items={actionItems} />
          </div>
        )}
      </div>

      {phase.waiting_reason && phase.status === 'waiting_for_client' && (
        <div className="kv-card reveal" style={{ marginBottom: 16, borderLeft: '3px solid var(--warning)' }}>
          <div className="kv-card-title" style={{ color: 'var(--warning)' }}>Waiting for client</div>
          <div className="kv-card-text">{phase.waiting_reason}</div>
        </div>
      )}
      {phase.hold_reason && phase.status === 'on_hold' && (
        <div className="kv-card reveal" style={{ marginBottom: 16, borderLeft: '3px solid var(--warning)' }}>
          <div className="kv-card-title" style={{ color: 'var(--warning)' }}>On hold</div>
          <div className="kv-card-text">{phase.hold_reason}</div>
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'board' && edits.length > 0 && <span className="tab-count">{edits.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <EditsBoard
          edits={edits}
          phaseId={id}
          projectId={pid}
          onAdd={() => setEditModal(true)}
          onOpen={setSlideOverEdit}
          onEditUpdate={(editId, patch) => setEdits((prev) => prev.map((e) => (e.id === editId ? { ...e, ...patch } : e)))}
          isAdmin={isAdmin}
          members={phaseMembers}
        />
      )}


      {/* Slide-over panel — opens when an edit card is clicked in the kanban */}
      <EditSlideOver
        edit={slideOverEdit}
        onClose={() => setSlideOverEdit(null)}
        members={phaseMembers}
        project={project}
        phase={phase}
        canEdit={isAdmin || (slideOverEdit && me && Number(me.id) === Number(slideOverEdit.assignee_id))}
        onEditUpdate={(editId, patch) => setEdits((prev) => prev.map((e) => (e.id === editId ? { ...e, ...patch } : e)))}
      />

      {/* Modals */}
      {isAdmin && (
        <>
          <CreateEditModal
            open={editModal}
            phaseId={id}
            members={phaseMembers}
            onClose={() => setEditModal(false)}
            onCreated={load}
          />
          <EditPhaseModal
            open={editPhase}
            phase={phase}
            projectDeadline={project?.project_deadline}
            onClose={() => setEditPhase(false)}
            onSaved={(updated, opts) => {
              if (opts?.conflict) load()
              else if (updated) setPhase((p) => ({ ...p, ...updated }))
            }}
          />
        </>
      )}

      <ConfirmModal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={`Archive phase ${phase.number}?`}
        body="The phase will be hidden from the active list. All edits and notes stay intact."
        danger
        confirmLabel="Archive phase"
        reasonField={{ label: 'Reason', required: true, placeholder: 'Why archive?' }}
        onConfirm={onArchive}
      />
      <ConfirmModal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title={`Restore phase ${phase.number}?`}
        body="The phase will reappear in the project. If it was previously active, it may reclaim the active slot."
        confirmLabel="Restore"
        onConfirm={onRestore}
      />

      <ConfirmModal
        open={completeOpen}
        onClose={() => !forceCompleting && setCompleteOpen(false)}
        title={`Complete phase ${phase.number}?`}
        body={
          completeAck
            ? `This is the first completion. The project will be marked "delivered" on ${fmtDate(new Date())} and flip to "Already built". Confirm?`
            : (() => {
                const unfinished = edits.filter((e) => e.status !== 'done' && e.status !== 'cancelled').length
                if (unfinished === 0) return 'Marks this phase as completed. Every edit must be done or cancelled.'
                return `${unfinished} ${unfinished === 1 ? 'edit is' : 'edits are'} not done yet. Mark ${unfinished === 1 ? 'it' : 'them'} as done and complete the phase?`
              })()
        }
        confirmLabel={
          completeAck
            ? 'Yes, set original delivery'
            : forceCompleting
              ? 'Marking…'
              : (() => {
                  const unfinished = edits.filter((e) => e.status !== 'done' && e.status !== 'cancelled').length
                  return unfinished > 0 ? `Mark ${unfinished} done & complete` : 'Complete phase'
                })()
        }
        onConfirm={doComplete}
      />
      <StatusInfoModal
        open={statusHelpOpen}
        onClose={() => setStatusHelpOpen(false)}
        entity="phase"
      />
    </AppShell>
  )
}

/* ---------- Edits kanban board ---------- */
function EditsBoard({ edits, phaseId, projectId, onAdd, onOpen, onEditUpdate, isAdmin, members }) {
  const toast = useToast()
  const [draggedId, setDraggedId] = useState(null)
  const [hoveredCol, setHoveredCol] = useState(null)
  const [cancelModalEdit, setCancelModalEdit] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  // Group by status
  const grouped = useMemo(() => {
    const g = {}
    KANBAN_COLUMNS.forEach((c) => { g[c.value] = [] })
    edits.forEach((e) => {
      if (g[e.status]) g[e.status].push(e)
      else g[e.status] = [e]
    })
    return g
  }, [edits])

  async function handleDrop(editId, newStatus) {
    setHoveredCol(null)
    setDraggedId(null)
    const edit = edits.find((e) => e.id === editId)
    if (!edit || edit.status === newStatus) return

    // Cancelled requires a reason — intercept and ask before calling the API
    if (newStatus === 'cancelled') {
      setCancelReason('')
      setCancelModalEdit(edit)
      return
    }

    // Optimistic update
    onEditUpdate?.(editId, { status: newStatus })
    try {
      await apiPatch(
        `/edits/${editId}`,
        { status: newStatus, version: edit.version },
        { headers: { 'If-Match': String(edit.version) } },
      )
      toast.success(`Moved to ${editStatusLabel(newStatus)}.`)
    } catch (e) {
      // Revert on failure (409 conflict, network, etc.)
      onEditUpdate?.(editId, { status: edit.status })
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }

  async function submitCancel() {
    const edit = cancelModalEdit
    if (!edit) return
    const reason = cancelReason.trim()
    if (!reason) {
      toast.error('Please provide a reason.')
      return
    }
    setCancelling(true)
    onEditUpdate?.(edit.id, { status: 'cancelled' })
    try {
      await apiPatch(
        `/edits/${edit.id}`,
        { status: 'cancelled', cancellation_reason: reason, version: edit.version },
        { headers: { 'If-Match': String(edit.version) } },
      )
      toast.success('Edit cancelled.')
      setCancelModalEdit(null)
      setCancelReason('')
    } catch (e) {
      // Revert on failure
      onEditUpdate?.(edit.id, { status: edit.status })
      const { message } = parseApiError(e)
      toast.error(message)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div>
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>
            <IconPlus size={14} />
            <span>Add edit</span>
          </button>
        </div>
      )}

      {edits.length === 0 ? (
        <div className="empty-large reveal">
          <div className="empty-large-icon">
            <IconEdit size={32} />
          </div>
          <div className="empty-large-title">No edits yet</div>
          <div className="empty-large-text">
            Break the phase into individual deliverables, then track each one to done.
          </div>
          {isAdmin && (
            <button type="button" className="btn btn-primary" onClick={onAdd}>
              <IconPlus size={16} />
              <span>Create the first edit</span>
            </button>
          )}
        </div>
      ) : (
        <div className="kanban">
          {KANBAN_COLUMNS.map((col) => (
            <div
              key={col.value}
              className={`kanban-col ${hoveredCol === col.value ? 'is-drop-target' : ''}`}
              onDragOver={(e) => {
                if (!isAdmin) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (hoveredCol !== col.value) setHoveredCol(col.value)
              }}
              onDragLeave={(e) => {
                // Only clear if we actually left the column
                if (!e.currentTarget.contains(e.relatedTarget)) setHoveredCol(null)
              }}
              onDrop={(e) => {
                if (!isAdmin) return
                e.preventDefault()
                const id = Number(e.dataTransfer.getData('text/plain'))
                if (id) handleDrop(id, col.value)
              }}
            >
              <div className="kanban-col-head">
                <div className="kanban-col-title">
                  <span className={`status-pill status-${col.value}`} style={{ padding: '2px 8px', fontSize: 10 }}>
                    {col.label}
                  </span>
                </div>
                <span className="kanban-col-count">{grouped[col.value].length}</span>
              </div>
              <div className={`kanban-col-body ${grouped[col.value].length === 0 ? 'is-empty' : ''}`}>
                {grouped[col.value].map((e) => (
                  <EditCard
                    key={e.id}
                    edit={e}
                    onOpen={() => onOpen(e)}
                    members={members}
                    draggable={isAdmin}
                    isDragging={draggedId === e.id}
                    onDragStart={(ev) => {
                      ev.dataTransfer.setData('text/plain', String(e.id))
                      ev.dataTransfer.effectAllowed = 'move'
                      setDraggedId(e.id)
                    }}
                    onDragEnd={() => {
                      setDraggedId(null)
                      setHoveredCol(null)
                    }}
                  />
                ))}
                {grouped[col.value].length === 0 && (
                  <span>{isAdmin ? 'Drop here' : 'No edits here'}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cancel-with-reason modal — pops when a card is dropped on the Cancelled column */}
      {cancelModalEdit && (
        <div className="modal-backdrop" onClick={() => !cancelling && setCancelModalEdit(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-head-icon modal-head-icon-danger">
                <IconStop size={20} />
              </div>
              <div className="modal-head-body">
                <h2 className="modal-title">Cancel this edit?</h2>
                <p className="modal-subtitle">
                  Cancelling <strong>{cancelModalEdit.title}</strong> — please tell the team why.
                </p>
              </div>
            </div>
            <div className="modal-body">
              <label className="form-label" htmlFor="cancel-reason">
                Reason <span style={{ color: 'var(--status-cancelled)' }}>*</span>
              </label>
              <textarea
                id="cancel-reason"
                className="form-textarea"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Duplicate of another edit, requirements changed, no longer needed…"
                rows={4}
                autoFocus
                disabled={cancelling}
              />
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCancelModalEdit(null)}
                disabled={cancelling}
              >
                Keep edit
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={submitCancel}
                disabled={cancelling || !cancelReason.trim()}
              >
                {cancelling ? 'Cancelling…' : 'Cancel edit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EditCard({ edit, onOpen, members, draggable, onDragStart, onDragEnd, isDragging }) {
  const overdue = edit.overdue
  // Backend returns flat rows from a JOIN with users (id, name directly).
  // Handle both old nested and new flat shapes.
  const member = members?.find((m) => (m.user_id ?? m.id) === edit.assignee_id)
  const memberUser = member?.user ?? member
  const assigneeName = memberUser?.name || (edit.assignee_id ? `User #${edit.assignee_id}` : null)
  const assigneeInitial = (memberUser?.name || '?').slice(0, 1).toUpperCase()
  return (
    <div
      className={`kanban-card ${isDragging ? 'is-dragging' : ''}`}
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      role="button"
      tabIndex={0}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-edit-badge">
          <IconEditTask size={9} />
          <span>EDIT</span>
        </span>
      </div>
      <div className="kanban-card-title">{edit.title}</div>
      <div className="kanban-card-meta">
        {assigneeName ? (
          <span className="kanban-card-assignee">
            <span className="avatar avatar-sm" style={{ width: 18, height: 18, fontSize: 9 }}>
              {assigneeInitial}
            </span>
            {assigneeName}
          </span>
        ) : (
          <span style={{ color: 'var(--text-dim)' }}>Unassigned</span>
        )}
        {edit.deadline && (
          <span className="kanban-card-deadline" style={overdue ? { color: '#fca5a5' } : undefined}>
            <IconCalendar size={11} />
            {fmtDeadline(edit.deadline)}
            {overdue && <IconAlertTriangle size={11} style={{ color: '#fca5a5' }} />}
          </span>
        )}
      </div>
    </div>
  )
}
