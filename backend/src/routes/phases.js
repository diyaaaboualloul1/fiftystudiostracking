// src/routes/phases.js — Phase CRUD + activate / complete / archive / restore
//
// Endpoints:
//   - GET    /api/projects/:id/phases           → list phases (any with project access)
//   - POST   /api/projects/:id/phases           → create phase (admin)
//   - GET    /api/phases/:id                    → phase detail (any with project access)
//   - PATCH  /api/phases/:id                    → update phase fields (admin)
//   - POST   /api/phases/:id/activate           → activate a planned phase (admin)
//   - POST   /api/phases/:id/complete           → complete the active phase (admin)
//   - POST   /api/phases/:id/archive            → archive phase (admin; needs reason)
//   - POST   /api/phases/:id/restore            → restore archived phase (admin)
//
// Single-active-phase rule is enforced at the DB level via partial UNIQUE index
// (uq_phases_single_active). Activation inserts as 'planned' and then sets to 'active'
// inside a transaction; if a sibling is already active, the unique index fires.

const express = require('express');
const { query, withTx } = require('../config/db');
const { authRequired, requireActiveUser } = require('../middleware/auth');
const { requireRole, requireProjectAccess, requireProjectWriteAccess, resolveProjectIdForRequest } = require('../middleware/permissions');
const { logActivity } = require('../middleware/activityLog');
const { computeProgress } = require('../utils/progress');
const { isPhaseOverdue, isEditOverdue } = require('../utils/overdue');

const router = express.Router();

const PHASE_STATUSES = ['planned', 'active', 'waiting_for_client', 'on_hold', 'completed'];

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

async function getPhaseOr404(client, id) {
  const r = await client.query('SELECT * FROM phases WHERE id = $1', [id]);
  if (r.rowCount === 0) return null;
  return r.rows[0];
}

