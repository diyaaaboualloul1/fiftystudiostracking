import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/AuthContext'
import { apiGet } from '../lib/api'
import { ROLE_DESCRIPTIONS, relativeTime, formatDateTime } from '../lib/format'
import {
  projectStatusLabel,
  fmtDeadline,
  progressPercent,
  progressLabel,
} from '../lib/domain'
import {
  IconUsers,
  IconShield,
  IconProject,
  IconCheck,
  IconArrowRight,
  IconPlus,
  IconActivity,
  IconInbox,
  IconBuilding,
  IconCalendar,
  IconAlertTriangle,
} from '../components/Icons'

export default function DashboardPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState({ users: 0, admins: 0, workers: 0, projects: 0 })
  const [recentUsers, setRecentUsers] = useState([])
  const [recentProjects, setRecentProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const promises = []
        if (isAdmin) {
          promises.push(apiGet('/users', { includeInactive: true }).catch(() => null))
          promises.push(
            apiGet('/projects', { sort: 'updated_at', order: 'desc', limit: 5 }).catch(() => null),
          )
        } else {
          promises.push(Promise.resolve(null))
          promises.push(
            apiGet('/projects', { sort: 'updated_at', order: 'desc', limit: 5 }).catch(() => null),
          )
        }
        const [u, p] = await Promise.all(promises)
        if (cancelled) return
        if (u) {
          const all = u.users || []
          setStats((s) => ({
            ...s,
            users: all.length,
            admins: all.filter((x) => x.role === 'admin').length,
            workers: all.filter((x) => x.role === 'worker').length,
          }))
          setRecentUsers(
            [...all]
              .sort(
                (a, b) =>
                  new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
              )
              .slice(0, 5),
          )
        }
        if (p) {
          const list = p.projects || []
          setStats((s) => ({ ...s, projects: p.count ?? list.length }))
          setRecentProjects(list.slice(0, 5))
        }
      } catch {
        // best-effort
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [isAdmin])

  return (
    <AppShell
      title={`Hello, ${user?.name?.split(' ')[0] || 'there'}.`}
      subtitle="Your Fifty Studios project overview."
    >
      <div className="welcome-card reveal">
        <div className="welcome-meta">
          <span className={`chip chip-${user?.role} chip-dot`}>{user?.role}</span>
          <span className="welcome-when">Last sign-in: {formatDateTime(user?.last_login_at) || 'just now'}</span>
        </div>
        <h2 className="welcome-title">
          {isAdmin
            ? 'Track every project, every phase, every edit.'
            : 'Welcome back — your projects are below.'}
        </h2>
        <p className="welcome-text">
          {ROLE_DESCRIPTIONS[user?.role] || ''}
        </p>
      </div>

      <div className="stat-grid">
        {isAdmin && (
          <>
            <StatCard
              icon={<IconUsers size={20} />}
              label="Total users"
              value={stats.users}
              loading={loading}
            />
            <StatCard
              icon={<IconShield size={20} />}
              label="Admins"
              value={stats.admins}
              loading={loading}
            />
            <StatCard
              icon={<IconUsers size={20} />}
              label="Workers"
              value={stats.workers}
              loading={loading}
            />
          </>
        )}
        <StatCard
          icon={<IconProject size={20} />}
          label={isAdmin ? 'Active projects' : 'My projects'}
          value={stats.projects}
          loading={loading}
        />
      </div>

      {/* Recent projects — shown to everyone */}
      <section className="dash-section">
        <div className="dash-section-head">
          <h2>{isAdmin ? 'Recent projects' : 'Your projects'}</h2>
          <Link to="/projects" className="btn btn-ghost btn-sm">
            See all <IconArrowRight size={12} />
          </Link>
        </div>
        {loading ? (
          <div className="empty"><div className="spinner spinner-primary" /></div>
        ) : recentProjects.length === 0 ? (
          <div className="empty-large">
            <div className="empty-large-icon">
              <IconInbox size={32} />
            </div>
            <div className="empty-large-title">
              {isAdmin ? 'No projects yet' : 'No projects assigned to you'}
            </div>
            <div className="empty-large-text">
              {isAdmin
                ? 'Create your first project to start tracking work.'
                : 'Once an admin adds you to a project team, it will show up here.'}
            </div>
            {isAdmin && (
              <Link to="/projects?new=1" className="btn btn-primary">
                <IconPlus size={16} />
                <span>Create your first project</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="dash-projects">
            {recentProjects.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="dash-project-card"
              >
                <div className="dash-project-card-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dash-project-card-name">{p.name}</div>
                    {p.client && (
                      <div className="dash-project-card-client">{p.client}</div>
                    )}
                  </div>
                  <span className={`status-pill status-${p.status}`} style={{ fontSize: 10 }}>
                    {projectStatusLabel(p.status)}
                  </span>
                </div>
                {p.active_phase ? (
                  <>
                    <div className="dash-project-card-progress">
                      <div className="dash-project-card-progress-track">
                        <div
                          className="dash-project-card-progress-fill"
                          style={{ width: `${progressPercent(p.active_phase.progress)}%` }}
                        />
                      </div>
                      <span>{progressLabel(p.active_phase.progress)}</span>
                    </div>
                    <div className="dash-project-card-foot">
                      <span>Phase {p.active_phase.number} · {p.active_phase.title}</span>
                      {p.active_phase.overdue ? (
                        <span className="overdue-badge" style={{ fontSize: 9 }}>
                          <IconAlertTriangle size={9} /> Overdue
                        </span>
                      ) : p.active_phase.deadline ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <IconCalendar size={10} /> {fmtDeadline(p.active_phase.deadline)}
                        </span>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="dash-project-card-foot">
                    <span>No active phase</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent users — admin only */}
      {isAdmin && (
        <section className="dash-section">
          <div className="dash-section-head">
            <h2>Recently updated users</h2>
            <Link to="/users" className="btn btn-ghost btn-sm">
              Manage <IconArrowRight size={12} />
            </Link>
          </div>
          {loading ? (
            <div className="empty"><div className="spinner spinner-primary" /></div>
          ) : recentUsers.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <IconUsers size={24} />
              </div>
              <div className="empty-title">No users yet</div>
              <div className="empty-text">Add the first user from the Users page in the sidebar.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="cell-user">
                          <div className="avatar avatar-sm">
                            {(u.name || '?').slice(0, 1).toUpperCase()}
                          </div>
                          <span>{u.name}</span>
                        </div>
                      </td>
                      <td className="cell-mono">{u.email}</td>
                      <td>
                        <span className={`chip chip-${u.role} chip-dot`}>{u.role}</span>
                      </td>
                      <td>
                        <span
                          className={`chip ${u.active ? 'chip-active' : 'chip-inactive'} chip-dot`}
                        >
                          {u.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="cell-muted">{relativeTime(u.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!isAdmin && (
        <div className="welcome-card reveal" style={{ marginTop: 24 }}>
          <h3 className="welcome-title" style={{ fontSize: 18 }}>
            <IconCheck size={18} /> You're signed in.
          </h3>
          <p className="welcome-text">
            Open any project above to see its phases and edits. You can update only the edits assigned to you, and add notes anywhere.
          </p>
        </div>
      )}
    </AppShell>
  )
}

function StatCard({ icon, label, value, loading, hint }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">
          {loading && value === 0 ? (
            <div className="spinner spinner-primary" />
          ) : (
            value
          )}
          {hint && <span className="stat-hint">{hint}</span>}
        </div>
      </div>
    </div>
  )
}
