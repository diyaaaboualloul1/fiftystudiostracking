// src/middleware/permissions.js — role + project-access middleware
//
// Approval deviation: 2 roles only — admin, worker.
// Worker sees projects where they are: owner / project_member / assigned-to-any-edit.
//
// Usage:
//   router.use(authRequired, requireActiveUser);            // any signed-in active user
//   router.use(authRequired, requireActiveUser, requireRole('admin'));
//   router.get('/:id', authRequired, requireActiveUser, requireProjectAccess('read'), handler);

const { query } = require('../config/db');

/**
 * requireRole(...allowedRoles)
 *   - Passes if req.user.role is in the list.
 *   - Otherwise 403.
 */
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Role '${req.user.role}' is not allowed. Required: ${allowedRoles.join(' or ')}`,
      });
    }
    next();
  };
}

/**
 * Resolve the project id for a request by inspecting the URL pattern.
 * Supports:
 *   - /api/projects/:id/...        → :id is a project id (or project_id from path)
 *   - /api/phases/:id/...          → look up phases.project_id
 *   - /api/edits/:id/...           → look up edits → phases.project_id
 * Returns the project_id number, or null when the id can't be resolved.
 */
async function resolveProjectIdForRequest(req) {
  const params = req.params || {};
  const url = (req.originalUrl || '').split('?')[0];

  // 1) /api/projects/:id (no /phases suffix) — :id is a project id
  //    /api/projects/:id/<other-stuff>  — :id is a project id (other routes: archive, restore, members, links, activity)
  const projectDirect = url.match(/^\/api\/projects\/(\d+)(?:\/(archive|restore|members|links|activity)(?:\/|$))?$/);
  if (projectDirect) {
    const id = Number(projectDirect[1]);
    const r = await query('SELECT id FROM projects WHERE id = $1', [id]);
    if (r.rowCount > 0) return id;
    return null;
  }

  // 2) /api/projects/:id/phases/... — :id is a project id
  const projectPhases = url.match(/^\/api\/projects\/(\d+)\/phases(?:\/|$)/);
  if (projectPhases) {
    return Number(projectPhases[1]);
  }

  // 3) /api/phases/:id/... — :id is a phase id
  const phaseRoute = url.match(/^\/api\/phases\/(\d+)(?:\/|$)/);
  if (phaseRoute) {
    const id = Number(phaseRoute[1]);
    const r = await query('SELECT project_id FROM phases WHERE id = $1', [id]);
    if (r.rowCount === 0) return null;
    return Number(r.rows[0].project_id);
  }

  // 4) /api/edits/:id/... — :id is an edit id
  const editRoute = url.match(/^\/api\/edits\/(\d+)(?:\/|$)/);
  if (editRoute) {
    const id = Number(editRoute[1]);
    const r = await query(
      'SELECT ph.project_id FROM edits e JOIN phases ph ON ph.id = e.phase_id WHERE e.id = $1',
      [id]
    );
    if (r.rowCount === 0) return null;
    return Number(r.rows[0].project_id);
  }

  return null;
}

/**
 * requireProjectAccess(mode)
 *   - mode is informational (we don't have separate read/write rules beyond the role).
 *   - For workers: must be owner, project member, or assigned to any non-archived edit in any non-archived phase of the project.
 *   - For admins: always allowed (but still validates the project exists for :id routes).
 */
function requireProjectAccess(_mode) {
  return async function (req, res, next) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Auth required' });
      if (!req.user.active) return res.status(403).json({ error: 'User account is inactive' });

      const projectId = await resolveProjectIdForRequest(req);
      if (projectId === null) {
        return res.status(404).json({ error: 'Project not found' });
      }
      req.project_id = projectId;

      // Admin bypasses (but verify project exists to give 404 not 500).
      if (req.user.role === 'admin') {
        const exists = await query('SELECT id FROM projects WHERE id = $1', [projectId]);
        if (exists.rowCount === 0) {
          return res.status(404).json({ error: 'Project not found' });
        }
        return next();
      }

      // Worker — must be owner, member, or assigned to an edit.
      const result = await query(
        `SELECT
           (p.owner_id = $2) AS is_owner,
           EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2) AS is_member,
           EXISTS (
             SELECT 1 FROM phases ph
             JOIN edits e ON e.phase_id = ph.id
             WHERE ph.project_id = p.id
               AND e.assignee_id = $2
               AND e.archived_at IS NULL
           ) AS is_assignee
         FROM projects p
         WHERE p.id = $1`,
        [projectId, req.user.id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }
      const r = result.rows[0];
      if (!r.is_owner && !r.is_member && !r.is_assignee) {
        return res.status(403).json({ error: 'No access to this project' });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * requireProjectWriteAccess()
 *   - Admin bypasses (with existence check, gives 404 not 500 for missing projects).
 *   - Otherwise: must be the project's owner OR a row in project_members.
 *   - Replaces requireRole('admin') for in-project CRUD (project fields,
 *     phases, edits). Destructive global operations (archive/restore/delete
 *     a project, manage members, manage links) remain requireRole('admin').
 */
function requireProjectWriteAccess() {
  return async function (req, res, next) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Auth required' });
      if (!req.user.active) return res.status(403).json({ error: 'User account is inactive' });

      const projectId = await resolveProjectIdForRequest(req);
      if (projectId === null) {
        return res.status(404).json({ error: 'Project not found' });
      }
      req.project_id = projectId;

      // Admin bypass (with existence check)
      if (req.user.role === 'admin') {
        const exists = await query('SELECT id FROM projects WHERE id = $1', [projectId]);
        if (exists.rowCount === 0) {
          return res.status(404).json({ error: 'Project not found' });
        }
        return next();
      }

      // Non-admin: must be project owner or project member.
      const access = await query(
        `SELECT
           (p.owner_id = $2) AS is_owner,
           EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2) AS is_member
         FROM projects p WHERE p.id = $1`,
        [projectId, req.user.id]
      );
      if (access.rowCount === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }
      const r = access.rows[0];
      if (!r.is_owner && !r.is_member) {
        return res.status(403).json({
          error: 'Write access requires project ownership, membership, or admin role',
        });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = {
  requireRole,
  requireProjectAccess,
  requireProjectWriteAccess,
  resolveProjectIdForRequest,
};
