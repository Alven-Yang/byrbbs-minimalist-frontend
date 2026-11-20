const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nativeFetch = window.fetch;
const reloadCaseKey = 'bym-test-reload-case';
const reloadCase = JSON.parse(sessionStorage.getItem(reloadCaseKey) || 'null');
if (!reloadCase && location.hash !== '#!board/A') location.hash = '#!board/A';
const requests = [];
window.fetch = (...args) => { requests.push(args[0]); return nativeFetch(...args); };
const output = document.querySelector('#test-results');
const checks = [];
function check(name, passed, extra = '') {
  checks.push({ name, passed: !!passed, extra });
  output.textContent = JSON.stringify({ passed: checks.every((v) => v.passed), checks }, null, 2);
  if (!passed) throw new Error(name + ': ' + extra);
}
async function until(condition) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await sleep(40); }
  throw new Error('Condition timed out: ' + condition.toString());
}
let rendered = '';
let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const route = location.hash.startsWith('#!') ? '/' + location.hash.slice(2) : '/board/A';
  const url = new URL(route, location.origin);
  const response = await nativeFetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  const html = new TextDecoder(response.headers.get('content-type').includes('GBK') ? 'gbk' : 'utf-8').decode(await response.arrayBuffer());
  if (token !== renderToken) return;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script').forEach((el) => el.remove());
  window.scrollTo(0, 0); // 模拟原站 AJAX 更新时的强制回顶。
  document.querySelector('#body').replaceChildren(...parsed.body.childNodes);
  const boardPath = url.pathname.startsWith('/board/') ? url.pathname : '/board/A';
  document.querySelector('#notice_nav').innerHTML = `<a href="/default">Forum</a><a href="/section/1">Section</a><a href="${boardPath}">Board</a>`;
  rendered = location.hash;
}
window.addEventListener('hashchange', render);
let delegatedReplies = 0;
document.querySelector('#body').addEventListener('click', (event) => {
  if (event.target.closest('.a-post')) { event.preventDefault(); delegatedReplies++; }
});
document.addEventListener('click', (event) => {
  const anchor = event.target.closest('a[href]');
  if (!anchor || event.defaultPrevented) return;
  const url = new URL(anchor.href);
  if (url.origin !== location.origin || !/^\/(board|article)\//.test(url.pathname)) return;
  event.preventDefault(); location.hash = '#!' + url.pathname.slice(1) + url.search;
});
const rows = () => document.querySelectorAll('#body .board-list tbody tr:not(.bym-page-divider)').length;
const floors = () => document.querySelectorAll('#body .a-wrap').length;
const nearBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
async function navigate(route) {
  rendered = '';
  location.hash = '#!' + route.replace(/^\//, '');
  await until(() => rendered === location.hash && document.body.classList.contains('bym-ready'));
  await sleep(100);
}
async function paused(paused) {
  const button = document.querySelector('#bym-pager');
  if ((button.getAttribute('aria-pressed') === 'false') !== paused) button.click();
  await sleep(50);
}

async function checkImageGallery() {
  await navigate('/article/A/101?case=gallery');
  const gallery = document.querySelector('#body .bym-gallery');
  const counter = gallery.querySelector('.bym-gallery-count');
  const image = gallery.querySelector('.bym-gallery-open img');
  const thumbnails = gallery.querySelectorAll('.bym-gallery-thumb');
  const floor = gallery.closest('.a-wrap');
  const originals = [...floor.querySelectorAll('[data-gallery-photo]')];
  check('多图楼层只显示一张大图，单图楼层不创建画廊', thumbnails.length === 3 &&
    counter.textContent === '1 / 3' && originals.every((photo) => photo.getClientRects().length === 0) &&
    !floor.nextElementSibling.querySelector('.bym-gallery') &&
    floor.nextElementSibling.querySelector('[data-gallery-photo]').getClientRects().length > 0);
  check('大图加载原始附件并保留原帖图注和表情', image.src.endsWith('/att/fixture/1/1') &&
    thumbnails[0].querySelector('img').src.endsWith('?thumb') &&
    floor.querySelector('figcaption').getClientRects().length > 0 &&
    floor.querySelector('img.bym-emoji-img').getClientRects().length > 0);

  const originalY = scrollY;
  const stage = gallery.querySelector('.bym-gallery-stage');
  const height = stage.offsetHeight;
  gallery.querySelector('.bym-gallery-next').click();
  check('左右切图只切换大图和进度，不改变页面位置', counter.textContent === '2 / 3' &&
    image.src.endsWith('/att/fixture/1/2') && stage.offsetHeight === height && scrollY === originalY);
  thumbnails[2].click();
  check('缩略图可直接切换并标记当前位置', counter.textContent === '3 / 3' &&
    thumbnails[2].getAttribute('aria-current') === 'true');
  thumbnails[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  check('方向键可以循环切换', counter.textContent === '1 / 3' &&
    thumbnails[0].getAttribute('aria-current') === 'true');

  thumbnails[1].click();
  await until(() => image.complete && image.naturalWidth > 0);
  const zoom = gallery.querySelector('.bym-gallery-open');
  zoom.click();
  check('点大图原地放大并留在当前画廊', zoom.getAttribute('aria-pressed') === 'true' &&
    image.style.transform.includes('scale(2.2)') && counter.textContent === '2 / 3' &&
    !document.querySelector('#bym-lightbox.bym-lightbox-open'));
  zoom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape 还原画廊里的大图', zoom.getAttribute('aria-pressed') === 'false' && !image.style.transform);

  const reply = document.querySelector('#bym-reply');
  const composer = document.querySelector('.a-comment');
  const draft = composer.querySelector('textarea');
  const toolbar = document.querySelector('.t-pre-bottom');
  check('默认收起回复并让分页工具栏回到帖尾', !reply.hidden && reply.getAttribute('aria-expanded') === 'false' &&
    getComputedStyle(composer).display === 'none' && getComputedStyle(toolbar).position === 'static');
  reply.click();
  check('展开快捷回复时给底栏留出空间', reply.getAttribute('aria-expanded') === 'true' &&
    document.activeElement === draft && stage.offsetHeight < height);
  draft.value = '尚未发送的内容';
  reply.click();
  document.querySelector('#a_reply').click();
  check('站点快捷回复入口保留刚才的输入', document.activeElement === draft && draft.value === '尚未发送的内容');
  reply.click();

  const toggle = document.querySelector('#bym-toggle');
  toggle.click();
  check('切回经典版时恢复原有图片、附件链接和换行', !document.querySelector('.bym-gallery') &&
    !document.querySelector('.bym-gallery-source') && originals.every((photo) => photo.getClientRects().length > 0) &&
    originals[0].parentElement.getAttribute('href') === '/att/fixture/1/1');
  toggle.click();
  await paused(false);
  nearBottom();
  await until(() => floors() === 20 && document.querySelectorAll('.bym-gallery').length === 2);
  check('自动翻页追加的楼层也创建独立画廊',
    document.querySelector('[data-bym-page="2"]').nextElementSibling.querySelector('.bym-gallery-count').textContent === '1 / 3');
  await paused(true);
}

async function run() {
  await render(); await until(() => !!document.querySelector('#bym-pager') && rows() === 31);
  if (reloadCase) {
    sessionStorage.removeItem(reloadCaseKey);
    checks.push(...reloadCase.checks);
    // 等待初始恢复保护结束，确认不会稍后又被旧缓存拉回原位置。
    await sleep(3300);
    check('真实刷新列表页回到顶部', performance.getEntriesByType('navigation')[0].type === 'reload' &&
      reloadCase.y > 500 && scrollY === 0, `${reloadCase.y} -> ${scrollY}`);
    await paused(true);
    window.scrollTo(0, 800); await sleep(650);
    const afterReloadY = scrollY;
    document.querySelector('.title_9 a[href]').click();
    await until(() => rendered === location.hash && location.hash.startsWith('#!article/') && floors() === 10);
    history.back(); await sleep(10);
    window.dispatchEvent(new WheelEvent('wheel', { deltaX: -160, deltaY: 2 }));
    await until(() => rendered === location.hash && location.hash === '#!board/A?case=reload' && rows() === 31);
    await until(() => Math.abs(scrollY - afterReloadY) < 3);
    check('刷新后再次两指返回仍恢复位置', afterReloadY > 500 && Math.abs(scrollY - afterReloadY) < 3,
      `${afterReloadY} -> ${scrollY}`);
    output.dataset.complete = 'true';
    return;
  }
  await sleep(150);
  check('未接近底部时不发出请求', requests.length === 0, String(requests.length));
  nearBottom(); await until(() => rows() === 61);
  check('列表追加下一页并去重置顶帖', document.querySelectorAll('.board-list tr.top').length === 1);
  check('从 AJAX 内容片段读取下一页', requests[0] === '/board/A?p=2');
  check('分页分界标记存在', !!document.querySelector('[data-bym-page="2"]'));
  check('未执行下一页脚本', !window.pagerInjected);
  await paused(true);
  nearBottom(); await sleep(250);
  check('暂停后不继续加载', requests.length === 1);
  await paused(false); await until(() => rows() === 91);
  nearBottom(); await sleep(250);
  check('末页停止请求', requests.length === 2 && document.querySelector('#bym-pager').textContent.includes('已到底'));
  window.scrollTo(0, 4500); await sleep(650);
  const y = scrollY;
  document.querySelector('[data-bym-page="2"]').nextElementSibling.querySelector('.title_9 a').click();
  await until(() => rendered === location.hash && location.hash.startsWith('#!article/') && floors() === 10);
  history.back();
  // 浏览器返回手势的横向 wheel 会在 popstate 之后继续到达页面。
  // 此时 AJAX 尚未完成，不能把它当成主动改变纵向阅读位置。
  await sleep(10);
  window.dispatchEvent(new WheelEvent('wheel', { deltaX: -160, deltaY: 0 }));
  await until(() => rendered === location.hash && location.hash === '#!board/A' && rows() === 91);
  await until(() => Math.abs(scrollY - y) < 3);
  window.dispatchEvent(new WheelEvent('wheel', { deltaX: -100, deltaY: 3 }));
  window.scrollTo(0, 0); // 原站在手势惯性期间再次回顶。
  await until(() => Math.abs(scrollY - y) < 3);
  check('横向返回手势及轻微纵向漂移不取消恢复', Math.abs(scrollY - y) < 3);
  check('返回还原已追加的页及滚动位置', rows() === 91 && Math.abs(scrollY - y) < 3, `${y} -> ${scrollY}`);
  window.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: -120 }));
  window.scrollTo(0, y - 300); await sleep(120);
  check('主动上下滚动仍能立即接管位置', Math.abs(scrollY - (y - 300)) < 3);
  await navigate('/board/A?case=fallback');
  await paused(true);
  window.scrollTo(0, 800); await sleep(650);
  const fallbackY = scrollY;
  // 模拟论坛自己的历史状态覆盖：路由位置缓存仍应能恢复。
  history.replaceState(null, '');
  location.hash = '#!article/A/101?case=fallback';
  await until(() => rendered === location.hash && location.hash.startsWith('#!article/') && floors() === 10);
  history.back();
  await until(() => rendered === location.hash && location.hash === '#!board/A?case=fallback' && rows() === 31);
  await until(() => Math.abs(scrollY - fallbackY) < 3);
  check('历史状态丢失时按路由恢复位置', Math.abs(scrollY - fallbackY) < 3, `${fallbackY} -> ${scrollY}`);
  await paused(false);
  await navigate('/board/B?case=other');
  await navigate('/board/A');
  check('同地址的新历史条目独立加载', rows() === 31);
  await navigate('/board/A/mode/0?au=demo&case=filter');
  nearBottom(); await until(() => rows() === 61);
  check('保留版面模式和查询筛选', requests.at(-1) === '/board/A/mode/0?au=demo&case=filter&p=2');
  await navigate('/board/A?case=retry');
  const beforeRetry = requests.length;
  nearBottom(); await until(() => document.querySelector('#bym-pager').textContent.includes('加载失败'));
  nearBottom(); await sleep(350);
  check('失败后停止自动重试', requests.length === beforeRetry + 1 && rows() === 31);
  document.querySelector('#bym-pager').click(); await until(() => rows() === 61);
  check('点击可重试', requests.length === beforeRetry + 2);
  await navigate('/board/A?case=invalid');
  nearBottom(); await until(() => document.querySelector('#bym-pager').textContent.includes('加载失败'));
  check('错误页码响应不追加', rows() === 31);
  await navigate('/board/A?case=gbk');
  nearBottom(); await until(() => rows() === 61);
  check('GBK 中文正确解码', document.querySelector('[data-bym-page="2"]').nextElementSibling.textContent.includes('测试中文 31'));
  await navigate('/board/A?case=race');
  nearBottom(); await until(() => document.querySelector('#bym-pager').textContent.includes('加载中'));
  await navigate('/board/B?case=away'); await sleep(700);
  check('离开页面后取消旧请求', rows() === 31 && !document.querySelector('[data-bym-page="2"]'));
  await navigate('/article/A/101');
  nearBottom(); await until(() => floors() === 20);
  check('帖子楼层追加并统一修饰', !!document.querySelector('[data-bym-page="2"]').nextElementSibling.querySelector('.a-head .a-left .a-pos'));
  document.querySelector('[data-bym-page="2"]').nextElementSibling.querySelector('.a-post').click();
  check('追加楼层保留事件代理', delegatedReplies === 1);
  nearBottom(); await until(() => floors() === 30);
  check('帖子连续追加至末页', document.querySelector('#bym-pager').textContent.includes('已到底'));
  await paused(true);
  document.querySelector('#bym-toggle').click(); await sleep(80);
  check('经典模式隐藏翻页控件', document.querySelector('#bym-pager').hidden);
  document.querySelector('#bym-toggle').click();
  await checkImageGallery();
  await navigate('/board/A?case=reload');
  window.scrollTo(0, 800); await sleep(650);
  check('刷新前列表已滚动', scrollY > 500);
  sessionStorage.setItem(reloadCaseKey, JSON.stringify({ checks, y: scrollY }));
  location.reload();
}
run().catch((error) => { output.textContent = JSON.stringify({ passed: false, checks, error: error.stack, requests, hash: location.hash }, null, 2); output.dataset.complete = 'true'; });
