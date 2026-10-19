// src/routes/notes.js — Notes on edits
//
// Endpoints:
//   - GET  /api/edits/:id/notes  → list notes (any with project access)
//   - POST /api/edits/:id/notes  → add note (any active user with project access)

const express = require('express');
const { query, withTx } = require('../config/db');
const { authRequired, requireActiveUser } = require('../middleware/auth');
const { requireProjectAccess } = require('../middleware/permissions');
const { logActivity } = require('../middleware/activityLog');

const router = express.Router();

// LIST notes on an edit
router.get(
  '/edits/:id(\\d+)/notes',
  authRequired, requireActiveUser, requireProjectAccess('read'),
  async (req, res, next) => {
    try {
      const editId = Number(req.params.id);
      const er = await query('SELECT id FROM edits WHERE id = $1', [editId]);
      if (er.rowCount === 0) return res.status(404).json({ error: 'Edit not found' });
      const r = await query(
        `SELECT n.*, u.name AS author_name FROM notes n
         LEFT JOIN users u ON u.id = n.author_id
         WHERE n.edit_id = $1 ORDER BY n.created_at DESC`,
        [editId]
      );
      res.json({ notes: r.rows });
    } catch (e) {
      next(e);
    }
  }
);

// ADD note
router.post(
  '/edits/:id(\\d+)/notes',
  authRequired, requireActiveUser, requireProjectAccess('read'),
  async (req, res, next) => {
    try {
      const editId = Number(req.params.id);
      const { body } = req.body || {};
      if (!body || typeof body !== 'string' || body.trim().length < 1) {
        return res.status(400).json({ error: 'body is required' });
      }
      if (body.length > 5000) return res.status(400).json({ error: 'body too long (max 5000)' });
      const er = await query('SELECT * FROM edits WHERE id = $1', [editId]);
      if (er.rowCount === 0) return res.status(404).json({ error: 'Edit not found' });
      const edit = er.rows[0];
      const ph = await query('SELECT project_id FROM phases WHERE id = $1', [edit.phase_id]);
      const project_id = ph.rows[0]?.project_id;
      const note = await withTx(async (client) => {
        const r = await client.query(
          `INSERT INTO notes (edit_id, author_id, body) VALUES ($1, $2, $3) RETURNING *`,
          [editId, req.user.id, body.trim()]
        );
        await logActivity(client, {
          project_id,
          entity_type: 'note',
          entity_id: r.rows[0].id,
          actor_id: req.user.id,
          action: 'add_note',
          new_values: { edit_id: editId, body_preview: body.trim().slice(0, 80) },
        });
        return r.rows[0];
      });
      res.status(201).json({ note });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
