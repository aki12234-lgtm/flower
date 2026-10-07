// Minimal static server. ES modules need a real origin; file:// will not work.
//
//   node tools/serve.js [port] [home]
//
// home is what / serves, index.html unless given: tools/quiet.html opens on a
// blank page, for starting the server without starting the game.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5173);
const HOME = process.argv[3] || 'index.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  // POST a data URL here and it lands in tools/snapshots/. The whole point of
  // the project is how it looks, and reading pixel statistics back out of a
  // canvas is no substitute for opening the image.
  if (req.method === 'POST' && url === '/_snap') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { name, data } = JSON.parse(body);
        const safe = String(name).replace(/[^a-z0-9._-]/gi, '_');
        const bin = Buffer.from(String(data).split(',')[1], 'base64');
        const dir = path.join(ROOT, 'tools', 'snapshots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, safe), bin);
        res.writeHead(200, { 'content-type': 'text/plain' }).end('saved ' + safe);
      } catch (e) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end(String(e));
      }
    });
    return;
  }

  const rel = url === '/' ? HOME :url.replace(/^\/+/, '');
  let file = path.resolve(ROOT, rel);

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  // A folder serves its index.html, the way GitHub Pages does, so v2/ works
  // here as it does online. Asked for without its slash, it is sent to the
  // slash first: otherwise everything the page links relatively would resolve
  // from the folder above it.
  if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) {
    if (!url.endsWith('/')) {
      const [raw, query] = (req.url || '/').split(/\?(.*)/s);
      res.writeHead(301, { location: raw + '/' + (query ? '?' + query : '') }).end();
      return;
    }
    file = path.join(file, 'index.html');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(data);
  });
}).listen(PORT, () => {
  console.log(`flower: http://localhost:${PORT}`);
});
