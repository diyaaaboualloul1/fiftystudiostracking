// Request logger middleware — writes every API call to /root/fifty-tracker/logs/requests.log
// and to /root/fifty-tracker/logs/auth.log (with auth-specific detail).
// This is the ground truth for "what did the browser actually send?"
const fs = require('fs')
const path = require('path')

const LOG_DIR = '/root/fifty-tracker/logs'
const REQ_LOG = path.join(LOG_DIR, 'requests.log')
const AUTH_LOG = path.join(LOG_DIR, 'auth.log')

// Ensure log dir exists (sync — fine, called once at boot)
try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch {}

// Truncate auth log on boot so we only see this session
try { fs.writeFileSync(AUTH_LOG, '') } catch {}

function ts() {
  return new Date().toISOString()
}

function maskEmail(e) {
  if (!e || typeof e !== 'string') return e
  const [local, domain] = e.split('@')
  if (!domain) return e
  return `${local.slice(0, 2)}***@${domain}`
}

function requestLogger(req, res, next) {
  const startedAt = Date.now()
  const requestId = Math.random().toString(36).slice(2, 10)
  req._requestId = requestId
  req._startedAt = startedAt

  // Capture the response body (small — max 1KB) so we can see exactly what was sent
  const origJson = res.json.bind(res)
  res.json = (body) => {
    req._responseBody = body
    return origJson(body)
  }

  res.on('finish', () => {
    const duration = Date.now() - startedAt
    const line = {
      ts: ts(),
      id: requestId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip || req.connection?.remoteAddress,
      ua: (req.headers['user-agent'] || '').slice(0, 80),
      status: res.statusCode,
      duration: `${duration}ms`,
      // Capture auth header — masked — so we can see if proxy stripped it
      auth: req.headers.authorization
        ? `Bearer ${req.headers.authorization.slice(7, 27)}…(${req.headers.authorization.length} chars)`
        : '(missing)',
      body: req.body && Object.keys(req.body).length ? req.body : undefined,
      response: req._responseBody,
    }
    try {
      fs.appendFileSync(REQ_LOG, JSON.stringify(line) + '\n')
    } catch { /* noop */ }
  })

  next()
}

// Specific auth logger — writes to auth.log with more detail
function logAuth(event, data) {
  const line = { ts: ts(), event, ...data }
  try {
    fs.appendFileSync(AUTH_LOG, JSON.stringify(line) + '\n')
  } catch { /* noop */ }
  // Also echo to stdout so it shows in pm2 logs
  console.log('[auth]', JSON.stringify(line))
}

module.exports = { requestLogger, logAuth, REQ_LOG, AUTH_LOG }
