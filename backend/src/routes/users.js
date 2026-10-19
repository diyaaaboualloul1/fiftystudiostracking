// src/routes/users.js — admin-only user CRUD + reactivate
const express = require('express');
const { query } = require('../config/db');
const { hash } = require('../utils/password');
const { validateName, validateEmail, validatePassword } = require('../utils/validation');
const { authRequired, requireActiveUser, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

const VALID_ROLES = ['admin', 'worker'];

// Map a password.js error message to a 400 response. Returns null if not a
// validation error (so the caller can re-throw unexpected errors).
function passwordErrorTo400(e) {
  if (e && typeof e.message === 'string' && e.message.startsWith('Password must')) {
    return { status: 400, body: { error: e.message, field: 'password' } };
  }
  return null;
}

router.use(authRequired, requireActiveUser, requireAdmin);

// GET /api/users?includeInactive=true|false&active=true|false&role=admin|worker
//   includeInactive=true  → returns active + inactive (default when omitted is false)
//   includeInactive=false → returns only active
//   active=true|false     → explicit filter (takes precedence)
//   role=admin|worker     → filter by role
router.get('/', async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];
    if (req.query.active !== undefined) {
      params.push(req.query.active === 'true');
      conditions.push(`active = $${params.length}`);
    } else if (req.query.includeInactive === 'true') {
      // No filter — include both active and inactive
    } else {
      // Default: only active users
      conditions.push('active = true');
    }
    if (req.query.role) {
      params.push(String(req.query.role));
      conditions.push(`role = $${params.length}`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await query(
      `SELECT id, name, email, role, active, created_at, updated_at
       FROM users ${where}
       ORDER BY created_at DESC`,
      params
    );
    res.json({ users: result.rows.map(publicUser) });
  } catch (e) {
    next(e);
  }
});

// POST /api/users — create
router.post('/', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, role are required' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    // Validate name + email format
    const nameErr = validateName(name);
    if (nameErr) return res.status(400).json({ error: nameErr, field: 'name' });
    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr, field: 'email' });

    const cleanEmail = email.trim().toLowerCase();
    const existing = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [cleanEmail]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'A user with that email already exists', field: 'email' });
    }

    // Hash the password. password.js throws on < 8 chars; convert to 400.
    let passwordHash;
    try {
      passwordHash = await hash(String(password));
    } catch (e) {
      const mapped = passwordErrorTo400(e);
      if (mapped) return res.status(mapped.status).json(mapped.body);
      throw e;
    }

    const result = await query(
      `INSERT INTO users (name, email, password_hash, role, active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, email, role, active, created_at, updated_at`,
      [name.trim(), cleanEmail, passwordHash, role]
    );
    res.status(201).json({ user: publicUser(result.rows[0]) });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'A user with that email already exists', field: 'email' });
    }
    next(e);
  }
});

// PATCH /api/users/:id — update
router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const { name, email, password, role, active } = req.body || {};
    const updates = [];
    const params = [];

    if (name !== undefined) {
      const err = validateName(name);
      if (err) return res.status(400).json({ error: err, field: 'name' });
      params.push(name.trim());
      updates.push(`name = $${params.length}`);
    }
    if (email !== undefined) {
      const err = validateEmail(email);
      if (err) return res.status(400).json({ error: err, field: 'email' });
      params.push(email.trim().toLowerCase());
      updates.push(`email = $${params.length}`);
    }
    if (password !== undefined) {
      let passwordHash;
      try {
        passwordHash = await hash(String(password));
      } catch (e) {
        const mapped = passwordErrorTo400(e);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        throw e;
      }
      params.push(passwordHash);
      updates.push(`password_hash = $${params.length}`);
    }
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}`, field: 'role' });
      }
      // Block self-demote: an admin cannot demote themselves away from admin
      if (id === req.user.id && role !== 'admin') {
        return res.status(400).json({
          error: 'You cannot change your own role away from admin',
          field: 'role',
        });
      }
      params.push(role);
      updates.push(`role = $${params.length}`);
    }
    if (active !== undefined) {
      params.push(Boolean(active));
      updates.push(`active = $${params.length}`);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    params.push(id);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, name, email, role, active, created_at, updated_at`,
      params
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: publicUser(result.rows[0]) });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'A user with that email already exists', field: 'email' });
    }
    next(e);
  }
});

// DELETE /api/users/:id — soft delete (set active=false)
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    const result = await query(
      `UPDATE users SET active = false
       WHERE id = $1 AND active = true
       RETURNING id`,
      [id]
    );
    if (result.rowCount === 0) {
      // Either the user doesn't exist or was already inactive
      const exists = await query('SELECT id, active FROM users WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'User not found' });
      // Already inactive — idempotent success
      return res.status(204).end();
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// POST /api/users/:id/reactivate
router.post('/:id/reactivate', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const result = await query(
      `UPDATE users SET active = true
       WHERE id = $1
       RETURNING id, name, email, role, active, created_at, updated_at`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: publicUser(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
