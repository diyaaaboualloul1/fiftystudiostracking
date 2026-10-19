import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('ft_user')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  // Single source of truth for clearing auth state.
  const clearAuth = useCallback(() => {
    localStorage.removeItem('ft_token')
    localStorage.removeItem('ft_user')
    setUser(null)
    setLoading(false)
  }, [])

  // Listen for the global "auth expired" event fired by the axios interceptor.
  // When ANY API call returns 401, this runs once, clears everything, and
  // sends the user to /login. Stops the 11-stacked-toast cascade and keeps
  // React state + localStorage consistent.
  useEffect(() => {
    function onAuthExpired() {
      clearAuth()
      navigate('/login', { replace: true })
    }
    window.addEventListener('ft:auth:expired', onAuthExpired)
    return () => window.removeEventListener('ft:auth:expired', onAuthExpired)
  }, [clearAuth, navigate])

  // On mount, verify the stored token is still valid
  useEffect(() => {
    let cancelled = false
    async function verify() {
      const token = localStorage.getItem('ft_token')
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const data = await apiGet('/auth/me')
        if (cancelled) return
        // Guard: /auth/me MUST return {user: {...}}. If the body is null/empty
        // (e.g. transient proxy / network issue), DON'T wipe auth — the user
        // may still be valid; just skip this refresh and let them continue.
        if (data && data.user) {
          setUser(data.user)
          localStorage.setItem('ft_user', JSON.stringify(data.user))
        }
      } catch (err) {
        if (cancelled) return
        // Only clear auth on an explicit 401 (token rejected by server).
        // Any other error (500, network, CORS) → keep auth, just stop loading.
        if (err?.response?.status === 401) {
          localStorage.removeItem('ft_token')
          localStorage.removeItem('ft_user')
          setUser(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    verify()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await apiPost('/auth/login', { email, password })
    if (!data || !data.token || !data.user) {
      throw new Error('Login response missing token or user')
    }
    localStorage.setItem('ft_token', data.token)
    localStorage.setItem('ft_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiPost('/auth/logout', {})
    } catch {
      // ignore — logging out is best-effort
    }
    clearAuth()
  }, [clearAuth])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
