import { useEffect, useState } from 'react'
import Modal from './Modal'
import { useToast } from '../context/ToastContext'
import { apiPatch } from '../lib/api'
import { parseApiError, toDateInputValue } from '../lib/domain'

export default function EditProjectModal({ open, onClose, project, onSaved }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [description, setDescription] = useState('')
  const [projectDeadline, setProjectDeadline] = useState('')
  const [errs, setErrs] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open && project) {
      setName(project.name || '')
      setClient(project.client || '')
      setDescription(project.description || '')
      setProjectDeadline(toDateInputValue(project.project_deadline))
      setErrs({})
    }
  }, [open, project])

  async function submit(e) {
    e.preventDefault()
    if (!project) return
    const err = {}
    if (!name || name.trim().length < 2) err.name = 'Name must be at least 2 characters.'
    setErrs(err)
    if (Object.keys(err).length) return

    setSubmitting(true)
    try {
      const body = {
        name: name.trim(),
        client: client.trim() || null,
        description: description.trim() || null,
        project_deadline: projectDeadline || null,
        version: project.version,
      }
      const { project: updated } = await apiPatch(
        `/projects/${project.id}`,
        body,
        { headers: { 'If-Match': String(project.version) } },
      )
      toast.success('Project updated.')
      onSaved?.(updated)
      onClose?.()
    } catch (e) {
      const { status, message, field, currentVersion } = parseApiError(e)
      if (status === 409) {
        toast.error('Project was modified by someone else. Refreshing…')
        onSaved?.(null, { conflict: true })
        onClose?.()
      } else if (field) {
        setErrs({ [field]: message })
        toast.error(message)
      } else {
        toast.error(message)
      }
      // surface current version to caller for refresh
      if (currentVersion) {
        // no-op (caller can re-fetch)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit "${project?.name || 'project'}"`}
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="edit-project-form" className="btn btn-primary" disabled={submitting}>
            {submitting && <span className="spinner" />}
            <span>{submitting ? 'Saving…' : 'Save changes'}</span>
          </button>
        </>
      }
    >
      <form id="edit-project-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="ep-name">Name</label>
          <input
            id="ep-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={140}
            autoFocus
          />
          {errs.name && <div className="field-error">{errs.name}</div>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ep-client">Client</label>
          <input
            id="ep-client"
            className="input"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            maxLength={140}
            placeholder="(optional)"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ep-desc">Description</label>
          <textarea
            id="ep-desc"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="(optional)"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ep-pd">Project deadline <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span></label>
          <input
            id="ep-pd"
            type="date"
            className="input"
            value={projectDeadline}
            onChange={(e) => setProjectDeadline(e.target.value)}
          />
          <div className="field-hint">
            The overall delivery promise for this project. Independent from any individual phase deadline.
          </div>
        </div>
      </form>
    </Modal>
  )
}
