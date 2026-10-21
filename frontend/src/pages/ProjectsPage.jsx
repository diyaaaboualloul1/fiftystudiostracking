import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import RoleGuard from '../components/RoleGuard'
import CreateProjectModal from '../components/CreateProjectModal'
import ConfirmModal from '../components/ConfirmModal'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { apiGet, apiDelete } from '../lib/api'
import {
  PROJECT_STATUSES,
  projectStatusLabel,
  fmtDeadline,
  progressPercent,
  progressLabel,
  parseApiError,
} from '../lib/domain'
import {
  IconPlus,
  IconSearch,
  IconFilter,
  IconSort,
  IconArrowUp,
  IconArrowDown,
  IconInbox,
  IconAlertTriangle,
  IconCalendar,
  IconTrash,
} from '../components/Icons'

// Top-of-table sortable columns (rendered before the static Active-phase column)
const SORTABLE_HEAD = [
  { key: 'name', label: 'Project' },
  { key: 'status', label: 'Status' },
]
// Trailing sortable deadline columns (rendered after the static Active-phase column)
const SORTABLE_TAIL = [
  { key: 'project_deadline', label: 'Project deadline' },
  { key: 'deadline', label: 'Phase deadline' },
]

const PAGE_SIZE = 25

export default function ProjectsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const createOpen = searchParams.get('new') === '1'

  const [projects, setProjects] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [statuses, setStatuses] = useState([]) // array of status values
  const [overdue, setOverdue] = useState(false)
  const [sort, setSort] = useState('updated_at')
  const [order, setOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, name, cascaded } | null
  const [deleting, setDeleting] = useState(false)

  function closeCreateModal() {
    // Strip ?new=1 from the URL without triggering a full reload
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  // Reset page on filter change
  useEffect(() => {
    setPage(1)
  }, [debounced, statuses, overdue, sort, order])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        sort,
        order,
        page,
        limit: PAGE_SIZE,
      }
      if (debounced) params.search = debounced
      if (statuses.length) params.status = statuses.join(',')
      if (overdue) params.overdue = 'true'
      const data = await apiGet('/projects', params)
      setProjects(data.projects || [])
      setTotal(data.count ?? (data.projects || []).length)
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [debounced, statuses, overdue, sort, order, page, toast])

  useEffect(() => {
    load()
  }, [load])

  // Always keep overdue projects at the top of the list, regardless of the
  // current sort column. Within the overdue group, keep backend's order.
  const sortedProjects = useMemo(() => {
    if (!projects || projects.length === 0) return projects
    const overdue = projects.filter((p) => p.active_phase?.overdue)
    const rest = projects.filter((p) => !p.active_phase?.overdue)
    return [...overdue, ...rest]
  }, [projects])

  // Today's date in the company timezone (Asia/Kuwait) — used for the
  // "Today · …" badge above the table so users can compare deadlines against
  // today without having to check their OS clock. Computed once per mount.
  const todayLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Kuwait',
      }).format(new Date())
    } catch {
      return new Date().toLocaleDateString()
    }
  }, [])

  const onSort = (key) => {
    if (sort === key) {
      setOrder(order === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(key)
      // reasonable default direction per column
      if (key === 'name' || key === 'client') setOrder('asc')
      else setOrder('desc')
    }
  }

  const toggleStatus = (s) => {
    setStatuses((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(total, page * PAGE_SIZE)

  return (
    <AppShell
      title="Projects"
      subtitle="Track every active build and maintenance engagement."
      actions={
        <RoleGuard allow={['admin']}>
          <Link to="/projects?new=1" className="btn btn-primary">
            <IconPlus size={16} />
            <span>New project</span>
          </Link>
        </RoleGuard>
      }
    >
      <div className="projects-today-badge" aria-label={`Today is ${todayLabel}`}>
        <IconCalendar size={14} />
        <span>
          Today · <strong>{todayLabel}</strong>
        </span>
      </div>
      <div className="filter-bar">
        <div className="search-input">
          <IconSearch size={16} className="search-icon" />
          <input
            type="search"
            className="input"
            placeholder="Search projects by name or client…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <button
          type="button"
          className={`filter-pill ${showFilters || statuses.length || overdue ? 'is-on' : ''}`}
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
        >
          <IconFilter size={14} />
          <span>
            Filters
            {(statuses.length + (overdue ? 1 : 0)) > 0 &&
              ` (${statuses.length + (overdue ? 1 : 0)})`}
          </span>
        </button>

        <div className="filter-spacer" />

        <div className="filter-meta">
          {loading ? (
            <span className="spinner spinner-primary" />
          ) : (
            <span>
              {total === 0
                ? 'No projects'
                : `${pageStart}–${pageEnd} of ${total}`}
            </span>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="filter-bar" style={{ marginTop: -8, marginBottom: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div className="filter-chip-group">
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Status</span>
            {PROJECT_STATUSES.filter((s) => s.value !== 'archived').map((s) => (
              <button
                key={s.value}
                type="button"
                className={`filter-pill ${statuses.includes(s.value) ? 'is-on' : ''}`}
                onClick={() => toggleStatus(s.value)}
              >
                {statuses.includes(s.value) && <span className="filter-pill-x">✓</span>}
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`filter-pill ${overdue ? 'is-on' : ''}`}
            onClick={() => setOverdue((v) => !v)}
            style={{ marginLeft: 'auto' }}
          >
            {overdue && <span className="filter-pill-x">✓</span>}
            <IconAlertTriangle size={14} />
            <span>Overdue only</span>
          </button>
        </div>
      )}

      {loading && projects.length === 0 ? (
        <SkeletonTable />
      ) : !loading && projects.length === 0 ? (
        <EmptyState
          hasFilters={Boolean(debounced || statuses.length || overdue)}
          onClear={() => {
            setQuery('')
            setStatuses([])
            setOverdue(false)
          }}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {SORTABLE_HEAD.map((col) => {
                    const isSorted = sort === col.key
                    return (
                      <th
                        key={col.key}
                        className={`th-sort ${isSorted ? 'is-sorted' : ''}`}
                        onClick={() => onSort(col.key)}
                      >
                        {col.label}
                        <span className="th-sort-icon">
                          {isSorted ? (
                            order === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
                          ) : (
                            <IconSort size={12} />
                          )}
                        </span>
                      </th>
                    )
                  })}
                  <th>Active phase</th>
                  {SORTABLE_TAIL.map((col) => {
                    const isSorted = sort === col.key
                    return (
                      <th
                        key={col.key}
                        className={`th-sort ${isSorted ? 'is-sorted' : ''}`}
                        onClick={() => onSort(col.key)}
                      >
                        {col.label}
                        <span className="th-sort-icon">
                          {isSorted ? (
                            order === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />
                          ) : (
                            <IconSort size={12} />
                          )}
                        </span>
                      </th>
                    )
                  })}
                  <th>Progress</th>
                  {isAdmin && <th className="row-actions-head" aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {sortedProjects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    p={p}
                    onOpen={() => navigate(`/projects/${p.id}`)}
                    onDelete={(proj) => setDeleteTarget({ id: proj.id, name: proj.name })}
                    canDelete={isAdmin}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <div className="pagination-meta">
                Page {page} of {totalPages}
              </div>
              <div className="pagination-controls">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={closeCreateModal}
        onCreated={(project) => {
          closeCreateModal()
          load()
          if (project?.id) navigate(`/projects/${project.id}`)
        }}
      />

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete project?"
        danger
        confirmLabel={deleting ? 'Deleting…' : 'Delete project'}
        cancelLabel="Cancel"
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return
          setDeleting(true)
          try {
            const result = await apiDelete(`/projects/${deleteTarget.id}`)
            const cascaded = result?.deleted?.cascaded || {}
            const parts = []
            if (cascaded.phases) parts.push(`${cascaded.phases} phase${cascaded.phases === 1 ? '' : 's'}`)
            if (cascaded.edits) parts.push(`${cascaded.edits} edit${cascaded.edits === 1 ? '' : 's'}`)
            if (cascaded.members) parts.push(`${cascaded.members} member${cascaded.members === 1 ? '' : 's'}`)
            if (cascaded.links) parts.push(`${cascaded.links} link${cascaded.links === 1 ? '' : 's'}`)
            const detail = parts.length ? ` (cascaded: ${parts.join(', ')})` : ''
            toast.success(`Deleted "${deleteTarget.name}"${detail}.`)
            setDeleteTarget(null)
            load()
          } catch (e) {
            const { message } = parseApiError(e)
            toast.error(message || 'Failed to delete project')
          } finally {
            setDeleting(false)
          }
        }}
        body={
          deleteTarget ? (
            <div>
              <p style={{ margin: '0 0 12px' }}>
                You're about to permanently delete{' '}
                <strong style={{ color: 'var(--text)' }}>{deleteTarget.name}</strong>.
                This will cascade-delete all of its:
              </p>
              <ul style={{ margin: '0 0 0 20px', padding: 0, color: 'var(--text-dim)' }}>
                <li>Phases</li>
                <li>Edits (and their activity history)</li>
                <li>Members</li>
                <li>Links</li>
              </ul>
              <p style={{ margin: '12px 0 0', color: 'var(--danger)', fontSize: 13 }}>
                <IconAlertTriangle size={13} /> &nbsp;This action cannot be undone.
              </p>
            </div>
          ) : null
        }
      />
    </AppShell>
  )
}

function ProjectRow({ p, onOpen, onDelete, canDelete }) {
  const isOverdue = Boolean(p.active_phase?.overdue)
  return (
    <tr className={`project-row ${isOverdue ? 'is-overdue' : ''}`} onClick={onOpen}>
      <td>
        <div className="project-name-cell">
          <span className="project-name">{p.name}</span>
          {p.client && <span className="project-client">{p.client}</span>}
          {isOverdue && (
            <span className="overdue-row-badge" title="Active phase is past its deadline">
              <IconAlertTriangle size={9} /> Overdue
            </span>
          )}
        </div>
      </td>
      <td>
        <span className={`status-pill status-${p.status}`}>
          {projectStatusLabel(p.status)}
        </span>
      </td>
      <td>
        {p.active_phase ? (
          <span>Phase {p.active_phase.number} · {p.active_phase.title}</span>
        ) : (
          <span className="cell-muted">No active phase</span>
        )}
      </td>
      <td>
        {p.project_deadline ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconCalendar size={11} />
            {fmtDeadline(p.project_deadline)}
          </span>
        ) : (
          <span className="cell-muted">—</span>
        )}
      </td>
      <td>
        {p.active_phase?.deadline ? (
          <span
            className={`cell-phase-deadline ${p.active_phase?.overdue ? 'is-overdue' : ''}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <IconCalendar size={11} />
            {fmtDeadline(p.active_phase.deadline)}
            {p.active_phase?.overdue && <IconAlertTriangle size={10} />}
          </span>
        ) : (
          <span className="cell-muted">—</span>
        )}
      </td>
      <td>
        {p.active_phase ? (
          <div className="project-progress">
            <div className="project-progress-track">
              <div
                className="project-progress-fill"
                style={{ width: `${progressPercent(p.active_phase.progress)}%` }}
              />
            </div>
            <span className="project-progress-label">
              {progressLabel(p.active_phase.progress)}
            </span>
          </div>
        ) : (
          <span className="cell-muted">—</span>
        )}
      </td>
      {canDelete && (
        <td className="row-actions-cell" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="row-action-btn row-action-danger"
            onClick={() => onDelete(p)}
            title="Delete project and all its data"
            aria-label={`Delete project ${p.name}`}
          >
            <IconTrash size={14} />
          </button>
        </td>
      )}
    </tr>
  )
}

/** Preload a batch of users for components that still show owners. */
export function preloadOwners(_users) {
  // No-op: Owner column removed from /projects. Kept for backward compat
  // with any other component that might import this.
}

function SkeletonTable() {
  return (
    <div className="table-wrap">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton-bar lg" style={{ width: '28%' }} />
          <div className="skeleton-bar" style={{ width: '12%' }} />
          <div className="skeleton-bar" style={{ width: '20%' }} />
          <div className="skeleton-bar sm" style={{ width: '14%' }} />
          <div className="skeleton-bar sm" style={{ width: '12%' }} />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ hasFilters, onClear }) {
  return (
    <div className="empty-large reveal">
      <div className="empty-large-icon">
        <IconInbox size={36} />
      </div>
      <div className="empty-large-title">
        {hasFilters ? 'No projects match your filters' : 'No projects yet'}
      </div>
      <div className="empty-large-text">
        {hasFilters
          ? 'Try clearing the search or status filters to see more.'
          : 'Create your first project to start tracking phases and edits.'}
      </div>
      {hasFilters ? (
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          Clear filters
        </button>
      ) : (
        <RoleGuard allow={['admin']}>
          <Link to="/projects?new=1" className="btn btn-primary">
            <IconPlus size={16} />
            <span>Create the first project</span>
          </Link>
        </RoleGuard>
      )}
    </div>
  )
}
