import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { IconProject } from '../components/Icons'

export default function ProjectsPlaceholderPage() {
  return (
    <AppShell
      title="Projects"
      subtitle="Phase 2 — coming next."
    >
      <div className="empty card">
        <div className="empty-icon">
          <IconProject size={28} />
        </div>
        <div className="empty-title">Projects ship in Phase 2</div>
        <div className="empty-text">
          Phase 1 is auth + user management. The next phase adds projects,
          phases, edits, the single-active-phase rule, and the 7-rule derived
          project status. Backed by Postgres triggers, no manual status inputs.
        </div>
        <Link to="/dashboard" className="btn btn-ghost" style={{ marginTop: 16 }}>
          Back to dashboard
        </Link>
      </div>
    </AppShell>
  )
}
