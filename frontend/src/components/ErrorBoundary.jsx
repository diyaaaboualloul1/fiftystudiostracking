import { Component } from 'react'

/**
 * Catches render-time errors anywhere in the tree and shows a recoverable
 * error screen instead of a black page. Also offers a "Reload" button so the
 * user can recover without losing their work.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Keep it loud in the console for debugging.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info)
  }

  reset = () => {
    this.setState({ error: null, info: null })
  }

  reload = () => {
    // Hard reload — clears any stale in-memory state.
    window.location.reload()
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="error-screen">
        <div className="error-card">
          <div className="error-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <h1 className="error-title">Something went wrong</h1>
          <p className="error-text">
            The page crashed before it could render. This is usually a stale
            token or a transient connection issue — reloading usually fixes it.
          </p>
          <pre className="error-detail">
            {String(error?.message || error)}
            {info?.componentStack ? '\n\n' + info.componentStack.split('\n').slice(0, 6).join('\n') : ''}
          </pre>
          <div className="error-actions">
            <button type="button" className="btn btn-ghost" onClick={this.reset}>
              Dismiss
            </button>
            <button type="button" className="btn btn-primary" onClick={this.reload}>
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
