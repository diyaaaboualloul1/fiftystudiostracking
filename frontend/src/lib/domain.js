// Phase 2 domain helpers — labels, colors, formatters

/**
 * Strip any date value to YYYY-MM-DD for HTML <input type="date">.
 * The pg driver returns DATE as a full ISO timestamp like "2026-10-31T00:00:00.000Z",
 * which the date input can't parse. This slices to the date part before any
 * timezone conversion can shift it.
 */
export function toDateInputValue(v) {
  if (!v) return ''
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
    if (m) return m[1]
    return ''
  }
  if (v instanceof Date) {
    const y = v.getUTCFullYear()
    const m = String(v.getUTCMonth() + 1).padStart(2, '0')
    const d = String(v.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return ''
}

/* ---------- Project status (4 simplified values) ---------- */
export const PROJECT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'ready', label: 'Ready' },
  { value: 'archived', label: 'Archived' },
]

// Map any legacy 8-value status to the simplified 4-value status.
const PROJECT_STATUS_LEGACY_MAP = {
  new_development: 'active',
  updates_in_progress: 'active',
  not_started: 'active',
  up_to_date: 'active',
  on_hold: 'paused',
  waiting_for_client: 'paused',
  ready_to_close: 'ready',
  archived: 'archived',
}

export function normalizeProjectStatus(s) {
  return PROJECT_STATUS_LEGACY_MAP[s] || s
}

export function projectStatusLabel(s) {
  if (!s) return '—'
  return PROJECT_STATUSES.find((x) => x.value === normalizeProjectStatus(s))?.label || s
}

/* ---------- Project state ---------- */
export const PROJECT_STATES = [
  { value: 'new_build', label: 'New build', desc: 'Building from scratch' },
  { value: 'already_built', label: 'Already built', desc: 'Maintaining an existing product' },
]

export function projectStateLabel(s) {
  if (!s) return '—'
  return PROJECT_STATES.find((x) => x.value === s)?.label || s
}

export function projectStateDesc(s) {
  if (!s) return ''
  return PROJECT_STATES.find((x) => x.value === s)?.desc || ''
}

/* ---------- Phase status ---------- */
export const PHASE_STATUSES = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'waiting_for_client', label: 'Waiting for client' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
]

export function phaseStatusLabel(s) {
  if (!s) return '—'
  return PHASE_STATUSES.find((x) => x.value === s)?.label || s
}

/* ---------- Edit status ---------- */
export const EDIT_STATUSES = [
  { value: 'to_do', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'testing', label: 'Testing' },
  { value: 'waiting_for_client', label: 'Waiting for client' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function editStatusLabel(s) {
  if (!s) return '—'
  return EDIT_STATUSES.find((x) => x.value === s)?.label || s
}

/* ---------- Edit status (kanban columns) ---------- */
export const KANBAN_COLUMNS = [
  { value: 'to_do', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'testing', label: 'Testing' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

/* ---------- Date helpers (Asia/Kuwait) ---------- */

const KUWAIT_TZ = 'Asia/Kuwait'

/** Today in Asia/Kuwait, as a YYYY-MM-DD string. */
export function todayInKuwait() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KUWAIT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Format a YYYY-MM-DD or ISO string as "Oct 18, 2026" (no tz shift). */
export function fmtDate(d) {
  if (!d) return '—'
  // If it's a YYYY-MM-DD (date-only, no time), format from the string parts
  // directly to avoid any timezone shift from new Date(iso) parsing.
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    return `${MONTH_SHORT[m - 1]} ${day}, ${y}`
  }
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Short "Oct 18" — used in chips / cards. */
export function fmtDateShort(d) {
  if (!d) return '—'
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [, m, day] = d.split('-').map(Number)
    return `${MONTH_SHORT[m - 1]} ${day}`
  }
  return new Date(d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** "in 3 days" / "2 days ago" relative to today (Asia/Kuwait). */
export function fmtDeadline(iso) {
  if (!iso) return ''
  // date-only — diff in days
  let target
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    target = new Date(y, m - 1, d)
  } else {
    target = new Date(iso)
  }
  const today = new Date()
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diffDays = Math.round((target - todayMid) / 86400000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays === -1) return 'yesterday'
  if (diffDays > 1 && diffDays <= 7) return `in ${diffDays} days`
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`
  return fmtDate(iso)
}

/** Is this date in the past (relative to today, Asia/Kuwait)? */
export function isOverdue(d) {
  if (!d) return false
  let target
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    target = new Date(y, m - 1, day)
  } else {
    target = new Date(d)
  }
  const today = new Date()
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return target < todayMid
}

/* ---------- User helpers ---------- */
export function userDisplayName(u) {
  if (!u) return '—'
  return u.name || u.email || `User #${u.id}`
}

export function userInitials(u) {
  const n = userDisplayName(u)
  return n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?'
}

/* ---------- Misc ---------- */
export function progressPercent(p) {
  if (!p) return 0
  if (typeof p === 'number') return Math.max(0, Math.min(100, p))
  if (typeof p === 'object') {
    if (typeof p.percent === 'number') return p.percent
    if (p.total > 0) return Math.round((p.done / p.total) * 100)
  }
  return 0
}

export function progressLabel(p) {
  if (!p) return ''
  if (typeof p === 'string') return p
  if (typeof p === 'object' && p.label) return p.label
  if (typeof p === 'object' && p.total != null) return `${p.done}/${p.total}`
  return ''
}

/** Parse a server error into {message, field?, currentVersion?}. */
export function parseApiError(err) {
  const status = err?.response?.status
  const data = err?.response?.data || {}
  const msg = data.error || data.message || err?.message || 'Request failed'
  return {
    status,
    message: msg,
    field: data.field,
    currentVersion: data.current_version,
    yourVersion: data.your_version,
    needsConfirmation: data.needs_confirmation,
    suggestedDate: data.suggested_original_delivery_date,
  }
}
