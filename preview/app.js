// 只供本地交互预览；线上用户脚本不依赖此文件，也不会请求这些示例数据。
const catalog = await fetch('/preview/catalog.json').then((response) => {
  if (!response.ok) throw new Error('无法加载版面目录');
  return response.json();
});
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sections = new Map(catalog.map((section) => [section.id, section]));
const boards = new Map();
catalog.forEach((section) => section.boards.forEach((entry) => {
  if (entry.path.startsWith('/board/')) boards.set(entry.path.split('/')[2], { ...entry, section, index: boards.size + 1 });
}));
const titles = ['版面交流与使用指南', '新朋友来报到，一起聊聊最近的生活', '分享一个最近发现的实用小工具', '周末有什么值得推荐的活动？', '整理了一些资料，希望对大家有帮助', '关于这个问题，想听听大家的经验', '记录今天遇到的一件小事', '一起分享最近读过的一本好书', '想找一起学习和交流的伙伴', '欢迎分享你的建议和想法'];
const main = document.querySelector('#body');
const notice = document.querySelector('#notice');
let renderTimer;
let noticeTimer;

document.querySelector('#sections').innerHTML = catalog.map((section) => `<li class="folder-close"><span class="x-folder"><span class="toggler" data-preview-folder role="button" aria-label="展开或收起${escape(section.name)}" aria-expanded="false"></span><a href="/section/${escape(section.id)}">${escape(section.name)}</a></span><ul class="x-child">${section.boards.map((entry) => `<li class="leaf"><span class="text"><span class="toggler"></span><a href="${escape(entry.path)}">${escape(entry.name)}</a></span></li>`).join('')}</ul></li>`).join('');

const listStyle = `<style>
.bmode{float:right}.bmode a{display:inline-block;margin-left:2px;padding:2px 5px}.bmode span{display:inline-block;margin-right:2px}.t-pre,.t-pre-bottom{margin-top:3px;width:100%}.t-btn a{display:inline-block;font-size:14px;margin-right:4px;padding:2px 6px}.t-btn .rss samp{width:27px;height:15px}.page{float:right;padding-top:2px}.title_1{width:140px;padding-left:10px}.title_2{width:100px}.title_3{width:auto}.title_4,.title_5,.title_6,.title_7{width:45px}.title_8{width:37px;padding-left:10px}.title_9{width:auto}.title_10{width:64px}.title_11{width:35px}.title_12{width:97px}.board-list .top .title_9 a{color:red}.board-list .tag{width:16px;height:17px}.middle{text-align:center}
</style>`;
const homeStyle = `<style>
.wrapper *{margin:1px;padding:2px}.wrapper{max-height:250px;overflow:auto;border:1px solid #DCE9F9;padding:1px}.item{margin-left:6px;border-bottom:1px solid #DCE9F9;width:95%}.left{width:45px}.left img{max-width:42px}.content{border-top:1px dashed #DCE9F9;padding:5px 0;line-height:1.4}.info{color:#999}.picshow.container *{margin:0;padding:0}.picshow.container{padding-bottom:56.25%;width:100%;height:0;overflow:hidden;position:relative}.picshow .slider{width:100%;height:100%;position:absolute}.picshow .slider li{list-style:none;display:inline}.picshow .slider img{width:100%;height:100%;display:block}.picshow .bottom{position:absolute;width:100%;height:35px;bottom:0;background:#666;opacity:.8}.picshow .title{position:absolute;width:90%;left:7px;bottom:7px;font-size:18px;color:white}
</style>`;

