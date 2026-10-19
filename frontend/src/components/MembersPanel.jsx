import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import RoleGuard from './RoleGuard'
import ConfirmModal from './ConfirmModal'
import { useToast } from '../context/ToastContext'
import { apiDelete, apiGet, apiPost } from '../lib/api'
import {
  userDisplayName,
  userInitials,
  parseApiError,
} from '../lib/domain'
import {
  IconUserPlus,
  IconUserMinus,
  IconShield,
  IconSearch,
} from './Icons'

/* ---------- Main panel ---------- */
export default function MembersPanel({ project, onChanged, canEdit }) {
  const toast = useToast()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [removing, setRemoving] = useState(null)

  const members = project.members || []
  const ownerId = project.owner_id

  // Normalize member data: backend returns flat rows from a JOIN with users
  // ({ id, name, email, role, ... }), but some code paths still expect the
  // older nested format ({ user_id, user: {...} }). Resolve the user id and
  // user object once so the rest of the component can stay simple.
  const getMemberId = (m) => m?.user_id ?? m?.id
  const getMemberUser = (m) => m?.user ?? m

  async function remove() {
    if (!removing) return
    try {
      await apiDelete(`/projects/${project.id}/members/${getMemberId(removing)}`)
      toast.success(`${userDisplayName(getMemberUser(removing))} removed.`)
      setRemoving(null)
      onChanged?.()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Team</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {members.length} {members.length === 1 ? 'member' : 'members'} on this project.
          </p>
        </div>
        {canEdit && (
          <RoleGuard allow={['admin']}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPickerOpen(true)}>
              <IconUserPlus size={14} />
              <span>Add member</span>
            </button>
          </RoleGuard>
        )}
      </div>

      <div className="member-list">
        {/* Owner row — always shown first */}
        <MemberRow
          project={project}
          userId={ownerId}
          role="Owner"
          owner
        />
        {members
          .filter((m) => getMemberId(m) !== ownerId)
          .map((m) => (
            <MemberRow
              key={getMemberId(m)}
              project={project}
              member={m}
              onRemove={canEdit ? () => setRemoving(m) : null}
            />
          ))}
        {members.filter((m) => getMemberId(m) !== ownerId).length === 0 && (
          <div className="empty" style={{ padding: 28 }}>
            <div className="empty-icon">
              <IconUserPlus size={22} />
            </div>
            <div className="empty-title">No additional team members yet</div>
            <div className="empty-text">
              {canEdit ? 'Add people who should be able to view and work on this project.' : 'Just the owner so far.'}
            </div>
          </div>
        )}
      </div>

      <UserPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        projectId={project.id}
        existingIds={new Set([ownerId, ...members.map((m) => getMemberId(m))])}
        onAdded={() => {
          setPickerOpen(false)
          onChanged?.()
        }}
      />

      <ConfirmModal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing ? userDisplayName(getMemberUser(removing)) : 'member'}?`}
        body={`They'll lose access to this project. You can re-add them any time.`}
        danger
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  )
}

function MemberRow({ project, member, userId, role, owner, onRemove }) {
  const toast = useToast()
  // The backend already returns the full user row (id, name, email, role)
  // joined onto each member, so we don't need to lazy-load. Fall back to the
  // older nested `member.user` shape just in case.
  const initialUser = member?.user ?? member ?? null
  const [u, setU] = useState(initialUser)
  useEffect(() => {
    let cancelled = false
    if (u) return
    const id = userId ?? member?.user_id ?? member?.id
    if (!id) return
    // We don't have a /api/users/:id endpoint, so try to find in the bulk list
    // via /api/users?active=true and cache.
    apiGet('/users')
      .then((data) => {
        if (cancelled) return
        const found = (data.users || []).find((x) => x.id === id)
        if (found) setU(found)
      })
      .catch(() => {
        // fall through — row will show "User #N" placeholder
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, member?.user_id, member?.id])

  return (
    <div className="member-row">
      <div className="member-avatar">{u ? userInitials(u) : `#${userId ?? member?.user_id ?? member?.id}`}</div>
      <div className="member-body">
        <div className="member-name">
          {u ? userDisplayName(u) : `User #${userId ?? member?.user_id ?? member?.id}`}
        </div>
        <div className="member-email">
          {u?.email || (u ? '' : 'Loading…')}
        </div>
        <div className="member-role" style={{ marginTop: 4 }}>
          {owner ? (
            <span className="chip chip-admin chip-dot">
              <IconShield size={11} />
              Owner
            </span>
          ) : (
            <span className="chip chip-worker chip-dot">Member</span>
          )}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onRemove}
          title="Remove"
          aria-label="Remove"
        >
          <IconUserMinus size={16} />
        </button>
      )}
    </div>
  )
}

/* ---------- User picker modal ---------- */
function UserPicker({ open, onClose, projectId, existingIds, onAdded }) {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setQuery('')
    setSelected(null)
    setLoading(true)
    apiGet('/users', { active: 'true' })
      .then((data) => {
        if (cancelled) return
        setUsers(data.users || [])
      })
      .catch(() => {
        if (cancelled) return
        toast.error('Failed to load users.')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [open, toast])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users
      .filter((u) => !existingIds.has(u.id))
      .filter((u) => {
        if (!q) return true
        return (
          (u.name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q)
        )
      })
  }, [users, query, existingIds])

  async function add() {
    if (!selected) return
    setSubmitting(true)
    try {
      await apiPost(`/projects/${projectId}/members`, { user_id: selected.id })
      toast.success(`${userDisplayName(selected)} added.`)
      onAdded?.()
    } catch (e) {
      const { message } = parseApiError(e)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add member"
      maxWidth={460}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={add}
            disabled={!selected || submitting}
          >
            {submitting && <span className="spinner" />}
            <span>{submitting ? 'Adding…' : 'Add'}</span>
          </button>
        </>
      }
    >
      <div className="field">
        <div className="search-input">
          <IconSearch size={16} className="search-icon" />
          <input
            type="search"
            className="input"
            placeholder="Search users by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      {loading ? (
        <div className="empty" style={{ padding: 24 }}>
          <div className="spinner spinner-lg spinner-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty" style={{ padding: 24 }}>
          <div className="empty-title">No users found</div>
          <div className="empty-text">
            {query ? 'Try a different search.' : 'All active users are already on this project.'}
          </div>
        </div>
      ) : (
        <div className="user-picker">
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              className={`user-picker-row ${selected?.id === u.id ? 'is-on' : ''}`}
              onClick={() => setSelected(u)}
            >
              <div className="avatar avatar-sm">{userInitials(u)}</div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="user-picker-name">{userDisplayName(u)}</div>
                <div className="user-picker-email">{u.email}</div>
              </div>
              <span className={`chip chip-${u.role}`} style={{ fontSize: 10 }}>{u.role}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
