import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { useToast } from '../context/ToastContext'
import { apiPost } from '../lib/api'
import { PROJECT_STATES, parseApiError } from '../lib/domain'
import { useAuth } from '../context/AuthContext'

export default function CreateProjectModal({ open, onClose, onCreated, users = [] }) {
  const toast = useToast()
  const navigate = useNavigate()
  const { user: me } = useAuth()

  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [description, setDescription] = useState('')
  const [ownerId, setOwnerId] = useState(me?.id || '')
  const [projectState, setProjectState] = useState('new_build')
  const [projectDeadline, setProjectDeadline] = useState('')

  const [errs, setErrs] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setClient('')
      setDescription('')
      setOwnerId(me?.id || '')
      setProjectState('new_build')
      setProjectDeadline('')
      setErrs({})
    }
  }, [open, me])

  async function submit(e) {
    e.preventDefault()
    const err = {}
    if (!name || name.trim().length < 2) err.name = 'Name must be at least 2 characters.'
    if (!ownerId) err.owner_id = 'Pick an owner.'
    setErrs(err)
    if (Object.keys(err).length) return

    setSubmitting(true)
    try {
      const body = {
        name: name.trim(),
        owner_id: Number(ownerId),
        project_state: projectState,
        project_deadline: projectDeadline || null,
        client: client.trim() || undefined,
        description: description.trim() || undefined,
      }
      const { project } = await apiPost('/projects', body)
      toast.success(`Project "${project.name}" created.`)
      onCreated?.(project)
      onClose?.()
      navigate(`/projects/${project.id}`)
    } catch (e) {
      const { message, field } = parseApiError(e)
      if (field) setErrs({ [field]: message })
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      maxWidth={560}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="create-project-form" className="btn btn-primary" disabled={submitting}>
            {submitting && <span className="spinner" />}
            <span>{submitting ? 'Creating…' : 'Create project'}</span>
          </button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="cp-name">
            Project name
          </label>
          <input
            id="cp-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Online Storefront"
            maxLength={140}
            autoFocus
            required
          />
          {errs.name && <div className="field-error">{errs.name}</div>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="cp-client">
            Client <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="cp-client"
            className="input"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Acme Co."
            maxLength={140}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="cp-desc">
            Description <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            id="cp-desc"
            className="textarea textarea-compact"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this project is about."
            maxLength={2000}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="cp-owner">
            Owner
          </label>
          <select
            id="cp-owner"
            className="select"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          >
            {users.length === 0 && <option value={me?.id || ''}>Me ({me?.name || 'You'})</option>}
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.email}
              </option>
            ))}
          </select>
          {errs.owner_id && <div className="field-error">{errs.owner_id}</div>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="cp-deadline">
            Project deadline <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="cp-deadline"
            type="date"
            className="input"
            value={projectDeadline}
            onChange={(e) => setProjectDeadline(e.target.value)}
          />
          {errs.project_deadline && <div className="field-error">{errs.project_deadline}</div>}
        </div>

        <div className="field">
          <label className="field-label">Project type</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {PROJECT_STATES.map((s) => (
              <label
                key={s.value}
                className={`card card-hover`}
                style={{
                  padding: 14,
                  cursor: 'pointer',
                  borderColor: projectState === s.value ? 'var(--primary)' : 'var(--border)',
                  background: projectState === s.value ? 'var(--primary-soft)' : 'var(--bg-elev-2)',
                }}
              >
                <input
                  type="radio"
                  name="project_state"
                  value={s.value}
                  checked={projectState === s.value}
                  onChange={() => setProjectState(s.value)}
                  style={{ display: 'none' }}
                />
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.desc}</div>
              </label>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  )
}
