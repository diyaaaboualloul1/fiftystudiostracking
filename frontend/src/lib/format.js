// Brand-true teal + cyan — extracted from 5ostudios.com
export const ROLE_LABELS = {
  admin: 'Admin',
  worker: 'Worker',
}

export const ROLE_DESCRIPTIONS = {
  admin: 'Full access. Manages users, projects, and all data.',
  worker: 'Sees only assigned projects. Updates only their own edits.',
}

export function relativeTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 45) return 'just now'
  if (diff < 90) return 'a minute ago'
  if (diff < 60 * 45) return `${Math.round(diff / 60)}m ago`
  if (diff < 60 * 90) return 'an hour ago'
  if (diff < 60 * 60 * 24) return `${Math.round(diff / 3600)}h ago`
  if (diff < 60 * 60 * 36) return 'yesterday'
  if (diff < 60 * 60 * 24 * 7)
    return `${Math.round(diff / 86400)}d ago`
  return d.toLocaleDateString()
}

export function formatDate(iso, opts = {}) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...opts,
  })
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?'
}
