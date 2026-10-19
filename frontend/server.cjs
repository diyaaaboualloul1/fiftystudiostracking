// Frontend server — serves built React app + proxies /api/* to backend
// Uses http-proxy directly (not http-proxy-middleware) to avoid header-stripping bugs
const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT) || 3080;
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:3081';

// Create a proxy server that forwards all requests to the backend
const apiProxy = httpProxy.createProxyServer({
  target: API_TARGET,
  changeOrigin: true,
  secure: false,
  ws: false,
  xfwd: true, // append X-Forwarded-* headers
});

apiProxy.on('error', (err, req, res) => {
  console.error(`[proxy] ERR ${req.method} ${req.url} → ${err.message}`);
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend unavailable' }));
  }
});

apiProxy.on('proxyReq', (proxyReq, req) => {
  // Explicitly forward the Authorization header — some proxies strip it
  if (req.headers.authorization) {
    proxyReq.setHeader('Authorization', req.headers.authorization);
  }
  console.log(`[proxy] FWD ${req.method} ${req.url} auth=${req.headers.authorization ? 'YES' : 'NO'}`);
});

apiProxy.on('proxyRes', (proxyRes, req) => {
  console.log(`[proxy] RES ${req.method} ${req.url} ← ${proxyRes.statusCode}`);
});

const app = express();

// Log every /api/* request
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[req] ${req.method} ${req.url} auth=${req.headers.authorization ? 'YES' : 'NO'}`);
  }
  next();
});

// Proxy /api/* to backend — use a middleware with path check (newer
// path-to-regexp v8+ rejects bare wildcards like /api/*).
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/api') {
    apiProxy.web(req, res);
    return;
  }
  next();
});

// Serve static files from dist/
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (/\.(js|css|woff2?|png|svg|ico)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      }
    },
  }));
}

// SPA fallback — serve index.html for any non-/api route
app.get(/^(?!\/api\/).*/, (req, res) => {
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(indexPath);
  } else {
    res.status(503).send('Frontend not built. Run `npm run build` first.');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[fifty-tracker-frontend] serving on :${PORT}, proxying /api/* → ${API_TARGET}`);
});
