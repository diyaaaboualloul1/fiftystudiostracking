import axios from 'axios'

// In dev/preview, Vite proxies /api → 127.0.0.1:3081 (see vite.config.js).
// In a real prod deploy, set VITE_API_BASE to e.g. https://api.yourhost.com
const baseURL = import.meta.env.VITE_API_BASE || '/api'

const api = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT from localStorage to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ft_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    // DIAGNOSTIC: log exactly what we're sending (visible in browser console)
    console.log(
      `[api] ${(config.method || 'GET').toUpperCase()} ${config.url} → Authorization: Bearer ${token.slice(0, 10)}…(${token.length} chars)`,
    )
  } else {
    console.log(`[api] ${(config.method || 'GET').toUpperCase()} ${config.url} → NO TOKEN in localStorage`)
  }
  return config
})

// 401 handler: dispatch a single global event so AuthContext can clean up
// auth state + redirect to /login. We DELIBERATELY do not clear localStorage
// here — AuthContext is the single source of truth. We also skip the dispatch
// if this is the login request itself (wrong password is a 401 but the user
// is on the login page, no session to clean up).
let isLoggingOut = false // re-entrancy guard so we don't fire 5 events in a row
let lastLoginAt = 0 // timestamp of last successful login — don't fire 401s for ~3s after
api.interceptors.response.use(
  (r) => {
    // Track successful logins so we can suppress the 401 cascade that
    // sometimes happens right after a fresh login (e.g. when the Dashboard
    // mounts and calls /api/users before the token has fully propagated
    // through every component).
    if (r.config?.url?.includes('/auth/login') && r.status === 200) {
      lastLoginAt = Date.now()
    }
    return r
  },
  (err) => {
    const status = err?.response?.status
    const url = err?.config?.url || ''
    const isLoginRequest = url.includes('/auth/login')
    const justLoggedIn = Date.now() - lastLoginAt < 3000

    // Always log 401s so we can see them in the console
    if (status === 401) {
      console.warn(
        `[api] 401 on ${(err.config?.method || 'GET').toUpperCase()} ${url}`,
        '— response:', err.response?.data,
        '— justLoggedIn:', justLoggedIn,
        '— isLoginRequest:', isLoginRequest,
      )
    }

    if (status === 401 && !isLoginRequest && !isLoggingOut && !justLoggedIn) {
      // Only fire once per "auth death" event — if 5 pages all see 401, we
      // don't want 5 redirects / 5 toasts. AND only fire if we're NOT
      // within 3s of a successful login (race-condition guard).
      isLoggingOut = true
      try {
        window.dispatchEvent(new CustomEvent('ft:auth:expired', {
          detail: { url, status },
        }))
      } finally {
        setTimeout(() => { isLoggingOut = false }, 500)
      }
    }
    return Promise.reject(err)
  },
)

export default api

// Convenience helpers
export async function apiGet(url, params) {
  const r = await api.get(url, { params })
  return r.data
}
export async function apiPost(url, body) {
  const r = await api.post(url, body)
  return r.data
}
export async function apiPatch(url, body) {
  const r = await api.patch(url, body)
  return r.data
}
export async function apiDelete(url) {
  const r = await api.delete(url)
  return r.data
}
