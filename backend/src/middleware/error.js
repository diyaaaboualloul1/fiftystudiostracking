// src/middleware/error.js — JSON error responses, no stack leak in prod

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

function errorHandler(err, req, res, _next) {
  // eslint-disable-next-line no-console
  console.error('[err]', err.message);
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(err.stack);
  }
  if (res.headersSent) return;
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.publicMessage || (status >= 500 ? 'Internal server error' : err.message || 'Error'),
  });
}

module.exports = { notFound, errorHandler };
