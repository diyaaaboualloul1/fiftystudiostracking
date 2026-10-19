import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '../context/ToastContext'
import { apiGet } from '../lib/api'
import { parseApiError, fmtDate } from '../lib/domain'
import { relativeTime } from '../lib/format'
import {
  IconActivity,
  IconPlus,
  IconEdit,
  IconArchive,
  IconRestore,
  IconCheck,
  IconStop,
  IconPause,
  IconLink,
  IconUserPlus,
  IconUserMinus,
  IconNote,
  IconBan,
  IconChevronDown,
  IconChevronRight,
  IconPlay,
} from './Icons'

const ENTITY_TYPES = [
  { value: 'project', label: 'Project' },
  { value: 'phase', label: 'Phase' },
  { value: 'edit', label: 'Edit' },
  { value: 'note', label: 'Note' },
  { value: 'link', label: 'Link' },
  { value: 'member', label: 'Member' },
]

const ACTION_ICON = {
  create: <IconPlus size={14} />,
  update: <IconEdit size={14} />,
  archive: <IconArchive size={14} />,
  restore: <IconRestore size={14} />,
  activate: <IconPlay size={14} />,
  complete: <IconCheck size={14} />,
  add_member: <IconUserPlus size={14} />,
  remove_member: <IconUserMinus size={14} />,
  add_link: <IconLink size={14} />,
  update_link: <IconEdit size={14} />,
  remove_link: <IconBan size={14} />,
  add_note: <IconNote size={14} />,
}

const ACTION_LABEL = {
  create: 'created',
  update: 'updated',
  archive: 'archived',
  restore: 'restored',
  activate: 'activated',
  complete: 'completed',
  add_member: 'added member',
  remove_member: 'removed member',
  add_link: 'added link',
  update_link: 'updated link',
  remove_link: 'removed link',
  add_note: 'added note',
}

const PAGE_SIZE = 25

export default function ActivityPanel({ projectId }) {
  const toast = useToast()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [filters, setFilters] = useState({ entity_type: '', action: '' })
  const [showFilters, setShowFilters] = useState(false)

  const load = useCallback(
    async (reset = true) => {
      if (reset) setLoading(true)
      else setLoadingMore(true)
      try {
        const params = { limit: PAGE_SIZE }
        if (!reset && events.length) {
          // Use the oldest loaded event's ts as the "before" cursor
          params.before = events[events.length - 1].ts
        }
        const data = await apiGet(`/projects/${projectId}/activity`, params)
        const list = data.activity || []
        if (reset) {
          setEvents(list)
        } else {
          setEvents((cur) => [...cur, ...list])
        }
        setHasMore(list.length === PAGE_SIZE)
      } catch (e) {
        const { message } = parseApiError(e)
        toast.error(message)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [projectId, events, toast],
  )

  useEffect(() => {
    setEvents([])
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const filtered = useMemo(() => {
    if (!filters.entity_type && !filters.action) return events
    return events.filter((ev) => {
      if (filters.entity_type && ev.entity_type !== filters.entity_type) return false
      if (filters.action && ev.action !== filters.action) return false
      return true
    })
  }, [events, filters])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Activity</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {loading ? 'Loading…' : `${filtered.length} event${filtered.length === 1 ? '' : 's'}.`}
          </p>
        </div>
        <button
          type="button"
          className={`filter-pill ${showFilters || filters.entity_type || filters.action ? 'is-on' : ''}`}
          onClick={() => setShowFilters((s) => !s)}
        >
          Filters
        </button>
      </div>

      {showFilters && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <select
            className="select filter-select"
            value={filters.entity_type}
            onChange={(e) => setFilters((f) => ({ ...f, entity_type: e.target.value }))}
          >
            <option value="">All entity types</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
          <select
            className="select filter-select"
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
          >
            <option value="">All actions</option>
            {Object.keys(ACTION_LABEL).map((a) => (
              <option key={a} value={a}>{ACTION_LABEL[a]}</option>
            ))}
          </select>
          {(filters.entity_type || filters.action) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFilters({ entity_type: '', action: '' })}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="empty"><div className="spinner spinner-lg spinner-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><IconActivity size={24} /></div>
          <div className="empty-title">No activity yet</div>
          <div className="empty-text">
            Once changes happen, they'll show up here.
          </div>
        </div>
      ) : (
        <>
          <div className="activity-list">
            {filtered.map((ev) => (
              <ActivityRow key={ev.id} ev={ev} />
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => load(false)}
                disabled={loadingMore}
              >
                {loadingMore ? <span className="spinner" /> : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ActivityRow({ ev }) {
  const [open, setOpen] = useState(false)
  const hasDiff = ev.old_values || ev.new_values
  const actionLabel = ACTION_LABEL[ev.action] || ev.action
  const entityLabel = ev.entity_type ? ev.entity_type.replace('_', ' ') : 'item'

  return (
    <div className="activity-row">
      <div className={`activity-icon ${ev.action}`}>
        {ACTION_ICON[ev.action] || <IconActivity size={14} />}
      </div>
      <div className="activity-body">
        <div className="activity-line">
          <strong>{ev.actor_name || 'System'}</strong>{' '}
          {actionLabel}{' '}
          a {entityLabel}
          {ev.entity_id ? ` #${ev.entity_id}` : ''}
        </div>
        <div className="activity-meta">
          <span>{relativeTime(ev.ts)}</span>
          <span style={{ color: 'var(--text-dim)' }}>·</span>
          <span>{fmtDate(ev.ts, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          {hasDiff && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              <span>{open ? 'Hide' : 'Details'}</span>
            </button>
          )}
        </div>
        {ev.reason && <div className="activity-reason">"{ev.reason}"</div>}
        {hasDiff && open && (
          <div className="activity-diff">
            <div className="activity-diff-head">
              <span>Before → After</span>
              <span>{ev.entity_type} #{ev.entity_id}</span>
            </div>
            <div className="activity-diff-body">
              <div className="activity-diff-side old">
                <h4>Before</h4>
                <pre>{JSON.stringify(ev.old_values || {}, null, 2)}</pre>
              </div>
              <div className="activity-diff-side new">
                <h4>After</h4>
                <pre>{JSON.stringify(ev.new_values || {}, null, 2)}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
