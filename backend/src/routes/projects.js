// src/routes/projects.js — Project CRUD + members + links + archive/restore
//
// Permissions summary:
//   - GET    /api/projects                  → any active user (admin: all; worker: accessible)
//   - POST   /api/projects                  → admin only
//   - GET    /api/projects/:id              → requireProjectAccess
//   - PATCH  /api/projects/:id              → admin only
//   - POST   /api/projects/:id/archive      → admin only
//   - POST   /api/projects/:id/restore      → admin only
//   - POST   /api/projects/:id/members      → admin only
//   - DELETE /api/projects/:id/members/:uid → admin only
//   - POST   /api/projects/:id/links        → admin only
//   - PATCH  /api/projects/:id/links/:lid   → admin only
//   - DELETE /api/projects/:id/links/:lid   → admin only
//
// Optimistic locking: PATCH /api/projects/:id and PATCH on links accept optional
// `If-Match: "<version>"` header. If provided and not equal to current, returns 409.

const express = require('express');
const { query, withTx } = require('../config/db');
const { authRequired, requireActiveUser } = require('../middleware/auth');
const { requireRole, requireProjectAccess, requireProjectWriteAccess } = require('../middleware/permissions');
const { logActivity } = require('../middleware/activityLog');
const { deriveStatus } = require('../utils/status');
const { computeProgress } = require('../utils/progress');
const { isPhaseOverdue, isEditOverdue } = require('../utils/overdue');

const router = express.Router();

const PROJECT_STATES = ['new_build', 'already_built'];
const PROJECT_STATUSES = [
  'not_started', 'up_to_date', 'new_development', 'updates_in_progress',
  'ready_to_close', 'waiting_for_client', 'on_hold',
];

