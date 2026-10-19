import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { apiGet } from '../lib/api'
import { useAuth } from '../context/AuthContext'

export default function SettingsPage() {
  const { user } = useAuth()
  const [health, setHealth] = useState(null)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [h, m] = await Promise.all([apiGet('/health'), apiGet('/auth/me')])
        if (cancelled) return
        setHealth(h)
        // Guard: /auth/me MUST return {user: {...}}. If body is null/empty,
        // skip silently — auth state is still valid via AuthContext.
        if (m && m.user) setMe(m.user)
      } catch {
        if (cancelled) return
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppShell
      title="Settings"
      subtitle="System health and your account details."
    >
      <div className="settings-grid">
        <section className="card reveal">
          <h2>System</h2>
          <p className="card-text">
            The tracker is bound to <code>Asia/Kuwait</code> for all deadlines
            and overdue clocks. All timestamps are server-stamped in UTC and
            displayed in the workspace timezone.
          </p>
          <div className="kv-list">
            <KV k="Status" v={loading ? '…' : health?.ok ? 'Healthy' : 'Error'} tone={health?.ok ? 'good' : 'bad'} />
            <KV k="Server time" v={loading ? '…' : new Date(health?.ts || Date.now()).toLocaleString()} />
            <KV k="Timezone" v={loading ? '…' : health?.tz || 'Asia/Kuwait'} />
            <KV k="API base" v={import.meta.env.VITE_API_BASE || '/api (via Vite proxy)'} mono />
          </div>
        </section>

        <section className="card reveal">
          <h2>Your account</h2>
          <div className="kv-list">
            <KV k="Name" v={user?.name} />
            <KV k="Email" v={user?.email} mono />
            <KV k="Role" v={<span className={`chip chip-${user?.role} chip-dot`}>{user?.role}</span>} />
            <KV k="Account created" v={me ? new Date(me.created_at).toLocaleString() : '…'} />
            <KV k="Last sign-in" v={me?.last_login_at ? new Date(me.last_login_at).toLocaleString() : 'First sign-in'} />
          </div>
          <p className="card-text" style={{ marginTop: 14 }}>
            Password changes and personal details will move here in a later
            phase. For now, ask an Admin to update them via Users.
          </p>
        </section>
      </div>
    </AppShell>
  )
}

function KV({ k, v, tone, mono }) {
  return (
    <div className="kv">
      <div className="kv-k">{k}</div>
      <div
        className={`kv-v${mono ? ' cell-mono' : ''}${tone ? ` kv-v-${tone}` : ''}`}
      >
        {v}
      </div>
    </div>
  )
}
