// src/routes/activity.js — Activity log per project
//
// Endpoints:
//   - GET /api/projects/:id/activity  → list recent activity (any with project access)

const express = require('express');
const { query } = require('../config/db');
const { authRequired, requireActiveUser } = require('../middleware/auth');
const { requireProjectAccess } = require('../middleware/permissions');

const router = express.Router();

router.get(
  '/projects/:id(\\d+)/activity',
  authRequired, requireActiveUser, requireProjectAccess('read'),
  async (req, res, next) => {
    try {
      const projectId = Number(req.params.id);
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const r = await query(
        `SELECT a.*, u.name AS actor_name FROM activity_events a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.project_id = $1
         ORDER BY a.ts DESC
         LIMIT $2`,
        [projectId, limit]
      );
      res.json({ activity: r.rows, count: r.rowCount });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
