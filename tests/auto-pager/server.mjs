// node tests/auto-pager/server.mjs，然后在浏览器打开输出地址。
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../../byrbbs-minimalist-frontend.user.js', import.meta.url));
const attempts = new Map();
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function galleryContent(floor) {
  const single = '<img data-gallery-photo src="/att/fixture/1/3" alt="单图">';
  if (floor % 10 === 1) return single;
  if (floor % 10 !== 0) return '';
  return '<br><a href="/att/fixture/1/1"><img data-gallery-photo src="/att/fixture/1/1?thumb" alt="第一张"></a><br><br>' +
    '<a href="/att/fixture/1/2"><img data-gallery-photo src="/att/fixture/1/2" alt="第二张"></a><br>' +
    '<figure><img data-gallery-photo src="/att/fixture/1/3" alt="第三张"><figcaption>原帖图注</figcaption></figure>' +
    '<img src="/att/fixture/1/3" alt="ema2">';
}

function content(url) {
  const article = url.pathname.startsWith('/article/');
  const page = Number(url.searchParams.get('p')) || 1;
  const next = new URL(url); next.searchParams.set('p', String(page + 1));
  const links = page < 3 ? `<li><a href="${esc(next.pathname + next.search)}">${page + 1}</a></li>` : '';
  const pagination = `<div class="page"><ul class="pagination"><li><ol class="page-main"><li class="page-select"><a>${url.searchParams.get('case') === 'invalid' && page > 1 ? 1 : page}</a></li>${links}</ol></li></ul></div>`;
  const rows = Array.from({ length: 30 }, (_, i) => {
    const n = (page - 1) * 30 + i + 1;
    return `<tr><td class="title_9"><a href="/article/A/101">测试中文 ${n}</a></td><td class="title_10">2026-10-29</td><td class="title_12">demo</td><td class="title_11">${n}</td></tr>`
      .replace('/article/A/101', `/article/A/${100 + n}`);
  }).join('');
  const floors = Array.from({ length: 10 }, (_, i) => {
    const n = (page - 1) * 10 + i;
    const images = url.searchParams.get('case') === 'gallery' ? galleryContent(n) : '';
    return `<div class="a-wrap"><table class="article"><tbody><tr class="a-head"><td class="a-left"><span class="a-u-name">demo</span></td><td><span class="a-pos">Floor ${n}</span></td></tr><tr class="a-body"><td class="a-left"><div class="a-u-uid">demo</div></td><td class="a-content"><div class="a-content-wrap">测试中文 ${n}${images}<div style="height:220px"></div></div></td></tr><tr class="a-bottom"><td></td><td><a class="a-post" href="/article/A/post/${101 + n}">Reply</a></td></tr></tbody></table></div>`;
  }).join('');
  const pinned = '<tr class="top"><td class="title_9"><a href="/article/A/9000">Pinned</a></td><td>2026</td><td>demo</td><td>0</td></tr>';
  const body = article ? floors : `<table class="board-list"><thead><tr><th class="title_9">Topic</th><th class="title_10">Date</th><th class="title_12">Author</th><th class="title_11">Replies</th></tr></thead><tbody>${pinned}${rows}</tbody></table>`;
  const reply = article && url.searchParams.get('case') === 'gallery';
  const replyLink = reply ? '<a id="a_reply" href="#">快捷回复</a>' : '';
  const composer = reply ? '<div class="a-comment"><form id="quick_post"><div class="a-comment-txt"><textarea rows="3"></textarea></div>' +
    '<div class="a-comment-btn"><input class="button" type="submit" value="快捷回复"></div></form></div>' : '';
  return `<style>#body .board-list td{height:60px}</style><div class="t-pre">${article ? pagination : ''}${replyLink}</div><div class="b-head"><span class="n-left">${article ? 'Article' : 'Board'}</span>${article ? `<a id="a_share" _u="${url.pathname}">Share</a>` : ''}</div><div class="b-content">${body}</div><div class="t-pre-bottom">${pagination}</div>${composer}<script>window.pagerInjected = true;</script>`;
}
function gbk(html) {
  const parts = html.split('测试中文');
  return Buffer.concat(parts.flatMap((part, i) => i ? [Buffer.from([0xb2, 0xe2, 0xca, 0xd4, 0xd6, 0xd0, 0xce, 0xc4]), Buffer.from(part)] : [Buffer.from(part)]));
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (data, type = 'text/html; charset=utf-8', status = 200) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(data);
  };
  if (url.pathname === '/subject.js') return send(fs.readFileSync(script), 'text/javascript');
  if (url.pathname === '/fixture.js') return send(fs.readFileSync(new URL('./fixture.js', import.meta.url)), 'text/javascript');
  const photo = url.pathname.match(/^\/att\/fixture\/1\/([1-3])$/);
  if (photo) {
    const color = ['#336888', '#c65236', '#528656'][Number(photo[1]) - 1];
    return send(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${color}"/></svg>`, 'image/svg+xml');
  }
  if (url.pathname.startsWith('/board/') || url.pathname.startsWith('/article/')) {
    // 普通 GET 只返回外壳，与真实论坛一样，只有 AJAX 请求才能拿到内容片段。
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') return send('<html><body>Forum shell</body></html>');
    const key = url.pathname + url.search;
    const count = (attempts.get(key) || 0) + 1; attempts.set(key, count);
    const page = Number(url.searchParams.get('p')) || 1;
    const scenario = url.searchParams.get('case');
    if (scenario === 'retry' && page === 2 && count === 1) return send('Network error', 'text/html', 500);
    const html = content(url);
    const respond = () => scenario === 'gbk' ? send(gbk(html), 'text/html; charset=GBK') : send(html);
    if (scenario === 'race' && page === 2) setTimeout(respond, 600); else respond();
    return;
  }
  if (url.pathname !== '/') return send('Not found', 'text/plain', 404);
  attempts.clear();
  send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>自动翻页回归测试</title><script>localStorage.setItem('bym-enabled','1');localStorage.setItem('bym-auto-pager','1');localStorage.setItem('bym-theme','light');</script><script src="/subject.js"></script><style>#test-results{position:fixed;right:16px;top:16px;z-index:99;width:320px;max-height:80vh;overflow:auto;background:#fff;padding:16px;border:1px solid #ccc;font:12px/1.6 monospace;white-space:pre-wrap}</style></head><body><header id="top_head"><figure id="top_logo"><a href="/default">BYR</a></figure></header><aside id="menu"><div id="u_login">Test user</div></aside><section id="main"><nav id="notice"><div id="notice_nav"></div></nav><section id="body"></section></section><footer id="bot_foot"></footer><pre id="test-results">正在测试…</pre><script src="/fixture.js"></script></body></html>`);
}).listen(4321, '127.0.0.1', () => console.log('Auto pager tests: http://127.0.0.1:4321/#!board/A'));
