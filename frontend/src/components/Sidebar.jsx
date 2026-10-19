import { NavLink } from 'react-router-dom'
import Logo from './Logo'
import {
  IconDashboard,
  IconUsers,
  IconProject,
  IconSettings,
  IconLogout,
} from './Icons'
import { useAuth } from '../context/AuthContext'

export default function Sidebar() {
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'

  const navItem = ({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <Logo height={26} />
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          <NavLink to="/dashboard" className={navItem}>
            <IconDashboard />
            <span>Dashboard</span>
          </NavLink>

          <NavLink to="/projects" className={navItem}>
            <IconProject />
            <span>Projects</span>
          </NavLink>

          {isAdmin && (
            <NavLink to="/users" className={navItem}>
              <IconUsers />
              <span>Users</span>
            </NavLink>
          )}

          <div className="nav-divider" aria-hidden="true" />

          {isAdmin && (
            <NavLink to="/settings" className={navItem}>
              <IconSettings />
              <span>Settings</span>
            </NavLink>
          )}
        </nav>
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div className="avatar" aria-hidden="true">
            {(user?.name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="sidebar-user-meta">
            <div className="sidebar-user-name">{user?.name || '—'}</div>
            <div className="sidebar-user-role">
              <span className={`chip chip-${user?.role || 'worker'} chip-dot`}>
                {user?.role}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="nav-item nav-item-logout"
          onClick={logout}
          aria-label="Sign out"
        >
          <IconLogout />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
