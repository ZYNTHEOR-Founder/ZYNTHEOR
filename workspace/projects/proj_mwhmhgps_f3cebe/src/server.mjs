import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, routeRequest } from './app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicHtmlPath = path.resolve(__dirname, '../public/index.html');
const store = createStore([{ id: 1, title: 'Initial verified record', category: 'system', createdAt: '2026-01-01T00:00:00.000Z' }]);

export const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  const urlPath = (req.url || '/').split('?')[0];
  if (method === 'GET' && urlPath === '/') {
    const html = fs.existsSync(publicHtmlPath) ? fs.readFileSync(publicHtmlPath, 'utf8') : '<h1>Application Ready</h1>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let parsed = {};
    if (chunks.length > 0) {
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { parsed = {}; }
    }
    const out = routeRequest(method, urlPath, parsed, store);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  server.listen(port, '0.0.0.0', () => console.log('Listening on ' + port));
}