// ============================================================
// LIST phases for a project
// ============================================================
router.get(
  '/projects/:id(\\d+)/phases',
  authRequired, requireActiveUser, requireProjectAccess('read'),
  async (req, res, next) => {
    try {
      const projectId = Number(req.params.id);
      const includeArchived = req.query.includeArchived === 'true';
      const params = [projectId];
      let where = 'WHERE project_id = $1';
      if (!includeArchived) where += ' AND archived_at IS NULL';
      const r = await query(
        `SELECT * FROM phases ${where} ORDER BY number`,
        params
      );
      // Compute progress for each
      const phases = await Promise.all(r.rows.map(async (ph) => {
        const er = await query('SELECT * FROM edits WHERE phase_id = $1 AND archived_at IS NULL ORDER BY id DESC', [ph.id]);
        const progress = computeProgress(er.rows);
        return { ...ph, progress, overdue: isPhaseOverdue(ph) };
      }));
      res.json({ phases });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// CREATE phase for a project
// ============================================================
router.post(
  '/projects/:id(\\d+)/phases',
  authRequired, requireActiveUser, requireProjectWriteAccess(),
  async (req, res, next) => {
    try {
      const projectId = Number(req.params.id);
      const proj = await query('SELECT id, project_deadline FROM projects WHERE id = $1', [projectId]);
      if (proj.rowCount === 0) return res.status(404).json({ error: 'Project not found' });

      const { number, title, description, deadline, activate_now } = req.body || {};
      if (!title || typeof title !== 'string' || title.trim().length < 1) {
        return res.status(400).json({ error: 'title is required' });
      }
      if (!number || !Number.isInteger(Number(number)) || Number(number) < 1) {
        return res.status(400).json({ error: 'number must be a positive integer' });
      }

      // Enforce: phase deadline cannot be after the project's deadline.
      if (deadline && proj.rows[0].project_deadline && deadline > proj.rows[0].project_deadline) {
        return res.status(400).json({
          error: `Phase deadline (${deadline}) cannot be after the project's deadline (${proj.rows[0].project_deadline}).`,
          field: 'deadline',
          project_deadline: proj.rows[0].project_deadline,
        });
      }

      const num = Number(number);
      const dup = await query(
        `SELECT id FROM phases WHERE project_id = $1 AND number = $2 AND archived_at IS NULL`,
        [projectId, num]
      );
      if (dup.rowCount > 0) {
        return res.status(409).json({ error: `Phase number ${num} already exists for this project` });
      }

      const phase = await withTx(async (client) => {
        // If activating now, archive any currently active phase first (same tx)
        // so the partial UNIQUE index on (project_id) WHERE status='active' AND archived_at IS NULL doesn't fire.
        // NOTE: do NOT set status='archived' — the DB CHECK constraint only allows the 5 active statuses.
        // Archived state is represented by archived_at IS NOT NULL.
        let archivedPhase = null;
        if (activate_now) {
          const reason = 'auto-archived because a new phase was activated';
          const ar = await client.query(
            `UPDATE phases
                SET archived_at = NOW(), archived_reason = $2
              WHERE project_id = $1 AND status = 'active' AND archived_at IS NULL
              RETURNING id, number, title, archived_at`,
            [projectId, reason]
          );
          if (ar.rowCount > 0) {
            archivedPhase = ar.rows[0];
            await logActivity(client, {
              project_id: projectId,
              entity_type: 'phase',
              entity_id: archivedPhase.id,
              actor_id: req.user.id,
              action: 'archive',
              new_values: { archived_at: ar.rows[0].archived_at },
              reason,
            });
          }
        }

        const status = activate_now ? 'active' : 'planned';
        const activatedAt = activate_now ? 'NOW()' : 'NULL';
        const r = await client.query(
          `INSERT INTO phases (project_id, number, title, description, status, deadline, activated_at)
           VALUES ($1, $2, $3, $4, $5, $6, ${activatedAt})
           RETURNING *`,
          [
            projectId,
            num,
            String(title).trim(),
            description ? String(description) : null,
            status,
            deadline || null,
          ]
        );
        const ph = r.rows[0];
        await logActivity(client, {
          project_id: projectId,
          entity_type: 'phase',
          entity_id: ph.id,
          actor_id: req.user.id,
          action: 'create',
          new_values: { number: ph.number, title: ph.title, status: ph.status, deadline: ph.deadline },
        });
        if (activate_now) {
          await logActivity(client, {
            project_id: projectId,
            entity_type: 'phase',
            entity_id: ph.id,
            actor_id: req.user.id,
            action: 'activate',
            new_values: { status: 'active' },
          });
        }
        return ph;
      });

      res.status(201).json({ phase });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: 'Phase number already exists for this project' });
      }
      next(e);
    }
  }
);

