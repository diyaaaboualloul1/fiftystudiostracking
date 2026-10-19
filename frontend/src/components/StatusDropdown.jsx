import { useEffect, useRef, useState } from 'react'
import { IconChevronDown } from './Icons'
import { editStatusLabel } from '../lib/domain'

/**
 * Compact status dropdown used inside the Edit detail page.
 * options: [{ value, label }]
 * current: string (current status value)
 * onChange: (newValue) => void
 */
export default function StatusDropdown({ current, options, onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const currentLabel = options.find((o) => o.value === current)?.label || editStatusLabel(current)

  return (
    <div className="status-dropdown" ref={ref}>
      <button
        type="button"
        className={`status-pill status-${current} ${className}`}
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: 'pointer', border: '1px solid var(--border)' }}
      >
        {currentLabel}
        <IconChevronDown size={11} />
      </button>
      {open && (
        <div className="status-dropdown-pop" role="menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`status-dropdown-item ${o.value === current ? 'is-current' : ''}`}
              onClick={() => {
                setOpen(false)
                if (o.value !== current) onChange?.(o.value)
              }}
              role="menuitem"
            >
              <span className={`status-pill status-${o.value}`} style={{ padding: '2px 8px', fontSize: 10.5 }}>
                {o.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
