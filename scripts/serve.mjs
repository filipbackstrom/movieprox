#!/usr/bin/env node
// Tiny static file server for local development: `npm run serve` then open http://localhost:8080
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url.endsWith('/')) url += 'index.html';
  const file = path.join(root, path.normalize(url));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error();
    res.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
