// src/middleware/auth.js — authentication + role middleware
const { verify } = require('../utils/jwt');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = {
    id: payload.sub,
    role: payload.role,
    active: payload.active,
  };
  next();
}

function requireActiveUser(req, res, next) {
  if (!req.user || !req.user.active) {
    return res.status(403).json({ error: 'User account is inactive' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authRequired, requireActiveUser, requireAdmin };
