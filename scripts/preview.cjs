'use strict';
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const { createDemo } = require('./demo-runtime.cjs');
const demo = createDemo();
const ui = path.resolve(__dirname, '../ui');
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/demo/request' && req.method === 'POST') {
    let body = ''; let overflow = false;
    for await (const chunk of req) { body += chunk; if (body.length > 8192) { overflow = true; break; } }
    if (overflow) { res.writeHead(413); return res.end(); }
    try { const response = await demo.service.handle(demo.operatorId, JSON.parse(body)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(response)); }
    catch { res.writeHead(400); res.end(); } return;
  }
  const paths = { '/': 'demo.html', '/demo.html': 'demo.html', '/index.html': 'index.html', '/app.js': 'app.js', '/demo.js': 'demo.js', '/admin.css': 'admin.css' };
  const file = paths[(req.url || '').split('?')[0]];
  if (!file || req.method !== 'GET') { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[path.extname(file)]);
  fs.createReadStream(path.join(ui, file)).pipe(res);
});
const port = Number(process.env.ADMIN_PREVIEW_PORT || 4177);
server.listen(port, '127.0.0.1', () => console.log(`Demonstração: http://127.0.0.1:${port}/demo.html — dados fictícios, sem conexão ao jogo.`));
