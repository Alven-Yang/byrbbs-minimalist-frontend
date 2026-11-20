import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const previewRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(previewRoot);
const scriptFile = path.join(repoRoot, 'byrbbs-minimalist-frontend.user.js');
const assets = {
  '/original.css': ['/tmp/byr-original.css', 'https://bbs.byr.cn/css/pack_beb65b693f.css', 'text/css'],
  '/widget.css': ['/tmp/byr-widget.css', 'https://bbs.byr.cn/ccss/xwidget.css', 'text/css'],
  '/img/logo.gif': ['/tmp/byr-logo.gif', 'https://bbs.byr.cn/img/logo.gif', 'image/gif'],
  '/img/ico.gif': ['/tmp/byr-ico.gif', 'https://bbs.byr.cn/img/ico.gif', 'image/gif'],
};

function send(res, file, type, attachment = false) {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (attachment) headers['Content-Disposition'] = 'attachment; filename="byrbbs-minimalist-frontend.user.js"';
  res.writeHead(200, headers);
  res.end(fs.readFileSync(file));
}

http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/byrbbs-minimalist-frontend.user.js' || pathname === '/script.js') {
    send(res, scriptFile, 'text/javascript; charset=utf-8');
  } else if (pathname === '/download/byrbbs-minimalist-frontend.user.js') {
    send(res, scriptFile, 'text/javascript; charset=utf-8', true);
  } else if (pathname === '/preview/app.js') {
    send(res, path.join(previewRoot, 'app.js'), 'text/javascript; charset=utf-8');
  } else if (pathname === '/preview/catalog.json') {
    send(res, path.join(previewRoot, 'catalog.json'), 'application/json; charset=utf-8');
  } else if (assets[pathname]) {
    const [cached, remote, type] = assets[pathname];
    if (fs.existsSync(cached)) send(res, cached, type);
    else { res.writeHead(302, { Location: remote }); res.end(); }
  } else if (/^\/(?:default|section\/[^/]+|board\/[^/]+(?:\/mode\/\d+)?|article\/[^/]+\/\d+)?\/?$/.test(pathname)) {
    send(res, path.join(previewRoot, 'index.html'), 'text/html; charset=utf-8');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(4318, '127.0.0.1', () => console.log('BYR preview: http://127.0.0.1:4318/'));
