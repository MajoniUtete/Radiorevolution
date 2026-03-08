/**
 * Radio Revolution — Local Dev Server
 * Run: node serve.js
 * Then open: http://localhost:3000
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);
  const ext      = path.extname(filePath).toLowerCase();
  const mime     = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try index.html for SPA-style fallback
      fs.readFile(path.join(ROOT, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      // Required for service workers
      'Service-Worker-Allowed': '/',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────────┐
│  📻 Radio Revolution — Dev Server        │
│  http://localhost:${PORT}                   │
│                                         │
│  Admin panel: http://localhost:${PORT}/admin.html│
│                                         │
│  Press Ctrl+C to stop                   │
└─────────────────────────────────────────┘
  `);
});
