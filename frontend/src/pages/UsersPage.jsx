import { useCallback, useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { useToast } from '../context/ToastContext'
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api'
import { formatDateTime, relativeTime } from '../lib/format'
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconCheck,
  IconSearch,
  IconAlertTriangle,
} from '../components/Icons'

const emptyForm = { name: '', email: '', password: '', role: 'worker' }

export default function UsersPage() {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [query, setQuery] = useState('')

  const [modal, setModal] = useState({ open: false, mode: 'create', user: null })
  const [form, setForm] = useState(emptyForm)
  const [formErr, setFormErr] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const [confirm, setConfirm] = useState(null) // { user, action: 'deactivate' | 'reactivate' }
  const [deleteModal, setDeleteModal] = useState(null) // { user }
  const [deleteEmail, setDeleteEmail] = useState('')
  const [deleteErr, setDeleteErr] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet('/users', { includeInactive: showInactive })
      setUsers(data.users || [])
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [showInactive, toast])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setForm(emptyForm)
    setFormErr({})
    setModal({ open: true, mode: 'create', user: null })
  }
  function openEdit(u) {
    setForm({ name: u.name, email: u.email, password: '', role: u.role })
    setFormErr({})
    setModal({ open: true, mode: 'edit', user: u })
  }
  function closeModal() {
    if (submitting) return
    setModal({ open: false, mode: 'create', user: null })
  }

  function openDelete(u) {
    setDeleteEmail('')
    setDeleteErr('')
    setDeleteModal({ user: u })
  }

  function closeDelete() {
    if (deleteSubmitting) return
    setDeleteModal(null)
    setDeleteErr('')
    setDeleteEmail('')
  }

  async function submitDelete() {
    if (!deleteModal?.user) return
    const u = deleteModal.user
    if (
      deleteEmail.toLowerCase().trim() !==
      (u.email || '').toLowerCase().trim()
    ) {
      setDeleteErr('Email does not match.')
      return
    }
    setDeleteSubmitting(true)
    setDeleteErr('')
    try {
      const result = await apiDelete(`/users/${u.id}?hard=true`)
      const notesDeleted = result?.notes_deleted ?? 0
      const extra =
        notesDeleted > 0
          ? ` (${notesDeleted} note${notesDeleted === 1 ? '' : 's'} also removed)`
          : ''
      toast.success(`${u.name} permanently deleted${extra}.`)
      setDeleteModal(null)
      setDeleteEmail('')
      load()
    } catch (e) {
      const ed = e?.response?.data
      const reason = ed?.reason
      let msg = ed?.error || 'Delete failed'
      if (
        reason === 'owns_projects' &&
        Array.isArray(ed?.owned_projects) &&
        ed.owned_projects.length > 0
      ) {
        const names = ed.owned_projects
          .map((p) => p.name)
          .slice(0, 3)
          .join(', ')
        msg += ` (${names}${ed.owned_projects.length > 3 ? '…' : ''})`
      }
      setDeleteErr(msg)
    } finally {
      setDeleteSubmitting(false)
    }
  }

  async function submitForm(e) {
    e.preventDefault()
    setFormErr({})
    setSubmitting(true)
    try {
      if (modal.mode === 'create') {
        await apiPost('/users', form)
        toast.success(`${form.name} added.`)
      } else {
        const body = { name: form.name, email: form.email, role: form.role }
        if (form.password) body.password = form.password
        await apiPatch(`/users/${modal.user.id}`, body)
        toast.success('User updated.')
      }
      closeModal()
      load()
    } catch (e) {
      const msg = e?.response?.data?.error || 'Save failed'
      const field = e?.response?.data?.field
      if (field) setFormErr({ [field]: msg })
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function doConfirm() {
    if (!confirm) return
    const { user, action } = confirm
    try {
      if (action === 'deactivate') {
        await apiDelete(`/users/${user.id}`)
        toast.success(`${user.name} deactivated.`)
      } else if (action === 'reactivate') {
        await apiPost(`/users/${user.id}/reactivate`, {})
        toast.success(`${user.name} reactivated.`)
      }
      setConfirm(null)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Action failed')
    }
  }

  const filtered = users.filter((u) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  })

  return (
    <AppShell
      title="Users"
      subtitle="Add and manage people with access to Fifty Tracker."
      actions={
        <>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span>Show inactive</span>
          </label>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <IconPlus size={16} />
            <span>Add user</span>
          </button>
        </>
      }
    >
      <div className="filter-bar">
        <div className="search-input">
          <IconSearch size={16} className="search-icon" />
          <input
            type="search"
            className="input"
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="filter-meta">
          {loading ? (
            <span className="spinner spinner-primary" />
          ) : (
            <span>
              {filtered.length} of {users.length}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="empty">
          <div className="spinner spinner-lg spinner-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <IconPlus size={24} />
          </div>
          <div className="empty-title">
            {users.length === 0
              ? 'No users yet'
              : `No users match "${query}"`}
          </div>
          <div className="empty-text">
            {users.length === 0
              ? 'Add the first one to get started.'
              : 'Try a different search or clear the filter.'}
          </div>
          {users.length === 0 && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={openCreate}
            >
              <IconPlus size={16} />
              <span>Add first user</span>
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last update</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className={!u.active ? 'row-muted' : ''}>
                  <td>
                    <div className="cell-user">
                      <div className="avatar avatar-sm">
                        {(u.name || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <span>{u.name}</span>
                    </div>
                  </td>
                  <td className="cell-mono">{u.email}</td>
                  <td>
                    <span className={`chip chip-${u.role} chip-dot`}>{u.role}</span>
                  </td>
                  <td>
                    <span
                      className={`chip ${u.active ? 'chip-active' : 'chip-inactive'} chip-dot`}
                    >
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="cell-muted">{formatDateTime(u.created_at)}</td>
                  <td className="cell-muted">{relativeTime(u.updated_at)}</td>
                  <td className="td-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      onClick={() => openEdit(u)}
                      title="Edit"
                      aria-label={`Edit ${u.name}`}
                    >
                      <IconEdit size={16} />
                    </button>
                    {u.active ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        onClick={() =>
                          setConfirm({ user: u, action: 'deactivate' })
                        }
                        title="Deactivate"
                        aria-label={`Deactivate ${u.name}`}
                      >
                        <IconTrash size={16} />
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          onClick={() =>
                            setConfirm({ user: u, action: 'reactivate' })
                          }
                          title="Reactivate"
                          aria-label={`Reactivate ${u.name}`}
                        >
                          <IconCheck size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-icon-danger"
                          onClick={() => openDelete(u)}
                          title="Delete permanently"
                          aria-label={`Delete ${u.name} permanently`}
                        >
                          <IconAlertTriangle size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit modal */}
      <Modal
        open={modal.open}
        onClose={closeModal}
        title={modal.mode === 'create' ? 'Add a new user' : `Edit ${modal.user?.name || ''}`}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeModal}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="user-form"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting && <span className="spinner" />}
              <span>
                {submitting
                  ? 'Saving…'
                  : modal.mode === 'create'
                    ? 'Add user'
                    : 'Save changes'}
              </span>
            </button>
          </>
        }
      >
        <form id="user-form" onSubmit={submitForm} noValidate>
          <div className="field">
            <label className="field-label" htmlFor="u-name">
              Full name
            </label>
            <input
              id="u-name"
              className="input"
              required
              minLength={2}
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Sara Khalid"
            />
            {formErr.name && <div className="field-error">{formErr.name}</div>}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="u-email">
              Work email
            </label>
            <input
              id="u-email"
              type="email"
              className="input"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="sara@5ostudios.com"
            />
            {formErr.email && <div className="field-error">{formErr.email}</div>}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="u-role">
              Role
            </label>
            <select
              id="u-role"
              className="select"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="worker">Worker — sees only assigned projects</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="u-pw">
              {modal.mode === 'create' ? 'Initial password' : 'New password (optional)'}
            </label>
            <input
              id="u-pw"
              type="password"
              className="input"
              required={modal.mode === 'create'}
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 8 characters"
            />
            <div className="field-hint">
              {modal.mode === 'create'
                ? 'They can change this after first sign-in.'
                : 'Leave blank to keep the current password.'}
            </div>
            {formErr.password && (
              <div className="field-error">{formErr.password}</div>
            )}
          </div>
        </form>
      </Modal>

      {/* Confirm deactivate / reactivate */}
      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={
          confirm?.action === 'reactivate'
            ? `Reactivate ${confirm?.user?.name || 'this user'}?`
            : `Deactivate ${confirm?.user?.name || 'this user'}?`
        }
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={
                confirm?.action === 'reactivate' ? 'btn btn-primary' : 'btn btn-danger'
              }
              onClick={doConfirm}
            >
              {confirm?.action === 'reactivate' ? 'Reactivate' : 'Deactivate'}
            </button>
          </>
        }
      >
        <div className="confirm-body">
          <div className="confirm-icon">
            <IconAlertTriangle size={28} />
          </div>
          <p>
            {confirm?.action === 'reactivate'
              ? `${confirm?.user?.name || 'This user'} will be able to sign in and access the tracker again.`
              : `${confirm?.user?.name || 'This user'} will no longer be able to sign in. Their data stays intact and you can reactivate any time.`}
          </p>
        </div>
      </Modal>

      {/* Hard-delete (permanent) modal */}
      <Modal
        open={Boolean(deleteModal)}
        onClose={closeDelete}
        title={`Permanently delete ${deleteModal?.user?.name || 'this user'}?`}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeDelete}
              disabled={deleteSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={submitDelete}
              disabled={
                deleteSubmitting ||
                deleteEmail.toLowerCase().trim() !==
                  (deleteModal?.user?.email || '').toLowerCase().trim()
              }
            >
              {deleteSubmitting && <span className="spinner" />}
              <span>
                {deleteSubmitting ? 'Deleting…' : 'Delete permanently'}
              </span>
            </button>
          </>
        }
      >
        <div className="confirm-body">
          <div className="confirm-icon confirm-icon-danger">
            <IconAlertTriangle size={28} />
          </div>
          <p>
            This will <strong>permanently remove</strong>{' '}
            <strong>{deleteModal?.user?.name}</strong> from the system. This
            action <strong>cannot be undone</strong>. Notes authored by this
            user will also be removed.
          </p>
          <div className="field" style={{ marginTop: 18 }}>
            <label className="field-label" htmlFor="confirm-delete-email">
              Type the user's email to confirm:
            </label>
            <code className="cell-mono confirm-target-email">
              {deleteModal?.user?.email}
            </code>
            <input
              id="confirm-delete-email"
              type="email"
              className="input"
              value={deleteEmail}
              onChange={(e) => {
                setDeleteEmail(e.target.value)
                if (deleteErr) setDeleteErr('')
              }}
              placeholder="paste or type the email above"
              autoComplete="off"
              autoFocus
              disabled={deleteSubmitting}
            />
            {deleteErr && <div className="field-error">{deleteErr}</div>}
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
