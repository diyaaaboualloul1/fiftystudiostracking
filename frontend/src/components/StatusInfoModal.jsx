import { IconX } from './Icons'

const PROJECT_STATUS_INFO = [
  { value: 'active', label: 'Active', desc: 'Work is happening or ready to start.' },
  { value: 'paused', label: 'Paused', desc: 'Blocked — on hold or waiting on the client.' },
  { value: 'ready', label: 'Ready', desc: 'All edits in current phase are done — just needs to close.' },
  { value: 'archived', label: 'Archived', desc: 'Hidden, kept for history.' },
]

const PHASE_STATUS_INFO = [
  { value: 'planned', label: 'Planned', desc: 'Created, not started yet.' },
  { value: 'active', label: 'Active', desc: 'Currently being worked on. Only one active phase per project.' },
  { value: 'waiting_for_client', label: 'Waiting for client', desc: 'Blocked on client feedback (reason shown).' },
  { value: 'on_hold', label: 'On hold', desc: 'Paused for internal reason (reason shown).' },
  { value: 'completed', label: 'Completed', desc: 'All edits done, phase delivered.' },
]

const EDIT_STATUS_INFO = [
  { value: 'to_do', label: 'To do', desc: 'Not started yet.' },
  { value: 'in_progress', label: 'In progress', desc: 'Work is happening.' },
  { value: 'testing', label: 'Testing', desc: 'Work done, being verified.' },
  { value: 'waiting', label: 'Waiting', desc: 'Blocked on something (reason shown).' },
  { value: 'done', label: 'Done', desc: 'Completed.' },
  { value: 'cancelled', label: 'Cancelled', desc: "Won't be done (reason shown)." },
]

const ENTITY_CONFIG = {
  project: {
    title: 'Project status',
    rows: PROJECT_STATUS_INFO,
    footer: 'The pill next to the project name (MAINTENANCE / NEW BUILD) is the state — it never changes.',
    chain: 'Project status follows the active phase: if the active phase is on_hold or waiting, the project shows Paused; if all edits in it are done, the project shows Ready.',
  },
  phase: {
    title: 'Phase status',
    rows: PHASE_STATUS_INFO,
    footer: 'Only one phase can be active at a time per project. Archive the current one to swap.',
    chain: 'A phase that is on_hold or waiting makes the whole project show Paused. A phase with every edit done makes the project show Ready.',
  },
  edit: {
    title: 'Edit status',
    rows: EDIT_STATUS_INFO,
    footer: "Cancelled edits count as 'done' for phase completion.",
    chain: 'When every edit in the current phase is done, the project flips to Ready and the phase can be closed.',
  },
}

export default function StatusInfoModal({ open, onClose, entity = 'project' }) {
  if (!open) return null
  const cfg = ENTITY_CONFIG[entity] || ENTITY_CONFIG.project

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal status-info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{cfg.title}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="modal-body status-info-body">
          {cfg.rows.map((row) => (
            <div key={row.value} className="status-info-row">
              <span className={`status-pill status-${row.value}`}>{row.label}</span>
              <span className="status-info-desc">{row.desc}</span>
            </div>
          ))}
        </div>
        <div className="modal-footer status-info-footer">
          <div className="status-info-footnote">
            <small>{cfg.footer}</small>
          </div>
          {cfg.chain && (
            <div className="status-info-chain">
              <span className="status-info-chain-label">How it links</span>
              <small>{cfg.chain}</small>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
