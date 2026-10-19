// src/routes/auth.js — /api/auth/login, /logout, /me
const express = require('express');
const { query } = require('../config/db');
const { verify: verifyPassword } = require('../utils/password');
const { sign } = require('../utils/jwt');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
  };
}

router.post('/login', async (req, res, next) => {
  const { email, password } = req.body || {};

  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const result = await query(
      'SELECT id, name, email, role, active, password_hash FROM users WHERE email = $1 LIMIT 1',
      [String(email).toLowerCase().trim()]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    if (!user.active) {
      return res.status(403).json({ error: 'Account is inactive' });
    }
    const ok = await verifyPassword(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = sign({ sub: user.id, role: user.role, active: user.active });
    return res.json({ token, user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  // Stateless JWT: just a hook for future blacklisting.
  res.status(204).end();
});

router.get('/me', authRequired, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, email, role, active FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user: publicUser(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
