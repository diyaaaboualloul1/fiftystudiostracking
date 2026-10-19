import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import PhaseDetailPage from './pages/PhaseDetailPage'
import EditDetailPage from './pages/EditDetailPage'
import RoleGuard from './components/RoleGuard'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/dashboard"
        element={
          <RoleGuard>
            <DashboardPage />
          </RoleGuard>
        }
      />
      <Route
        path="/users"
        element={
          <RoleGuard requireAdmin>
            <UsersPage />
          </RoleGuard>
        }
      />
      <Route
        path="/projects"
        element={
          <RoleGuard>
            <ProjectsPage />
          </RoleGuard>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <RoleGuard>
            <ProjectDetailPage />
          </RoleGuard>
        }
      />
      <Route
        path="/projects/:pid/phases/:id"
        element={
          <RoleGuard>
            <PhaseDetailPage />
          </RoleGuard>
        }
      />
      <Route
        path="/edits/:id"
        element={
          <RoleGuard>
            <EditDetailPage />
          </RoleGuard>
        }
      />
      <Route
        path="/settings"
        element={
          <RoleGuard requireAdmin>
            <SettingsPage />
          </RoleGuard>
        }
      />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
