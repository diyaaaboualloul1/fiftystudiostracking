import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Navigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Logo from '../components/Logo'
import { IconShield, IconEye, IconEyeOff, IconRefresh } from '../components/Icons'

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  // ?reset=1 → nuke ALL ft_* keys from localStorage and reload.
  // Use this if you're stuck seeing 401s in the console (stale token).
  useEffect(() => {
    if (searchParams.get('reset') === '1') {
      const keys = []
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k && k.startsWith('ft_')) {
          localStorage.removeItem(k)
          keys.push(k)
        }
      }
      // Also wipe sessionStorage for good measure
      try { sessionStorage.clear() } catch {}
      toast.success(`Cleared ${keys.length} stale session key(s). Please sign in.`)
      // Strip the query param and reload from server (not cache)
      setSearchParams({}, { replace: true })
      window.location.replace('/login')
    }
  }, [searchParams, setSearchParams, toast])

  function clearSession() {
    const keys = []
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('ft_')) {
        localStorage.removeItem(k)
        keys.push(k)
      }
    }
    toast.success(`Cleared ${keys.length} stale session key(s). Reloading…`)
    // Hard reload bypassing cache
    setTimeout(() => {
      window.location.replace('/login?_=' + Date.now())
    }, 600)
  }

  if (user) {
    return <Navigate to={location.state?.from?.pathname || '/dashboard'} replace />
  }

  async function onSubmit(e) {
    e.preventDefault()
    setErr('')
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      const dest = location.state?.from?.pathname || '/dashboard'
      navigate(dest, { replace: true })
    } catch (e) {
      const msg =
        e?.response?.data?.error || 'Sign-in failed. Check your email and password.'
      setErr(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-bg" aria-hidden="true">
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-grid" />
      </div>

      <div className="login-card reveal">
        <div className="login-card-top">
          <Logo height={32} />
          <span className="login-product">Fifty Tracker</span>
        </div>

        <h1 className="login-title">Welcome back</h1>
        <p className="login-subtitle">
          Sign in with your Fifty Studios work email to continue.
        </p>

        <form onSubmit={onSubmit} className="login-form" noValidate>
          <div className="field">
            <label htmlFor="email" className="field-label">
              Work email
            </label>
            <input
              id="email"
              name="ft-email"
              type="email"
              autoComplete="username"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@5ostudios.com"
              autoFocus
              // Belt-and-braces: defeat iOS Safari, 1Password, LastPass, Bitwarden
              // auto-fill that may have stored a stale password for this origin.
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
            />
          </div>

          <div className="field">
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <div className="password-input">
              <input
                id="password"
                name="ft-password"
                type={showPw ? 'text' : 'password'}
                // CRITICAL: do NOT use autoComplete="current-password" here.
                // iOS Safari and most password managers will silently overwrite
                // the field with a saved/stale password, causing "Invalid
                // credentials" with no visible clue to the user. Using "off"
                // plus the data-ignore attrs blocks every major manager.
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                required
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="demo1234"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                aria-pressed={showPw}
                tabIndex={-1}
              >
                {showPw ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </div>
            <div className="field-hint">
              Demo accounts: any email from the Users page · password{' '}
              <code>demo1234</code>
            </div>
          </div>

          {err && <div className="login-error">{err}</div>}

          <button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={submitting || !email || !password}
          >
            {submitting ? <span className="spinner" /> : <IconShield size={16} />}
            <span>{submitting ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </form>

        <div className="login-foot">
          <p>
            No public sign-up. Accounts are added by an Admin from{' '}
            <Link to="/login">User Management</Link>.
          </p>
          <button
            type="button"
            className="login-reset"
            onClick={clearSession}
            title="Clear all Fifty Tracker session data and reload"
          >
            <IconRefresh size={14} />
            <span>Stuck? Clear session &amp; retry</span>
          </button>
        </div>
      </div>
    </div>
  )
}
