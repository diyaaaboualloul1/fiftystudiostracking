// src/routes/edits.js — Edit CRUD + archive/restore
//
// Endpoints:
//   - GET    /api/phases/:id/edits          → list edits (any with project access)
//   - POST   /api/phases/:id/edits          → create edit (admin)
//   - GET    /api/edits/:id                 → edit detail (any with project access)
//   - PATCH  /api/edits/:id                 → update (admin OR assigned worker)
//   - POST   /api/edits/:id/archive         → admin (needs reason)
//   - POST   /api/edits/:id/restore         → admin

const express = require('express');
const { query, withTx } = require('../config/db');
const { authRequired, requireActiveUser } = require('../middleware/auth');
const { requireRole, requireProjectAccess, requireProjectWriteAccess } = require('../middleware/permissions');
const { logActivity } = require('../middleware/activityLog');
const { isEditOverdue, editExceedsPhase } = require('../utils/overdue');

const router = express.Router();

const EDIT_STATUSES = ['to_do', 'in_progress', 'testing', 'waiting', 'done', 'cancelled'];

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
// LIST edits in a phase
// ============================================================
router.get(
  '/phases/:id(\\d+)/edits',
  authRequired, requireActiveUser, requireProjectAccess('read'),
  async (req, res, next) => {
    try {
      const phaseId = Number(req.params.id);
      const includeArchived = req.query.includeArchived === 'true';
      const params = [phaseId];
      let where = 'WHERE phase_id = $1';
      if (!includeArchived) where += ' AND archived_at IS NULL';
      // Default ordering: overdue unfinished first, then unfinished by deadline, then done/cancelled
      const r = await query(
        `SELECT e.*, u.name AS assignee_name
         FROM edits e LEFT JOIN users u ON u.id = e.assignee_id
         ${where}
         ORDER BY
           CASE WHEN e.archived_at IS NULL AND e.status NOT IN ('done','cancelled') AND e.deadline IS NOT NULL AND e.deadline < (current_date) THEN 0 ELSE 1 END,
           CASE WHEN e.status IN ('done','cancelled') THEN 1 ELSE 0 END,
           e.deadline NULLS LAST,
           e.id`,
        params
      );
      // Compute overdue flag client-side using the same logic (date-only).
      const edits = r.rows.map(e => ({
        ...e,
        overdue: isEditOverdue(e),
      }));
      res.json({ edits });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// CREATE edit (admin)
// ============================================================
router.post(
  '/phases/:id(\\d+)/edits',
  authRequired, requireActiveUser, requireProjectWriteAccess(),
  async (req, res, next) => {
    try {
      const phaseId = Number(req.params.id);
      const phase = await query('SELECT * FROM phases WHERE id = $1', [phaseId]);
      if (phase.rowCount === 0) return res.status(404).json({ error: 'Phase not found' });
      if (phase.rows[0].archived_at) {
        return res.status(409).json({ error: 'Cannot add edits to an archived phase' });
      }

      const { title, description, assignee_id, status, deadline, waiting_reason, cancellation_reason } = req.body || {};
      if (!title || typeof title !== 'string' || title.trim().length < 1) {
        return res.status(400).json({ error: 'title is required' });
      }
      const editStatus = status || 'to_do';
      if (!EDIT_STATUSES.includes(editStatus)) {
        return res.status(400).json({ error: `status must be one of: ${EDIT_STATUSES.join(', ')}` });
      }
      if (editStatus === 'waiting' && (!waiting_reason || String(waiting_reason).trim().length < 1)) {
        return res.status(400).json({ error: 'waiting_reason is required when status=waiting' });
      }
      if (editStatus === 'cancelled' && (!cancellation_reason || String(cancellation_reason).trim().length < 1)) {
        return res.status(400).json({ error: 'cancellation_reason is required when status=cancelled' });
      }
      if (assignee_id !== undefined && assignee_id !== null) {
        const ac = await query('SELECT id FROM users WHERE id = $1', [assignee_id]);
        if (ac.rowCount === 0) return res.status(400).json({ error: 'assignee_id does not exist' });
      }
      const completedAt = editStatus === 'done' ? 'NOW()' : 'NULL';

      const edit = await withTx(async (client) => {
        const r = await client.query(
          `INSERT INTO edits (phase_id, title, description, assignee_id, status, deadline, waiting_reason, cancellation_reason, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${completedAt})
           RETURNING *`,
          [
            phaseId,
            String(title).trim(),
            description ? String(description) : null,
            assignee_id || null,
            editStatus,
            deadline || null,
            editStatus === 'waiting' ? String(waiting_reason).trim() : null,
            editStatus === 'cancelled' ? String(cancellation_reason).trim() : null,
          ]
        );
        const ed = r.rows[0];
        await logActivity(client, {
          project_id: phase.rows[0].project_id,
          entity_type: 'edit',
          entity_id: ed.id,
          actor_id: req.user.id,
          action: 'create',
          new_values: { title: ed.title, status: ed.status, assignee_id: ed.assignee_id, deadline: ed.deadline },
        });
        return ed;
      });
      res.status(201).json({ edit });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// GET edit detail
// ============================================================
router.get(
  '/edits/:id(\\d+)',
  authRequired, requireActiveUser, requireProjectAccess('read'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const r = await query(
        `SELECT e.*, u.name AS assignee_name, ph.deadline AS phase_deadline, ph.project_id
         FROM edits e
         LEFT JOIN users u ON u.id = e.assignee_id
         JOIN phases ph ON ph.id = e.phase_id
         WHERE e.id = $1`, [id]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: 'Edit not found' });
      const e = r.rows[0];
      const nr = await query(
        `SELECT n.*, u.name AS author_name FROM notes n
         LEFT JOIN users u ON u.id = n.author_id
         WHERE n.edit_id = $1 ORDER BY n.created_at DESC`,
        [id]
      );
      res.json({
        edit: {
          ...e,
          overdue: isEditOverdue(e),
          exceeds_phase: editExceedsPhase(e, { deadline: e.phase_deadline }),
          notes: nr.rows,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// PATCH edit — admin OR the assigned worker
// ============================================================
router.patch(
  '/edits/:id(\\d+)',
  authRequired, requireActiveUser,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const cur = await query('SELECT * FROM edits WHERE id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Edit not found' });
      const before = cur.rows[0];

      // Permission: admin OR (worker AND assignee_id === req.user.id)
      if (req.user.role === 'worker') {
        if (before.assignee_id !== req.user.id) {
          return res.status(403).json({ error: 'Workers can only update edits assigned to them' });
        }
      } else if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const ifMatch = checkIfMatch(req, before.version);
      if (!ifMatch.ok) return res.status(ifMatch.status).json(ifMatch.body);

      const { title, description, assignee_id, status, deadline, waiting_reason, cancellation_reason } = req.body || {};
      const updates = [];
      const params = [];
      function addParam(v) { params.push(v); return `$${params.length}`; }

      // Workers may only update a small set of fields.
      const workerAllowed = new Set(['status', 'deadline', 'waiting_reason', 'cancellation_reason']);
      if (req.user.role === 'worker') {
        for (const k of Object.keys(req.body || {})) {
          if (!workerAllowed.has(k)) {
            return res.status(403).json({ error: `Workers cannot update field: ${k}` });
          }
        }
      }

      // Compute final status (default to current)
      let finalStatus = before.status;
      if (status !== undefined) {
        if (!EDIT_STATUSES.includes(status)) {
          return res.status(400).json({ error: `status must be one of: ${EDIT_STATUSES.join(', ')}` });
        }
        finalStatus = status;
        if (finalStatus === 'waiting' && (!waiting_reason || String(waiting_reason).trim().length < 1) && !before.waiting_reason) {
          return res.status(400).json({ error: 'waiting_reason is required when status=waiting' });
        }
        if (finalStatus === 'cancelled' && (!cancellation_reason || String(cancellation_reason).trim().length < 1) && !before.cancellation_reason) {
          return res.status(400).json({ error: 'cancellation_reason is required when status=cancelled' });
        }
        updates.push(`status = ${addParam(finalStatus)}`);
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
      if (assignee_id !== undefined) {
        if (assignee_id !== null) {
          const ac = await query('SELECT id FROM users WHERE id = $1', [assignee_id]);
          if (ac.rowCount === 0) return res.status(400).json({ error: 'assignee_id does not exist' });
        }
        updates.push(`assignee_id = ${addParam(assignee_id)}`);
      }
      if (deadline !== undefined) {
        updates.push(`deadline = ${addParam(deadline || null)}`);
      }
      if (waiting_reason !== undefined) {
        updates.push(`waiting_reason = ${addParam(waiting_reason === null ? null : String(waiting_reason))}`);
      }
      if (cancellation_reason !== undefined) {
        updates.push(`cancellation_reason = ${addParam(cancellation_reason === null ? null : String(cancellation_reason))}`);
      }

      // Manage completed_at: when status transitions to done, set NOW(); when leaving done, clear it.
      if (status !== undefined && status !== before.status) {
        if (status === 'done' && before.status !== 'done') {
          updates.push(`completed_at = NOW()`);
        } else if (status !== 'done' && before.status === 'done') {
          updates.push(`completed_at = NULL`);
        }
      }

      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

      params.push(id);
      const result = await withTx(async (client) => {
        const r = await client.query(
          `UPDATE edits SET ${updates.join(', ')}, version = version + 1
           WHERE id = $${params.length} RETURNING *`,
          params
        );
        // Find project_id via phase
        const ph = await client.query('SELECT project_id FROM phases WHERE id = $1', [before.phase_id]);
        const project_id = ph.rows[0]?.project_id;
        await logActivity(client, {
          project_id,
          entity_type: 'edit',
          entity_id: id,
          actor_id: req.user.id,
          action: 'update',
          old_values: before,
          new_values: r.rows[0],
        });

        // ============================================================
        // Auto-complete phase: when an edit transitions to done/cancelled
        // AND every non-archived edit in the phase is now done/cancelled,
        // AND the phase is currently active (not already completed/archived),
        // auto-transition the phase to 'completed' — unless the project is a
        // new_build and this would be the first ever completed phase, in which
        // case we need the caller to confirm original delivery.
        // ============================================================
        if (status !== undefined && (status === 'done' || status === 'cancelled') && status !== before.status) {
          const allEdits = await client.query(
            `SELECT status FROM edits WHERE phase_id = $1 AND archived_at IS NULL`,
            [before.phase_id]
          );
          const allFinished = allEdits.rows.length > 0
            && allEdits.rows.every((e) => e.status === 'done' || e.status === 'cancelled');

          if (allFinished) {
            const phCur = await client.query(
              `SELECT * FROM phases WHERE id = $1 AND archived_at IS NULL AND status NOT IN ('completed','planned')`,
              [before.phase_id]
            );
            if (phCur.rowCount > 0) {
              const phaseRow = phCur.rows[0];
              // Check if this would be the first completed phase in a new_build project
              const projRow = await client.query(`SELECT * FROM projects WHERE id = $1`, [phaseRow.project_id]);
              const project = projRow.rows[0];
              const prior = await client.query(
                `SELECT id FROM phases WHERE project_id = $1 AND status = 'completed' AND id <> $2 AND archived_at IS NULL`,
                [phaseRow.project_id, phaseRow.id]
              );
              const needsConfirm = project.project_state === 'new_build' && prior.rowCount === 0;
              if (!needsConfirm) {
                const upd = await client.query(
                  `UPDATE phases SET status = 'completed', completed_at = NOW(), version = version + 1
                   WHERE id = $1 RETURNING *`,
                  [phaseRow.id]
                );
                await logActivity(client, {
                  project_id: phaseRow.project_id,
                  entity_type: 'phase',
                  entity_id: phaseRow.id,
                  actor_id: req.user.id,
                  action: 'complete',
                  reason: 'auto-completed: all edits are done/cancelled',
                  old_values: phaseRow,
                  new_values: upd.rows[0],
                });
              }
              // If needsConfirm, do nothing here — the user must explicitly POST /complete with confirm.
            }
          }
        }

        return r.rows[0];
      });
      res.json({ edit: result });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// ARCHIVE edit (admin)
// ============================================================
router.post(
  '/edits/:id(\\d+)/archive',
  authRequired, requireActiveUser, requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const reason = (req.body && req.body.reason) || null;
      if (!reason || String(reason).trim().length < 1) {
        return res.status(400).json({ error: 'reason is required to archive' });
      }
      const result = await withTx(async (client) => {
        const cur = await client.query('SELECT * FROM edits WHERE id = $1', [id]);
        if (cur.rowCount === 0) return { __notFound: true };
        const before = cur.rows[0];
        if (before.archived_at) return { __error: 409, body: { error: 'Edit is already archived' } };
        const r = await client.query(
          `UPDATE edits SET archived_at = NOW(), archived_reason = $2, version = version + 1
           WHERE id = $1 RETURNING *`,
          [id, String(reason).trim()]
        );
        const ph = await client.query('SELECT project_id FROM phases WHERE id = $1', [before.phase_id]);
        const project_id = ph.rows[0]?.project_id;
        await logActivity(client, {
          project_id,
          entity_type: 'edit',
          entity_id: id,
          actor_id: req.user.id,
          action: 'archive',
          old_values: before,
          new_values: r.rows[0],
          reason: String(reason).trim(),
        });
        return r.rows[0];
      });
      if (result.__notFound) return res.status(404).json({ error: 'Edit not found' });
      if (result.__error) return res.status(result.__error).json(result.body);
      res.json({ edit: result });
    } catch (e) {
      next(e);
    }
  }
);

// ============================================================
// RESTORE edit (admin)
// ============================================================
router.post(
  '/edits/:id(\\d+)/restore',
  authRequired, requireActiveUser, requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const result = await withTx(async (client) => {
        const cur = await client.query('SELECT * FROM edits WHERE id = $1', [id]);
        if (cur.rowCount === 0) return { __notFound: true };
        const before = cur.rows[0];
        if (!before.archived_at) return { __error: 409, body: { error: 'Edit is not archived' } };
        const r = await client.query(
          `UPDATE edits SET archived_at = NULL, archived_reason = NULL, version = version + 1
           WHERE id = $1 RETURNING *`,
          [id]
        );
        const ph = await client.query('SELECT project_id FROM phases WHERE id = $1', [before.phase_id]);
        const project_id = ph.rows[0]?.project_id;
        await logActivity(client, {
          project_id,
          entity_type: 'edit',
          entity_id: id,
          actor_id: req.user.id,
          action: 'restore',
          old_values: before,
          new_values: r.rows[0],
        });
        return r.rows[0];
      });
      if (result.__notFound) return res.status(404).json({ error: 'Edit not found' });
      if (result.__error) return res.status(result.__error).json(result.body);
      res.json({ edit: result });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