function boardInfo(id) {
  return boards.get(id) || { path: '/board/' + id, name: id, section: sections.get('1'), index: 999 };
}
function topic(board, index) {
  return { id: board.index * 1000 + index + 1, title: index === 0 ? board.name + ' · 版面交流与使用指南' : titles[index % titles.length], author: 'demo' + (index % 5 + 1), replies: index * 3, index };
}
function articlePath(board, entry) { return '/article/' + board.path.split('/')[2] + '/' + entry.id; }
function breadcrumbs(items) {
  notice.innerHTML = '<div id="notice_nav">' + [{ name: '北邮人论坛', path: '/default' }, ...items].map((item) => `<a href="${escape(item.path || 'javascript:void(0)')}">${escape(item.name)}</a>`).join(' &gt;&gt; ') + '</div>';
}
function toast(text) {
  clearTimeout(noticeTimer);
  document.querySelector('#preview-notice').textContent = text;
  noticeTimer = setTimeout(() => { document.querySelector('#preview-notice').textContent = ''; }, 3500);
}
function widget(id, name, path, content, tabs = null) {
  const inner = tabs ? `<div class="w-tab"><div class="w-tab-title"><ul><li class="tab-normal tab-down" data-tab="0">热门话题</li><li class="tab-normal" data-tab="1">版面列表</li></ul></div><div class="w-tab-content" style="display:block">${content}</div><div class="w-tab-content">${tabs}</div></div>` : content;
  return `<li class="widget color-default" id="${id}"><div class="widget-head" style="cursor:move"><span class="widget-title"><a href="#" class="collapse" aria-label="折叠${escape(name)}"><samp class="ico-pos-w-collapse-on"></samp></a><a href="${escape(path)}">${escape(name)}</a></span></div><div class="widget-content">${inner}</div></li>`;
}
function topicList(board, count = 6, offset = 0) {
  return '<ul class="w-list-line">' + Array.from({ length: count }, (_, i) => {
    const entry = topic(board, offset + i);
    return `<li><a href="${articlePath(board, entry)}">${escape(entry.title)} (${entry.replies})</a></li>`;
  }).join('') + '</ul>';
}
function sectionWidget(section) {
  const board = boardInfo(section.boards.find((entry) => entry.path.startsWith('/board/')).path.split('/')[2]);
  const links = '<ul class="w-list-float">' + section.boards.map((entry) => `<li><a href="${escape(entry.path)}">${escape(entry.name)}</a></li>`).join('') + '</ul>';
  return widget('section-' + section.id, section.name, '/section/' + section.id, topicList(board, 2), links);
}
function renderHome() {
  const campus = boardInfo('BUPT');
  const jobs = boardInfo('Job');
  const picture = boards.has('Picture') ? boardInfo('Picture') : campus;
  notice.innerHTML = `<a href="${articlePath(campus, topic(campus, 0))}">【预览说明】分区和版面名称取自论坛，帖子内容为示例数据</a>`;
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#dbe8ed"/><path d="M0 270L220 80L420 270L560 150L640 230V360H0Z" fill="#a7bfc9"/></svg>');
  const gallery = `<div class="picshow container"><ul class="slider"><li><a href="${articlePath(picture, topic(picture, 2))}"><img src="${image}" alt="校园生活示例"></a></li></ul><div class="bottom"><div class="title">校园生活 · 进入帖子看看</div></div></div>`;
  main.innerHTML = homeStyle + `<div id="columns"><ul id="column1" class="column">${sectionWidget(sections.get('0'))}${widget('recommend', '近期热点活动', campus.path, topicList(campus))}${sectionWidget(sections.get('1'))}${sectionWidget(sections.get('3'))}${sectionWidget(sections.get('5'))}${sectionWidget(sections.get('7'))}</ul><ul id="column2" class="column">${widget('topten', '近期热门话题', jobs.path, topicList(jobs, 10))}${sectionWidget(sections.get('2'))}${sectionWidget(sections.get('4'))}${sectionWidget(sections.get('6'))}${sectionWidget(sections.get('8'))}${sectionWidget(sections.get('9'))}</ul><ul id="column3" class="column">${widget('picshow', '贴图秀', picture.path, gallery)}${widget('focus', '近期推荐文章', campus.path, topicList(campus, 7, 3))}${widget('bulletin', '北邮人公告栏', boardInfo('Announce').path, topicList(boardInfo('Announce'), 5))}</ul></div>`;
}
function renderSection(id) {
  let section = sections.get(id);
  const parent = catalog.find((item) => item.boards.some((entry) => entry.path === '/section/' + id));
  if (!section && parent) {
    const entry = parent.boards.find((item) => item.path === '/section/' + id);
    section = { id, name: entry.name, boards: parent.boards.filter((item) => item.path.startsWith('/board/')).slice(0, 8) };
  }
  if (!section) { toast('这个分区没有预览数据'); section = sections.get('1'); }
  const trail = parent ? [{ name: parent.name, path: '/section/' + parent.id }] : [];
  breadcrumbs([...trail, { name: section.name, path: '/section/' + id }, { name: '分区列表' }]);
  const rows = section.boards.map((entry, i) => {
    const directory = entry.path.startsWith('/section/');
    const board = boardInfo(entry.path.split('/')[2]);
    const latest = topic(board, 3);
    return `<tr><td class="title_1"><a href="${escape(entry.path)}">${escape(entry.name)}</a><br>${escape(entry.path.split('/')[2])}</td><td class="title_2">${directory ? '[二级目录]' : '<a href="/user/query/demo">示例版主</a><br>'}</td><td class="title_3">${directory ? '&nbsp;' : `<a href="${articlePath(board, latest)}">${escape(latest.title)}</a><br>发贴人: demo1 日期: 2026-10-29 10:00:00`}</td>${[i + 3, i % 7, 120 + i * 5, 600 + i * 13].map((number, j) => `<td class="title_${j + 4} middle">${directory ? '&nbsp;' : number}</td>`).join('')}</tr>`;
  }).join('');
  main.innerHTML = listStyle + `<div class="b-head corner"><span class="n-left">版面列表</span></div><div class="b-content corner"><table class="board-list corner"><thead><tr>${['版面名称', '版主', '最新主题', '在线', '今日', '主题', '文章'].map((text, i) => `<th class="title_${i + 1}">${text}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function pagination(path, page, count = 5) {
  return `<div class="page"><ul class="pagination"><li class="page-pre">分页:</li><li><ol class="page-main">${Array.from({ length: count }, (_, i) => `<li class="${page === i + 1 ? 'page-select' : 'page-normal'}"><a href="${escape(path)}${path.includes('?') ? '&' : '?'}p=${i + 1}">${i + 1}</a></li>`).join('')}</ol></li></ul></div>`;
}
function renderBoard(id, mode, params) {
  const board = boardInfo(id);
  const page = Math.max(1, Math.min(5, Number(params.get('p')) || 1));
  const base = board.path + (mode ? '/mode/' + mode : '');
  const keywords = params.get('t1') || '';
  const author = params.get('au') || '';
  const query = new URLSearchParams();
  if (keywords) query.set('t1', keywords);
  if (author) query.set('au', author);
  const pagePath = base + (query.size ? '?' + query : '');
  breadcrumbs([{ name: board.section.name, path: '/section/' + board.section.id }, { name: board.name, path: base }, { name: mode ? '经典模式' : '文章列表' }]);
  const entries = Array.from({ length: 10 }, (_, i) => topic(board, (page - 1) * 10 + i)).filter((entry) => entry.title.includes(keywords) && entry.author.includes(author));
  const rows = entries.map((entry) => `<tr${entry.index < 2 ? ' class="top"' : ''}><td class="title_8"><a href="${articlePath(board, entry)}"><samp class="tag ico-pos-article-${entry.index < 2 ? 'top' : 'normal'}"></samp></a></td><td class="title_9"><a href="${articlePath(board, entry)}">${escape(entry.title)}</a></td><td class="title_10">2026-10-28</td><td class="title_12">| <a href="/user/query/${entry.author}">${entry.author}</a></td>${mode ? '' : `<td class="title_11 middle">${entry.replies}</td><td class="title_10"><a href="${articlePath(board, entry)}?p=2">2026-10-29</a></td><td class="title_12">| <a href="/user/query/demo2">demo2</a></td>`}</tr>`).join('');
  main.innerHTML = listStyle + `<div class="t-pre"><div class="bmode"><span>版面模式:</span>${[['主题', ''], ['原作', '6'], ['经典', '0'], ['保留', '3'], ['文摘', '1']].map(([name, value]) => `<a class="tab-normal ${mode === value ? 'tab-down' : ''}" href="${board.path}${value ? '/mode/' + value : ''}">${name}</a>`).join('')}</div><div class="t-btn"><a class="b-post button" href="#" data-preview-action="new">新话题</a><a class="button" href="#" data-preview-action="favorite">收藏</a><a class="button" href="/section/${board.section.id}">返回分区</a></div></div><div class="b-head corner"><span class="n-right">版主: <a href="/user/query/demo">示例版主</a></span><span class="n-left">本版当前共有18人在线 今日帖数6</span></div><div class="b-content"><table class="board-list tiz"><thead><tr><th class="title_8">状态</th><th class="title_9 middle">主题</th><th class="title_10">发帖时间</th><th class="title_12">| 作者</th>${mode ? '' : '<th class="title_11 middle">回复</th><th class="title_10">最新回复</th><th class="title_12">| 作者</th>'}</tr></thead><tbody>${rows}</tbody></table></div><div class="t-pre-bottom">${pagination(pagePath, page)}<div class="t-btn"><form id="board_search" action="/s/article"><input name="t1" class="input-text input" placeholder="输入关键字" value="${escape(keywords)}"><input name="au" class="input-text input" placeholder="输入作者ID" value="${escape(author)}"><input type="submit" class="button" value="搜索"></form></div></div>`;
}
function renderArticle(id, articleId, params) {
  const board = boardInfo(id);
  const entry = topic(board, Math.max(0, Number(articleId) % 1000 - 1));
  const path = '/article/' + id + '/' + articleId;
  const page = params.get('p') === '2' ? 2 : 1;
  breadcrumbs([{ name: board.section.name, path: '/section/' + board.section.id }, { name: board.name, path: board.path }, { name: '帖子详情' }]);
  const floors = Array.from({ length: 4 }, (_, i) => {
    const author = i === 0 ? entry.author : 'demo' + (i + 1);
    const face = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><rect width="84" height="84" rx="16" fill="#dbe7fb"/><text x="42" y="55" text-anchor="middle" fill="#416ba9" font-family="sans-serif" font-size="36">${i + 1}</text></svg>`);
    return `<div class="a-wrap"><table class="article"><tbody><tr class="a-head"><td class="a-left"><span class="a-u-name"><a href="/user/query/${author}">${author}</a></span></td><td><span class="a-pos">${i === 0 && page === 1 ? '楼主' : '第 ' + ((page - 1) * 4 + i) + ' 楼'}</span></td></tr><tr class="a-body"><td class="a-left"><div class="a-u-img"><img src="${face}" alt="示例头像"></div><div class="a-u-uid">${author}</div><dl class="a-u-info"><dt>等级</dt><dd>用户</dd></dl></td><td class="a-content"><div class="a-content-wrap">发信人: ${author}<br>标 题: ${escape(entry.title)}<br>发信站: 北邮人论坛<br><br>${i === 0 ? `欢迎来到「${escape(board.name)}」版。这是一篇用于预览完整浏览流程的示例帖子。<br><br>你可以从首页进入分区，再打开任意版面和帖子；也可以通过上方路径返回列表，或使用浏览器前进、后退。` : '感谢分享，欢迎继续交流你的想法。这里展示回复楼层的排版效果。'}<br><br><font>※ 来源: 北邮人论坛 · 本地示例数据</font></div></td></tr><tr class="a-bottom"><td class="a-left"><ul class="a-func-info"><li><a href="/user/query/${author}">查看</a></li><li><a href="#" data-preview-action="message">发信</a></li><li><a href="#" data-preview-action="friend">加好友</a></li></ul></td><td><a href="#" class="a-back" data-preview-action="top">返回顶部</a></td></tr></tbody></table></div>`;
  }).join('');
  main.innerHTML = `<div class="t-pre">${pagination(path, page, 2)}<div class="t-btn"><a href="${board.path}" class="button">返回版面</a><a href="#" class="button" data-preview-action="reply">回复</a></div></div><div class="b-head"><span class="n-left">文章主题：${escape(entry.title)}</span><span class="n-right"><a id="a_share" _u="${path}" href="#" data-preview-action="share">分享</a></span></div><div class="b-content">${floors}</div><div class="t-pre-bottom">${pagination(path, page, 2)}</div><div class="a-comment"><form id="quick_post"><div class="a-comment-txt"><textarea rows="5" placeholder="输入示例回复（不会发送到论坛）"></textarea></div><div class="a-comment-btn"><input class="button" type="submit" value="快捷回复"></div><div id="em_img"><div class="ubb-img-tab">经典表情</div><div class="ubb-img" style="display:block"><button type="button" data-preview-emoji="☺">☺</button><button type="button" data-preview-emoji="♥">♥</button></div></div></form></div>`;
}
function currentRoute() {
  return location.hash.startsWith('#!') ? '/' + location.hash.slice(2) : location.pathname === '/' ? '/default' : location.pathname + location.search;
}
function render() {
  const route = currentRoute();
  const [pathname, query = ''] = route.split('?');
  const parts = pathname.split('/');
  const params = new URLSearchParams(query);
  if (parts[1] === 'section') renderSection(parts[2]);
  else if (parts[1] === 'board') renderBoard(parts[2], parts[3] === 'mode' ? parts[4] : '', params);
  else if (parts[1] === 'article') renderArticle(parts[2], parts[3], params);
  else renderHome();
  main.dataset.previewRoute = route;
  const board = parts[1] === 'board' || parts[1] === 'article' ? boardInfo(parts[2]) : null;
  document.title = (board ? board.name : parts[1] === 'section' ? sections.get(parts[2])?.name || '分区目录' : '北邮人论坛') + ' · 交互预览';
  window.scrollTo(0, 0);
}
function navigate(route) {
  const hash = '#!' + route.slice(1);
  if (location.hash === hash) render();
  else location.hash = hash;
}
window.addEventListener('hashchange', () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 120);
});
document.addEventListener('click', (event) => {
  const folder = event.target.closest('[data-preview-folder]');
  if (folder) {
    const item = folder.closest('li');
    const open = item.classList.toggle('folder-open');
    item.classList.toggle('folder-close', !open);
    item.querySelector(':scope > .x-child').style.display = open ? 'block' : 'none';
    folder.setAttribute('aria-expanded', String(open));
    return;
  }
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    const wrapper = tab.closest('.w-tab');
    wrapper.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('tab-down', item === tab));
    wrapper.querySelectorAll('.w-tab-content').forEach((item, i) => { item.style.display = i === Number(tab.dataset.tab) ? 'block' : 'none'; });
    return;
  }
  const collapse = event.target.closest('.collapse');
  if (collapse) {
    event.preventDefault();
    const content = collapse.closest('.widget').querySelector('.widget-content');
    content.style.display = content.style.display === 'none' ? '' : 'none';
    return;
  }
  const action = event.target.closest('[data-preview-action]');
  if (action) {
    event.preventDefault();
    if (action.dataset.previewAction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (action.dataset.previewAction === 'reply') document.querySelector('#quick_post textarea')?.focus();
    else toast('这是交互预览；发文、收藏、分享和用户操作需在真实论坛中使用。');
    return;
  }
  const emoji = event.target.closest('[data-preview-emoji]');
  if (emoji) {
    const textarea = document.querySelector('#quick_post textarea');
    textarea.value += emoji.dataset.previewEmoji;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const anchor = event.target.closest('a');
  if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return;
  if (/^\/(default|section|board|article)(?:\/|$)/.test(url.pathname) && !url.pathname.endsWith('.user.js')) {
    event.preventDefault();
    navigate(url.pathname + url.search);
  } else if (url.pathname.startsWith('/user/') || url.pathname === '/fav') {
    event.preventDefault();
    toast('当前为示例用户，个人资料和收藏请在真实论坛中查看。');
  }
});
document.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'board_search') {
    const data = new FormData(event.target);
    const base = currentRoute().split('?')[0];
    const params = new URLSearchParams({ t1: data.get('t1') || '', au: data.get('au') || '' });
    navigate(base + '?' + params);
  } else if (event.target.id === 'quick_post') toast('示例回复已预览，不会发送到真实论坛。');
});

render();
const userscript = document.createElement('script');
userscript.src = '/byrbbs-minimalist-frontend.user.js';
document.body.appendChild(userscript);