// ============================================================
// GET phase by id
// ============================================================
router.get(
  '/phases/:id(\\d+)',
  authRequired, requireActiveUser, requireProjectAccess('read'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const r = await query('SELECT * FROM phases WHERE id = $1', [id]);
      if (r.rowCount === 0) return res.status(404).json({ error: 'Phase not found' });
      const ph = r.rows[0];
      const er = await query('SELECT * FROM edits WHERE phase_id = $1 AND archived_at IS NULL ORDER BY id DESC', [id]);
      const progress = computeProgress(er.rows);
      const overdueEdits = er.rows.filter(isEditOverdue);
      res.json({
        phase: {
          ...ph,
          progress,
          overdue: isPhaseOverdue(ph),
          overdue_edits: overdueEdits.length,
          edits: er.rows,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// PATCH phase — update fields (admin)
// ============================================================
router.patch(
  '/phases/:id(\\d+)',
  authRequired, requireActiveUser, requireProjectWriteAccess(),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const cur = await query('SELECT * FROM phases WHERE id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Phase not found' });
      const before = cur.rows[0];
      const ifMatch = checkIfMatch(req, before.version);
      if (!ifMatch.ok) return res.status(ifMatch.status).json(ifMatch.body);

      const { title, description, status, waiting_reason, hold_reason, deadline } = req.body || {};
      const updates = [];
      const params = [];
      function addParam(v) { params.push(v); return `$${params.length}`; }

      // Enforce: phase deadline cannot be after the project's deadline.
      // Only do this check when the deadline is being changed.
      if (deadline !== undefined && deadline) {
        const pr = await query('SELECT project_deadline FROM projects WHERE id = $1', [before.project_id]);
        const projectDeadline = pr.rows[0]?.project_deadline;
        if (projectDeadline && deadline > projectDeadline) {
          return res.status(400).json({
            error: `Phase deadline (${deadline}) cannot be after the project's deadline (${projectDeadline}).`,
            field: 'deadline',
            project_deadline: projectDeadline,
          });
        }
      }
      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length < 1) {
          return res.status(400).json({ error: 'title must be a non-empty string' });
        }
        updates.push(`title = ${addParam(String(title).trim())}`);
      }
      if (description !== undefined) {
        updates.push(`description = ${addParam(description === null ? null : String(description))}`);
      }
      if (status !== undefined) {
        if (!PHASE_STATUSES.includes(status)) {
          return res.status(400).json({ error: `status must be one of: ${PHASE_STATUSES.join(', ')}` });
        }
        // Only allow direct status changes within the planned/active flow.
        // Activation must go through /activate to bump activated_at; completion through /complete.
        if (status === 'active') {
          return res.status(400).json({ error: "Use POST /api/phases/:id/activate to set status='active'" });
        }
        if (status === 'completed') {
          return res.status(400).json({ error: "Use POST /api/phases/:id/complete to set status='completed'" });
        }
        // DB CHECK constraints require a reason for waiting_for_client / on_hold.
        // Validate here so the user gets a clear 400 instead of a 500 from the DB.
        if (status === 'waiting_for_client' && (waiting_reason === undefined || !String(waiting_reason).trim())) {
          return res.status(400).json({ error: "waiting_reason is required when status='waiting_for_client'" });
        }
        if (status === 'on_hold' && (hold_reason === undefined || !String(hold_reason).trim())) {
          return res.status(400).json({ error: "hold_reason is required when status='on_hold'" });
        }
        updates.push(`status = ${addParam(status)}`);
      }
      if (waiting_reason !== undefined) {
        updates.push(`waiting_reason = ${addParam(waiting_reason === null ? null : String(waiting_reason))}`);
      }
      if (hold_reason !== undefined) {
        updates.push(`hold_reason = ${addParam(hold_reason === null ? null : String(hold_reason))}`);
      }
      if (deadline !== undefined) {
        updates.push(`deadline = ${addParam(deadline || null)}`);
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

      params.push(id);
      const result = await withTx(async (client) => {
        const r = await client.query(
          `UPDATE phases SET ${updates.join(', ')}, version = version + 1
           WHERE id = $${params.length} RETURNING *`,
          params
        );
        await logActivity(client, {
          project_id: before.project_id,
          entity_type: 'phase',
          entity_id: id,
          actor_id: req.user.id,
          action: 'update',
          old_values: before,
          new_values: r.rows[0],
        });
        return r.rows[0];
      });
      res.json({ phase: result });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// ACTIVATE phase — set status to 'active'
// Enforces: no other non-archived active phase in the same project
//           (DB UNIQUE index will also enforce this — we get a clean 409).
// ============================================================
router.post(
  '/phases/:id(\\d+)/activate',
  authRequired, requireActiveUser, requireProjectWriteAccess(),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const phase = await withTx(async (client) => {
        const cur = await getPhaseOr404(client, id);
        if (!cur) return { __notFound: true };
        if (cur.archived_at) return { __error: 409, body: { error: 'Cannot activate an archived phase' } };
        if (cur.status === 'completed') return { __error: 409, body: { error: 'Cannot activate a completed phase' } };
        if (cur.status === 'active') return { __error: 409, body: { error: 'Phase is already active' } };

        // Set to active — DB unique partial index will reject if another sibling is active.
        try {
          const r = await client.query(
            `UPDATE phases SET status = 'active', activated_at = NOW(), version = version + 1
             WHERE id = $1 RETURNING *`,
            [id]
          );
          await logActivity(client, {
            project_id: cur.project_id,
            entity_type: 'phase',
            entity_id: id,
            actor_id: req.user.id,
            action: 'activate',
            old_values: cur,
            new_values: r.rows[0],
          });
          return r.rows[0];
        } catch (e) {
          if (e.code === '23505') {
            // UNIQUE partial index violation
            return { __error: 409, body: { error: 'Another phase is already active in this project' } };
          }
          throw e;
        }
      });
      if (phase.__notFound) return res.status(404).json({ error: 'Phase not found' });
      if (phase.__error) return res.status(phase.__error).json(phase.body);
      res.json({ phase });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// COMPLETE phase — set status to 'completed'
// Requires: at least one Done edit AND every non-archived edit is Done or Cancelled.
// Also: if project_state='new_build' and this is the first ever phase being completed,
//       ask caller to confirm by sending confirm_original_delivery=true.
// ============================================================
router.post(
  '/phases/:id(\\d+)/complete',
  authRequired, requireActiveUser, requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const confirm = req.body && req.body.confirm_original_delivery === true;
      const phase = await withTx(async (client) => {
        const cur = await getPhaseOr404(client, id);
        if (!cur) return { __notFound: true };
        if (cur.archived_at) return { __error: 409, body: { error: 'Cannot complete an archived phase' } };
        if (cur.status === 'completed') return { __error: 409, body: { error: 'Phase is already completed' } };
        if (cur.status === 'planned') return { __error: 409, body: { error: 'Cannot complete a planned phase — activate it first' } };

        // Read edits in this phase (non-archived)
        const er = await client.query(
          'SELECT * FROM edits WHERE phase_id = $1 AND archived_at IS NULL ORDER BY id DESC',
          [id]
        );
        const edits = er.rows;
        const doneCount = edits.filter(e => e.status === 'done').length;
        const unfinished = edits.filter(e => e.status !== 'done' && e.status !== 'cancelled');
        if (unfinished.length > 0) {
          return { __error: 400, body: { error: 'Cannot complete: unfinished edits remain', unfinished_count: unfinished.length } };
        }
        // Allow completing a phase that has NO edits at all (empty phase is valid).
        // Only require at least one Done edit IF there are any edits.
        if (edits.length > 0 && doneCount === 0) {
          return { __error: 400, body: { error: 'Cannot complete: at least one edit must be Done' } };
        }

        // If this is the first completed phase and project_state is new_build, require confirmation.
        const proj = await client.query('SELECT * FROM projects WHERE id = $1', [cur.project_id]);
        const project = proj.rows[0];
        const priorCompleted = await client.query(
          `SELECT id FROM phases WHERE project_id = $1 AND status = 'completed' AND id <> $2 AND archived_at IS NULL`,
          [cur.project_id, id]
        );
        if (project.project_state === 'new_build' && priorCompleted.rowCount === 0) {
          if (!confirm) {
            return { __error: 409, body: {
              error: 'Completing the initial build requires confirmation. Re-send with confirm_original_delivery=true',
              needs_confirmation: true,
              suggested_original_delivery_date: new Date().toISOString().slice(0, 10),
            } };
          }
          // Apply the side-effect: project_state -> already_built, original_delivery_date -> today
          await client.query(
            `UPDATE projects SET project_state = 'already_built',
               original_delivery_date = COALESCE(original_delivery_date, CURRENT_DATE),
               original_delivery_acknowledged = true,
               version = version + 1
             WHERE id = $1`,
            [cur.project_id]
          );
        }

        const r = await client.query(
          `UPDATE phases SET status = 'completed', completed_at = NOW(), version = version + 1
           WHERE id = $1 RETURNING *`,
          [id]
        );
        await logActivity(client, {
          project_id: cur.project_id,
          entity_type: 'phase',
          entity_id: id,
          actor_id: req.user.id,
          action: 'complete',
          old_values: cur,
          new_values: r.rows[0],
        });
        return r.rows[0];
      });
      if (phase.__notFound) return res.status(404).json({ error: 'Phase not found' });
      if (phase.__error) return res.status(phase.__error).json(phase.body);
      res.json({ phase });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// ARCHIVE phase — admin, requires reason
// Releasing an active phase's slot is automatic (status stays whatever, but archived_at IS NOT NULL
// excludes it from the uq_phases_single_active partial index).
// ============================================================
router.post(
  '/phases/:id(\\d+)/archive',
  authRequired, requireActiveUser, requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const reason = (req.body && req.body.reason) || null;
      if (!reason || String(reason).trim().length < 1) {
        return res.status(400).json({ error: 'reason is required to archive' });
      }
      const phase = await withTx(async (client) => {
        const cur = await getPhaseOr404(client, id);
        if (!cur) return { __notFound: true };
        if (cur.archived_at) return { __error: 409, body: { error: 'Phase is already archived' } };
        const r = await client.query(
          `UPDATE phases SET archived_at = NOW(), archived_reason = $2, version = version + 1
           WHERE id = $1 RETURNING *`,
          [id, String(reason).trim()]
        );
        await logActivity(client, {
          project_id: cur.project_id,
          entity_type: 'phase',
          entity_id: id,
          actor_id: req.user.id,
          action: 'archive',
          old_values: cur,
          new_values: r.rows[0],
          reason: String(reason).trim(),
        });
        return r.rows[0];
      });
      if (phase.__notFound) return res.status(404).json({ error: 'Phase not found' });
      if (phase.__error) return res.status(phase.__error).json(phase.body);
      res.json({ phase });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// RESTORE phase — admin
// Cannot restore if another non-archived phase currently holds the active slot
// (DB UNIQUE index will reject the restoration if so).
// ============================================================
router.post(
  '/phases/:id(\\d+)/restore',
  authRequired, requireActiveUser, requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const phase = await withTx(async (client) => {
        const cur = await getPhaseOr404(client, id);
        if (!cur) return { __notFound: true };
        if (!cur.archived_at) return { __error: 409, body: { error: 'Phase is not archived' } };

        // If restoring an active phase, archive any OTHER active phase first
        // so the partial UNIQUE index on (project_id) WHERE status='active' AND archived_at IS NULL doesn't fire.
        // NOTE: do NOT set status='archived' — the DB CHECK constraint only allows the 5 active statuses.
        // Archived state is represented by archived_at IS NOT NULL.
        if (cur.status === 'active') {
          const reason = 'auto-archived because another phase was restored';
          const ar = await client.query(
            `UPDATE phases
                SET archived_at = NOW(), archived_reason = $2
              WHERE project_id = $1 AND status = 'active' AND archived_at IS NULL AND id != $3
              RETURNING id, number, title, archived_at`,
            [cur.project_id, reason, id]
          );
          if (ar.rowCount > 0) {
            const archivedPhase = ar.rows[0];
            await logActivity(client, {
              project_id: cur.project_id,
              entity_type: 'phase',
              entity_id: archivedPhase.id,
              actor_id: req.user.id,
              action: 'archive',
              new_values: { archived_at: ar.rows[0].archived_at },
              reason,
            });
          }
        }

        try {
          const r = await client.query(
            `UPDATE phases SET archived_at = NULL, archived_reason = NULL, version = version + 1
             WHERE id = $1 RETURNING *`,
            [id]
          );
          await logActivity(client, {
            project_id: cur.project_id,
            entity_type: 'phase',
            entity_id: id,
            actor_id: req.user.id,
            action: 'restore',
            old_values: cur,
            new_values: r.rows[0],
          });
          return r.rows[0];
        } catch (e) {
          if (e.code === '23505') {
            return { __error: 409, body: { error: 'Cannot restore: another active phase already exists for this project' } };
          }
          throw e;
        }
      });
      if (phase.__notFound) return res.status(404).json({ error: 'Phase not found' });
      if (phase.__error) return res.status(phase.__error).json(phase.body);
      res.json({ phase });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
