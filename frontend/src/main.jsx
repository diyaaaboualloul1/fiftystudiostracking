import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/base.css'
import './styles/components.css'
import './styles/shell.css'
import './styles/login.css'
import './styles/error.css'
import './styles/pages.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Reveal-on-scroll: add .reveal-visible when .reveal elements enter the viewport
if (typeof window !== 'undefined') {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('reveal-visible')
          io.unobserve(e.target)
        }
      })
    },
    { threshold: 0.08 },
  )
  const scan = () => document.querySelectorAll('.reveal:not(.reveal-visible)').forEach((el) => io.observe(el))
  // Wait for first React commit, then scan
  setTimeout(scan, 50)
  // SPA navigation: React Router swaps page content without a full reload,
  // so the new .reveal elements would never be observed. A MutationObserver
  // re-scans whenever the DOM changes under the app root.
  const root = document.getElementById('root')
  if (root) {
    const mo = new MutationObserver(() => scan())
    mo.observe(root, { childList: true, subtree: true })
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
