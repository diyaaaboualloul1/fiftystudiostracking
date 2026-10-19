import { useEffect, useState } from 'react'
import Modal from './Modal'
import RoleGuard from './RoleGuard'
import { useToast } from '../context/ToastContext'
import { apiDelete, apiPatch, apiPost } from '../lib/api'
import { parseApiError } from '../lib/domain'
import {
  IconLink,
  IconExternal,
  IconEdit,
  IconTrash,
  IconPlus,
} from './Icons'

export default function LinksPanel({ project, onChanged, canEdit }) {
  const toast = useToast()
  const [modal, setModal] = useState({ open: false, mode: 'add', link: null })
  const [removing, setRemoving] = useState(null)
  const links = project.links || []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Links</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {links.length === 0
              ? 'No external links yet.'
              : `${links.length} ${links.length === 1 ? 'link' : 'links'}.`}
          </p>
        </div>
        {canEdit && (
          <RoleGuard allow={['admin']}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setModal({ open: true, mode: 'add', link: null })}
            >
              <IconPlus size={14} />
              <span>Add link</span>
            </button>
          </RoleGuard>
        )}
      </div>

      <div className="link-list">
        {links.map((l) => (
          <div key={l.id} className="link-row">
            <div className="link-icon">
              <IconLink size={18} />
            </div>
            <div className="link-body">
              <div className="link-label">{l.label}</div>
              <a
                className="link-url"
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
              >
                <span>{l.url}</span>
                <IconExternal size={11} />
              </a>
            </div>
            {canEdit && (
              <RoleGuard allow={['admin']}>
                <div className="link-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setModal({ open: true, mode: 'edit', link: l })}
                    title="Edit"
                    aria-label="Edit"
                  >
                    <IconEdit size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setRemoving(l)}
                    title="Remove"
                    aria-label="Remove"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </RoleGuard>
            )}
          </div>
        ))}
        {links.length === 0 && (
          <div className="empty" style={{ padding: 28 }}>
            <div className="empty-icon">
              <IconLink size={22} />
            </div>
            <div className="empty-title">No links yet</div>
            <div className="empty-text">
              {canEdit
                ? 'Add a link to the design, the repo, the live site, anywhere useful.'
                : 'Once added, project links will show up here.'}
            </div>
          </div>
        )}
      </div>

      <LinkFormModal
        open={modal.open}
        mode={modal.mode}
        link={modal.link}
        projectId={project.id}
        existingLabels={links.map((l) => l.label)}
        onClose={() => setModal({ open: false, mode: 'add', link: null })}
        onSaved={() => {
          setModal({ open: false, mode: 'add', link: null })
          onChanged?.()
        }}
      />

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Remove link "${removing?.label || ''}"?`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await apiDelete(`/projects/${project.id}/links/${removing.id}`)
                  toast.success('Link removed.')
                  setRemoving(null)
                  onChanged?.()
                } catch (e) {
                  const { message } = parseApiError(e)
                  toast.error(message)
                }
              }}
            >
              Remove
            </button>
          </>
        }
      >
        <div className="confirm-body">
          <div className="confirm-icon">
            <IconTrash size={28} />
          </div>
          <p>This will remove the link from the project. The destination itself isn't affected.</p>
        </div>
      </Modal>
    </div>
  )
}

function LinkFormModal({ open, mode, link, projectId, existingLabels, onClose, onSaved }) {
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [errs, setErrs] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setLabel(link?.label || '')
      setUrl(link?.url || '')
      setErrs({})
    }
  }, [open, link])

  async function submit(e) {
    e.preventDefault()
    const err = {}
    if (!label || label.trim().length < 1) err.label = 'Label is required.'
    if (!url || url.trim().length < 4) err.url = 'URL is required.'
    else if (!/^https?:\/\//i.test(url.trim())) err.url = 'URL must start with http:// or https://'
    setErrs(err)
    if (Object.keys(err).length) return

    setSubmitting(true)
    try {
      if (mode === 'add') {
        await apiPost(`/projects/${projectId}/links`, {
          label: label.trim(),
          url: url.trim(),
        })
        toast.success('Link added.')
      } else {
        await apiPatch(`/projects/${projectId}/links/${link.id}`, {
          label: label.trim(),
          url: url.trim(),
        })
        toast.success('Link updated.')
      }
      onSaved?.()
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
      title={mode === 'add' ? 'Add link' : 'Edit link'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="link-form" className="btn btn-primary" disabled={submitting}>
            {submitting && <span className="spinner" />}
            <span>{submitting ? 'Saving…' : 'Save'}</span>
          </button>
        </>
      }
    >
      <form id="link-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="lf-label">Label</label>
          <input
            id="lf-label"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Figma"
            maxLength={120}
            autoFocus
          />
          {errs.label && <div className="field-error">{errs.label}</div>}
          {mode === 'add' && existingLabels.includes(label.trim()) && label.trim() && (
            <div className="field-hint" style={{ color: 'var(--warning)' }}>
              A link with this label already exists on this project.
            </div>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="lf-url">URL</label>
          <input
            id="lf-url"
            type="url"
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://figma.com/..."
            maxLength={500}
          />
          {errs.url && <div className="field-error">{errs.url}</div>}
        </div>
      </form>
    </Modal>
  )
}
