// ==UserScript==
// @name         北邮人论坛 · 简约版
// @namespace    https://bbs.byr.cn/
// @version      0.7.11
// @description  为北邮人论坛首页、分区目录、帖子列表与详情页提供响应式简约布局，支持固定分区侧栏、深色模式、返回位置恢复与自动无缝翻页。
// @author       Hermi2024
// @match        https://bbs.byr.cn/*
// @match        http://bbs.byr.cn/*
// @updateURL    https://raw.githubusercontent.com/Alven-Yang/byrbbs-minimalist-frontend/refs/heads/codex/forum-layout/byrbbs-minimalist-frontend.user.js
// @downloadURL  https://raw.githubusercontent.com/Alven-Yang/byrbbs-minimalist-frontend/refs/heads/codex/forum-layout/byrbbs-minimalist-frontend.user.js
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. 配置
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'bym-enabled';
  const THEME_KEY = 'bym-theme';
  const PAGER_KEY = 'bym-auto-pager';
  const TOGGLE_KEY = 'm'; // Alt+M 切换
  const LOADING_TIMEOUT = 3000;
  const PAGER_THRESHOLD = 1200;
  let pendingRoute = null;
  let pendingTimer = null;

  const state = {
    enabled: readEnabled(),
    theme: readTheme(), // 'auto' | 'light' | 'dark'
    autoPager: readAutoPager(),
  };

  function readEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch (e) {
      return true;
    }
  }

  function saveEnabled(v) {
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  function readTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function saveTheme(v) {
    try {
      localStorage.setItem(THEME_KEY, v);
    } catch (e) { /* ignore */ }
  }

  function readAutoPager() {
    try {
      return localStorage.getItem(PAGER_KEY) !== '0';
    } catch (e) {
      return true;
    }
  }

  function saveAutoPager(v) {
    try {
      localStorage.setItem(PAGER_KEY, v ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  const darkQuery = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function systemDark() {
    return !!(darkQuery && darkQuery.matches);
  }

  function effectiveDark() {
    return state.theme === 'dark' || (state.theme === 'auto' && systemDark());
  }

  /* ------------------------------------------------------------------ *
   * 1. 路由判断：分别识别首页、分区目录、帖子列表与详情页
   *    BYR 是 hash 路由：#!article/版面/文章ID
   * ------------------------------------------------------------------ */
  function isArticlePage() {
    if (location.hash.startsWith('#!')) return /^#!article(?:\/|$)/.test(location.hash);
    return (
      /^#!article\//.test(location.hash) ||
      /^#!article$/.test(location.hash) ||
      /^\/article\//.test(location.pathname)
    );
  }

  function getBrowseRoute() {
    // 有 hash 时以 hash 为准，不能把未知路由误判成 pathname 为 / 的首页。
    const path = location.hash
      ? location.hash.replace(/^#!/, '/')
      : location.pathname;
    if (/^\/(?:default)?\/?(?:\?.*)?$/.test(path)) return { kind: 'home', path: '/default' };
    const match = path.match(/^\/(section|board)\/([^/?#]+)(\/mode\/\d+)?\/?(?:\?.*)?$/);
    if (!match) return null;
    return {
      kind: match[1],
      path: '/' + match[1] + '/' + match[2] + (match[3] || ''),
    };
  }

  function hasBrowseContent(route) {
    if (!route) return false;
    if (route.kind === 'home') return !!document.querySelector('#body #columns');
    const table = document.querySelector('#body .board-list');
    if (!table || !table.querySelector(route.kind === 'board' ? 'th.title_9' : 'th.title_1')) return false;
    // hash 先改变、AJAX 内容后替换：面包屑必须指向当前版面及模式。
    const routeLinks = Array.from(document.querySelectorAll('#notice_nav a[href]'))
      .map((a) => new URL(a.href, location.href).pathname.replace(/\/$/, ''))
      .filter((path) => path.startsWith('/' + route.kind + '/'));
    // 二级目录的面包屑中也有父分区，必须检查最末级，不能把父链接当成已加载。
    if (routeLinks[routeLinks.length - 1] !== route.path) return false;
    if (route.kind === 'board') {
      const query = (location.hash || location.search).split('?')[1] || '';
      const page = new URLSearchParams(query.split('#')[0]).get('p') || '1';
      const selected = document.querySelector('#body .page-select');
      if (selected && selected.textContent.trim() !== page) return false;
    }
    return true;
  }

  // 从 hash / pathname 里取出当前文章 ID
  function getArticleId() {
    const m =
      location.hash.match(/^#!article\/(?:[^/?#]+)\/(\d+)/) ||
      location.pathname.match(/\/article\/(?:[^/?#]+)\/(\d+)/);
    return m ? m[1] : '';
  }

  // 只有当前文章 DOM 真正出现后才启用卡片样式，避免在跳转前的旧页面上
  // 先套一遍新布局（BYR 是 hash SPA，hash 先变、内容后到）。
  // 页面顶部的 #a_share 带有当前文章地址；翻页后仍然存在。
  function hasArticleContent() {
    // 标题和分享地址可能先到，楼层后到；只看到标题不能解除加载遮挡。
    if (!document.querySelector('#body table.article, #body .b-content .a-wrap')) return false;
    const query = (location.hash || location.search).split('?')[1] || '';
    const page = new URLSearchParams(query.split('#')[0]).get('p') || '1';
    const selected = document.querySelector('#body .page-select');
    if (selected && selected.textContent.trim() !== page) return false;
    const id = getArticleId();
    if (id) {
      const share = document.querySelector('#body #a_share[_u]');
      if (share) {
        const articlePath = (location.hash.startsWith('#!') ? '/' + location.hash.slice(2) : location.pathname)
          .match(/^\/article\/[^/?#]+\/\d+/);
        const sharePath = new URL(share.getAttribute('_u'), location.href).pathname.replace(/\/$/, '');
        return !!articlePath && sharePath === articlePath[0];
      }
      return !!(
        document.querySelector(`#body a[href*="/ajax_cross/${id}.json"]`) ||
        document.querySelector(`#body a[href*="/article/post/${id}"]`) ||
        document.querySelector(`#body [class~="body${id}"]`)
      );
    }
    return !!(
      document.querySelector('#body table.article') ||
      document.querySelector('#body .b-content .a-wrap')
    );
  }

  /* ------------------------------------------------------------------ *
   * 1.1 自动无缝翻页：把版面列表 / 帖子详情的下一页接到当前页面末尾
   * ------------------------------------------------------------------ */
  let pager = null;
  const pagerCache = new Map();

  function getRouteKey() {
    return location.pathname + location.search + location.hash;
  }

  function getPageContext() {
    const path = location.hash.startsWith('#!')
      ? '/' + location.hash.slice(2) : location.pathname + location.search;
    const url = new URL(path, location.origin);
    const kind = /^\/article\/[^/]+\/\d+\/?$/.test(url.pathname) ? 'article'
      : /^\/board\/[^/]+(?:\/mode\/\d+)?\/?$/.test(url.pathname) ? 'board' : null;
    if (!kind) return null;
    const page = Number(url.searchParams.get('p') || 1);
    if (!Number.isInteger(page) || page < 1) return null;
    url.pathname = url.pathname.replace(/\/$/, '');
    return { kind, url, page };
  }

  function pageFilters(url) {
    const params = new URLSearchParams(url.search);
    ['p', '_uid', '_t'].forEach((key) => params.delete(key));
    params.sort();
    return params.toString();
  }

  function findNextPageLink(root, context, afterPage) {
    // 只认分页栏中的紧邻下一页，不能把正文引用的其他页码当成翻页入口。
    for (const anchor of root.querySelectorAll('.pagination a[href], .page-main a[href]')) {
      const url = new URL(anchor.getAttribute('href'), context.url);
      const page = Number(url.searchParams.get('p'));
      if (url.origin !== location.origin || url.pathname.replace(/\/$/, '') !== context.url.pathname ||
          page !== afterPage + 1 || pageFilters(url) !== pageFilters(context.url)) continue;
      url.hash = '';
      return { href: url.pathname + url.search, page };
    }
    return null;
  }

  function pagerTarget(root, kind) {
    if (kind === 'board') return root.querySelector('.board-list tbody');
    return Array.from(root.querySelectorAll('.b-content')).find((el) =>
      Array.from(el.children).some((child) => child.matches('.a-wrap')));
  }

  function pagerItems(target, kind) {
    if (!target) return [];
    return Array.from(target.children).filter((el) => kind === 'board'
      ? el.matches('tr') && !!el.querySelector('td.title_9 a[href]')
      : el.matches('.a-wrap'));
  }

  function pagerItemKey(item, kind) {
    const link = item.querySelector(kind === 'board'
      ? 'td.title_9 a[href*="/article/"]'
      : 'a[href*="/ajax_cross/"], a[href*="/article/post/"]');
    if (link) return new URL(link.getAttribute('href'), location.href).pathname;
    // 离线预览或没有功能链接的楼层，仍按楼层号及正文去重。
    return (item.querySelector('.a-pos')?.textContent || '') + '|' + item.textContent.trim();
  }

  function pagerEntryId() {
    const entry = history.state && history.state['bym-scroll'];
    return entry && entry.key === getRouteKey() ? entry.id : '';
  }

  function syncPagerButton() {
    if (!pagerButton) return;
    const visible = !!(pager && state.enabled && document.body?.classList.contains('bym-ready'));
    pagerButton.hidden = !visible;
    if (!visible) return;
    pagerButton.classList.toggle('bym-paused', !state.autoPager);
    pagerButton.setAttribute('aria-pressed', String(state.autoPager));
    const range = pager.basePage === pager.loadedPage ? String(pager.basePage) : `${pager.basePage}–${pager.loadedPage}`;
    const text = !state.autoPager ? '↕ 已暂停'
      : pager.loading ? '⇩ 加载中'
        : pager.error ? '加载失败，点击重试'
          : pager.exhausted ? `✓ 已到底 · ${range}` : `⇩ 自动翻页 · ${range}`;
    // 观察器监听 childList，文字未变时不重建文本节点。
    if (pagerButton.textContent !== text) pagerButton.textContent = text;
    pagerButton.title = `${pager.basePage} 至 ${pager.loadedPage} 页；` +
      (pager.error ? '点击重试下一页' : state.autoPager ? '点击暂停自动翻页' : '点击恢复自动翻页');
  }

  function rememberPager() {
    if (!pager || !pager.entryId || !pager.pages.length) return;
    pagerCache.delete(pager.entryId);
    pagerCache.set(pager.entryId, {
      key: pager.key, pages: pager.pages, next: pager.next,
      loadedPage: pager.loadedPage, exhausted: pager.exhausted,
    });
    // 仅在当前标签页内保留最近几个浏览记录，返回时先还原内容再还原滚动。
    while (pagerCache.size > 6) pagerCache.delete(pagerCache.keys().next().value);
  }

  function stopPagerRequest() {
    if (!pager) return;
    if (pager.controller) pager.controller.abort();
    pager.controller = null;
    pager.loading = false;
  }

  function appendPagerPage(current, page) {
    const fragment = document.createDocumentFragment();
    const items = [];
    page.nodes.forEach((template) => {
      const key = pagerItemKey(template, current.kind);
      if (current.seen.has(key)) return;
      current.seen.add(key);
      items.push(document.importNode(template, true));
    });
    if (!items.length) return 0;
    const marker = document.createElement(current.kind === 'board' ? 'tr' : 'div');
    marker.className = 'bym-page-divider';
    marker.dataset.bymPage = String(page.page);
    const label = document.createElement('a');
    label.href = page.href;
    label.textContent = `第 ${page.page} 页`;
    if (current.kind === 'board') {
      const cell = document.createElement('td');
      cell.colSpan = current.target.closest('table').querySelectorAll('thead th').length || 7;
      cell.appendChild(label);
      marker.appendChild(cell);
    } else marker.appendChild(label);
    fragment.append(marker, ...items);
    current.target.appendChild(fragment);
    return items.length;
  }

  function syncPager() {
    const context = getPageContext();
    const key = getRouteKey();
    const ready = !!document.body?.classList.contains('bym-ready');
    if (pager && (pager.key !== key || !context)) {
      stopPagerRequest();
      rememberPager();
      pager = null;
    }
    if (!context || !state.enabled || !ready) {
      stopPagerRequest();
      syncPagerButton();
      return;
    }
    const target = pagerTarget(document.querySelector('#body'), context.kind);
    if (!target) return;
    // 原站同地址刷新也会替换内容容器；此时重新加载，避免混入旧数据。
    if (pager && pager.target !== target) {
      stopPagerRequest();
      pagerCache.delete(pager.entryId);
      pager = null;
    }
    if (!pager) {
      const entryId = pagerEntryId();
      const cached = pagerCache.get(entryId);
      pager = {
        key, entryId, context, kind: context.kind, target,
        basePage: context.page, loadedPage: context.page,
        next: findNextPageLink(document.querySelector('#body'), context, context.page),
        loading: false, controller: null, error: false, exhausted: false,
        pages: [], seen: new Set(pagerItems(target, context.kind).map((el) => pagerItemKey(el, context.kind))),
      };
      if (cached && cached.key === key) {
        cached.pages.forEach((page) => appendPagerPage(pager, page));
        pager.pages = cached.pages;
        pager.next = cached.next;
        pager.loadedPage = cached.loadedPage;
        pager.exhausted = cached.exhausted;
      }
      pager.exhausted = !pager.next;
    }
    syncPagerButton();
    checkAutoPager();
  }

  async function loadNextPage() {
    if (!pager || pager.loading || pager.exhausted || pager.error || !state.autoPager) return;
    const current = pager;
    const next = current.next;
    if (!next) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    current.loading = true;
    current.controller = controller;
    syncPagerButton();
    try {
      // BYR 的 AJAX 返回内容片段；普通 GET 返回的是论坛外壳。
      const response = await fetch(next.href, {
        credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(response.headers.get('content-type') || '');
      const html = new TextDecoder(charset ? charset[1] : document.characterSet).decode(await response.arrayBuffer());
      if (pager !== current || current.key !== getRouteKey() || !state.autoPager || !state.enabled) return;
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const source = parsed.querySelector('#body') || parsed.body;
      const selected = source.querySelector('.page-select');
      const content = pagerTarget(source, current.kind);
      const items = pagerItems(content, current.kind);
      // 登录过期、错误页、重定向或返回了原页时停下，保留手动分页。
      if (!selected || selected.textContent.trim() !== String(next.page) || !items.length) throw new Error('无有效分页内容');
      if (current.kind === 'article') {
        const share = source.querySelector('#a_share[_u]');
        if (!share || new URL(share.getAttribute('_u'), location.href).pathname !== current.context.url.pathname) {
          throw new Error('文章不匹配');
        }
      }
      const nodes = items.map((item) => {
        const node = item.cloneNode(true);
        node.querySelectorAll('script').forEach((script) => script.remove());
        return node;
      });
      const page = { page: next.page, href: next.href, nodes };
      if (!appendPagerPage(current, page)) throw new Error('下一页没有新内容');
      current.pages.push(page);
      current.loadedPage = next.page;
      current.next = findNextPageLink(source, current.context, next.page);
      current.exhausted = !current.next;
      rememberPager();
      if (current.kind === 'board') decorateBrowse();
      else decorateFloors();
    } catch (error) {
      // 主动暂停 / 离开页面的请求无需提示错误；超时或网络失败只允许手动重试。
      if (pager === current && current.controller === controller) current.error = true;
    } finally {
      clearTimeout(timeout);
      if (pager === current && current.controller === controller) {
        current.controller = null;
        current.loading = false;
        syncPagerButton();
        if (!current.error && !current.exhausted) requestAnimationFrame(checkAutoPager);
      }
    }
  }

  function checkAutoPager() {
    if (!pager || pager.key !== getRouteKey() || !state.enabled || !state.autoPager || pager.loading ||
        pager.error || pager.exhausted || !document.body?.classList.contains('bym-ready')) return;
    const root = document.scrollingElement || document.documentElement;
    const remaining = root.scrollHeight - (window.scrollY + window.innerHeight);
    if (remaining <= PAGER_THRESHOLD) loadNextPage();
  }

  function toggleAutoPager() {
    if (pager && pager.error && state.autoPager) pager.error = false;
    else {
      state.autoPager = !state.autoPager;
      saveAutoPager(state.autoPager);
      if (!state.autoPager) stopPagerRequest();
    }
    syncPagerButton();
    checkAutoPager();
  }

  function syncLoading(waiting) {
    const root = document.documentElement;
    if (!root) return;
    if (!waiting) {
      clearTimeout(pendingTimer);
      pendingRoute = null;
      root.classList.remove('bym-loading');
      root.style.removeProperty('--bym-pending-height');
      return;
    }
    const key = location.pathname + location.search + location.hash;
    if (!pendingRoute || pendingRoute.key !== key) {
      clearTimeout(pendingTimer);
      pendingRoute = { key, expired: false };
      const main = document.querySelector('#main');
      const height = main ? Math.ceil(main.getBoundingClientRect().height) : 0;
      if (height > 0) root.style.setProperty('--bym-pending-height', height + 'px');
      pendingTimer = setTimeout(() => {
        if (!pendingRoute || pendingRoute.key !== key) return;
        pendingRoute.expired = true;
        // 网络失败或 DOM 不兼容时恢复可见；普通 DOM 变化不会重置这个截止时间。
        applyRoute();
      }, LOADING_TIMEOUT);
    }
    root.classList.toggle('bym-loading', !pendingRoute.expired);
    if (pendingRoute.expired) root.style.removeProperty('--bym-pending-height');
  }

  function applyRoute() {
    const body = document.body;
    const article = isArticlePage();
    const browse = getBrowseRoute();
    const supported = article || !!browse;
    const ready = article ? hasArticleContent() : hasBrowseContent(browse);
    // 公共外壳跟随路由，不跟随 AJAX 就绪状态，避免等待内容时闪回经典布局。
    const active = supported && state.enabled;
    if (document.documentElement) document.documentElement.classList.toggle('bym-enabled', active);
    const head = document.querySelector('#body .b-head');
    const error = !!head && head.textContent.trim() === '论坛错误信息';
    syncLoading(active && !ready && !error);
    applyTheme();
    if (!body) {
      scrollHistory.sync(active, false, error);
      return;
    }
    body.classList.toggle('bym-is-article', article);
    body.classList.toggle('bym-supported', supported);
    ['home', 'section', 'board'].forEach((kind) => {
      body.classList.toggle('bym-is-' + kind, !!browse && browse.kind === kind);
    });
    body.classList.toggle('bym-ready', ready);
    body.classList.toggle('bym-on', active && ready && article);
    body.classList.toggle('bym-browse-on', active && ready && !!browse);
    body.classList.toggle('bym-active', active);
    if (!(active && ready && article)) restoreComposer();
    // AJAX 换页后释放旧楼层引用，避免一直保留已经移除的页面。
    [movedActions, movedBadges].forEach((moved) => {
      moved.forEach((parent, node) => { if (!node.isConnected) moved.delete(node); });
    });
    if (!active) {
      body.classList.remove('bym-menu-open');
      syncMenu();
    }
    if (!(active && ready && article) && floatbar) floatbar.classList.remove('bym-visible');
    // 先识别历史条目、还原已追加的页，再修饰内容并在下一帧恢复滚动位置。
    scrollHistory.sync(active, ready, error);
    syncPager();
    // 标题和导航与新内容同一轮更新，避免短暂显示上一个页面的标题。
    if (active && ready) {
      if (browse) decorateBrowse();
      else decorateFloors();
    }
  }

  /* ------------------------------------------------------------------ *
   * 1.2 浏览器后退 / 前进：按历史记录保存位置，等待 AJAX 和布局完成后恢复
   * ------------------------------------------------------------------ */
  function createScrollHistory() {
    const KEY = 'bym-scroll';
    const POSITION_KEY = 'bym-scroll-entry:';
    const ROUTE_POSITION_KEY = 'bym-scroll-route:';
    const positions = new Map();
    const nativeRestoration = history.scrollRestoration;
    let current = null;
    let restoring = null;
    let frame = 0;
    let saveTimer = 0;
    let enabled = false;
    let traversing = false;
    let historyLength = history.length;
    // 列表页主动刷新表示重新浏览；浏览器后退 / 前进仍读取历史位置。
    // 只消费一次，避免 BFCache 恢复时把它再次当成刷新。
    let resetInitialBoard = performance.getEntriesByType('navigation')[0]?.type === 'reload' &&
      getBrowseRoute()?.kind === 'board';
    const routeKey = () => location.pathname + location.search + location.hash;

    function entryState() {
      const value = history.state && history.state[KEY];
      return value && typeof value.id === 'string' && value.key === routeKey() &&
        Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
    }

    function persist() {
      clearTimeout(saveTimer);
      saveTimer = 0;
      if (!current || current.key !== routeKey()) return;
      const saved = entryState();
      if (saved && saved.id !== current.id) return;
      // 保留论坛或其他脚本的历史状态，不改写非对象类型的状态。
      if (history.state !== null && (typeof history.state !== 'object' || Array.isArray(history.state))) return;
      try {
        const { id, key, x, y } = current;
        try {
          sessionStorage.setItem(POSITION_KEY + id, JSON.stringify({ key, x, y }));
          sessionStorage.setItem(ROUTE_POSITION_KEY + encodeURIComponent(key), JSON.stringify({ key, x, y }));
        } catch (e) { /* ignore */ }
        history.replaceState({ ...history.state, [KEY]: { id, key, x, y } }, '');
      } catch (e) { /* 存储受限时仍可在当前文档内记住位置。 */ }
    }

    function storedPosition(id) {
      try {
        const value = JSON.parse(sessionStorage.getItem(POSITION_KEY + id) || 'null');
        return value && value.key === routeKey() && Number.isFinite(value.x) && Number.isFinite(value.y)
          ? value : null;
      } catch (e) {
        return null;
      }
    }

    function storedRoutePosition(key) {
      try {
        const value = JSON.parse(sessionStorage.getItem(ROUTE_POSITION_KEY + encodeURIComponent(key)) || 'null');
        return value && value.key === key && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
      } catch (e) {
        return null;
      }
    }

    function saveBeforeNavigation() {
      // 论坛点击处理器随后会把正文滚回顶部；先把用户离开前的位置同步写入当前历史条目。
      if (!enabled || !current || current.key !== routeKey()) return;
      current.x = window.scrollX;
      current.y = window.scrollY;
      positions.set(current.id, { x: current.x, y: current.y });
      persist();
    }

    function remember() {
      if (!enabled || !current || !current.ready || restoring || current.key !== routeKey()) return;
      current.x = window.scrollX;
      current.y = window.scrollY;
      positions.set(current.id, { x: current.x, y: current.y });
      // 滚动时只更新内存；限频写入历史状态，以便刷新或跨文档返回后接续。
      if (!saveTimer) saveTimer = setTimeout(persist, 500);
    }

    function stopRestoring() {
      cancelAnimationFrame(frame);
      frame = 0;
      restoring = null;
    }

    function restore() {
      frame = 0;
      if (!restoring || !current || current.key !== routeKey()) return;
      if (!current.ready) return;
      if (!restoring.started) restoring.started = performance.now();
      const root = document.scrollingElement || document.documentElement;
      const x = Math.min(restoring.x, Math.max(0, root.scrollWidth - window.innerWidth));
      const y = Math.min(restoring.y, Math.max(0, root.scrollHeight - window.innerHeight));
      if (Math.abs(window.scrollX - x) > 1 || Math.abs(window.scrollY - y) > 1) {
        window.scrollTo({ left: x, top: y, behavior: 'auto' });
      }
      // 短时间跟随图片、字体和异步布局变化，也覆盖原站稍晚执行的回顶。
      if (performance.now() - restoring.started < 3000) frame = requestAnimationFrame(restore);
      else {
        stopRestoring();
        remember();
      }
    }

    function sync(active, ready, error) {
      enabled = active;
      const restoration = active ? 'manual' : nativeRestoration;
      if (restoration && history.scrollRestoration !== restoration) history.scrollRestoration = restoration;
      if (!active) {
        stopRestoring();
        if (current) current.ready = false;
        return;
      }
      const key = routeKey();
      const saved = entryState();
      // BYR 的 hash 路由有时会用自己的状态对象覆盖当前历史条目，
      // 这时条目 ID 会丢失；按路由保存的位置仍可作为返回恢复的兜底。
      // 只有浏览器后退 / 前进才使用这份兜底，普通点击进入同一地址仍从顶部开始。
      const routeSaved = traversing ? storedRoutePosition(key) : null;
      if (!current || current.key !== key || (saved && saved.id !== current.id) || (traversing && routeSaved)) {
        stopRestoring();
        clearTimeout(saveTimer);
        saveTimer = 0;
        const initial = !current;
        const reset = initial && resetInitialBoard;
        resetInitialBoard = false;
        current = saved ? { ...saved } : {
          id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
          key, x: initial ? window.scrollX : 0, y: initial ? window.scrollY : 0,
        };
        if (reset) {
          current.x = 0;
          current.y = 0;
          restoring = { x: 0, y: 0, started: 0 };
        } else if (saved || routeSaved) {
          const position = saved
            ? (storedPosition(saved.id) || positions.get(saved.id) || saved)
            : routeSaved;
          current.x = position.x;
          current.y = position.y;
          restoring = { x: position.x, y: position.y, started: 0 };
        }
        persist();
        // 相同地址的不同历史条目分别记忆，普通打开新页面仍由原站回到顶部。
        if (positions.size > 100) positions.delete(positions.keys().next().value);
      }
      traversing = false;
      current.ready = ready && !error;
      if (error) stopRestoring();
      if (restoring) {
        if (current.ready && !frame) frame = requestAnimationFrame(restore);
      } else remember();
    }

    function userScroll(event) {
      // 触控板两指横向滑动用于前进 / 后退，popstate 后仍会有惯性 wheel；
      // 只有明确的纵向滚动才取消恢复，轻微的纵向漂移也按横向手势处理。
      if (event.type === 'wheel' && Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      // AJAX 还没完成时没有可供用户滚动的目标内容，保留离开前的恢复位置。
      if (restoring && !current?.ready) return;
      // 用户开始纵向滚动或操作已加载的页面时交还控制，避免把人拉回去。
      if (restoring) stopRestoring();
      remember();
    }
    window.addEventListener('scroll', remember, { passive: true });
    ['wheel', 'touchstart', 'pointerdown'].forEach((type) => {
      window.addEventListener(type, userScroll, { passive: true, capture: true });
    });
    window.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) userScroll(event);
    }, true);
    // 在原站的点击处理器回顶前保存；返回按钮则使用持续记录的内存位置。
    ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach((type) => {
      document.addEventListener(type, saveBeforeNavigation, true);
    });
    window.addEventListener('pagehide', saveBeforeNavigation);
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) { current = null; applyRoute(); }
    });
    // 同文档 hash 路由的后退 / 前进会先触发 popstate，再触发 hashchange；
    // 记录这个方向，避免把普通点击导航误认为返回。
    window.addEventListener('popstate', () => {
      const length = history.length;
      traversing = length === historyLength;
      historyLength = length;
    });
    return { sync };
  }

  /* ------------------------------------------------------------------ *
   * 2. 注入样式（document-start 即注入，避免闪烁）
   * ------------------------------------------------------------------ */
  const CSS = String.raw`
/* ==================================================================
   北邮人论坛 · 简约版
   公共外壳作用于 :where(html).bym-enabled body，详情页样式作用于 body.bym-on
   ================================================================== */

/* ---------- 页面底色与基础 ---------- */
html.bym-enabled { background: #f4f6fa; }
/* 在 document-start 就标记根节点，让外壳样式先于 body 和 AJAX 内容生效。 */
html.bym-loading #main,
html.bym-loading #main *,
html.bym-loading #bot_foot,
html.bym-loading #bym-floatbar { visibility: hidden !important; }
html.bym-loading #main { min-height: max(40vh, var(--bym-pending-height, 0px)); }
html.bym-loading body::after {
  content: "正在加载…";
  position: fixed;
  top: 112px;
  left: 50%;
  transform: translateX(-50%);
  color: #64748b;
  font: 13px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  pointer-events: none;
  z-index: 100;
}
html.bym-dark.bym-loading body::after { color: #aab6c6; }
html.bym-dark.bym-enabled body:not(.bym-ready) #body > .b-content {
  background: #161d27 !important;
  color: #d7dee8 !important;
  border-color: #263041 !important;
}
:where(html).bym-enabled body {
  --bym-gutter: clamp(10px, 1.5vw, 20px);
  --bym-sidebar-width: clamp(12rem, 17vw, 15rem);
  --bym-sidebar-space: 0px;
  --bym-content-width: min(1120px, calc(100vw - var(--bym-sidebar-space) - var(--bym-gutter) * 2));
  --bym-content-left: calc(var(--bym-sidebar-space) + (100vw - var(--bym-sidebar-space) - var(--bym-content-width)) / 2);
  width: auto !important;
  min-width: 0 !important;
  background: #f4f6fa !important;
  color: #1f2937;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
/* 所有内容及浮层共用同一列，侧栏展开、缩放和换行时一起调整。 */
:where(html).bym-enabled body :is(#top_head, #main, #bot_foot) {
  width: var(--bym-content-width) !important;
  min-width: 0 !important;
  max-width: none !important;
  margin-left: var(--bym-content-left) !important;
  margin-right: 0 !important;
  box-sizing: border-box !important;
}
:where(html).bym-enabled body :is(#body, #body > .b-content, #body > .b-head, #body > .t-pre, #body > .t-pre-bottom, .board-list) {
  min-width: 0;
  box-sizing: border-box;
}
body.bym-browse-on #main { container: bym-main / inline-size; }
:where(html).bym-enabled body #body { display: grid; grid-template-columns: minmax(0, 1fr); }

/* ---------- 顶部：收起广告横幅，压缩为工具条 ---------- */
:where(html).bym-enabled body #top_head {
  height: auto !important;
  min-height: 60px;
  margin-block: 0 !important;
  padding: 10px 16px 0 !important;
  display: flex !important;
  flex-wrap: wrap;
  align-items: center !important;
  gap: 16px;
  background: transparent !important;
  overflow: visible !important;
  border: 0 !important;
}

:where(html).bym-enabled body #top_logo {
  order: 1;
  flex: 0 0 auto;
  margin: 0 !important;
}
:where(html).bym-enabled body #top_logo img {
  display: block;
  height: 34px !important;
  width: auto !important;
}

:where(html).bym-enabled body #ban_ner { display: none !important; }

:where(html).bym-enabled body #top_menu {
  order: 2;
  margin-left: auto !important;
  float: none !important;
  min-width: 0;
}
:where(html).bym-enabled body #top_menu ul {
  display: flex !important;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 18px;
  margin: 0 !important;
  padding: 0 !important;
}
:where(html).bym-enabled body #top_menu li {
  margin: 0 !important;
  list-style: none;
}
:where(html).bym-enabled body #top_menu a {
  color: #64748b !important;
  font-size: 12px !important;
  text-decoration: none !important;
  transition: color .15s ease;
}
:where(html).bym-enabled body #top_menu a:hover { color: #2f6fd0 !important; }

/* ---------- 左侧栏 / 广告：阅读页默认隐藏，菜单收进抽屉 ---------- */
:where(html).bym-enabled body #menu,
:where(html).bym-enabled body #left_adv,
:where(html).bym-enabled body #left_line {
  display: none !important;
}

:where(html).bym-enabled body.bym-menu-open #menu {
  display: block !important;
  position: fixed !important;
  top: 76px !important;
  left: 16px !important;
  bottom: 52px !important;
  width: 240px !important;
  max-width: calc(100vw - 32px) !important;
  margin: 0 !important;
  padding: 10px !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-width: none;
  -ms-overflow-style: none;
  z-index: 2147482998 !important;
  background: #fff !important;
  border: 1px solid #e4e9f2 !important;
  border-radius: 14px !important;
  box-shadow: 0 24px 70px -20px rgba(15, 23, 42, .45) !important;
  box-sizing: border-box;
}
:where(html).bym-enabled body.bym-menu-open #menu::-webkit-scrollbar,
:where(html).bym-enabled body.bym-menu-open #menu *::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}
:where(html).bym-enabled body.bym-menu-open #menu #left_adv,
:where(html).bym-enabled body.bym-menu-open #menu .m-hide { display: none !important; }
:where(html).bym-enabled body.bym-menu-open #menu #xlist,
:where(html).bym-enabled body.bym-menu-open #menu #u_login {
  width: auto !important;
  margin: 0 0 10px !important;
  border-radius: 10px !important;
  overflow: hidden;
}
:where(html).bym-enabled body.bym-menu-open #menu a {
  color: #475569 !important;
  text-decoration: none !important;
}
:where(html).bym-enabled body.bym-menu-open #menu a:hover { color: #2f6fd0 !important; }

/* 保留树形菜单的展开逻辑，去掉原站固定行高和内层裁切。 */
:where(html).bym-enabled body #menu {
  font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
:where(html).bym-enabled body #menu :is(#xlist, #u_login) {
  width: auto !important;
  min-width: 0 !important;
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  box-sizing: border-box;
}
:where(html).bym-enabled body #menu :is(a, li, p, span) {
  font-size: inherit !important;
  line-height: inherit !important;
}
:where(html).bym-enabled body #menu :is(.x-folder, .x-leaf, .x-child > li > span) {
  display: flex !important;
  align-items: flex-start;
  width: 100% !important;
  height: auto !important;
  min-height: 2.2em;
  padding: 4px 2px;
  overflow: visible !important;
  box-sizing: border-box;
}
:where(html).bym-enabled body #menu a {
  float: none !important;
  min-width: 0;
  padding-top: 0 !important;
  white-space: normal !important;
  overflow-wrap: anywhere;
  font-weight: 400 !important;
}
:where(html).bym-enabled body #menu :is(.x-folder, .active) > a { font-weight: 600 !important; }
:where(html).bym-enabled body #menu .toggler {
  float: none !important;
  flex-shrink: 0;
  margin-top: 4px !important;
}
:where(html).bym-enabled body #menu .x-child li { padding: 0 0 0 8px; }
:where(html).bym-enabled body #menu .x-search input { min-width: 0; max-width: 100%; height: auto; box-sizing: border-box; }

#bym-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147482997;
  display: none;
  background: rgba(15, 23, 42, .36);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}
body.bym-menu-open #bym-overlay { display: block; }

/* 桌面端默认常驻分区侧栏；窄屏继续使用原来的抽屉，避免挤压正文。 */
@media (min-width: 1100px) {
  :where(html).bym-enabled body.bym-active {
    --bym-sidebar-space: calc(var(--bym-sidebar-width) + var(--bym-gutter));
  }
  :where(html).bym-enabled body.bym-active #menu {
    display: block !important;
    position: fixed !important;
    top: var(--bym-gutter) !important;
    left: var(--bym-gutter) !important;
    bottom: var(--bym-gutter) !important;
    width: var(--bym-sidebar-width) !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 10px !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    scrollbar-width: thin;
    z-index: 2147482998 !important;
    background: #fff !important;
    border: 1px solid #e4e9f2 !important;
    border-radius: 14px !important;
    box-shadow: 0 16px 48px -28px rgba(15, 23, 42, .42) !important;
    box-sizing: border-box;
  }
  :where(html).bym-enabled body.bym-active #menu #left_adv,
  :where(html).bym-enabled body.bym-active #menu #left_line,
  :where(html).bym-enabled body.bym-active #menu .m-hide { display: none !important; }
  :where(html).bym-enabled body.bym-active #menu #xlist,
  :where(html).bym-enabled body.bym-active #menu #u_login {
    width: auto !important;
    margin: 0 0 10px !important;
    border-radius: 10px !important;
    overflow: hidden;
  }
  :where(html).bym-enabled body.bym-active #menu a {
    color: #475569 !important;
    text-decoration: none !important;
  }
  :where(html).bym-enabled body.bym-active #menu a:hover { color: #2f6fd0 !important; }
  :where(html).bym-enabled body.bym-active #bym-menu,
  :where(html).bym-enabled body.bym-active #bym-overlay { display: none !important; }
  html.bym-dark.bym-enabled body.bym-active #menu {
    background: #161d27 !important;
    border-color: #263041 !important;
    box-shadow: 0 16px 48px -28px rgba(0, 0, 0, .85) !important;
  }
  html.bym-dark.bym-enabled body.bym-active #menu a { color: #aab6c6 !important; }
  html.bym-dark.bym-enabled body.bym-active #menu a:hover { color: #7fb0f5 !important; }
}

/* ---------- 主容器：居中自适应 ---------- */
:where(html).bym-enabled body #main {
  margin-block: 8px 48px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
}

/* ---------- 面包屑 ---------- */
:where(html).bym-enabled body #notice {
  padding: 6px 4px 10px !important;
  border: 0 !important;
  background: transparent !important;
  font-size: 12px !important;
  line-height: 1.6;
  color: #94a3b8 !important;
  overflow-wrap: anywhere;
}
:where(html).bym-enabled body #notice a {
  color: #64748b !important;
  text-decoration: none !important;
}
:where(html).bym-enabled body #notice a:hover { color: #2f6fd0 !important; }

/* ---------- 内容区不再裁剪 ---------- */
body.bym-on #body {
  width: 100% !important;
  overflow: visible !important;
}
body.bym-on #body .b-content {
  overflow: visible !important;
}

/* ---------- 顶部 / 底部操作条 ---------- */
:where(html).bym-enabled body #body > .t-pre,
:where(html).bym-enabled body #body > .t-pre-bottom {
  position: static !important;
  top: auto;
  z-index: auto;
  display: flex !important;
  align-items: center !important;
  flex-wrap: wrap;
  gap: 10px;
  width: 100% !important;
  min-height: 46px;
  margin: 0 0 12px !important;
  padding: 7px 12px !important;
  box-sizing: border-box !important;
  background: rgba(255, 255, 255, .92) !important;
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border: 1px solid #e4e9f2 !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 28px -22px rgba(15, 23, 42, .45);
}
:where(html).bym-enabled body #body > .t-pre-bottom {
  margin: 14px 0 0 !important;
}
/* 底部工具条：搜索在左，分页在右 */
:where(html).bym-enabled body #body > .t-pre-bottom .t-btn {
  order: 1;
  flex: 1 1 auto;
  min-width: 0;
}
:where(html).bym-enabled body #body > .t-pre-bottom .page {
  order: 2;
}

:where(html).bym-enabled body #body > .t-pre .page,
:where(html).bym-enabled body #body > .t-pre-bottom .page {
  float: none !important;
  margin-left: auto !important;
  padding: 0 !important;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  gap: 6px;
}

/* 顶部工具条：分页靠左，发文按钮靠右，左右平衡 */
:where(html).bym-enabled body #body > .t-pre .page { margin-left: 0 !important; }
:where(html).bym-enabled body #body > .t-pre .t-btn { margin-left: auto; }

:where(html).bym-enabled body .t-btn {
  display: flex !important;
  float: none !important;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
:where(html).bym-enabled body .t-btn a {
  display: inline-flex !important;
  align-items: center;
  padding: 5px 12px !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 8px !important;
  background: #2f6fd0 !important;
  color: #fff !important;
  font-size: 13px !important;
  line-height: 1.4;
  text-decoration: none !important;
  transition: background .15s ease, transform .15s ease;
}
:where(html).bym-enabled body .t-btn a:hover {
  background: #2159b0 !important;
  color: #fff !important;
  transform: translateY(-1px);
}

/* 底部搜索表单（保留原有搜索 / 精华帖 / 带附件等筛选功能） */
:where(html).bym-enabled body #f_search {
  display: flex !important;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 !important;
  padding: 0 !important;
}
:where(html).bym-enabled body #f_search .input-text {
  width: 12em !important;
  max-width: 40vw;
  height: 28px;
  box-sizing: border-box;
}
:where(html).bym-enabled body #f_search label {
  display: inline-flex;
  align-items: center;
  gap: 0;
  margin: 0 2px 0 0;
  color: #64748b !important;
  font-size: 12px !important;
  white-space: nowrap;
}
/* 复选框与「精华帖 / 带附件」之间只留一点距离 */
:where(html).bym-enabled body #f_search input[type="checkbox"] {
  margin: 0 -3px 0 0 !important;
  accent-color: #2f6fd0;
}
:where(html).bym-enabled body #f_search .button { margin-left: 2px; }

/* 输入框 / 按钮 */
:where(html).bym-enabled body .input-text {
  border: 1px solid #dbe2ee !important;
  border-radius: 8px !important;
  background: #fff !important;
  padding: 4px 8px !important;
  font-size: 12px !important;
  color: #334155 !important;
}
:where(html).bym-enabled body .button {
  border: 0 !important;
  border-radius: 8px !important;
  background: #eef2f9 !important;
  color: #475569 !important;
  padding: 5px 10px !important;
  font-size: 12px !important;
  cursor: pointer;
}
:where(html).bym-enabled body .button:hover { background: #e2e8f3 !important; }

/* ---------- 分页 ---------- */
:where(html).bym-enabled body .pagination {
  display: flex !important;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  gap: 5px;
  margin: 0 !important;
  padding: 0 !important;
  font-size: 12px !important;
  color: #64748b !important;
  list-style: none;
}
:where(html).bym-enabled body .page-main {
  display: flex !important;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  gap: 4px;
  margin: 0 !important;
  padding: 0 !important;
}
:where(html).bym-enabled body .page-main li { list-style: none; }
:where(html).bym-enabled body .pagination > li { min-width: 0; max-width: 100%; }
:where(html).bym-enabled body .page-main a {
  display: inline-block;
  padding: 3px 9px !important;
  border: 0 !important;
  border-radius: 7px !important;
  background: #eef2f7 !important;
  color: #475569 !important;
  font-size: 12px !important;
  line-height: 1.5;
  text-decoration: none !important;
  transition: background .15s ease, color .15s ease;
}
:where(html).bym-enabled body .page-select a {
  background: #2f6fd0 !important;
  color: #fff !important;
}
:where(html).bym-enabled body .page-normal a:hover {
  background: #dbe7fb !important;
  color: #2159b0 !important;
}
:where(html).bym-enabled body .page-jump input[type="text"] { width: 26px !important; }

/* ---------- 文章标题条 ---------- */
body.bym-on #body > .b-head {
  display: flex !important;
  align-items: center !important;
  flex-wrap: wrap;
  gap: 14px;
  height: auto !important;
  margin: 0 0 12px !important;
  padding: 16px 20px !important;
  border: 1px solid #e4e9f2 !important;
  border-radius: 14px !important;
  background: #fff !important;
  color: #0f172a !important;
  font-size: 19px !important;
  font-weight: 650 !important;
  line-height: 1.45;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 16px 40px -34px rgba(15, 23, 42, .5);
}
body.bym-on #body > .b-head .n-left {
  display: block;
  order: 1;
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
body.bym-on #body > .b-head .n-right {
  float: none !important;
  order: 2;
  margin-left: auto !important;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  font-size: 11px !important;
  font-weight: 400 !important;
  color: #94a3b8 !important;
}
body.bym-on #body > .b-head .n-right img { opacity: .55; }
/* 站点给「分享到:」写了内联 color:#eee，浅色下几乎看不见 */
body.bym-on #body > .b-head #a_share {
  color: #94a3b8 !important;
  font-size: 11px !important;
}

/* ---------- 楼层卡片 ---------- */
body.bym-on .b-content {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  border-radius: 0 !important;
  margin: 0 !important;
  overflow: visible !important;
}

body.bym-on .a-wrap {
  margin: 0 0 14px !important;
  border: 1px solid #e4e9f2 !important;
  border-radius: 14px !important;
  background: #fff !important;
  overflow: hidden !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 18px 44px -40px rgba(15, 23, 42, .55);
}
body.bym-on .a-wrap.kb {
  border-color: #2f6fd0 !important;
  box-shadow: 0 0 0 3px rgba(47, 111, 208, .14) !important;
}

/* 把楼层表格改成 flex 布局：彻底摆脱表格列宽联动 */
body.bym-on table.article,
body.bym-on table.article > tbody {
  display: block !important;
  width: 100% !important;
  border-collapse: collapse !important;
  background: transparent !important;
}
body.bym-on table.article td {
  background: transparent !important;
  vertical-align: top !important;
}
/* 注意：被折叠楼层的占位单元格由站点 JS 控制 display，
   这里不要强制 display，否则「手贱想看」按钮永远不出现 */

/* 楼层头：作者 + 操作 */
body.bym-on .a-head {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  flex-wrap: wrap;
  gap: 6px 20px;
  height: auto !important;
  padding: 0 !important;
  background: #f8fafc !important;
  border-bottom: 1px solid #eef2f7 !important;
}
body.bym-on .a-head td {
  padding: 9px 16px !important;
  border: 0 !important;
  vertical-align: middle !important;
}
body.bym-on .a-head > td:first-child {
  flex: 0 0 auto;
}
body.bym-on .a-head > td:last-child {
  flex: 1 1 auto;
  min-width: 0;
  display: flex !important;
  justify-content: flex-end;
}
body.bym-on .a-head .a-left {
  display: flex !important;
  align-items: center;
  width: auto !important;
  border-right: 0 !important;
  white-space: nowrap;
}
body.bym-on .a-head .a-left .a-pos {
  margin-left: 8px;
}
body.bym-on .a-u-name {
  font-size: 13px !important;
  font-weight: 700 !important;
  color: #2159b0 !important;
}
body.bym-on .a-u-sex { opacity: .7; }

body.bym-on .a-func {
  float: none !important;
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 2px 14px !important;
  font-size: 0;
}
body.bym-on .a-head .a-func { justify-content: flex-end; }
body.bym-on .a-func li {
  display: inline-flex !important;
  align-items: center;
  margin: 0 !important;
}
body.bym-on .a-func li a {
  color: #64748b !important;
  font-size: 12px !important;
  text-decoration: none !important;
  transition: color .15s ease;
}
body.bym-on .a-func li a:hover { color: #2f6fd0 !important; }
body.bym-on .a-func samp { opacity: .55; }

/* 楼主 / 沙发等徽标 */
body.bym-on .a-pos {
  display: inline-block;
  padding: 1px 8px !important;
  border-radius: 999px !important;
  background: #2f6fd0 !important;
  color: #fff !important;
  font-size: 11px !important;
  font-weight: 600;
  line-height: 1.7;
}

/* 正文行：头像列 + 内容列 */
body.bym-on .a-body {
  display: flex !important;
  align-items: stretch;
}
body.bym-on .a-body > * { box-sizing: border-box; }
body.bym-on .a-body > .a-content {
  flex: 1 1 auto;
  min-width: 0;
}

/* 头像列 */
body.bym-on .a-body .a-left {
  flex: 0 0 184px;
  width: 184px !important;
  padding: 16px 10px !important;
  border-right: 1px solid #f1f5f9 !important;
  background: #fbfcff !important;
  text-align: center;
  box-sizing: border-box;
  overflow: visible !important;
}
body.bym-on .a-body .a-left > div {
  width: auto !important;
  margin: 0 !important;
  padding: 0 !important;
}
body.bym-on .a-body .a-left .a-u-img {
  width: auto !important;
  margin: 0 auto 8px !important;
  overflow: visible !important;
}
body.bym-on .a-body .a-left img {
  display: block;
  width: 84px !important;
  height: 84px !important;
  margin: 0 auto !important;
  padding: 4px !important;
  border: 1px solid #eef2f8 !important;
  border-radius: 12px !important;
  background: #fff !important;
  object-fit: contain;
  box-sizing: border-box;
  box-shadow: 0 2px 10px rgba(15, 23, 42, .08);
}
/* 保留「关注」小按钮（站点 iframe），压成紧凑尺寸 */
body.bym-on .a-body .a-left iframe {
  display: block !important;
  width: 63px !important;
  height: 24px !important;
  margin: 4px auto 6px !important;
  border: 0 !important;
}

/* 匿名帖（IWhisper 等）左栏没有用户信息，收窄头像列 */
body.bym-on .a-wrap.bym-anon .a-body .a-left {
  flex: 0 0 104px;
  width: 104px !important;
}
body.bym-on .a-wrap.bym-anon .a-body .a-left img {
  width: 64px !important;
  height: 64px !important;
}

/* 用户名 + 等级/文章/积分：从站点的 120px 浮动列表改为不裁切的网格 */
body.bym-on .a-body .a-left .a-u-uid {
  width: auto !important;
  margin: 0 0 6px !important;
  overflow: visible !important;
  color: #334155 !important;
  font-size: 12px !important;
  font-weight: 600;
  line-height: 1.5;
  text-align: center;
  overflow-wrap: anywhere;
}
body.bym-on .a-body .a-left .a-u-uid a {
  color: inherit !important;
  text-decoration: none !important;
}
body.bym-on .a-body .a-left .a-u-uid a:hover { color: #2f6fd0 !important; }
body.bym-on .a-body .a-left .a-u-info {
  display: grid !important;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1px 8px;
  width: auto !important;
  max-width: 100% !important;
  margin: 0 0 8px !important;
  padding: 0 2px !important;
  overflow: visible !important;
  font-size: 11.5px;
  line-height: 1.6;
  text-align: left;
}
body.bym-on .a-body .a-left .a-u-info dt,
body.bym-on .a-body .a-left .a-u-info dd {
  float: none !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  white-space: normal;
}
body.bym-on .a-body .a-left .a-u-info dt { color: #94a3b8 !important; white-space: nowrap; }
body.bym-on .a-body .a-left .a-u-info dd { color: #475569 !important; overflow-wrap: anywhere; }

/* 查看 / 发信 / 加好友：由脚本移入左栏，横向排在用户信息下方
   图标是 <a> 的兄弟节点，背景放在 <li> 上，避免图标被按钮底色盖住 */
body.bym-on .a-body .a-left .a-func-info {
  display: flex !important;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  width: 100% !important;
  margin: 10px 0 0 !important;
  padding: 10px 0 0 !important;
  gap: 4px !important;
  border-top: 1px dashed #eef2f7;
  font-size: 11px;
}
body.bym-on .a-body .a-left .a-func-info li {
  position: relative;
  display: flex !important;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  width: auto !important;
  min-width: 0;
  margin: 0 !important;
  padding: 4px 2px !important;
  box-sizing: border-box;
  border-radius: 8px !important;
  background: #eef2f9 !important;
  transition: background .15s ease;
}
body.bym-on .a-body .a-left .a-func-info li:hover { background: #dbe7fb !important; }
body.bym-on .a-body .a-left .a-func-info li a {
  position: static !important;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: auto !important;
  padding: 0 !important;
  box-sizing: border-box;
  border-radius: 0 !important;
  background: none !important;
  color: #475569 !important;
  font-size: 11px !important;
  line-height: 1.4;
  white-space: nowrap;
  text-align: center;
  transition: color .15s ease;
}
/* 整颗胶囊（含左侧图标）都可点击 */
body.bym-on .a-body .a-left .a-func-info li a::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 8px;
}
body.bym-on .a-body .a-left .a-func-info li:hover a { color: #2159b0 !important; }
body.bym-on .a-body .a-left .a-func-info samp {
  flex: 0 0 16px;
  position: relative;
  z-index: 1;
  width: 16px !important;
  height: 16px !important;
  margin: 0 2px 0 0 !important;
  opacity: .75;
  pointer-events: none;
}
/* 查看功能移到头像点击；加好友稍微加宽 */
body.bym-on .a-body .a-left .a-func-info li.bym-action-view { display: none !important; }
body.bym-on .a-body .a-left .a-func-info li.bym-action-friend { flex-grow: 1.35; }
/* 头像本身包一层真实链接，点击时由站点自己的 /user/query/ 处理器打开资料对话框 */
body.bym-on .a-body .a-left .a-u-img > .bym-avatar-link {
  display: block !important;
  width: fit-content;
  margin: 0 auto !important;
  border-radius: 12px;
  cursor: pointer;
  text-decoration: none !important;
}

/* 正文 */
body.bym-on .a-content {
  padding: 16px 20px 18px !important;
  color: #1f2937 !important;
  font-size: 15px !important;
  line-height: 1.85 !important;
  word-break: break-word;
  overflow-wrap: anywhere;
}
body.bym-on .a-content-wrap {
  color: inherit !important;
  font-size: inherit !important;
  overflow: visible !important;
}
/* 发信人 / 标题 / 发信站：弱化为辅助信息 */
body.bym-on .bym-meta {
  margin: 0 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px dashed #eef2f7;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.75;
}
body.bym-on .bym-meta font { color: inherit !important; }
body.bym-on .a-content-wrap font {
  font-size: inherit !important;
  line-height: inherit !important;
}
body.bym-on .a-content-wrap a {
  color: #2563eb !important;
  text-decoration: none !important;
}
body.bym-on .a-content-wrap a:hover { text-decoration: underline !important; }
/* ※ 来源 / 发信站：进一步弱化 */
body.bym-on .a-content-wrap .bym-source {
  color: #a8b3c2 !important;
  font-size: 11.5px !important;
  line-height: 1.7;
}
body.bym-on .a-content-wrap .bym-source a {
  color: #a8b3c2 !important;
  text-decoration: none !important;
}
body.bym-on .a-content-wrap .bym-source a:hover { text-decoration: underline !important; }
body.bym-on .a-content-wrap img {
  max-width: 100% !important;
  height: auto !important;
  border-radius: 8px;
}
/* 站内小表情不要被放大成正文那么大 */
body.bym-on .a-content-wrap img[alt^="ema"] {
  height: 1.6em !important;
  width: auto !important;
  vertical-align: -0.3em;
  border-radius: 0 !important;
}

/* 被折叠楼层的「手贱想看」占位 */
body.bym-on .a-body > .a-content2 {
  flex: 1 1 auto;
  padding: 16px 20px !important;
}
body.bym-on .a-content2 .a-background {
  width: auto !important;
  max-width: 420px;
  margin: 0 !important;
  padding: 14px 18px !important;
  border: 1px dashed #dbe2ee !important;
  border-radius: 10px !important;
  background: #f8fafc !important;
}
body.bym-on .a-content2 .a-background p {
  margin: 0 0 6px !important;
  color: #64748b !important;
  font-family: inherit !important;
  font-size: 13px !important;
  line-height: 1.7;
}
body.bym-on .a-content2 .a-func-dispCai {
  margin-top: 6px !important;
  padding: 4px 12px !important;
  border: 0 !important;
  border-radius: 7px !important;
  background: #eef2f7 !important;
  color: #475569 !important;
  font-size: 12px !important;
  cursor: pointer;
}

/* 楼层底部：赞/踩/返回顶部 */
body.bym-on .a-bottom {
  display: flex !important;
  /* 站点给这一行写死了 23px；不放开的话，单元格的内边距只会向上下溢出，行高不会真的变大 */
  height: auto !important;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
body.bym-on .a-bottom td {
  display: flex !important;
  align-items: center;
  gap: 12px;
  padding: 12px 16px !important;
  border-top: 1px solid #f1f5f9 !important;
  background: #fbfcff !important;
}
/* 左栏按钮已移入头像列，空出来的底部左单元格不再占位 */
body.bym-on .a-wrap.bym-actions-moved .a-bottom > .a-left,
body.bym-on .a-wrap.bym-actions-empty .a-bottom > .a-left { display: none !important; }
body.bym-on .a-bottom > td:last-child {
  flex: 1 1 auto;
  min-width: 0;
}
/* 底部状态（赞 / 踩 / 楼主好评）与正文左边缘对齐，不再落到头像列下方 */
body.bym-on .a-wrap.bym-actions-moved .a-bottom > td:last-child,
body.bym-on .a-wrap.bym-actions-empty .a-bottom > td:last-child {
  padding-left: calc(184px + 20px) !important;
}
body.bym-on .a-wrap.bym-anon .a-bottom > td:last-child {
  padding-left: calc(104px + 20px) !important;
}
body.bym-on .a-status {
  float: none !important;
  display: inline-flex !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  margin: 0 auto 0 0 !important;
  padding: 0 !important;
}
body.bym-on .a-status li {
  display: inline-flex !important;
  align-items: center;
  margin: 0 !important;
}
body.bym-on .a-status a {
  display: inline-flex !important;
  align-items: center;
  color: #64748b !important;
  font-size: 12px !important;
  line-height: 1.6;
  text-decoration: none !important;
}
body.bym-on .a-status a:hover { color: #2f6fd0 !important; }
/* 统一卡片底部与精彩回复：图标 16×16，和文字垂直居中对齐 */
body.bym-on .a-status samp,
body.bym-on .a-nice-comment-func samp {
  flex: 0 0 16px;
  width: 16px !important;
  height: 16px !important;
  margin: 0 4px 0 0 !important;
  vertical-align: middle !important;
}
body.bym-on .a-back {
  float: right !important;
  color: #94a3b8 !important;
  font-size: 12px !important;
  text-decoration: none !important;
}
body.bym-on .a-back:hover { color: #2f6fd0 !important; }

/* ---------- 精彩回复：核心修复 ---------- */
body.bym-on #nice_view {
  width: auto !important;
  max-width: 100% !important;
  margin: 26px 0 0 !important;
  padding: 0 !important;
  border: 1px solid #f6e3c5 !important;
  border-radius: 12px !important;
  background: linear-gradient(180deg, #fffdf8 0%, #fff9ef 100%) !important;
  overflow: hidden !important;
  box-sizing: border-box;
}

body.bym-on .a-nice-comment-divline {
  display: flex !important;
  align-items: center;
  gap: 8px;
  width: auto !important;
  max-width: 100% !important;
  height: auto !important;
  margin: 0 !important;
  padding: 12px 16px 8px !important;
  border: 0 !important;
  position: static !important;
  box-sizing: border-box;
}
body.bym-on .a-nice-comment-divline h3 {
  width: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  color: #b45309 !important;
  font-size: 14px !important;
  font-weight: 700;
}
body.bym-on .a-nice-comment-divline h3 span::before {
  content: "💬 ";
  font-size: 14px;
}
body.bym-on .a-nice-comment-divline h5 {
  width: auto !important;
  margin: 0 0 0 auto !important;
  background: transparent !important;
  text-align: right;
  font-size: 12px !important;
}
body.bym-on .a-nice-comment-divline h5 a {
  color: #9a6b2f !important;
  text-decoration: none !important;
}
body.bym-on .a-nice-comment-divline h5 a:hover { text-decoration: underline !important; }

body.bym-on .a-nice-comment {
  width: auto !important;
  max-width: 100% !important;
  margin: 0 12px 10px !important;
  border: 0 !important;
  background: transparent !important;
  box-sizing: border-box;
}
body.bym-on .a-nice-comment img { max-width: 100% !important; height: auto !important; }

body.bym-on .a-nice-comment-item {
  display: flex !important;
  align-items: flex-start !important;
  gap: 18px;
  width: auto !important;
  max-width: 100% !important;
  margin: 0 !important;
  padding: 12px 14px !important;
  box-sizing: border-box;
}
body.bym-on .a-nice-comment-item + .a-nice-comment-item {
  border-top: 1px dashed #f0d9b5 !important;
}
/* 头像固定尺寸，文字 / ID 单独一列，不再随头像大小错位
   图片本身使用和楼层头像完全相同的边框、内边距与 object-fit:contain，不裁切 */
body.bym-on .a-nice-comment-face {
  display: block !important;
  flex: 0 0 84px !important;
  width: 84px !important;
  height: 84px !important;
  margin: 0 !important;
  padding: 0 !important;
  box-sizing: border-box;
  overflow: visible !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
}
body.bym-on .a-nice-comment-face img {
  display: block !important;
  width: 84px !important;
  height: 84px !important;
  margin: 0 !important;
  padding: 4px !important;
  border: 1px solid #eef2f8 !important;
  border-radius: 12px !important;
  background: #fff !important;
  object-fit: contain !important;
  box-sizing: border-box;
  box-shadow: 0 2px 10px rgba(15, 23, 42, .08);
}
body.bym-on .a-nice-comment-cell {
  flex: 1 1 auto;
  min-width: 0 !important;
  margin-left: 0 !important;
  min-height: 0 !important;
}
body.bym-on .a-nice-comment-id { margin-bottom: 6px !important; }
body.bym-on .a-nice-comment-id a {
  color: #8a6a3b !important;
  font-size: 12px !important;
}
body.bym-on .a-nice-comment-content {
  margin-bottom: 6px !important;
  color: #3f3a33 !important;
  font-size: 14px !important;
  line-height: 1.75 !important;
  word-break: break-word;
  overflow-wrap: anywhere;
}
body.bym-on .a-nice-comment-func {
  float: none !important;
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 12px !important;
}
body.bym-on .a-nice-comment-func li {
  display: inline-flex !important;
  align-items: center;
  margin: 0 !important;
}
body.bym-on .a-nice-comment-func a {
  display: inline-flex !important;
  align-items: center;
  color: #9a7b52 !important;
  font-size: 12px !important;
  line-height: 1.4;
  text-decoration: none !important;
}
body.bym-on .a-nice-comment-func a:hover { color: #b45309 !important; }
body.bym-on .a-nice-comment-floor {
  margin: 0 !important;
  color: #a8a29e !important;
}

/* ---------- 快捷回复：固定在底部，压缩成一行 ---------- */
body.bym-on .a-comment {
  position: fixed !important;
  left: var(--bym-content-left) !important;
  bottom: 10px !important;
  z-index: 74;
  width: var(--bym-content-width) !important;
  margin: 0 !important;
  padding: 8px 10px !important;
  border: 1px solid #e4e9f2 !important;
  border-radius: 14px !important;
  background: #fff !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 18px 44px -40px rgba(15, 23, 42, .55);
  box-sizing: border-box;
}
/* 输入框与「快捷回复」按钮同一行、同一高度 */
body.bym-on #quick_post {
  display: flex !important;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 8px;
}
body.bym-on .a-comment-txt {
  order: 1;
  flex: 1 1 0;
  width: auto !important;
  min-width: 0;
  margin-right: 0 !important;
}
body.bym-on .a-comment-btn {
  order: 2;
  float: none !important;
  display: flex !important;
  align-items: flex-end;
  flex: 0 0 auto;
  gap: 6px;
}
body.bym-on .a-comment-txt textarea {
  display: block;
  width: 100% !important;
  height: auto !important;
  min-height: 38px !important;
  max-height: 112px !important;
  padding: 8px 12px !important;
  border: 1px solid #dbe2ee !important;
  border-radius: 10px !important;
  background: #fbfcff !important;
  color: #1f2937 !important;
  font-size: 13.5px !important;
  line-height: 1.4 !important;
  box-sizing: border-box;
  overflow-y: hidden !important;
  resize: none;
}
body.bym-on .a-comment-txt textarea:focus {
  outline: 2px solid #c7daf7 !important;
  border-color: #7aa7e8 !important;
  background: #fff !important;
}
body.bym-on .a-comment-btn .button {
  width: 88px !important;
  height: 38px !important;
  min-height: 38px !important;
  align-self: center;
  border: 0 !important;
  border-radius: 10px !important;
  background: #2f6fd0 !important;
  color: #fff !important;
  font-size: 13px !important;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease;
}
body.bym-on .a-comment-btn .button:hover { background: #2159b0 !important; }

/* 表情面板默认收起，点「😊」后在输入框上方浮出，保留原有表情功能 */
#bym-emoji-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid #dbe2ee;
  border-radius: 10px;
  background: #f4f7fc;
  color: #475569;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
body.bym-on #bym-emoji-toggle { display: inline-flex; }
#bym-emoji-toggle:hover { background: #e8eef9; }
#bym-emoji-toggle[aria-expanded="true"] {
  background: #2f6fd0;
  border-color: #2f6fd0;
}

body.bym-on #em_img { display: none !important; }
body.bym-on .a-comment.bym-emoji-open #em_img {
  display: block !important;
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  bottom: calc(100% + 8px) !important;
  max-height: 230px;
  margin: 0 !important;
  padding: 10px 12px !important;
  /* 面板本身不滚动，滚动条只交给下面的表情框 */
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  background: #fff !important;
  border: 1px solid #e4e9f2 !important;
  border-radius: 12px !important;
  box-shadow: 0 18px 44px -22px rgba(15, 23, 42, .45) !important;
  box-sizing: border-box;
  z-index: 76;
}
/* 具体表情：唯一可滚动的区域 */
body.bym-on #em_img .ubb-img {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0 !important;
  padding: 0 2px 0 0 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
}
/* 四个分类按钮固定在表情框下方，靠右，不随表情滚动 */
body.bym-on .ubb-img-tab {
  flex: 0 0 auto;
  display: flex !important;
  justify-content: flex-end;
  width: 100% !important;
  gap: 6px;
  margin: 8px 0 0 !important;
  padding: 0 !important;
  overflow: visible !important;
}
body.bym-on .ubb-img-tab li {
  padding: 3px 10px !important;
  border: 0 !important;
  border-radius: 7px !important;
  background: #eef2f7 !important;
  color: #475569 !important;
  font-size: 12px !important;
  cursor: pointer;
}
body.bym-on .ubb-img-tab li div { color: inherit !important; }
body.bym-on .ubb-img-tab li[_cur="1"] {
  background: #2f6fd0 !important;
  color: #fff !important;
}
body.bym-on .ubb-img-tab li[_cur="1"] div { color: #fff !important; }

/* ---------- 页脚 ---------- */
:where(html).bym-enabled body #bot_foot {
  box-sizing: border-box;
  margin-block: 36px 40px !important;
  padding: 0 16px !important;
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: auto !important;
  border: 0 !important;
  background: transparent !important;
  opacity: .7;
}
:where(html).bym-enabled body #bot_logo img { height: 26px !important; width: auto !important; }
:where(html).bym-enabled body #bot_info {
  font-size: 11px !important;
  line-height: 1.7;
  color: #94a3b8 !important;
}

/* ---------- 窄屏适配 ---------- */
@media (max-width: 1099px) {
  body.bym-on #top_menu { display: block !important; margin-left: auto !important; }
  body.bym-on #top_menu ul {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px 12px !important;
  }
  body.bym-on #top_menu a { font-size: 11px !important; }
  body.bym-on #top_head { min-height: 52px; padding: 8px 12px 0 !important; }
  body.bym-on #main { margin-top: 4px !important; }
  body.bym-on #notice { padding: 4px 2px 8px !important; }
  body.bym-on #body > .t-pre,
  body.bym-on #body > .t-pre-bottom { padding: 6px 8px !important; gap: 6px; }
  body.bym-on .t-btn a { padding: 4px 9px !important; font-size: 12px !important; }
  body.bym-on #body > .b-head { font-size: 17px !important; padding: 13px 16px !important; }
  body.bym-on.bym-menu-open #menu {
    top: 60px !important;
    left: 10px !important;
    bottom: 52px !important;
    width: 240px !important;
    max-width: calc(100vw - 20px) !important;
  }

  /* 头像列不再隐藏，改为卡片顶部的一条横向用户信息条 */
  body.bym-on .a-body { flex-direction: column; }
  body.bym-on .a-body .a-left {
    display: flex !important;
    flex: 0 0 auto;
    align-items: center;
    flex-wrap: wrap;
    width: 100% !important;
    gap: 4px 10px;
    padding: 10px 12px !important;
    border-right: 0 !important;
    border-bottom: 1px solid #f1f5f9 !important;
    text-align: left;
  }
  body.bym-on .a-body .a-left .a-u-img { flex: 0 0 auto; margin: 0 !important; }
  body.bym-on .a-body .a-left .a-u-img img {
    width: 48px !important;
    height: 48px !important;
    margin: 0 !important;
    padding: 2px !important;
    border-radius: 9px !important;
  }
  body.bym-on .a-wrap.bym-anon .a-body .a-left {
    flex: 0 0 auto;
    width: 100% !important;
  }
  body.bym-on .a-wrap.bym-anon .a-body .a-left img {
    width: 48px !important;
    height: 48px !important;
  }
  body.bym-on .a-body .a-left .a-u-uid {
    flex: 0 0 auto;
    margin: 0 !important;
    text-align: left;
  }
  body.bym-on .a-body .a-left .a-u-info {
    flex: 0 1 auto;
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  body.bym-on .a-body .a-left .a-func-info {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    width: auto !important;
    margin: 0 0 0 auto !important;
    padding: 0 !important;
    border-top: 0 !important;
    gap: 6px !important;
  }
  body.bym-on .a-body .a-left .a-func-info li {
    flex: 0 0 auto;
    width: auto !important;
    padding: 4px 7px !important;
  }
  body.bym-on .a-body .a-left .a-func-info li.bym-action-friend {
    flex-grow: 0;
    padding-left: 9px !important;
    padding-right: 9px !important;
  }
  body.bym-on .a-body .a-left .a-func-info li a {
    width: auto !important;
    padding: 0 !important;
  }

  body.bym-on .a-head td { padding: 8px 12px !important; }
  body.bym-on .a-func { gap: 2px 10px !important; }
  body.bym-on .a-content { padding: 14px 16px 16px !important; }
  body.bym-on .a-nice-comment { margin: 0 8px 8px !important; }
  body.bym-on .a-nice-comment-item { padding: 10px !important; gap: 12px; }
  body.bym-on .a-nice-comment-face {
    flex-basis: 48px !important;
    width: 48px !important;
    height: 48px !important;
  }
  body.bym-on .a-nice-comment-face img {
    width: 48px !important;
    height: 48px !important;
    padding: 2px !important;
    border-radius: 9px !important;
  }
  body.bym-on .a-nice-comment-content { font-size: 13.5px !important; }
  /* 窄屏头像列已变成顶部横条，底部状态恢复通栏 */
  body.bym-on .a-wrap.bym-actions-moved .a-bottom > td:last-child,
  body.bym-on .a-wrap.bym-actions-empty .a-bottom > td:last-child,
  body.bym-on .a-wrap.bym-anon .a-bottom > td:last-child {
    padding-left: 16px !important;
  }
  body.bym-on .a-comment { padding: 8px 10px !important; }
}

@media (max-width: 560px) {
  body.bym-on .a-comment-btn { width: auto !important; }
  body.bym-on .a-comment-btn .button {
    width: 78px !important;
    height: 38px !important;
    min-height: 38px !important;
    font-size: 12.5px !important;
  }
  #bym-emoji-toggle { width: 36px; height: 38px; flex: 0 0 36px; }
  body.bym-on .a-body .a-left .a-func-info {
    width: 100% !important;
    margin-left: 0 !important;
  }
  body.bym-on .a-body .a-left .a-func-info li,
  body.bym-on .a-body .a-left .a-func-info li.bym-action-friend { flex: 1 1 auto; min-width: min-content; }
}

/* ---------- 左下角控制条：简约版 / 主题 ---------- */
#bym-dock {
  position: fixed;
  left: var(--bym-content-left, 14px);
  bottom: 14px;
  z-index: 2147483000;
  display: none;
  align-items: center;
  gap: 6px;
  max-width: var(--bym-content-width, calc(100vw - 28px));
  flex-wrap: wrap;
}
body.bym-supported #bym-dock { display: flex; }
#bym-pager[hidden] { display: none !important; }
#bym-dock button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid #dbe2ee;
  border-radius: 999px;
  background: rgba(255, 255, 255, .92);
  color: #475569;
  font: 12px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  cursor: pointer;
  box-shadow: 0 6px 20px -10px rgba(15, 23, 42, .5);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  opacity: .6;
  transition: opacity .15s ease, transform .15s ease;
}
#bym-dock button:hover { opacity: 1; transform: translateY(-1px); }
#bym-pager.bym-paused { color: #94a3b8; }
.bym-page-divider { text-align: center; color: #718096; }
body.bym-on .bym-page-divider { margin: 22px 0; padding: 10px; border-top: 1px solid #e4e9f2; }
body.bym-is-board.bym-browse-on .board-list tr.bym-page-divider td {
  padding: 10px 12px !important;
  background: var(--bym-soft);
  text-align: center;
}
.bym-page-divider a { color: inherit; font-size: 12px; text-decoration: none; }
html.bym-dark body.bym-on .bym-page-divider { color: #94a3b8; border-color: #263041; }
@container bym-main (max-width: 48rem) {
  body.bym-is-board.bym-browse-on .board-list tbody tr.bym-page-divider { display: block; padding: 0; }
}
#bym-toggle.bym-off { color: #94a3b8; }
#bym-toggle .bym-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
}
#bym-toggle.bym-off .bym-dot { background: #cbd5e1; }
#bym-menu,
#bym-theme {
  padding: 6px 9px;
  font-size: 14px;
  line-height: 1;
}
/* 经典版下站点自己的菜单是可见的，不需要抽屉和主题按钮 */
body.bym-supported:not(.bym-active) #bym-menu,
body.bym-supported:not(.bym-active) #bym-theme {
  display: none;
}
/* 抽屉打开时收起左下角控制条，避免盖住菜单底部；点遮罩或按 Esc 关闭 */
body.bym-supported.bym-menu-open #bym-dock {
  display: none;
}

/* ==================================================================
   0.4.0：浮动标题 / 路径栏 + 底部工具栏与快捷回复
   ================================================================== */
/* 读文章时，滚动超过标题后出现的浮动栏：向下滚显示标题，向上滚显示路径 */
#bym-floatbar {
  display: none;
  position: fixed;
  top: 8px;
  left: var(--bym-content-left);
  transform: translateY(-10px);
  width: var(--bym-content-width);
  height: 42px;
  z-index: 70;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  background: rgba(255, 255, 255, .94);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border: 1px solid #e4e9f2;
  border-radius: 12px;
  box-shadow: 0 10px 30px -22px rgba(15, 23, 42, .55);
  box-sizing: border-box;
  transition: opacity .18s ease, transform .18s ease;
}
body.bym-on #bym-floatbar { display: block; }
#bym-floatbar.bym-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.bym-float-row {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  box-sizing: border-box;
  transition: transform .24s cubic-bezier(.2, .8, .2, 1), opacity .2s ease;
  will-change: transform;
}
.bym-float-title { transform: translateY(-110%); opacity: 0; cursor: pointer; }
.bym-float-path { transform: translateY(110%); opacity: 0; }
#bym-floatbar.bym-mode-title .bym-float-title { transform: translateY(0); opacity: 1; }
#bym-floatbar.bym-mode-path .bym-float-path { transform: translateY(0); opacity: 1; }
.bym-float-tag {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: #eef2f9;
  color: #64748b;
  font-size: 11px;
  line-height: 1.6;
}
.bym-float-title-text,
.bym-float-path-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.bym-float-title-text {
  color: #1f2937;
  font-size: 13.5px;
  font-weight: 600;
}
.bym-float-path-text {
  color: #64748b;
  font-size: 12px;
}
.bym-float-path-text #notice_nav,
.bym-float-path-text > div {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
#bym-floatbar a {
  color: #64748b !important;
  text-decoration: none !important;
}
#bym-floatbar a:hover { color: #2f6fd0 !important; }

/* 桌面端：底部工具栏吸底，快捷回复只占一行 */
@media (min-width: 1100px) {
  body.bym-on #body > .t-pre-bottom {
    position: fixed !important;
    left: var(--bym-content-left) !important;
    bottom: calc(var(--bym-composer-h, 54px) + 18px) !important;
    z-index: 72;
    width: var(--bym-content-width) !important;
    min-height: 40px;
    margin: 0 !important;
    padding: 5px 10px !important;
  }
  body.bym-on #bym-dock { bottom: calc(var(--bym-composer-h, 54px) + var(--bym-toolbar-h, 40px) + 30px); }
}

/* 底部浮层会遮住末尾内容，给页面和页脚留出空间 */
body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + 38px) !important; }
body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + 42px) !important; }
@media (min-width: 1100px) {
  body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + var(--bym-toolbar-h, 40px) + var(--bym-dock-h, 32px) + 38px) !important; }
  body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + var(--bym-toolbar-h, 40px) + var(--bym-dock-h, 32px) + 48px) !important; }
}
@media (max-width: 1099px) {
  body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + var(--bym-dock-h, 32px) + 38px) !important; }
  body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + 42px) !important; }
  body.bym-on #bym-dock { bottom: calc(var(--bym-composer-h, 54px) + 22px); }
  body.bym-on .a-comment { bottom: 8px !important; }
  #bym-floatbar {
    top: 6px;
    height: 38px;
  }
}

/* ==================================================================
   黑夜模式：跟随系统，或由左下角太阳/月亮按钮手动覆盖
   （支持的页面在等待内容期间也保持当前主题）
   ================================================================== */
html.bym-dark { background: #0d1117; color-scheme: dark; }

html.bym-dark.bym-enabled body { background: #0d1117 !important; color: #d7dee8; }
html.bym-dark.bym-enabled body #top_menu a { color: #94a3b8 !important; }
html.bym-dark.bym-enabled body #top_menu a:hover { color: #7fb0f5 !important; }
html.bym-dark.bym-enabled body #notice { color: #7d8a9c !important; }
html.bym-dark.bym-enabled body #notice a { color: #9aa7b8 !important; }
html.bym-dark.bym-enabled body #notice a:hover { color: #7fb0f5 !important; }

html.bym-dark.bym-enabled body #body > .t-pre,
html.bym-dark.bym-enabled body #body > .t-pre-bottom {
  background: rgba(22, 29, 39, .94) !important;
  border-color: #263041 !important;
  box-shadow: 0 8px 28px -22px rgba(0, 0, 0, .8);
}
html.bym-dark.bym-enabled body .page-main a {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark.bym-enabled body .page-select a {
  background: #2f6fd0 !important;
  color: #fff !important;
}
html.bym-dark.bym-enabled body .page-normal a:hover {
  background: #26364a !important;
  color: #cfe0ff !important;
}
html.bym-dark.bym-enabled body .pagination { color: #94a3b8 !important; }
html.bym-dark.bym-enabled body .input-text {
  background: #0f141c !important;
  border-color: #2a3444 !important;
  color: #d7dee8 !important;
}
html.bym-dark.bym-enabled body .button {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark.bym-enabled body .button:hover { background: #26364a !important; }
html.bym-dark.bym-enabled body #f_search label { color: #94a3b8 !important; }

html.bym-dark body.bym-on #body > .b-head {
  background: #161d27 !important;
  border-color: #263041 !important;
  color: #e6edf6 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 16px 40px -34px rgba(0, 0, 0, .9);
}
html.bym-dark body.bym-on #body > .b-head .n-right { color: #7d8a9c !important; }

html.bym-dark body.bym-on .a-wrap {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 18px 44px -40px rgba(0, 0, 0, .9);
}
html.bym-dark body.bym-on .a-wrap.kb {
  border-color: #2f6fd0 !important;
  box-shadow: 0 0 0 3px rgba(47, 111, 208, .22) !important;
}
html.bym-dark body.bym-on .a-head {
  background: #131a23 !important;
  border-bottom-color: #222c3a !important;
}
html.bym-dark body.bym-on .a-u-name,
html.bym-dark body.bym-on .a-u-name a { color: #a9c8fa !important; }
html.bym-dark body.bym-on .a-u-name a:hover { color: #dbe9ff !important; }
html.bym-dark body.bym-on .a-func li a { color: #94a3b8 !important; }
html.bym-dark body.bym-on .a-func li a:hover { color: #7fb0f5 !important; }
html.bym-dark body.bym-on .a-body .a-left {
  background: #131a23 !important;
  border-right-color: #222c3a !important;
}
html.bym-dark body.bym-on .a-body .a-left img {
  background: #0f141c !important;
  border-color: #2a3444 !important;
  box-shadow: none;
}
html.bym-dark body.bym-on .a-body .a-left .a-u-uid { color: #d7e1ef !important; }
html.bym-dark body.bym-on .a-body .a-left .a-u-info dt { color: #6f7d90 !important; }
html.bym-dark body.bym-on .a-body .a-left .a-u-info dd { color: #aab6c6 !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info { border-top-color: #222c3a !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info li { background: #1e2836 !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info li:hover { background: #26364a !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info li a { color: #aab6c6 !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info li:hover a { color: #cfe0ff !important; }
html.bym-dark body.bym-on .a-content { color: #d7dee8 !important; }
html.bym-dark body.bym-on .bym-meta {
  color: #7d8a9c;
  border-bottom-color: #222c3a;
}
html.bym-dark body.bym-on .a-content-wrap a { color: #79aef8 !important; }
html.bym-dark body.bym-on .a-content-wrap blockquote {
  border-left-color: #2a3444 !important;
  background: #131a23 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .a-content2 .a-background {
  background: #131a23 !important;
  border-color: #2a3444 !important;
}
html.bym-dark body.bym-on .a-content2 .a-background p { color: #94a3b8 !important; }
html.bym-dark body.bym-on .a-content2 .a-func-dispCai {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .a-bottom td {
  background: #131a23 !important;
  border-top-color: #222c3a !important;
}
html.bym-dark body.bym-on .a-status a { color: #94a3b8 !important; }
html.bym-dark body.bym-on .a-status a:hover { color: #7fb0f5 !important; }
html.bym-dark body.bym-on .a-back { color: #6f7d90 !important; }

html.bym-dark body.bym-on #nice_view {
  background: linear-gradient(180deg, #1a1710 0%, #17140e 100%) !important;
  border-color: #3a2e1c !important;
}
html.bym-dark body.bym-on .a-nice-comment-divline h3 { color: #e0a458 !important; }
html.bym-dark body.bym-on .a-nice-comment-divline h5 a { color: #c08a4a !important; }
html.bym-dark body.bym-on .a-nice-comment-item + .a-nice-comment-item {
  border-top-color: #33291a !important;
}
html.bym-dark body.bym-on .a-nice-comment-face {
  border: 0 !important;
  background: transparent !important;
}
html.bym-dark body.bym-on .a-nice-comment-face img {
  background: #0f141c !important;
  border-color: #2a3444 !important;
  box-shadow: none;
}
/* 精彩回复的用户名带内联红色，深色背景下单独提亮成浅暖色 */
html.bym-dark body.bym-on .a-nice-comment-id a,
html.bym-dark body.bym-on .a-nice-comment-id strong { color: #f3c88f !important; }
html.bym-dark body.bym-on .a-nice-comment-content { color: #ddd5c8 !important; }
html.bym-dark body.bym-on .a-nice-comment-func a { color: #b9a07c !important; }
html.bym-dark body.bym-on .a-nice-comment-func a:hover { color: #e0a458 !important; }
html.bym-dark body.bym-on .a-nice-comment-floor { color: #7d7264 !important; }

html.bym-dark body.bym-on .a-comment {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 18px 44px -40px rgba(0, 0, 0, .9);
}
html.bym-dark body.bym-on .a-comment-txt textarea {
  background: #0f141c !important;
  border-color: #2a3444 !important;
  color: #d7dee8 !important;
}
html.bym-dark body.bym-on .a-comment-txt textarea:focus {
  background: #131a23 !important;
  border-color: #4d7fc4 !important;
  outline-color: #26364a !important;
}
html.bym-dark body.bym-on .ubb-img-tab li {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .ubb-img-tab li[_cur="1"] {
  background: #2f6fd0 !important;
  color: #fff !important;
}

html.bym-dark.bym-enabled body #bot_info { color: #6f7d90 !important; }

/* 站点正文里的深色字体：在黑夜模式下提亮 */
html.bym-dark body.bym-on .a-content-wrap .f007 { color: #c7d2e0 !important; }
html.bym-dark body.bym-on .a-content-wrap .f008 { color: #8b98aa !important; }
html.bym-dark body.bym-on .a-content-wrap .f015 { color: #e6edf6 !important; }
html.bym-dark body.bym-on .a-content-wrap .f012 { color: #7fb0f5 !important; }
html.bym-dark body.bym-on .a-content-wrap .f002 { color: #42d66b !important; }
html.bym-dark body.bym-on .a-content-wrap .f010 { color: #35c759 !important; }
html.bym-dark body.bym-on .a-content-wrap .bym-source,
html.bym-dark body.bym-on .a-content-wrap .bym-source a {
  color: #6f7d90 !important;
}

html.bym-dark #bym-dock button {
  background: rgba(22, 29, 39, .94);
  border-color: #2b3648;
  color: #c7d2e0;
}
html.bym-dark.bym-enabled body.bym-menu-open #menu {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 24px 70px -20px rgba(0, 0, 0, .9) !important;
}
html.bym-dark.bym-enabled body.bym-menu-open #menu #xlist,
html.bym-dark.bym-enabled body.bym-menu-open #menu #u_login {
  background: #131a23 !important;
  border-color: #222c3a !important;
}
html.bym-dark.bym-enabled body.bym-menu-open #menu a { color: #aab6c6 !important; }
html.bym-dark.bym-enabled body.bym-menu-open #menu a:hover { color: #7fb0f5 !important; }

html.bym-dark #bym-floatbar {
  background: rgba(22, 29, 39, .95);
  border-color: #263041;
  box-shadow: 0 10px 30px -22px rgba(0, 0, 0, .9);
}
html.bym-dark #bym-floatbar .bym-float-tag {
  background: #1e2836;
  color: #94a3b8;
}
html.bym-dark #bym-floatbar .bym-float-title-text { color: #e6edf6; }
html.bym-dark #bym-floatbar .bym-float-path-text { color: #94a3b8; }
html.bym-dark #bym-floatbar a { color: #aab6c6 !important; }
html.bym-dark #bym-floatbar a:hover { color: #7fb0f5 !important; }

#bym-emoji-toggle { background: #f4f7fc; color: #475569; border-color: #dbe2ee; }
html.bym-dark body.bym-on #bym-emoji-toggle {
  background: #1e2836;
  border-color: #2a3444;
  color: #c7d2e0;
}
html.bym-dark body.bym-on #bym-emoji-toggle:hover { background: #26364a; }
html.bym-dark body.bym-on .a-comment.bym-emoji-open #em_img {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 18px 44px -22px rgba(0, 0, 0, .9) !important;
}
`;

  // 浏览页独立作用域：楼层、快捷回复和详情页浮动工具条仍只使用 .bym-on。
  const BROWSE_CSS = String.raw`
body.bym-browse-on {
  --bym-surface: #fff;
  --bym-soft: #f7f9fc;
  --bym-border: #e4e9f2;
  --bym-text: #243247;
  --bym-muted: #718096;
  --bym-link: #2f6fd0;
  --bym-tint: #edf4ff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.65;
}
html.bym-dark body.bym-browse-on {
  --bym-surface: #161d27;
  --bym-soft: #131a23;
  --bym-border: #263041;
  --bym-text: #d7dee8;
  --bym-muted: #94a3b8;
  --bym-link: #8bb7fa;
  --bym-tint: #1c2b42;
}
#bym-browse-header { display: none; }
body.bym-browse-on #bym-browse-header { display: block; margin: 10px 0 24px; }
body.bym-browse-on #bym-page-title {
  margin: 0 0 16px;
  color: var(--bym-text);
  font-size: 28px;
  line-height: 1.35;
  font-weight: 700;
  letter-spacing: -.5px;
}
body.bym-browse-on #bym-browse-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--bym-border);
}
body.bym-browse-on #bym-browse-nav a {
  padding: 6px 12px;
  border-radius: 8px;
  color: var(--bym-muted);
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
}
body.bym-browse-on #bym-browse-nav a:hover { background: var(--bym-surface); color: var(--bym-link); }
body.bym-browse-on #bym-browse-nav a[aria-current] { background: var(--bym-tint); color: var(--bym-link); font-weight: 600; }
body.bym-browse-on #body { width: 100% !important; overflow: visible !important; }
body.bym-browse-on #body > .b-content {
  padding: 0 !important;
  border: 0 !important;
  border-radius: 14px;
  background: transparent !important;
  overflow: visible !important;
}
body.bym-browse-on #body > .b-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
  height: auto !important;
  padding: 10px 4px !important;
  margin: 0 0 12px;
  border: 0 !important;
  background: transparent !important;
  color: var(--bym-muted) !important;
  font-size: 12px;
  line-height: 1.6;
}
body.bym-browse-on #body > .b-head .n-left { order: 0; }
body.bym-browse-on #body > .b-head .n-right { order: 1; float: none; margin-left: auto; }
body.bym-browse-on #body > .b-head a { color: var(--bym-link) !important; }
body.bym-browse-on #body > .b-head .n-left > span { margin-left: 4px; }
body.bym-browse-on .title-img { width: auto; max-width: 20px; max-height: 18px; vertical-align: middle; }
body.bym-browse-on #body > .t-pre,
body.bym-browse-on #body > .t-pre-bottom { background: var(--bym-surface) !important; border-color: var(--bym-border) !important; }
body.bym-browse-on #body > .t-pre { gap: 12px; padding: 12px !important; }
body.bym-browse-on #body > .t-pre .t-btn { order: 0; margin-left: 0; }
body.bym-browse-on .bmode { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; order: 1; float: none; margin-left: auto; color: var(--bym-muted); font-size: 12px; }
body.bym-browse-on .bmode > * { margin: 0 !important; }
body.bym-browse-on .bmode a,
body.bym-browse-on .w-tab-title li {
  padding: 5px 9px !important;
  border: 0 !important;
  border-radius: 6px;
  background: var(--bym-soft) !important;
  color: var(--bym-muted) !important;
  font-size: 12px;
  line-height: 1.5;
}
body.bym-browse-on .bmode a.tab-down,
body.bym-browse-on .w-tab-title li.tab-down { background: var(--bym-tint) !important; color: var(--bym-link) !important; font-weight: 600; }
body.bym-browse-on #body .t-btn a:not(.b-post) { background: var(--bym-soft) !important; color: var(--bym-link) !important; }
body.bym-browse-on #body .t-btn a.b-post { background: #2f6fd0 !important; color: #fff !important; }
body.bym-browse-on #board_search { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; max-width: 100%; font-size: 12px; }
body.bym-browse-on #board_search label { margin: 0 4px 0 -3px; color: var(--bym-muted); white-space: nowrap; }
body.bym-browse-on #board_search .input-text { flex: 1 1 10em; min-width: 0; width: 12em; max-width: 100%; box-sizing: border-box; }
body.bym-browse-on #board_search input[type="checkbox"] { accent-color: var(--bym-link); }
body.bym-browse-on .pagination { flex-wrap: wrap; row-gap: 8px; }
body.bym-browse-on .page-main { flex-wrap: wrap; }
body.bym-browse-on #body > .t-pre-bottom { align-items: flex-start !important; padding: 14px !important; gap: 14px; }
body.bym-browse-on #body > .t-pre-bottom .page { order: 0; width: 100%; margin-left: 0 !important; }
body.bym-browse-on #body > .t-pre-bottom .t-btn { order: 1; width: 100%; }
body.bym-browse-on #bym-dock { bottom: 18px; }
body.bym-browse-on #bot_foot { margin-bottom: 72px !important; }
body.bym-browse-on :is(a, button, input):focus-visible { outline: 2px solid var(--bym-link) !important; outline-offset: 3px; }

/* 首页保留原来的三个栏目和 widget 节点，折叠、标签、拖动仍由原站处理。 */
body.bym-is-home.bym-browse-on #notice {
  margin-bottom: 18px;
  padding: 10px 14px !important;
  border: 1px solid var(--bym-border) !important;
  border-radius: 10px;
  background: var(--bym-surface) !important;
}
body.bym-browse-on #columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: 18px; padding: 0; }
body.bym-browse-on #columns .column { float: none; width: auto !important; min-width: 0; }
body.bym-browse-on #column2 { order: -1; }
body.bym-browse-on #columns .widget {
  margin: 0 0 18px !important;
  border: 1px solid var(--bym-border);
  border-radius: 14px;
  background: var(--bym-surface);
  box-shadow: 0 3px 16px -12px rgba(15, 23, 42, .18);
}
body.bym-browse-on .widget-head {
  height: auto;
  min-height: 24px;
  padding: 16px 16px 10px;
  border: 0 !important;
  border-radius: 14px 14px 0 0;
  background: var(--bym-surface) !important;
  overflow: visible;
}
body.bym-browse-on .widget .widget-title { padding: 0; font-size: 15px; }
body.bym-browse-on .widget .widget-title,
body.bym-browse-on .widget .widget-title a { color: var(--bym-text) !important; }
body.bym-browse-on .widget-op { font-size: 12px; }
body.bym-browse-on .widget-content {
  padding: 2px 16px 14px;
  border: 0 !important;
  border-radius: 0 0 14px 14px;
  background: var(--bym-surface) !important;
  color: var(--bym-muted);
  font-size: 13px;
}
body.bym-browse-on .widget-content a { color: var(--bym-text); }
body.bym-browse-on .widget-content a:hover { color: var(--bym-link) !important; background: transparent; }
body.bym-browse-on .w-list-line li {
  box-sizing: border-box;
  height: auto;
  min-height: 34px;
  padding: 9px 0;
  border-bottom: 1px solid var(--bym-border);
  line-height: 1.65;
  white-space: normal;
  overflow-wrap: anywhere;
}
body.bym-browse-on .w-list-line li:last-child { border-bottom: 0; }
body.bym-browse-on .w-list-float { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
body.bym-browse-on .w-list-float li { float: none; width: auto; height: auto; line-height: 1.6; padding: 5px 0; overflow-wrap: anywhere; }
body.bym-browse-on .w-tab-title { height: auto; padding: 0 0 10px; overflow: hidden; }
body.bym-browse-on .w-tab-title li { cursor: pointer; }
body.bym-browse-on .w-tab-content { padding: 0; border-color: var(--bym-border); }
body.bym-browse-on .edit-box { background: var(--bym-soft); border-color: var(--bym-border); }
body.bym-browse-on .edit-box label { color: var(--bym-muted); }
body.bym-browse-on #topten .w-list-line { counter-reset: bym-hot; }
body.bym-browse-on #topten .w-list-line li { counter-increment: bym-hot; display: flex; align-items: baseline; gap: 10px; }
body.bym-browse-on #topten .w-list-line li::before { content: counter(bym-hot, decimal-leading-zero); flex: 0 0 20px; color: var(--bym-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
body.bym-browse-on #topten .w-list-line li:nth-child(-n+3)::before { color: var(--bym-link); font-weight: 700; }
body.bym-browse-on #topten .w-list-line li > a { min-width: 0; }
body.bym-browse-on #topposts .item { padding: 12px 0; border-bottom: 1px solid var(--bym-border); }
body.bym-browse-on #topposts .wrapper { max-height: 420px; margin: 0; padding: 0; border: 0; }
body.bym-browse-on #topposts .wrapper .content { border-color: var(--bym-border); }
body.bym-browse-on #topposts .left { width: 40px; vertical-align: top; }
body.bym-browse-on #topposts .left img { width: 32px; height: 32px; object-fit: contain; border-radius: 8px; }
body.bym-browse-on #topposts .right { padding-left: 6px; }
body.bym-browse-on #topposts .name a { color: var(--bym-link); }
body.bym-browse-on #topposts .content { padding: 6px 0; color: var(--bym-text); line-height: 1.7; overflow-wrap: anywhere; }
body.bym-browse-on #topposts .info,
body.bym-browse-on #topposts .hint { color: var(--bym-muted); font-size: 11px; }
body.bym-browse-on #picshow .widget-content { padding: 4px 12px 14px; }
body.bym-browse-on #picshow img { max-width: 100%; object-fit: contain; }
body.bym-browse-on #picshow .widget-content > div { max-width: 100%; }
body.bym-browse-on .widget.kb,
body.bym-browse-on .widget-placeholder { border: 2px solid var(--bym-link) !important; }
body.bym-browse-on .w-list-line li.kb,
body.bym-browse-on .w-list-float li.kb { background: var(--bym-tint); }

/* 版面目录：原表格节点直接排成卡片，保留版主、最新主题及全部统计。 */
body.bym-is-section.bym-browse-on #body > .b-head { display: none; }
body.bym-browse-on .board-list { color: var(--bym-muted); }
body.bym-is-section.bym-browse-on .board-list { display: block; }
body.bym-is-section.bym-browse-on .board-list thead { display: none; }
body.bym-is-section.bym-browse-on .board-list tbody { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 16px; }
body.bym-is-section.bym-browse-on .board-list tbody tr {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-content: start;
  padding: 18px 20px;
  border: 1px solid var(--bym-border);
  border-radius: 14px;
  background: var(--bym-surface);
}
body.bym-is-section.bym-browse-on .board-list td {
  display: block;
  width: auto !important;
  padding: 0 !important;
  border: 0;
  background: transparent !important;
  color: var(--bym-muted) !important;
  font-size: 12px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
body.bym-is-section.bym-browse-on .board-list :is(.title_1, .title_2, .title_3) { grid-column: 1 / -1; }
body.bym-is-section.bym-browse-on .board-list .title_1 > a { color: var(--bym-text); font-size: 17px; font-weight: 650; }
body.bym-is-section.bym-browse-on .board-list .title_2 { margin-top: 8px; }
body.bym-is-section.bym-browse-on .board-list .title_2 br { display: none; }
body.bym-is-section.bym-browse-on .board-list .title_2 a { color: var(--bym-muted); margin-right: 6px; }
body.bym-is-section.bym-browse-on .board-list .title_3 { margin: 12px 0; padding-top: 12px !important; border-top: 1px solid var(--bym-border); }
body.bym-is-section.bym-browse-on .board-list .title_3 > a { color: var(--bym-text); font-size: 13px; }
body.bym-is-section.bym-browse-on .board-list [data-bym-label] { text-align: left; font-variant-numeric: tabular-nums; }
body.bym-is-section.bym-browse-on .board-list [data-bym-label]::before { content: attr(data-bym-label); margin-right: 6px; color: var(--bym-muted); font-size: 11px; }
body.bym-is-section.bym-browse-on .board-list .bym-directory :is(.title_3, .title_4, .title_5, .title_6, .title_7) { display: none; }
body.bym-is-section.bym-browse-on .board-list .bym-directory { border-style: dashed; }
body.bym-browse-on .board-list a:hover { color: var(--bym-link) !important; }

/* 帖子列表：标题优先，状态、作者、回复及最后回复链接保留在原节点上。 */
body.bym-is-board.bym-browse-on .board-list { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border: 1px solid var(--bym-border); border-radius: 14px; overflow: hidden; background: var(--bym-surface); }
body.bym-is-board.bym-browse-on .board-list thead tr { border: 0; }
body.bym-is-board.bym-browse-on .board-list th { padding: 12px 8px; background: var(--bym-soft); color: var(--bym-muted); border-bottom: 1px solid var(--bym-border); font-size: 11px; }
body.bym-is-board.bym-browse-on .board-list td { padding: 16px 8px !important; border-bottom: 1px solid var(--bym-border); background: transparent; color: var(--bym-muted); font-size: 12px; line-height: 1.6; }
body.bym-is-board.bym-browse-on .board-list tr:last-child td { border-bottom: 0; }
body.bym-is-board.bym-browse-on .board-list tr:hover td,
body.bym-is-board.bym-browse-on .board-list tr.kb td { background: var(--bym-soft) !important; }
body.bym-is-board.bym-browse-on .board-list .title_8 { width: 30px; padding-left: 14px !important; }
body.bym-is-board.bym-browse-on .board-list .title_9 { width: auto; overflow-wrap: anywhere; }
body.bym-is-board.bym-browse-on .board-list td.title_9 { font-size: 14px; }
body.bym-is-board.bym-browse-on .board-list td.title_9 > a { color: var(--bym-text); }
body.bym-is-board.bym-browse-on .board-list .title_10 { width: 84px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
body.bym-is-board.bym-browse-on .board-list .title_11 { width: 42px; text-align: center; }
body.bym-is-board.bym-browse-on .board-list .title_12 { width: 84px; overflow-wrap: anywhere; }
body.bym-is-board.bym-browse-on .board-list :is(.title_10, .title_12) a { color: var(--bym-muted); }
body.bym-is-board.bym-browse-on .board-list .title_11 { color: var(--bym-link); }
body.bym-is-board.bym-browse-on .board-list tr.top td { background: var(--bym-tint); }
body.bym-is-board.bym-browse-on .board-list tr.top td.title_9 > a:first-child::before { content: "置顶"; display: inline-block; margin-right: 8px; padding: 1px 5px; border-radius: 4px; background: var(--bym-surface); color: var(--bym-link); font-size: 10px; vertical-align: 1px; }

@container bym-main (min-width: 38rem) and (max-width: 57rem) {
  body.bym-browse-on #column3 { grid-column: 1 / -1; }
}
@media (max-width: 700px) {
  body.bym-browse-on #top_head { padding: 8px 12px 0 !important; min-height: 52px; gap: 8px; }
  body.bym-browse-on #top_logo img { height: 28px !important; }
  body.bym-browse-on #top_menu ul { flex-wrap: wrap; justify-content: flex-end; gap: 4px 10px; }
  body.bym-browse-on #top_menu a { font-size: 10px !important; }
  body.bym-browse-on #bym-page-title { font-size: 24px; }
  body.bym-browse-on #bym-browse-nav { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 12px; }
  body.bym-browse-on #bym-browse-nav a { padding: 5px 9px; }
  body.bym-browse-on .bmode { margin-left: 0; }
  body.bym-browse-on #body > .t-pre .t-btn { margin-left: 0; }
  body.bym-browse-on .pagination { gap: 6px; }
  body.bym-browse-on .page-main a { padding: 4px 8px !important; }
  body.bym-browse-on #board_search .input-text { width: 10em; }
}
/* 按正文的实际宽度切换列表，侧栏、窗口缩放都会参与计算。 */
@container bym-main (max-width: 48rem) {
  body.bym-is-board.bym-browse-on .board-list,
  body.bym-is-board.bym-browse-on .board-list tbody { display: block; }
  body.bym-is-board.bym-browse-on .board-list thead { display: none; }
  body.bym-is-board.bym-browse-on .board-list tbody tr { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 5px 12px; padding: 16px 14px 16px 40px; border-bottom: 1px solid var(--bym-border); }
  body.bym-is-board.bym-browse-on .board-list tbody tr:last-child { border-bottom: 0; }
  body.bym-is-board.bym-browse-on .board-list td { display: block; min-width: 0; width: auto !important; padding: 0 !important; border: 0; background: transparent !important; font-size: 11px; overflow-wrap: anywhere; }
  body.bym-is-board.bym-browse-on .board-list tr.top { background: var(--bym-tint); }
  body.bym-is-board.bym-browse-on .board-list tr.kb { background: var(--bym-soft); }
  body.bym-is-board.bym-browse-on .board-list td.title_8 { position: absolute; left: 14px; top: 19px; padding: 0 !important; }
  body.bym-is-board.bym-browse-on .board-list td.title_9 { grid-column: 1 / -1; grid-row: 1; font-size: 14px; }
  body.bym-is-board.bym-browse-on .board-list tr.bym-no-replies .title_9 { grid-column: 1 / -1; }
  body.bym-is-board.bym-browse-on .board-list .title_11 { grid-column: 1 / -1; grid-row: 4; justify-self: start; padding: 2px 6px !important; border-radius: 6px; background: var(--bym-soft) !important; }
  body.bym-is-board.bym-browse-on .board-list .title_11::after { content: " 回复"; font-size: 10px; }
  body.bym-is-board.bym-browse-on .board-list .bym-created { grid-column: 1; grid-row: 2; }
  body.bym-is-board.bym-browse-on .board-list .bym-updated { grid-column: 2; grid-row: 2; text-align: right; }
  body.bym-is-board.bym-browse-on .board-list .bym-author { grid-column: 1; grid-row: 3; }
  body.bym-is-board.bym-browse-on .board-list .bym-last-author { grid-column: 2; grid-row: 3; text-align: right; }
  body.bym-is-board.bym-browse-on .board-list .title_10::before { content: attr(data-bym-label) " "; color: var(--bym-muted); }
}
`;

  function injectStyle() {
    if (document.getElementById('bym-style')) return;
    const el = document.createElement('style');
    el.id = 'bym-style';
    el.dataset.version = '0.7.10';
    el.textContent = CSS + BROWSE_CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /* ------------------------------------------------------------------ *
   * 3. 左下角控制条：简约版 / 主题 / 版面菜单
   * ------------------------------------------------------------------ */
  let dock = null;
  let toggleBtn = null;
  let themeBtn = null;
  let menuBtn = null;
  let pagerButton = null;
  let overlay = null;

  function syncToggle() {
    if (!toggleBtn) return;
    toggleBtn.classList.toggle('bym-off', !state.enabled);
    const label = toggleBtn.querySelector('.bym-label');
    const text = state.enabled ? '简约版' : '经典版';
    if (label && label.textContent !== text) label.textContent = text;
    toggleBtn.title = '切换简约阅读布局（Alt+M）';
  }

  function syncTheme() {
    if (!themeBtn) return;
    const dark = effectiveDark();
    const icon = dark ? '☀️' : '🌙';
    if (themeBtn.textContent !== icon) themeBtn.textContent = icon;
    themeBtn.classList.toggle('bym-auto', state.theme === 'auto');
    themeBtn.title =
      (state.theme === 'auto' ? '当前跟随系统；' : '') +
      (dark ? '深色模式，点击切换为浅色' : '浅色模式，点击切换为深色') +
      '（Shift+点击恢复跟随系统）';
  }

  function applyTheme() {
    // 主题与公共外壳一起保留，不能在 AJAX 等待期间闪回白底。
    const modern = document.documentElement.classList.contains('bym-enabled');
    const dark = !!(modern && state.enabled && effectiveDark());
    document.documentElement.classList.toggle('bym-dark', dark);
    syncTheme();
  }

  function toggleTheme(e) {
    if (e && e.shiftKey) {
      state.theme = 'auto';
    } else {
      state.theme = effectiveDark() ? 'light' : 'dark';
    }
    saveTheme(state.theme);
    applyTheme();
  }

  function toggle() {
    state.enabled = !state.enabled;
    saveEnabled(state.enabled);
    applyRoute();
    syncToggle();
    if (state.enabled) {
      decoratePage();
      scheduleDecorate();
    } else {
      restoreUserActions();
      document.querySelectorAll('.a-comment.bym-emoji-open').forEach((el) => {
        el.classList.remove('bym-emoji-open');
      });
    }
  }

  function syncMenu() {
    if (!menuBtn || !document.body) return;
    menuBtn.setAttribute('aria-expanded', String(document.body.classList.contains('bym-menu-open')));
  }

  function toggleMenu() {
    if (!document.body) return;
    document.body.classList.toggle('bym-menu-open');
    syncMenu();
  }

  function closeMenu() {
    if (!document.body) return;
    document.body.classList.remove('bym-menu-open');
    syncMenu();
  }

  function mountDock() {
    if (dock || !document.body) return;

    dock = document.createElement('div');
    dock.id = 'bym-dock';

    menuBtn = document.createElement('button');
    menuBtn.id = 'bym-menu';
    menuBtn.type = 'button';
    menuBtn.title = '版面菜单（导航 / 登录 / 信箱）';
    menuBtn.setAttribute('aria-label', '版面菜单');
    menuBtn.textContent = '☰';
    menuBtn.addEventListener('click', toggleMenu);

    toggleBtn = document.createElement('button');
    toggleBtn.id = 'bym-toggle';
    toggleBtn.type = 'button';
    toggleBtn.innerHTML = '<span class="bym-dot"></span><span class="bym-label">简约版</span>';
    toggleBtn.addEventListener('click', toggle);

    themeBtn = document.createElement('button');
    themeBtn.id = 'bym-theme';
    themeBtn.type = 'button';
    themeBtn.setAttribute('aria-label', '切换深色 / 浅色模式');
    themeBtn.textContent = '🌙';
    // 普通点击：在深/浅之间切换；Shift+点击：恢复跟随系统
    themeBtn.addEventListener('click', toggleTheme);

    pagerButton = document.createElement('button');
    pagerButton.id = 'bym-pager';
    pagerButton.type = 'button';
    pagerButton.hidden = true;
    pagerButton.setAttribute('aria-pressed', 'true');
    pagerButton.addEventListener('click', toggleAutoPager);

    dock.append(menuBtn, toggleBtn, themeBtn, pagerButton);

    overlay = document.createElement('div');
    overlay.id = 'bym-overlay';
    overlay.addEventListener('click', closeMenu);

    document.body.append(dock, overlay);
    syncToggle();
    syncTheme();
    syncMenu();
    syncPagerButton();
  }

  function onKeydown(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && String(e.key).toLowerCase() === TOGGLE_KEY) {
      if (isArticlePage() || getBrowseRoute()) {
        e.preventDefault();
        toggle();
      }
    }
    if (e.key === 'Escape') closeMenu();
  }

  /* ------------------------------------------------------------------ *
   * 3.5 首页、分区目录与帖子列表增强
   * ------------------------------------------------------------------ */
  function decorateBrowse() {
    if (!document.body || !document.body.classList.contains('bym-browse-on')) return;
    const route = getBrowseRoute();
    if (!route) return;
    const main = document.querySelector('#main');
    const content = document.querySelector('#body');
    if (!main || !content) return;
    let header = document.getElementById('bym-browse-header');
    if (!header) {
      header = document.createElement('div');
      header.id = 'bym-browse-header';
      const title = document.createElement('h1');
      title.id = 'bym-page-title';
      const nav = document.createElement('nav');
      nav.id = 'bym-browse-nav';
      nav.setAttribute('aria-label', '论坛分区');
      header.append(title, nav);
      main.insertBefore(header, main.firstChild);
    }
    const breadcrumbs = Array.from(document.querySelectorAll('#notice_nav a[href]'));
    const current = breadcrumbs.find((a) => new URL(a.href, location.href).pathname.replace(/\/$/, '') === route.path);
    const title = header.querySelector('#bym-page-title');
    const label = route.kind === 'home' ? '北邮人论坛' : (current ? current.textContent.trim() : '版面浏览');
    if (title.textContent !== label) title.textContent = label;

    // 直接使用原站分区链接，保留站点的事件代理与 hash 导航。
    const sections = Array.from(document.querySelectorAll('#menu a[href^="/section/"]'))
      .filter((a) => /^\/section\/\d+$/.test(a.getAttribute('href')));
    const links = [{ href: '/default', label: '首页' }];
    sections.forEach((a) => {
      const href = a.getAttribute('href');
      if (!links.some((item) => item.href === href)) links.push({ href, label: a.textContent.trim() });
    });
    const nav = header.querySelector('#bym-browse-nav');
    const signature = JSON.stringify(links);
    if (nav.dataset.links !== signature) {
      nav.textContent = '';
      links.forEach((item) => {
        const a = document.createElement('a');
        a.href = item.href;
        a.textContent = item.label;
        nav.appendChild(a);
      });
      nav.dataset.links = signature;
    }
    const parentSection = breadcrumbs.find((a) => /^\/section\/\d+$/.test(new URL(a.href, location.href).pathname));
    const activePath = route.kind !== 'home' && parentSection
      ? new URL(parentSection.href, location.href).pathname : route.path;
    nav.querySelectorAll('a').forEach((a) => {
      if (a.getAttribute('href') === activePath) a.setAttribute('aria-current', route.path === activePath ? 'page' : 'location');
      else a.removeAttribute('aria-current');
    });

    document.querySelectorAll('#body .board-list tbody > tr').forEach((row) => {
      if (row.classList.contains('bym-page-divider')) return;
      if (route.kind === 'section') {
        const directory = row.querySelector('.title_1 a[href^="/section/"]');
        row.classList.toggle('bym-directory', !!directory);
        ['在线', '今日', '主题', '文章'].forEach((text, index) => {
          const cell = row.querySelector('.title_' + (index + 4));
          if (cell) cell.dataset.bymLabel = text;
        });
      } else if (route.kind === 'board') {
        row.classList.toggle('bym-no-replies', !row.querySelector('.title_11'));
        row.querySelectorAll('.title_10').forEach((cell, index) => {
          cell.classList.add(index === 0 ? 'bym-created' : 'bym-updated');
          cell.dataset.bymLabel = index === 0 ? '发布' : '更新';
        });
        row.querySelectorAll('.title_12').forEach((cell, index) => {
          cell.classList.add(index === 0 ? 'bym-author' : 'bym-last-author');
        });
      }
    });
  }

  function decoratePage() {
    decorateBrowse();
    decorateFloors();
    observeFloatingLayout();
  }

  /* ------------------------------------------------------------------ *
   * 3.6 轻量 DOM 增强：把「楼主 / 沙发」徽标移到作者名旁边
   * ------------------------------------------------------------------ */
  let decorateTimer = null;
  const movedActions = new Map(); // .a-func-info -> 原父节点
  const movedBadges = new Map();  // .a-pos -> 原父节点

  // 把正文开头的「发信人 / 标 题 / 发信站」三行收进一个弱化的 meta 区块
  function decorateMeta(wrap) {
    const content = wrap.querySelector('.a-content-wrap');
    if (!content) return;

    // 三行后面通常还跟着一个空 <br>，会撑出多余的行距，一并去掉
    function trimAfterMeta(meta) {
      let next = meta.nextSibling;
      while (next && next.nodeType === Node.TEXT_NODE && !next.nodeValue.trim()) {
        const after = next.nextSibling;
        next.remove();
        next = after;
      }
      if (next && next.nodeType === Node.ELEMENT_NODE && next.tagName === 'BR') {
        next.remove();
      }
    }

    const existing = content.querySelector(':scope > .bym-meta');
    if (existing) {
      trimAfterMeta(existing);
      return;
    }

    const first = content.firstChild;
    if (!first || first.nodeType !== Node.TEXT_NODE || !/^\s*发信人[:：]/.test(first.nodeValue)) {
      return;
    }

    const nodes = [];
    let brs = 0;
    for (const node of Array.from(content.childNodes)) {
      nodes.push(node);
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
        brs += 1;
        if (brs >= 3) break;
      }
    }
    if (brs < 3) return;

    try {
      const range = document.createRange();
      range.setStartBefore(nodes[0]);
      range.setEndAfter(nodes[nodes.length - 1]);
      const meta = document.createElement('div');
      meta.className = 'bym-meta';
      range.surroundContents(meta);
      trimAfterMeta(meta);
    } catch (e) {
      /* 结构异常时放弃，不影响正文 */
    }
  }

  // 「※ 修改 / ※ 来源」等落款行弱化显示（不改变链接和内容）
  function decorateSource(wrap) {
    wrap.querySelectorAll('.a-content-wrap font').forEach((font) => {
      if (font.classList.contains('bym-source')) return;
      const text = (font.textContent || '').trim();
      if (/^※\s*(?:修改|来源)/.test(text) || /^来源[:：]/.test(text)) {
        font.classList.add('bym-source');
      }
    });
  }

  // 查看 / 发信 / 加好友：从楼层底部移到左侧用户信息下方
  function decorateUserActions(wrap) {
    const left = wrap.querySelector('.a-body > .a-left');
    const info = wrap.querySelector(
      '.a-bottom .a-left .a-func-info, .a-body > .a-left .a-func-info'
    );
    if (!left || !info) return;
    if (!left.contains(info)) {
      if (!movedActions.has(info)) movedActions.set(info, info.parentNode);
      left.appendChild(info);
    } else if (!movedActions.has(info)) {
      // 兼容已经移动过的页面（例如旧版本保存下来的 DOM）
      const bottomLeft = wrap.querySelector('.a-bottom > .a-left');
      if (bottomLeft) movedActions.set(info, bottomLeft);
    }
    wrap.classList.add('bym-actions-moved');

    // 标记「查看 / 加好友」：查看按钮隐藏，改由头像点击触发；
    // 加好友稍微加宽
    info.querySelectorAll('li').forEach((li) => {
      const a = li.querySelector('a');
      if (!a) return;
      const text = (a.textContent || '').replace(/\s+/g, '');
      const href = a.getAttribute('href') || '';
      if (text === '查看' || href.includes('/user/query/')) li.classList.add('bym-action-view');
      if (text.includes('加好友')) li.classList.add('bym-action-friend');
    });

    // 头像本身包一层真实链接（和精彩回复头像一样），
    // 这样用户点的是普通 <a>，站点自己的 click_a 会打开用户资料对话框。
    // 不要用合成 click 去点隐藏的「查看」链接：线上它可能不经过站点的事件代理，
    // 结果变成整页跳转。
    const userLink = wrap.querySelector(
      '.a-func-info a[href*="/user/query/"], .a-head .a-u-name a[href*="/user/query/"]'
    );
    const face = wrap.querySelector('.a-body .a-u-img');
    if (userLink && face) {
      let anchor = face.querySelector(':scope > a.bym-avatar-link');
      if (!anchor) {
        anchor = document.createElement('a');
        anchor.className = 'bym-avatar-link';
        anchor.title = '查看用户资料';
        while (face.firstChild) anchor.appendChild(face.firstChild);
        face.appendChild(anchor);
      }
      if (anchor.getAttribute('href') !== userLink.href) anchor.href = userLink.href;
    }
  }

  // 切回经典版时把移动过的节点放回原处
  function restoreUserActions() {
    // 拆掉头像外面新增的链接，恢复站点原来的 div > img 结构
    document.querySelectorAll('.a-u-img > a.bym-avatar-link').forEach((a) => {
      const face = a.parentNode;
      if (!face) return;
      while (a.firstChild) face.insertBefore(a.firstChild, a);
      a.remove();
    });

    movedActions.forEach((parent, info) => {
      if (info.isConnected && parent && info.parentNode !== parent) parent.appendChild(info);
      const wrap = info.closest ? info.closest('.a-wrap') : null;
      if (wrap) wrap.classList.remove('bym-actions-moved');
    });
    movedActions.clear();

    movedBadges.forEach((parent, badge) => {
      if (badge.isConnected && parent && badge.parentNode !== parent) parent.appendChild(badge);
    });
    movedBadges.clear();
  }

  function decorateFloors() {
    if (!state.enabled || !isArticlePage() || !hasArticleContent()) return;
    document.querySelectorAll('#body .a-wrap').forEach((wrap) => {
      const author = wrap.querySelector('.a-head .a-left');
      const badge = wrap.querySelector('.a-head .a-pos');
      if (author && badge && !author.contains(badge)) {
        if (!movedBadges.has(badge)) movedBadges.set(badge, badge.parentNode);
        author.appendChild(badge);
      }
      decorateMeta(wrap);
      decorateSource(wrap);
      decorateUserActions(wrap);

      // 底部左侧单元格为空（匿名帖 / 按钮已移走）时不再占位
      const bottomLeft = wrap.querySelector('.a-bottom > .a-left');
      if (bottomLeft) {
        const hasElement = !!bottomLeft.querySelector('img, a, ul, iframe, div');
        const text = (bottomLeft.textContent || '').replace(/[\s ]/g, '');
        wrap.classList.toggle('bym-actions-empty', !hasElement && !text);
      }

      // 匿名帖没有用户名 / 等级信息，左栏收窄
      const hasUser = !!wrap.querySelector('.a-body .a-u-uid, .a-body .a-u-info, .a-body .a-func-info');
      wrap.classList.toggle('bym-anon', !hasUser);
    });

    mountComposer();
    syncFloatbar();
    updateFloatbarVisibility();
  }

  function scheduleDecorate() {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(decoratePage, 80);
  }

  /* ------------------------------------------------------------------ *
   * 3.7 浮动标题 / 路径栏、底栏表情按钮、头像点击
   * ------------------------------------------------------------------ */
  let floatbar = null;
  let floatTitle = null;
  let floatPath = null;
  let floatMode = 'title';
  let lastScrollY = window.scrollY || 0;

  function setFloatMode(mode) {
    if (!floatbar) return;
    if (floatMode === mode && floatbar.classList.contains('bym-mode-' + mode)) return;
    floatMode = mode;
    floatbar.classList.remove('bym-mode-title', 'bym-mode-path');
    floatbar.classList.add('bym-mode-' + mode);
  }

  function mountFloatbar() {
    if (!document.body) return;
    const existing = document.getElementById('bym-floatbar');
    if (existing && existing !== floatbar) floatbar = existing;
    if (!floatbar) {
      floatbar = document.createElement('div');
      floatbar.id = 'bym-floatbar';
      floatbar.classList.add('bym-mode-title');

      const titleRow = document.createElement('div');
      titleRow.className = 'bym-float-row bym-float-title';
      titleRow.title = '回到顶部';
      const titleTag = document.createElement('span');
      titleTag.className = 'bym-float-tag';
      titleTag.textContent = '标题';
      floatTitle = document.createElement('span');
      floatTitle.className = 'bym-float-title-text';
      titleRow.append(titleTag, floatTitle);
      titleRow.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const pathRow = document.createElement('div');
      pathRow.className = 'bym-float-row bym-float-path';
      const pathTag = document.createElement('span');
      pathTag.className = 'bym-float-tag';
      pathTag.textContent = '位置';
      floatPath = document.createElement('div');
      floatPath.className = 'bym-float-path-text';
      pathRow.append(pathTag, floatPath);

      floatbar.append(titleRow, pathRow);
    }
    if (!document.body.contains(floatbar)) document.body.appendChild(floatbar);
    if (!floatTitle) floatTitle = floatbar.querySelector('.bym-float-title-text');
    if (!floatPath) floatPath = floatbar.querySelector('.bym-float-path-text');
    setFloatMode(floatMode);
  }

  function syncFloatbar() {
    if (!document.body) return;
    if (!floatbar) return;
    const titleNode = document.querySelector('#body .b-head .n-left');
    if (titleNode && floatTitle) {
      const text = (titleNode.textContent || '')
        .replace(/^文章主题\s*[:：]\s*/, '')
        .trim();
      if (floatTitle.textContent !== text) floatTitle.textContent = text;
    }
    const nav = document.querySelector('#notice_nav');
    if (nav && floatPath) {
      const html = nav.innerHTML;
      if (floatPath.dataset.srchtml !== html) {
        const clone = nav.cloneNode(true);
        clone.removeAttribute('id');
        floatPath.textContent = '';
        floatPath.appendChild(clone);
        floatPath.dataset.srchtml = html;
      }
    }
  }

  function updateFloatbarVisibility() {
    if (!floatbar) return;
    const y = window.scrollY || window.pageYOffset || 0;
    const modern = document.body && document.body.classList.contains('bym-on');
    const head = modern ? document.querySelector('#body .b-head') : null;
    if (!head || y < 20) {
      floatbar.classList.remove('bym-visible');
      lastScrollY = y;
      return;
    }
    const show = head.getBoundingClientRect().bottom < 56;
    if (show) {
      if (y > lastScrollY + 1) setFloatMode('title');
      else if (y < lastScrollY - 1) setFloatMode('path');
      floatbar.classList.add('bym-visible');
    } else {
      floatbar.classList.remove('bym-visible');
    }
    lastScrollY = y;
  }

  // 输入框随内容自动换行、增高；底栏和左下角控制条跟着上移
  let composerOriginal = null;
  const floatingSizes = new Map();
  const floatingResize = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    entries.forEach(({ target }) => {
      const property = floatingSizes.get(target);
      const height = Math.ceil(target.getBoundingClientRect().height);
      if (property && height > 0 && document.documentElement.style.getPropertyValue(property) !== height + 'px') {
        document.documentElement.style.setProperty(property, height + 'px');
      }
    });
  }) : null;

  // 工具栏分页、按钮和控制条换行后，用实际高度给其他浮层及正文留位。
  function observeFloatingLayout() {
    if (!floatingResize) return;
    const targets = new Map();
    if (document.body?.classList.contains('bym-active')) {
      [['.a-comment', '--bym-composer-h'], ['#body > .t-pre-bottom', '--bym-toolbar-h'], ['#bym-dock', '--bym-dock-h']].forEach(([selector, property]) => {
        const element = document.querySelector(selector);
        if (element) targets.set(element, property);
      });
    }
    floatingSizes.forEach((property, element) => {
      if (!targets.has(element)) {
        floatingResize.unobserve(element);
        floatingSizes.delete(element);
        document.documentElement.style.removeProperty(property);
      }
    });
    targets.forEach((property, element) => {
      if (floatingSizes.has(element)) return;
      floatingSizes.set(element, property);
      floatingResize.observe(element);
    });
  }

  function restoreComposer() {
    if (!composerOriginal) return;
    const { textarea, rows, height, overflow } = composerOriginal;
    if (rows === null) textarea.removeAttribute('rows');
    else textarea.setAttribute('rows', rows);
    [[ 'height', height ], [ 'overflow-y', overflow ]].forEach(([name, original]) => {
      if (original.value) textarea.style.setProperty(name, original.value, original.priority);
      else textarea.style.removeProperty(name);
    });
    document.documentElement.style.removeProperty('--bym-composer-h');
    composerOriginal = null;
  }

  function resizeComposer() {
    if (!document.body || !document.body.classList.contains('bym-on')) return;
    const comment = document.querySelector('.a-comment');
    const ta = comment && comment.querySelector('.a-comment-txt textarea');
    if (!comment || !ta) return;
    const max = 112;
    ta.style.setProperty('height', 'auto', 'important');
    const h = Math.max(38, Math.min(ta.scrollHeight, max));
    ta.style.setProperty('height', h + 'px', 'important');
    ta.style.setProperty('overflow-y', ta.scrollHeight > max ? 'auto' : 'hidden', 'important');
    const box = Math.round(comment.getBoundingClientRect().height);
    if (box > 0) {
      document.documentElement.style.setProperty('--bym-composer-h', box + 'px');
    }
  }

  // 表情面板默认收起，保留站点的 UBB 表情功能
  function mountComposer() {
    if (!document.body || !document.body.classList.contains('bym-on')) return;
    const comment = document.querySelector('.a-comment');
    if (!comment) return;
    const form = comment.querySelector('#quick_post');
    if (!form) return;
    let btn = form.querySelector('#bym-emoji-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'bym-emoji-toggle';
      btn.type = 'button';
      btn.textContent = '😊';
      btn.title = '表情';
      btn.setAttribute('aria-label', '表情');
      btn.addEventListener('click', () => {
        const open = comment.classList.toggle('bym-emoji-open');
        btn.setAttribute('aria-expanded', String(open));
      });
    }
    const actions = form.querySelector('.a-comment-btn');
    const submit = actions ? actions.querySelector('input[type="submit"], .button') : null;
    // 表情按钮放在「快捷回复」之前
    if (actions) {
      if (btn.parentNode !== actions || (submit && btn.nextElementSibling !== submit)) {
        actions.insertBefore(btn, submit || actions.firstChild);
      }
    } else if (btn.parentNode !== form) {
      form.appendChild(btn);
    }
    btn.setAttribute('aria-expanded', String(comment.classList.contains('bym-emoji-open')));

    // 具体表情显示在「经典 / 悠嘻猴 / 兔斯基 / 洋葱头」四个分类按钮之上
    const em = comment.querySelector('#em_img');
    if (em) {
      const tabs = em.querySelector('.ubb-img-tab');
      const list = em.querySelector('.ubb-img');
      if (tabs && list && list.nextElementSibling !== tabs) {
        em.insertBefore(list, tabs);
      }
    }

    const ta = comment.querySelector('.a-comment-txt textarea');
    if (ta && (!composerOriginal || composerOriginal.textarea !== ta)) {
      restoreComposer();
      composerOriginal = {
        textarea: ta,
        rows: ta.getAttribute('rows'),
        height: { value: ta.style.getPropertyValue('height'), priority: ta.style.getPropertyPriority('height') },
        overflow: { value: ta.style.getPropertyValue('overflow-y'), priority: ta.style.getPropertyPriority('overflow-y') },
      };
    }
    if (ta) ta.rows = 1;
    if (ta && !ta.dataset.bymGrow) {
      ta.dataset.bymGrow = '1';
      ta.addEventListener('input', resizeComposer);
    }
    resizeComposer();
  }

  const scrollHistory = createScrollHistory();
  injectStyle();
  // 此时 body 可能尚未出现；先设置根节点外壳和加载标记，再由观察器接续。
  applyRoute();

  /* ------------------------------------------------------------------ *
   * 4. 启动 & 路由监听
   * ------------------------------------------------------------------ */
  function boot() {
    applyRoute();
    mountDock();
    mountFloatbar();
    scheduleDecorate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('hashchange', () => {
    closeMenu();
    // hash 先变、内容后到：保留外壳与主题，暂时遮挡尚未匹配的正文。
    applyRoute();
    // 页面内容为 AJAX 渲染，稍后再确认一次
    requestAnimationFrame(() => {
      applyRoute();
      mountDock();
      mountFloatbar();
      scheduleDecorate();
    });
    setTimeout(() => {
      applyRoute();
      mountDock();
      mountFloatbar();
      scheduleDecorate();
    }, 300);
  });
  window.addEventListener('popstate', applyRoute);

  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('scroll', () => {
    updateFloatbarVisibility();
    checkAutoPager();
  }, { passive: true });
  window.addEventListener('resize', resizeComposer);

  // 系统主题变化时，仅在「跟随系统」模式下重新应用
  if (darkQuery) {
    const onSystemTheme = () => {
      if (state.theme === 'auto') applyTheme();
    };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemTheme);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemTheme);
  }

  // 若站点脚本重建了 body 子节点，确保控制条仍在
  const mo = new MutationObserver(() => {
    if (!document.body) return;
    if (dock && !document.body.contains(dock)) document.body.appendChild(dock);
    if (overlay && !document.body.contains(overlay)) document.body.appendChild(overlay);
    if (floatbar && !document.body.contains(floatbar)) document.body.appendChild(floatbar);
    applyRoute();
    scheduleDecorate();
  });
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
