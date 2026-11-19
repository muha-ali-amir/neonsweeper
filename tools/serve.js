#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 *  NEONSWEEPER // zero-dependency local static server
 *  Usage: npm start   (or: node tools/serve.js)
 *  Opens http://localhost:5173 automatically.
 * ------------------------------------------------------------------ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const HOST = '127.0.0.1';
const BASE_URL = `http://localhost:${PORT}`;
const OPEN_BROWSER = !process.argv.includes('--no-open') && process.env.NO_OPEN !== '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, BASE_URL).pathname);
  } catch {
    send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.resolve(ROOT, `.${pathname}`);
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(res, 404, `<!doctype html><meta charset="utf-8"><title>404 // SIGNAL LOST</title>
<body style="background:#03040a;color:#23f4ff;font:14px monospace;display:grid;place-items:center;height:100vh;margin:0">
<div><p>404 // SIGNAL LOST</p><p style="color:#6f8ba5">No route mapped to <code>${escapeHtml(pathname)}</code>.</p>
<p><a style="color:#ff2bd6" href="/">RETURN TO NEONSWEEPER</a></p></div></body>`, {
        'Content-Type': 'text/html; charset=utf-8',
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };

    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath)
      .on('error', () => {
        if (!res.headersSent) send(res, 500, 'Read error');
        else res.destroy();
      })
      .pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ██ NEONSWEEPER // MINEFIELD PROTOCOL');
  console.log(`  ▸ uplink:  ${BASE_URL}`);
  console.log(`  ▸ serving: ${ROOT}`);
  console.log('  ▸ press CTRL+C to terminate');
  console.log('');

  if (!OPEN_BROWSER) return;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', BASE_URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [BASE_URL], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [BASE_URL], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    console.log('  (could not open a browser automatically — open the URL manually)');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  ✖ Port ${PORT} is already in use.`);
    console.error(`    Close the other server or run:  set PORT=5174 && npm start\n`);
  } else {
    console.error('\n  ✖ Server error:', error.message, '\n');
  }
  process.exitCode = 1;
});

const shutdown = () => {
  console.log('\n  ▸ uplink terminated.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
