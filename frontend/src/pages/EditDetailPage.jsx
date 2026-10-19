import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import EditSlideOver from '../components/EditSlideOver'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { apiGet } from '../lib/api'
import { parseApiError } from '../lib/domain'

/* ---------- Edit detail page (deep-link host) ----------
   The /edits/:id route exists for deep-linking and sharing. The actual
   UX is the EditSlideOver in full mode — no separate "page" layout.
   This component just fetches the edit and renders the full slider. */
export default function EditDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user: me } = useAuth()

  const [edit, setEdit] = useState(null)
  const [phase, setPhase] = useState(null)
  const [project, setProject] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet(`/edits/${id}`)
      const e = data.edit || data
      setEdit(e)
      setPhase(data.edit?.phase || data.phase)
      if (e.project) {
        setProject(e.project)
      } else if (e.project_id) {
        try {
          const proj = await apiGet(`/projects/${e.project_id}`)
          setProject(proj.project || proj)
        } catch {}
      }
      if (e.project_id) {
        try {
          const proj = await apiGet(`/projects/${e.project_id}`)
          setMembers(proj.members || [])
        } catch {}
      }
    } catch (e2) {
      const { status, message } = parseApiError(e2)
      if (status === 404) {
        toast.error('Edit not found.')
        navigate('/projects', { replace: true })
      } else {
        toast.error(message)
      }
    } finally {
      setLoading(false)
    }
  }, [id, toast, navigate])

  useEffect(() => {
    load()
  }, [load])

  if (loading || !edit) {
    return (
      <div className="page-loading" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner spinner-lg spinner-primary" />
      </div>
    )
  }

  const isAdmin = me?.role === 'admin'
  const isAssignee = me && Number(me.id) === Number(edit.assignee_id)
  const canEdit = isAdmin || isAssignee

  return (
    <EditSlideOver
      edit={edit}
      onClose={() => {
        if (phase?.id && project?.id) {
          navigate(`/projects/${project.id}/phases/${phase.id}`)
        } else {
          navigate('/projects')
        }
      }}
      members={members}
      project={project}
      phase={phase}
      canEdit={canEdit}
      defaultMode="full"
    />
  )
}
