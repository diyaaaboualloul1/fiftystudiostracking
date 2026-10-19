import Sidebar from './Sidebar'
import Topbar from './Topbar'

// Phase 1 app shell: sidebar + topbar + content area.
// Sidebar uses the same brand navy/surface as 5ostudios.com (dark).
export default function AppShell({ title, subtitle, actions, children }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <Topbar title={title} subtitle={subtitle} actions={actions} />
        <div className="page">{children}</div>
      </main>
    </div>
  )
}
