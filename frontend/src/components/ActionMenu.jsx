import { useEffect, useRef, useState } from 'react'
import { IconMoreH } from './Icons'

/**
 * Kebab action menu. Renders a button + a pop-up of items.
 * items: [{ label, icon, onClick, danger }]
 */
export default function ActionMenu({ items, label = 'Actions', buttonClass = 'btn btn-ghost btn-icon' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="action-menu" ref={ref}>
      <button
        type="button"
        className={buttonClass}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        <IconMoreH size={18} />
      </button>
      {open && (
        <div className="action-menu-pop" role="menu">
          {items.map((it, idx) => (
            <button
              key={idx}
              type="button"
              className={`action-menu-item ${it.danger ? 'danger' : ''}`}
              onClick={() => {
                setOpen(false)
                it.onClick?.()
              }}
              role="menuitem"
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
