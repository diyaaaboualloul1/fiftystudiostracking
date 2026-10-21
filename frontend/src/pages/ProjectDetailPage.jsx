import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import RoleGuard from '../components/RoleGuard'
import ActionMenu from '../components/ActionMenu'
import ConfirmModal from '../components/ConfirmModal'
import CreateProjectModal from '../components/CreateProjectModal'
import EditProjectModal from '../components/EditProjectModal'
import CreatePhaseModal from '../components/CreatePhaseModal'
import CreateEditModal from '../components/CreateEditModal'
import MembersPanel from '../components/MembersPanel'
import LinksPanel from '../components/LinksPanel'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import {
  projectStatusLabel,
  projectStateLabel,
  projectStateDesc,
  phaseStatusLabel,
  editStatusLabel,
  fmtDate,
  userDisplayName,
  userInitials,
  parseApiError,
} from '../lib/domain'
import {
  IconAlertTriangle,
  IconArchive,
  IconCalendar,
  IconChevronRight,
  IconEdit,
  IconHash,
  IconInfo,
  IconPlus,
  IconRestore,
} from '../components/Icons'
import StatusInfoModal from '../components/StatusInfoModal'

const TABS = [
  { key: 'overview', label: 'Project info' },
  { key: 'phases', label: 'Phases' },
  { key: 'links', label: 'Links' },
  { key: 'members', label: 'Members' },
]

