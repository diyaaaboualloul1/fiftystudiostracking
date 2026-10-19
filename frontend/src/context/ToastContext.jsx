import { createContext, useCallback, useContext, useState, useRef } from 'react'

const ToastContext = createContext(null)

const MAX_VISIBLE = 4 // cap on stacked toasts
const DEDUPE_WINDOW_MS = 1500 // suppress identical (kind+msg) within this window

let id = 0
const nextId = () => ++id

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const lastSeenRef = useRef(new Map()) // key -> { id, at }

  const dismiss = useCallback((tid) => {
    setToasts((cur) => cur.filter((t) => t.id !== tid))
  }, [])

  const push = useCallback(
    (msg, kind = 'info', ttl = 4000) => {
      const key = `${kind}::${msg}`
      const now = Date.now()
      const last = lastSeenRef.current.get(key)
      // Dedupe: if we just showed this exact message, don't show it again.
      if (last && now - last.at < DEDUPE_WINDOW_MS) {
        return last.id
      }

      const tid = nextId()
      lastSeenRef.current.set(key, { id: tid, at: now })

      setToasts((cur) => {
        // Cap visible toasts — dismiss the oldest if we'd exceed MAX_VISIBLE.
        const next = [...cur, { id: tid, msg, kind }]
        if (next.length > MAX_VISIBLE) {
          const dropped = next.shift()
          // Don't clear lastSeen for the dropped one — it's still "recent".
        }
        return next
      })

      if (ttl > 0) setTimeout(() => dismiss(tid), ttl)
      return tid
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider
      value={{
        success: (m) => push(m, 'success'),
        error: (m) => push(m, 'error', 6000),
        info: (m) => push(m, 'info'),
      }}
    >
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}
