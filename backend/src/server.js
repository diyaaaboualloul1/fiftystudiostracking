// src/server.js — Express app entry point
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const projectsRouter = require('./routes/projects');
const phasesRouter = require('./routes/phases');
const editsRouter = require('./routes/edits');
const notesRouter = require('./routes/notes');
const activityRouter = require('./routes/activity');
const { notFound, errorHandler } = require('./middleware/error');
const { requestLogger } = require('./middleware/requestLogger');
const { query } = require('./config/db');

// ============================================================
// Schema bootstrap — run src/db/schema.sql on boot (idempotent).
// Errors are logged but do NOT crash the server; routes surface
// the underlying DB error if the schema is truly missing.
// ============================================================
async function runSchema() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    // eslint-disable-next-line no-console
    console.error('[schema] schema.sql not found at', schemaPath);
    return;
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  try {
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[schema] OK — schema.sql applied (idempotent)');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[schema] FAILED to apply schema.sql:', e.message);
  }
}

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: (process.env.FRONTEND_URL || 'http://localhost:3080').split(',').map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// File-based request logger — writes every API call to /root/fifty-tracker/logs/
app.use('/api', requestLogger);

// Health check (no auth)
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, ts: new Date().toISOString(), tz: process.env.COMPANY_TIMEZONE || 'Asia/Kuwait' });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'db_unreachable' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api', phasesRouter);     // /api/projects/:id/phases AND /api/phases/...
app.use('/api', editsRouter);      // /api/phases/:id/edits     AND /api/edits/...
app.use('/api', notesRouter);      // /api/edits/:id/notes
app.use('/api', activityRouter);   // /api/projects/:id/activity

// Debug endpoint — verify a token
const { verify: verifyJwt } = require('./utils/jwt');
app.post('/api/debug/verify-token', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required' });
  const payload = verifyJwt(token);
  res.json({
    tokenLength: token.length,
    tokenFirst10: token.slice(0, 10),
    tokenLast10: token.slice(-10),
    valid: Boolean(payload),
    payload: payload || null,
    now: Math.floor(Date.now() / 1000),
    tokenExp: payload?.exp || null,
  });
});

// Debug endpoint — read the last N log entries
app.get('/api/debug/logs', (req, res) => {
  const { REQ_LOG, AUTH_LOG } = require('./middleware/requestLogger');
  const type = req.query.type === 'auth' ? AUTH_LOG : REQ_LOG;
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  try {
    const content = fs.readFileSync(type, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const tail = lines.slice(-limit);
    const parsed = tail.map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
    res.json({
      file: path.basename(type),
      count: parsed.length,
      total: lines.length,
      entries: parsed,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/api', notFound);
app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT) || 3081;

// Run schema first, then start listening. If the schema fails we still
// start (to keep /api/health useful) but log the error.
(async () => {
  await runSchema();
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[fifty-tracker] backend listening on :${port} (env=${process.env.NODE_ENV || 'development'})`);
  });

  function shutdown(signal) {
    // eslint-disable-next-line no-console
    console.log(`[fifty-tracker] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();

module.exports = app;