export default function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user: me } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(searchParams.get('tab') || 'overview')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [createPhaseOpen, setCreatePhaseOpen] = useState(false)
  const [createEditFor, setCreateEditFor] = useState(null)  // {id, title, number} when adding an edit to a specific phase
  const [createProjectOpen, setCreateProjectOpen] = useState(searchParams.get('new') === '1')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [statusHelpOpen, setStatusHelpOpen] = useState(false)
  const [users, setUsers] = useState([])

  const isAdmin = me?.role === 'admin'
  // Member / owner can edit the project they belong to. Admin already covered by isAdmin.
  const isProjectOwner = project?.owner_id === me?.id
  const isProjectMember = Array.isArray(project?.members) && project.members.some((m) => m.id === me?.id)
  const canManageProject = isAdmin || isProjectOwner || isProjectMember

  // Sync tab to URL
  useEffect(() => {
    const t = searchParams.get('tab') || 'overview'
    setTab(t)
  }, [searchParams])

  // Auto-open create modal if ?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreateProjectOpen(true)
    }
  }, [searchParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet(`/projects/${id}`)
      setProject(data.project || data)
    } catch (e) {
      const { status, message } = parseApiError(e)
      if (status === 404) {
        toast.error('Project not found.')
        navigate('/projects', { replace: true })
      } else {
        toast.error(message)
      }
    } finally {
      setLoading(false)
    }
  }, [id, toast, navigate])

  useEffect(() => {
    load()
  }, [load])

  // Load users for owner picker (admin only)
  useEffect(() => {
    if (!isAdmin) return
    apiGet('/users', { active: 'true' })
      .then((data) => setUsers(data.users || []))
      .catch(() => {})
  }, [isAdmin])

  const setTabAndUrl = (t) => {
    setTab(t)
    setSearchParams((cur) => {
      const next = new URLSearchParams(cur)
      next.set('tab', t)
      return next
    }, { replace: true })
  }

  /* -------- inline name edit -------- */
  function startEditName() {
    if (!canManageProject) return
    setNameDraft(project.name)
    setEditingName(true)
  }
  async function saveName() {
    const next = nameDraft.trim()
    if (next === project.name || next.length < 2) {
      setEditingName(false)
      return
    }
    try {
      const body = { name: next, version: project.version }
      const { project: updated } = await apiPatch(
        `/projects/${project.id}`,
        body,
        { headers: { 'If-Match': String(project.version) } },
      )
      setProject((p) => ({ ...p, ...updated }))
      toast.success('Name updated.')
      setEditingName(false)
    } catch (e) {
      const { status, message } = parseApiError(e)
      if (status === 409) {
        toast.error('Project was modified. Refreshing…')
        load()
      } else {
        toast.error(message)
      }
      setEditingName(false)
    }
  }

  /* -------- archive / restore -------- */
  async function doArchive(reason) {
    try {
      await apiPost(`/projects/${project.id}/archive`, { reason })
      toast.success('Project archived.')
      setArchiveOpen(false)
      load()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }
  async function doRestore() {
    try {
      await apiPost(`/projects/${project.id}/restore`, {})
      toast.success('Project restored.')
      setRestoreOpen(false)
      load()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }

  /* -------- phase actions -------- */
  async function activatePhase(p) {
    try {
      await apiPost(`/phases/${p.id}/activate`, {})
      toast.success(`Phase ${p.number} activated.`)
      load()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }
  async function completePhase(p) {
    try {
      await apiPost(`/phases/${p.id}/complete`, {})
      toast.success(`Phase ${p.number} completed.`)
      load()
    } catch (e) {
      const { status, message, needsConfirmation, suggestedDate } = parseApiError(e)
      if (status === 409 && needsConfirmation) {
        const ok = window.confirm(
          `Completing the initial build will mark the project as "delivered" on ${fmtDate(suggestedDate || new Date())}. Continue?`,
        )
        if (!ok) return
        try {
          await apiPost(`/phases/${p.id}/complete`, { confirm_original_delivery: true })
          toast.success(`Phase ${p.number} completed. Original delivery set.`)
          load()
        } catch (e2) {
          const { message: m2 } = parseApiError(e2)
          toast.error(m2)
        }
      } else {
        toast.error(message)
      }
    }
  }
  async function archivePhase(p) {
    const reason = window.prompt(`Reason for archiving phase ${p.number}?`, '')
    if (reason === null) return
    try {
      await apiPost(`/phases/${p.id}/archive`, { reason: reason.trim() || 'No reason' })
      toast.success(`Phase ${p.number} archived.`)
      load()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }
  async function restorePhase(p) {
    try {
      await apiPost(`/phases/${p.id}/restore`, {})
      toast.success(`Phase ${p.number} restored.`)
      load()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }

  if (loading && !project) {
    return (
      <AppShell title="Project" subtitle="Loading…">
        <div className="page-loading">
          <div className="spinner spinner-lg spinner-primary" />
        </div>
      </AppShell>
    )
  }

  if (!project) {
    return (
      <AppShell title="Project not found">
        <div className="empty">
          <div className="empty-title">No such project</div>
          <Link to="/projects" className="btn btn-ghost" style={{ marginTop: 14 }}>
            Back to projects
          </Link>
        </div>
      </AppShell>
    )
  }

  const isArchived = Boolean(project.archived_at)
  const phases = project.phases || []
  const activePhase = project.active_phase
  const counts = {
    overview: 0,
    phases: phases.length,
    members: (project.members || []).length + 1, // +1 for owner
    links: (project.links || []).length,
    activity: 0,
  }

  const actionItems = []
  if (canManageProject) {
    actionItems.push({
      label: 'Edit project',
      icon: <IconEdit size={14} />,
      onClick: () => setEditOpen(true),
    })
    actionItems.push({
      label: 'Add phase',
      icon: <IconPlus size={14} />,
      onClick: () => setCreatePhaseOpen(true),
    })
  }
  if (isAdmin && isArchived) {
    actionItems.push({
      label: 'Restore project',
      icon: <IconRestore size={14} />,
      onClick: () => setRestoreOpen(true),
    })
  } else if (isAdmin) {
    actionItems.push({
      label: 'Archive project',
      icon: <IconArchive size={14} />,
      danger: true,
      onClick: () => setArchiveOpen(true),
    })
  }

  return (
    <AppShell
      title=""
      subtitle=""
      actions={
        <Link to="/projects" className="btn btn-ghost btn-sm">
          ← All projects
        </Link>
      }
    >
      {isArchived && (
        <div className="archived-banner">
          <div className="archived-banner-icon">
            <IconArchive size={16} />
          </div>
          <div className="archived-banner-body">
            <strong>Archived</strong> on {fmtDate(project.archived_at)}
            {project.archive_reason && <> — "{project.archive_reason}"</>}
          </div>
          {isAdmin && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRestoreOpen(true)}
            >
              <IconRestore size={14} />
              <span>Restore</span>
            </button>
          )}
        </div>
      )}

      <div className={`project-mini-header ${isArchived ? 'is-archived' : ''}`}>
        <h1
          className="project-mini-header-name"
          contentEditable={editingName}
          suppressContentEditableWarning
          onDoubleClick={startEditName}
          onBlur={(e) => {
            if (editingName) {
              setNameDraft(e.currentTarget.textContent || '')
              saveName()
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setEditingName(false)
              if (e.currentTarget) e.currentTarget.textContent = project.name
            }
          }}
          title={canManageProject ? 'Double-click to rename' : undefined}
        >
          {editingName ? nameDraft : project.name}
        </h1>
        <div className="project-mini-header-meta">
          <span className={`status-dot status-${project.status}`} title={projectStatusLabel(project.status)} />
          <span>{projectStatusLabel(project.status)}</span>
          <button
            type="button"
            className="status-info-btn"
            onClick={() => setStatusHelpOpen(true)}
            title="What do these statuses mean?"
            aria-label="Status help"
          >
            <IconInfo size={12} />
          </button>
          {activePhase && (
            <>
              <span className="project-mini-header-sep">·</span>
              <span>Phase {activePhase.number}</span>
            </>
          )}
          {!activePhase && (
            <>
              <span className="project-mini-header-sep">·</span>
              <span>{fmtDate(project.updated_at)}</span>
            </>
          )}
        </div>

        {(project.project_deadline || (activePhase && activePhase.deadline)) && (
          <div className="project-mini-header-deadlines">
            {project.project_deadline && (
              <span
                className="header-badge header-badge--project"
                title="Project deadline — promised delivery date for the whole project"
              >
                <IconCalendar size={12} />
                <span className="header-badge-label">Project deadline</span>
                <span className="header-badge-sep">·</span>
                <span className="header-badge-date">{fmtDate(project.project_deadline)}</span>
              </span>
            )}
            {activePhase && activePhase.deadline && (
              <span
                className={`header-badge header-badge--phase ${activePhase.overdue ? 'header-badge--overdue' : ''}`}
                title={activePhase.overdue ? 'Phase deadline — OVERDUE (past due)' : 'Active phase deadline'}
              >
                <IconCalendar size={12} />
                <span className="header-badge-label">Phase deadline</span>
                <span className="header-badge-sep">·</span>
                <span className="header-badge-date">{fmtDate(activePhase.deadline)}</span>
                {activePhase.overdue && <IconAlertTriangle size={11} />}
              </span>
            )}
          </div>
        )}
        {actionItems.length > 0 && (
          <div className="project-mini-header-actions">
            <ActionMenu items={actionItems} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTabAndUrl(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && <span className="tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab project={project} />
      )}
      {tab === 'phases' && (
        <PhasesTab
          project={project}
          onActivate={activatePhase}
          onComplete={completePhase}
          onArchive={archivePhase}
          onRestore={restorePhase}
          onAdd={() => setCreatePhaseOpen(true)}
          onAddEdit={(phase) => setCreateEditFor(phase)}
          isAdmin={isAdmin}
        />
      )}
      {tab === 'members' && (
        <MembersPanel project={project} onChanged={load} canEdit={isAdmin} />
      )}
      {tab === 'links' && (
        <LinksPanel project={project} onChanged={load} canEdit={isAdmin} />
      )}

      {/* Modals */}
      {isAdmin && (
        <>
          <CreateProjectModal
            open={createProjectOpen}
            users={users}
            onClose={() => {
              setCreateProjectOpen(false)
              if (searchParams.get('new')) {
                setSearchParams((cur) => {
                  const next = new URLSearchParams(cur)
                  next.delete('new')
                  return next
                }, { replace: true })
              }
            }}
            onCreated={(p) => navigate(`/projects/${p.id}`)}
          />
          <EditProjectModal
            open={editOpen}
            project={project}
            onClose={() => setEditOpen(false)}
            onSaved={(updated, opts) => {
              if (opts?.conflict) {
                load()
              } else if (updated) {
                setProject((p) => ({ ...p, ...updated }))
              }
            }}
          />
          <CreatePhaseModal
            open={createPhaseOpen}
            projectId={project.id}
            nextNumber={nextPhaseNumber(phases)}
            activePhaseNumber={activePhase?.number}
            projectDeadline={project.project_deadline}
            onClose={() => setCreatePhaseOpen(false)}
            onCreated={load}
          />
          <CreateEditModal
            open={!!createEditFor}
            phaseId={createEditFor?.id}
            members={project.members || []}
            onClose={() => setCreateEditFor(null)}
            onCreated={() => {
              setCreateEditFor(null)
              load()
            }}
          />
        </>
      )}

      <ConfirmModal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={`Archive "${project.name}"?`}
        body="The project will move out of the active list. All phases, edits, and history stay intact. You can restore at any time."
        danger
        confirmLabel="Archive project"
        reasonField={{ label: 'Reason', required: true, placeholder: 'Why archive?' }}
        onConfirm={doArchive}
      />

      <ConfirmModal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title={`Restore "${project.name}"?`}
        body="The project will reappear in the active list and can be worked on again."
        confirmLabel="Restore project"
        onConfirm={doRestore}
      />
      <StatusInfoModal
        open={statusHelpOpen}
        onClose={() => setStatusHelpOpen(false)}
        entity="project"
      />
    </AppShell>
  )
}

function nextPhaseNumber(phases) {
  if (!phases || !phases.length) return 1
  return Math.max(...phases.map((p) => p.number || 0)) + 1
}

/* ---------- Overview tab ---------- */
function OverviewTab({ project }) {
  const active = project.active_phase
  const projectDeadlineOverdue = project.project_deadline && new Date(project.project_deadline) < new Date(new Date().toDateString())
  const activeDeadlineOverdue = active && active.deadline && !active.archived_at && active.status !== 'completed'
    && new Date(active.deadline) < new Date(new Date().toDateString())

  return (
    <div>
      {project.description && (
        <section className="kv-card reveal" style={{ marginBottom: 18 }}>
          <div className="kv-card-title">Description</div>
          <div className="kv-card-text">{project.description}</div>
        </section>
      )}

      <div className="section-grid-2">
        <section className="kv-card reveal">
          <div className="kv-card-title">Active phase</div>
          {active ? (
            <div>
              <div className="cell-stack-value" style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                Phase {active.number} · {active.title}
              </div>
              <div className="cell-stack">
                <span className="cell-stack-label">Status</span>
                <span>
                  <span className={`status-pill status-${active.status}`}>
                    {phaseStatusLabel(active.status)}
                  </span>
                </span>
              </div>
              {active.deadline && (
                <div className="cell-stack" style={{ marginTop: 8 }}>
                  <span className="cell-stack-label">Deadline</span>
                  <span className="cell-stack-value">{fmtDate(active.deadline)}</span>
                </div>
              )}
              {active.description && (
                <div className="cell-stack" style={{ marginTop: 8 }}>
                  <span className="cell-stack-label">Description</span>
                  <span className="cell-stack-value" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {active.description}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="kv-card-empty">No active phase right now.</div>
          )}
        </section>

        <section className="kv-card reveal">
          <div className="kv-card-title">Project meta</div>
          <div className="kv-list">
            <div className="kv">
              <div className="kv-k">Client</div>
              <div className="kv-v">{project.client || '—'}</div>
            </div>
            <div className="kv">
              <div className="kv-k">State</div>
              <div className="kv-v">{projectStateLabel(project.project_state)}</div>
            </div>
            <div className="kv">
              <div className="kv-k">Created</div>
              <div className="kv-v">{fmtDate(project.created_at)}</div>
            </div>
            <div className="kv">
              <div className="kv-k">Last update</div>
              <div className="kv-v">{fmtDate(project.updated_at)}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

/* ---------- Phases tab ---------- */
// Sort priority for the phases list: active → planned → waiting → on hold → completed → archived → cancelled
function phaseStatusOrder(phase) {
  if (phase.archived_at) return 5
  if (phase.cancelled_at) return 6
  const order = {
    active: 0,
    planned: 1,
    waiting_for_client: 2,
    on_hold: 3,
    completed: 4,
  }
  return order[phase.status] ?? 7
}

function PhasesTab({ project, onActivate, onComplete, onArchive, onRestore, onAdd, onAddEdit, isAdmin }) {
  // Sort by status priority (active first, archived last), then by phase number (newest first within group).
  const phases = useMemo(
    () => [...(project.phases || [])].sort((a, b) => {
      const orderA = phaseStatusOrder(a)
      const orderB = phaseStatusOrder(b)
      if (orderA !== orderB) return orderA - orderB
      return (b.number || 0) - (a.number || 0)
    }),
    [project.phases],
  )
  return (
    <div>
      <div className="dash-section-head">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>All phases</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            One phase is active at a time. Archive the current one to swap.
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>
            <IconPlus size={14} />
            <span>Add phase</span>
          </button>
        )}
      </div>
      {phases.length === 0 ? (
        <div className="empty" style={{ padding: 40 }}>
          <div className="empty-icon"><IconHash size={22} /></div>
          <div className="empty-title">No phases yet</div>
          <div className="empty-text">
            {isAdmin ? 'Add a first phase to organize the work.' : 'Phases will appear here once they are added.'}
          </div>
        </div>
      ) : (
        <div className="phase-list phase-list-mini">
          {phases.map((p) => (
            <PhaseRowMini
              key={p.id}
              phase={p}
              projectId={project.id}
              onAddEdit={onAddEdit}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PhaseRowMini({ phase, projectId, onAddEdit, isAdmin }) {
  const [expanded, setExpanded] = useState(false)
  const [edits, setEdits] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [statusHelpOpen, setStatusHelpOpen] = useState(false)
  const toast = useToast()

  const doneCount = phase.edits_done || 0
  const totalCount = phase.edits_total || 0
  const hasEdits = totalCount > 0
  const phaseUrl = `/projects/${projectId}/phases/${phase.id}`
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  // Effective status key (archived/cancelled override the base status for styling)
  const statusKey = phase.archived_at
    ? 'archived'
    : phase.cancelled_at
      ? 'cancelled'
      : phase.status

  // Display label
  const statusLabel = phase.archived_at
    ? 'Archived'
    : phase.cancelled_at
      ? 'Cancelled'
      : phaseStatusLabel(phase.status)

  // Reason text (for on hold / waiting / archived / cancelled)
  const reason = phase.archived_at
    ? phase.archive_reason
    : phase.cancelled_at
      ? phase.cancellation_reason
      : phase.status === 'waiting_for_client'
        ? phase.waiting_reason
        : phase.status === 'on_hold'
          ? phase.hold_reason
          : null

  // Deadline overdue (only for active/planned/waiting/on-hold phases, not completed/archived/cancelled)
  const todayStr = new Date().toDateString()
  const isOverdue = phase.deadline && !phase.archived_at && !phase.cancelled_at &&
    phase.status !== 'completed' && new Date(phase.deadline) < new Date(todayStr)

  // Date range (start → end)
  const startDate = phase.start_date || phase.activated_at
  const endDate = phase.completed_at || phase.end_date || phase.deadline
  const hasDateRange = startDate || endDate

  async function toggleExpand() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (edits === null) {
      setLoading(true)
      try {
        const data = await apiGet(`/phases/${phase.id}`)
        setEdits(data.phase.edits || [])
      } catch (e) {
        const { message } = parseApiError(e)
        toast.error(message)
      } finally {
        setLoading(false)
      }
    }
  }

  const visibleEdits = showAll ? edits : (edits || []).slice(0, 5)
  const hiddenCount = edits ? Math.max(0, edits.length - 5) : 0

  return (
    <div className={`phase-row-mini is-${statusKey}`}>
      <div className="phase-row-mini-top">
        <div className="phase-row-mini-num">{phase.number}</div>
        <Link
          to={phaseUrl}
          className="phase-row-mini-name"
          title={`Open "${phase.title}"`}
        >
          {phase.title}
        </Link>
        <span className={`status-pill phase-row-mini-status status-${statusKey}`}>
          {statusLabel}
        </span>
        <button
          type="button"
          className="status-info-btn"
          onClick={() => setStatusHelpOpen(true)}
          title="What do these statuses mean?"
          aria-label="Status help"
          onClickCapture={(e) => e.stopPropagation()}
        >
          <IconInfo size={11} />
        </button>
        {phase.deadline && (
          <span className={`phase-row-mini-deadline ${isOverdue ? 'is-overdue' : ''}`}>
            <IconCalendar size={12} />
            <span>{fmtDate(phase.deadline)}</span>
          </span>
        )}
      </div>
      <div className="phase-row-mini-bottom">
        {hasDateRange && (
          <span className="phase-row-mini-dates">
            {startDate ? fmtDate(startDate) : '—'} → {endDate ? fmtDate(endDate) : '—'}
          </span>
        )}
        {reason && (
          <span className="phase-row-mini-reason" title={reason}>
            — {reason}
          </span>
        )}
        {hasEdits && (
          <div className="phase-row-mini-progress">
            <div className="phase-row-mini-progress-bar">
              <div
                className="phase-row-mini-progress-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="phase-row-mini-count">{doneCount}/{totalCount}</span>
          </div>
        )}
        <div className="phase-row-mini-bottom-actions">
          {isAdmin && !phase.archived_at && onAddEdit && (
            <button
              type="button"
              className="phase-row-mini-add"
              onClick={() => onAddEdit(phase)}
              title="Add edit"
              aria-label="Add edit"
            >
              <IconPlus size={14} />
            </button>
          )}
          <button
            type="button"
            className="phase-row-mini-chevron"
            onClick={toggleExpand}
            aria-label={expanded ? 'Collapse edits' : 'Expand edits'}
            title={hasEdits ? (expanded ? 'Collapse' : `Show ${totalCount} edit${totalCount === 1 ? '' : 's'}`) : 'No edits yet'}
          >
            <IconChevronRight size={14} className={expanded ? 'is-expanded' : ''} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="phase-row-mini-body">
          {loading ? (
            <div className="edit-row-mini-loading">Loading edits…</div>
          ) : !edits || edits.length === 0 ? (
            <div className="edit-row-mini-empty">No edits yet</div>
          ) : (
            <>
              {visibleEdits.map((e) => (
                <div key={e.id} className="edit-row-mini">
                  <span
                    className={`status-dot status-${e.status}`}
                    title={editStatusLabel(e.status)}
                  />
                  <span className="edit-row-mini-title">{e.title}</span>
                  <span className={`status-pill status-${e.status}`}>
                    {editStatusLabel(e.status)}
                  </span>
                </div>
              ))}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="show-more-btn"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll
                    ? '▲ Show less'
                    : `▼ Show ${hiddenCount} more`}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <StatusInfoModal
        open={statusHelpOpen}
        onClose={() => setStatusHelpOpen(false)}
        entity="phase"
      />
    </div>
  )
}

function OwnerName({ ownerId }) {
  const [u, setU] = useState(null)
  useEffect(() => {
    let cancelled = false
    apiGet('/users')
      .then((data) => {
        if (cancelled) return
        const found = (data.users || []).find((x) => x.id === ownerId)
        if (found) setU(found)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [ownerId])
  if (u) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="avatar avatar-sm" style={{ width: 22, height: 22, fontSize: 10 }}>
          {userInitials(u)}
        </span>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{userDisplayName(u)}</span>
      </span>
    )
  }
  return <span>User #{ownerId}</span>
}