function projectToJSON(row, opts = {}) {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    description: row.description,
    owner_id: row.owner_id,
    owner_name: row.owner_name || null,
    project_state: row.project_state,
    project_deadline: row.project_deadline,
    original_delivery_date: row.original_delivery_date,
    original_delivery_acknowledged: row.original_delivery_acknowledged,
    archived_at: row.archived_at,
    archived_reason: row.archived_reason,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function checkIfMatch(req, currentVersion) {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) return { ok: true };
  const want = String(ifMatch).replace(/"/g, '');
  if (String(currentVersion) !== want) {
    return { ok: false, status: 409, body: {
      error: 'Version conflict',
      current_version: currentVersion,
      your_version: want,
    } };
  }
  return { ok: true };
}

// ============================================================
// LIST projects — with search, status filter, overdue, sort
// ============================================================
router.get('/', authRequired, requireActiveUser, async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];
    function addParam(v) { params.push(v); return `$${params.length}`; }

    // Default: hide archived. ?includeArchived=true to show them.
    const includeArchived = req.query.includeArchived === 'true';
    if (!includeArchived) {
      conditions.push('p.archived_at IS NULL');
    }

    // Worker visibility: owner / member / assigned-to-edit
    if (req.user.role === 'worker') {
      conditions.push(`(
        p.owner_id = ${addParam(req.user.id)}
        OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ${addParam(req.user.id)})
        OR EXISTS (
          SELECT 1 FROM phases ph
          JOIN edits e ON e.phase_id = ph.id
          WHERE ph.project_id = p.id AND e.assignee_id = ${addParam(req.user.id)}
            AND e.archived_at IS NULL
        )
      )`);
    }

    // Search (name, client)
    if (req.query.search && String(req.query.search).trim() !== '') {
      const s = `%${String(req.query.search).trim().toLowerCase()}%`;
      conditions.push(`(LOWER(p.name) LIKE ${addParam(s)} OR LOWER(COALESCE(p.client, '')) LIKE ${addParam(s)})`);
    }

    // Status filter (multi-select, OR). Computed via subquery.
    // We use a CTE-free approach: compute status for every project using a LATERAL subquery.
    // For list view, we use a simpler approach: pull all matching, then compute status in JS.
    // (50-200 projects typical — fine.)

    const baseWhere = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const sql = `
      SELECT p.*, u.name AS owner_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      ${baseWhere}
      ORDER BY p.created_at DESC
    `;
    const result = await query(sql, params);
    let projects = result.rows;

    // For each project, compute derived status + active phase info.
    // The "active phase slot" is occupied by status IN ('active','waiting_for_client','on_hold').
    const enriched = await Promise.all(projects.map(async (p) => {
      const activePhase = await query(
        `SELECT * FROM phases
         WHERE project_id = $1 AND archived_at IS NULL
         ORDER BY
           CASE status
             WHEN 'active' THEN 0
             WHEN 'waiting_for_client' THEN 1
             WHEN 'on_hold' THEN 2
             WHEN 'completed' THEN 3
             ELSE 4
           END,
           number DESC
         LIMIT 1`,
        [p.id]
      );
      const phase = activePhase.rows[0] || null;
      let edits = [];
      if (phase) {
        const er = await query(
          `SELECT * FROM edits WHERE phase_id = $1 AND archived_at IS NULL ORDER BY id DESC`,
          [phase.id]
        );
        edits = er.rows;
      }
      const status = deriveStatus(p, phase, edits);
      const progress = phase ? computeProgress(edits) : { done: 0, total: 0, label: 'No edits', percent: null };
      const phaseOverdue = phase ? isPhaseOverdue(phase) : false;
      return {
        ...projectToJSON(p),
        status,
        active_phase: phase ? {
          id: phase.id,
          number: phase.number,
          title: phase.title,
          deadline: phase.deadline,
          progress,
          overdue: phaseOverdue,
        } : null,
      };
    }));

    // Status filter (OR)
    let filtered = enriched;
    if (req.query.status) {
      const wanted = String(req.query.status).split(',').map(s => s.trim()).filter(Boolean);
      if (wanted.length > 0) {
        filtered = filtered.filter(p => wanted.includes(p.status));
      }
    }

    // Overdue only
    if (req.query.overdue === 'true') {
      filtered = filtered.filter(p => p.active_phase && p.active_phase.overdue);
    }

    // Sort
    const sort = req.query.sort || 'default';
    const dateStr = (d) => {
      if (!d) return '9999-12-31';
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      return String(d).slice(0, 10);
    };
    if (sort === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'status') {
      filtered.sort((a, b) => a.status.localeCompare(b.status));
    } else if (sort === 'deadline') {
      filtered.sort((a, b) => {
        const ad = dateStr(a.active_phase?.deadline);
        const bd = dateStr(b.active_phase?.deadline);
        return ad.localeCompare(bd);
      });
    } else {
      // default: overdue first, then by nearest deadline, then no-active-phase
      filtered.sort((a, b) => {
        const ao = a.active_phase?.overdue ? 0 : (a.active_phase ? 1 : 2);
        const bo = b.active_phase?.overdue ? 0 : (b.active_phase ? 1 : 2);
        if (ao !== bo) return ao - bo;
        const ad = dateStr(a.active_phase?.deadline);
        const bd = dateStr(b.active_phase?.deadline);
        if (ad !== bd) return ad.localeCompare(bd);
        return a.name.localeCompare(b.name);
      });
    }

    res.json({ projects: filtered, count: filtered.length });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// CREATE project — admin
// ============================================================
router.post('/', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, client: clientName, description, owner_id, project_state, project_deadline, original_delivery_date } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!owner_id) return res.status(400).json({ error: 'owner_id is required' });
    if (!PROJECT_STATES.includes(project_state)) {
      return res.status(400).json({ error: `project_state must be one of: ${PROJECT_STATES.join(', ')}` });
    }
    const ownerCheck = await query('SELECT id FROM users WHERE id = $1 AND active = true', [owner_id]);
    if (ownerCheck.rowCount === 0) {
      return res.status(400).json({ error: 'owner_id must be an active user' });
    }
    const created = await withTx(async (client) => {
      const r = await client.query(
        `INSERT INTO projects (name, client, description, owner_id, project_state, project_deadline, original_delivery_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          name.trim(),
          clientName ? String(clientName).trim() : null,
          description ? String(description) : null,
          owner_id,
          project_state,
          project_deadline || null,
          original_delivery_date || null,
        ]
      );
      const p = r.rows[0];
      await logActivity(client, {
        project_id: p.id,
        entity_type: 'project',
        entity_id: p.id,
        actor_id: req.user.id,
        action: 'create',
        old_values: null,
        new_values: { name: p.name, project_state: p.project_state, owner_id: p.owner_id },
      });
      return p;
    });
    const enriched = await enrichProject(created);
    res.status(201).json({ project: enriched });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// GET project detail — any with project access
// ============================================================
router.get('/:id(\\d+)', authRequired, requireActiveUser, requireProjectAccess('read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await query(
      `SELECT p.*, u.name AS owner_name FROM projects p
       LEFT JOIN users u ON u.id = p.owner_id
       WHERE p.id = $1`, [id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    const p = r.rows[0];
    const members = await query(
      `SELECT u.id, u.name, u.email, u.role, pm.added_at
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 ORDER BY pm.added_at`,
      [id]
    );
    const links = await query(
      `SELECT * FROM project_links WHERE project_id = $1 ORDER BY created_at`, [id]
    );
    const phases = await query(
      `SELECT * FROM phases WHERE project_id = $1 ORDER BY number`, [id]
    );
    // Fetch edit counts for all phases in one query so the Phases tab can show
    // "X edits, Y done" on every phase card (not just the active one).
    const phaseIds = phases.rows.map((ph) => ph.id);
    let editCounts = new Map();
    if (phaseIds.length > 0) {
      const ec = await query(
        `SELECT phase_id,
                COUNT(*) FILTER (WHERE archived_at IS NULL) AS total,
                COUNT(*) FILTER (WHERE archived_at IS NULL AND status = 'done') AS done
         FROM edits
         WHERE phase_id = ANY($1::int[])
         GROUP BY phase_id`,
        [phaseIds]
      );
      for (const row of ec.rows) {
        editCounts.set(row.phase_id, { total: Number(row.total), done: Number(row.done) });
      }
    }
    const phasesWithCounts = phases.rows.map((ph) => {
      const c = editCounts.get(ph.id) || { total: 0, done: 0 };
      return { ...ph, edits_total: c.total, edits_done: c.done };
    });
    // The "active phase slot" is occupied by status IN ('active','waiting_for_client','on_hold').
    const activePhase = phases.rows
      .filter(ph => !ph.archived_at)
      .sort((a, b) => {
        const order = { active: 0, waiting_for_client: 1, on_hold: 2 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.number - a.number);
      })[0] || null;
    let edits = [];
    if (activePhase) {
      const er = await query(
        `SELECT * FROM edits WHERE phase_id = $1 AND archived_at IS NULL ORDER BY id DESC`,
        [activePhase.id]
      );
      edits = er.rows;
    }
    const status = deriveStatus(p, activePhase, edits);
    const progress = activePhase ? computeProgress(edits) : { done: 0, total: 0, label: 'No edits', percent: null };
    res.json({
      project: {
        ...projectToJSON(p),
        status,
        members: members.rows,
        links: links.rows,
        phases: phases.rows,
        active_phase: activePhase ? {
          ...activePhase,
          progress,
          overdue: isPhaseOverdue(activePhase),
        } : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// PATCH project — admin
// ============================================================
router.patch('/:id(\\d+)', authRequired, requireActiveUser, requireProjectWriteAccess(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cur = await query('SELECT * FROM projects WHERE id = $1', [id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    const before = cur.rows[0];

    const ifMatch = checkIfMatch(req, before.version);
    if (!ifMatch.ok) return res.status(ifMatch.status).json(ifMatch.body);

    const { name, client: clientName, description, owner_id, project_state, project_deadline, original_delivery_date, original_delivery_acknowledged } = req.body || {};
    const updates = [];
    const params = [];
    function addParam(v) { params.push(v); return `$${params.length}`; }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 1) {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      updates.push(`name = ${addParam(name.trim())}`);
    }
    if (clientName !== undefined) {
      updates.push(`client = ${addParam(clientName === null ? null : String(clientName).trim())}`);
    }
    if (description !== undefined) {
      updates.push(`description = ${addParam(description === null ? null : String(description))}`);
    }
    if (owner_id !== undefined) {
      const ownerCheck = await query('SELECT id FROM users WHERE id = $1 AND active = true', [owner_id]);
      if (ownerCheck.rowCount === 0) {
        return res.status(400).json({ error: 'owner_id must be an active user' });
      }
      updates.push(`owner_id = ${addParam(owner_id)}`);
    }
    if (project_state !== undefined) {
      if (!PROJECT_STATES.includes(project_state)) {
        return res.status(400).json({ error: `project_state must be one of: ${PROJECT_STATES.join(', ')}` });
      }
      updates.push(`project_state = ${addParam(project_state)}`);
    }
    if (project_deadline !== undefined) {
      // Enforce: if the new project deadline is earlier than some phase deadlines, reject.
      // The caller can opt-in to auto-cap phase deadlines by sending cascade_phase_deadlines: true.
      if (project_deadline) {
        const conflict = await query(
          `SELECT id, number, title, deadline FROM phases
             WHERE project_id = $1 AND archived_at IS NULL
               AND deadline IS NOT NULL AND deadline > $2
             ORDER BY deadline DESC`,
          [id, project_deadline]
        );
        const cascade = req.body && req.body.cascade_phase_deadlines === true;
        if (conflict.rowCount > 0) {
          if (!cascade) {
            return res.status(400).json({
              error: `New project deadline (${project_deadline}) is earlier than ${conflict.rowCount} phase deadline(s). Pass cascade_phase_deadlines: true to auto-cap them.`,
              field: 'project_deadline',
              project_deadline,
              conflicting_phases: conflict.rows.map((p) => ({
                id: p.id, number: p.number, title: p.title, deadline: p.deadline,
              })),
            });
          }
        }
      }
      updates.push(`project_deadline = ${addParam(project_deadline || null)}`);
    }
    if (original_delivery_date !== undefined) {
      updates.push(`original_delivery_date = ${addParam(original_delivery_date || null)}`);
    }
    if (original_delivery_acknowledged !== undefined) {
      updates.push(`original_delivery_acknowledged = ${addParam(Boolean(original_delivery_acknowledged))}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    params.push(id);
    const result = await withTx(async (client) => {
      const r = await client.query(
        `UPDATE projects SET ${updates.join(', ')}, version = version + 1
         WHERE id = $${params.length} RETURNING *`,
        params
      );
      await logActivity(client, {
        project_id: id,
        entity_type: 'project',
        entity_id: id,
        actor_id: req.user.id,
        action: 'update',
        old_values: before,
        new_values: r.rows[0],
      });
      return r.rows[0];
    });
    const enriched = await enrichProject(result);
    res.json({ project: enriched });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// ARCHIVE project — admin (needs reason)
// ============================================================
router.post('/:id(\\d+)/archive', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const reason = (req.body && req.body.reason) || null;
    if (!reason || String(reason).trim().length < 1) {
      return res.status(400).json({ error: 'reason is required to archive' });
    }
    const cur = await query('SELECT * FROM projects WHERE id = $1', [id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    if (cur.rows[0].archived_at) {
      return res.status(409).json({ error: 'Project is already archived' });
    }
    const result = await withTx(async (client) => {
      const r = await client.query(
        `UPDATE projects SET archived_at = NOW(), archived_reason = $2, version = version + 1
         WHERE id = $1 RETURNING *`,
        [id, String(reason).trim()]
      );
      await logActivity(client, {
        project_id: id,
        entity_type: 'project',
        entity_id: id,
        actor_id: req.user.id,
        action: 'archive',
        old_values: cur.rows[0],
        new_values: r.rows[0],
        reason: String(reason).trim(),
      });
      return r.rows[0];
    });
    res.json({ project: await enrichProject(result) });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// RESTORE project — admin
// ============================================================
router.post('/:id(\\d+)/restore', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cur = await query('SELECT * FROM projects WHERE id = $1', [id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    if (!cur.rows[0].archived_at) {
      return res.status(409).json({ error: 'Project is not archived' });
    }
    const result = await withTx(async (client) => {
      const r = await client.query(
        `UPDATE projects SET archived_at = NULL, archived_reason = NULL, version = version + 1
         WHERE id = $1 RETURNING *`,
        [id]
      );
      await logActivity(client, {
        project_id: id,
        entity_type: 'project',
        entity_id: id,
        actor_id: req.user.id,
        action: 'restore',
        old_values: cur.rows[0],
        new_values: r.rows[0],
      });
      return r.rows[0];
    });
    res.json({ project: await enrichProject(result) });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// DELETE project — admin (cascades to phases, edits, members, links, activity)
// ============================================================
router.delete('/:id(\\d+)', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cur = await query('SELECT * FROM projects WHERE id = $1', [id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    const project = cur.rows[0];

    // Get counts so the client can show what will be deleted
    const [phaseCount, editCount, memberCount, linkCount] = await Promise.all([
      query('SELECT COUNT(*)::int AS n FROM phases WHERE project_id = $1', [id]),
      query(
        `SELECT COUNT(*)::int AS n FROM edits e
         JOIN phases p ON p.id = e.phase_id
         WHERE p.project_id = $1`, [id]
      ),
      query('SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1', [id]),
      query('SELECT COUNT(*)::int AS n FROM project_links WHERE project_id = $1', [id]),
    ]);

    // ON DELETE CASCADE on phases, edits, members, links, activity will clean up
    // We log the delete action to stdout since activity_events.project_id is NOT NULL
    // and the row would be cascade-deleted anyway.
    console.log(`[DELETE] project ${id} "${project.name}" by user ${req.user.id}; cascaded: phases=${phaseCount.rows[0].n}, edits=${editCount.rows[0].n}, members=${memberCount.rows[0].n}, links=${linkCount.rows[0].n}`);
    await withTx(async (client) => {
      await client.query('DELETE FROM projects WHERE id = $1', [id]);
    });

    res.json({
      ok: true,
      deleted: {
        id,
        name: project.name,
        cascaded: {
          phases: phaseCount.rows[0].n,
          edits: editCount.rows[0].n,
          members: memberCount.rows[0].n,
          links: linkCount.rows[0].n,
        },
      },
    });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// MEMBERS — add / remove
// ============================================================
router.post('/:id(\\d+)/members', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    const proj = await query('SELECT id FROM projects WHERE id = $1', [id]);
    if (proj.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    const u = await query('SELECT id, name, email, role FROM users WHERE id = $1', [user_id]);
    if (u.rowCount === 0) return res.status(400).json({ error: 'user_id does not exist' });
    await withTx(async (client) => {
      await client.query(
        `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [id, user_id]
      );
      await logActivity(client, {
        project_id: id,
        entity_type: 'member',
        entity_id: user_id,
        actor_id: req.user.id,
        action: 'add_member',
        new_values: { user_id, name: u.rows[0].name, email: u.rows[0].email },
      });
    });
    res.status(201).json({ member: { project_id: id, user_id, ...u.rows[0] } });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id(\\d+)/members/:userId(\\d+)', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const uid = Number(req.params.userId);
    const proj = await query('SELECT id FROM projects WHERE id = $1', [id]);
    if (proj.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    const r = await query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING user_id', [id, uid]);
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'Member not found on this project' });
    }
    await withTx(async (client) => {
      await logActivity(client, {
        project_id: id,
        entity_type: 'member',
        entity_id: uid,
        actor_id: req.user.id,
        action: 'remove_member',
        old_values: { user_id: uid },
      });
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ============================================================
// LINKS — add / update / remove
// ============================================================
router.post('/:id(\\d+)/links', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { label, url } = req.body || {};
    if (!label || !url) return res.status(400).json({ error: 'label and url are required' });
    if (String(label).length > 60) return res.status(400).json({ error: 'label too long (max 60)' });
    if (String(url).length > 500) return res.status(400).json({ error: 'url too long (max 500)' });
    const proj = await query('SELECT id FROM projects WHERE id = $1', [id]);
    if (proj.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    const result = await withTx(async (client) => {
      const r = await client.query(
        `INSERT INTO project_links (project_id, label, url) VALUES ($1, $2, $3) RETURNING *`,
        [id, String(label).trim(), String(url).trim()]
      );
      await logActivity(client, {
        project_id: id,
        entity_type: 'link',
        entity_id: r.rows[0].id,
        actor_id: req.user.id,
        action: 'add_link',
        new_values: { label: r.rows[0].label, url: r.rows[0].url },
      });
      return r.rows[0];
    });
    res.status(201).json({ link: result });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'A link with that label already exists for this project', field: 'label' });
    }
    next(e);
  }
});

router.patch('/:id(\\d+)/links/:linkId(\\d+)', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const linkId = Number(req.params.linkId);
    const cur = await query('SELECT * FROM project_links WHERE id = $1 AND project_id = $2', [linkId, id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Link not found' });
    const { label, url } = req.body || {};
    const updates = [];
    const params = [];
    function addParam(v) { params.push(v); return `$${params.length}`; }
    if (label !== undefined) {
      if (String(label).length > 60) return res.status(400).json({ error: 'label too long (max 60)' });
      updates.push(`label = ${addParam(String(label).trim())}`);
    }
    if (url !== undefined) {
      if (String(url).length > 500) return res.status(400).json({ error: 'url too long (max 500)' });
      updates.push(`url = ${addParam(String(url).trim())}`);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(linkId, id);
    const result = await withTx(async (client) => {
      const r = await client.query(
        `UPDATE project_links SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND project_id = $${params.length} RETURNING *`,
        params
      );
      await logActivity(client, {
        project_id: id,
        entity_type: 'link',
        entity_id: linkId,
        actor_id: req.user.id,
        action: 'update_link',
        old_values: cur.rows[0],
        new_values: r.rows[0],
      });
      return r.rows[0];
    });
    res.json({ link: result });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'A link with that label already exists for this project', field: 'label' });
    }
    next(e);
  }
});

router.delete('/:id(\\d+)/links/:linkId(\\d+)', authRequired, requireActiveUser, requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const linkId = Number(req.params.linkId);
    const cur = await query('SELECT * FROM project_links WHERE id = $1 AND project_id = $2', [linkId, id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Link not found' });
    await query('DELETE FROM project_links WHERE id = $1', [linkId]);
    await withTx(async (client) => {
      await logActivity(client, {
        project_id: id,
        entity_type: 'link',
        entity_id: linkId,
        actor_id: req.user.id,
        action: 'remove_link',
        old_values: cur.rows[0],
      });
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Helper: enrich a project with derived fields (used by create + patch responses)
async function enrichProject(p) {
  const active = await query(
    `SELECT * FROM phases WHERE project_id = $1 AND archived_at IS NULL
     ORDER BY CASE status
       WHEN 'active' THEN 0
       WHEN 'waiting_for_client' THEN 1
       WHEN 'on_hold' THEN 2
       WHEN 'completed' THEN 3
       ELSE 4
     END, number DESC LIMIT 1`,
    [p.id]
  );
  const phase = active.rows[0] || null;
  let edits = [];
  if (phase) {
    const er = await query(`SELECT * FROM edits WHERE phase_id = $1 AND archived_at IS NULL ORDER BY id DESC`, [phase.id]);
    edits = er.rows;
  }
  const status = deriveStatus(p, phase, edits);
  const progress = phase ? computeProgress(edits) : { done: 0, total: 0, label: 'No edits', percent: null };
  return {
    ...projectToJSON(p),
    status,
    active_phase: phase ? {
      id: phase.id, number: phase.number, title: phase.title,
      deadline: phase.deadline, progress,
      overdue: isPhaseOverdue(phase),
    } : null,
  };
}

module.exports = router;
