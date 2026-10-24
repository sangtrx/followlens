/**
 * FollowLens Auto Scan: one click on the extension icon, with a visible stop control.
 * Interacts ONLY with Instagram's rendered profile links and native dialog scrolling.
 * No fetch/XHR/internal endpoints, cookies, tokens, credentials, or follow/unfollow actions.
 * Scrolling can make Instagram itself load more data; automation is NOT zero-risk.
 */
(() => {
  'use strict';
  const INSTANCE = '__followlens_auto_v2';
  if (window[INSTANCE]) { window[INSTANCE].show(); return; }

  const USER_RE = /^[a-z0-9._]{1,30}$/i;
  const RESERVED = new Set(['accounts','explore','reels','reel','p','stories','direct','about','developer','privacy','legal','web','api','challenge']);
  const pieces = location.pathname.split('/').filter(Boolean);
  const owner = pieces.length === 1 && USER_RE.test(pieces[0]) && !RESERVED.has(pieces[0].toLowerCase()) ? pieces[0].toLowerCase() : null;
  if (!owner || !['instagram.com', 'www.instagram.com'].includes(location.hostname)) {
    alert('FollowLens: mở instagram.com/username/ trước khi quét.');
    return;
  }

  const MAX_USERS = 75000;
  const MAX_STEPS = 5000;
  const MIN_PACE_MS = 340; // Do not scroll again before Instagram has had time to render.
  const LOAD_TIMEOUT_MS = 16000;
  const MAX_IDLE_WAIT_MS = 1400; // Slow/unchanged view: wait, then verify; never assume complete.
  const MAX_SCAN_MS = 12 * 60 * 1000;
  const DIAG = { followers: 'Followers', following: 'Following' };
  const data = { followers: new Set(), following: new Set() };
  let expected = { followers: null, following: null };
  let cancelled = false;
  let running = false;
  let currentDialog = null;
  let closed = false;
  let resultSaved = false;
  let scanningFull = false;
  let cachedScroller = null;

  const host = document.createElement('div');
  host.id = 'followlens-auto-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .panel { position:fixed; z-index:2147483647; top:66px; right:17px; width:330px; max-width:calc(100vw - 25px);
      color:#f7f2ff; background:#17141e; border:1px solid #695384; border-radius:16px;
      box-shadow:0 12px 46px #0009; padding:16px; font:12px/1.5 system-ui,sans-serif; }
    .head { display:flex; gap:8px; align-items:center; justify-content:space-between; }
    .brand { font-size:16px; color:#cfadff; font-weight:800; }
    .close { border:0; background:none; color:#ddd; font-size:19px; cursor:pointer; }
    p { margin:8px 0; } .muted { color:#aea6ba; }
    .stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:12px 0; }
    .stat { padding:10px; background:#282234; border-radius:8px; }
    .stat strong { display:block; font-size:22px; } .stat small { color:#bdb1cc; }
    .status { background:#221d2b; border-radius:8px; padding:9px; white-space:pre-wrap; min-height:36px; }
    .warn { color:#ffbf9d; } .good { color:#9ce7ba; }
    .buttons { display:flex; gap:8px; margin-top:10px; }
    button { cursor:pointer; font:inherit; }
    .btn { padding:9px 10px; border-radius:8px; border:1px solid #745b9e; background:#3c2c54; color:#f8f3ff; flex:1; }
    .btn.primary { background:#b891ff; color:#1e1127; font-weight:800; }
    .btn:disabled { opacity:.48; cursor:default; }
  `;
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'FollowLens Auto Scan');
  panel.innerHTML = `
    <div class="head"><span class="brand">FollowLens Smart Auto v2</span><button id="close" class="close" aria-label="Đóng">×</button></div>
    <p class="muted" id="owner"></p>
    <p class="muted">Tự quét Followers. Lần đầu sẽ quét cả Following. Không gọi API nội bộ.</p>
    <div class="stats"><div class="stat"><small>Followers</small><strong id="followers">0</strong></div><div class="stat"><small>Following</small><strong id="following">0</strong></div></div>
    <div class="status" id="status" role="status" aria-live="polite">Sẵn sàng.</div>
    <div class="buttons"><button id="run" class="btn primary">Smart Scan</button><button id="full" class="btn">Full Scan</button><button id="stop" class="btn">Dừng</button></div>
    <div class="buttons"><button id="dashboard" class="btn">Xem kết quả</button></div>
    <p class="muted" style="font-size:11px">Nếu Instagram yêu cầu xác minh hoặc dữ liệu chưa đầy đủ, hệ thống dừng và không lưu snapshot mới.</p>
  `;
  shadow.append(style, panel);
  document.documentElement.append(host);
  const el = id => shadow.getElementById(id);
  el('owner').textContent = 'Trang: @' + owner;

  function status(message, mode = '') { el('status').textContent = message; el('status').className = 'status ' + mode; }
  function updateCounters() {
    for (const kind of ['followers','following']) el(kind).textContent = data[kind].size.toLocaleString('vi-VN');
  }
  function stillOnOwner() { return location.pathname.split('/').filter(Boolean).join('/').toLowerCase() === owner; }
  function check() {
    if (cancelled || closed) throw new Error('Đã dừng theo yêu cầu. Snapshot trước không bị thay đổi.');
    if (!stillOnOwner()) throw new Error('Trang profile đã thay đổi. Đã dừng để tránh lẫn dữ liệu.');
    if (document.querySelector('form[action*="login"], input[name="username"][type="text"]') || /\/challenge\/|\/checkpoint\//.test(location.pathname)) {
      throw new Error('Instagram yêu cầu đăng nhập/xác minh. Đã dừng, không thử vượt qua.');
    }
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = node => !!node && node.isConnected && node.getClientRects().length > 0;

  // Instagram profile stats can be anchors, buttons, or clickable <li>/<span>
  // groups. Prefer URLs, then scoped text stats in the visible profile header.
  function profileTargets(kind) {
    const wanted = '/' + owner + '/' + kind + '/';
    const word = kind === 'followers' ? /\bfollowers\b/i : /\bfollowing\b/i;
    const other = kind === 'followers' ? /\bfollowing\b/i : /\bfollowers\b/i;
    const anchors = Array.from(document.querySelectorAll('header a[href], main a[href]')).filter(a => {
      if (!visible(a) || host.contains(a)) return false;
      try {
        const url = new URL(a.getAttribute('href'), location.origin);
        return ['instagram.com', 'www.instagram.com'].includes(url.hostname) &&
          url.pathname.toLowerCase().replace(/\/?$/, '/') === wanted;
      } catch { return false; }
    });
    const scored = [];
    const seen = new Set(anchors);
    const roots = Array.from(document.querySelectorAll('header, main header'));
    // A small set of layouts nests profile statistics directly under main.
    if (!roots.length) roots.push(...document.querySelectorAll('main'));
    for (const root of roots) {
      for (const item of root.querySelectorAll('li, [role="button"], button, [tabindex], span, div')) {
        if (!visible(item) || host.contains(item)) continue;
        const value = (item.textContent || '').replace(/\s+/g, ' ').trim();
        if (value.length > 90 || !word.test(value) || other.test(value)) continue;
        // Try the row AND the visible label: sometimes React's click handler
        // is attached to a child span rather than its ancestor list item.
        const variants = [item.closest('li'), item.closest('[role="button"],button'), item].filter(Boolean);
        for (const candidate of variants) {
          if (!visible(candidate) || host.contains(candidate) || seen.has(candidate)) continue;
          const label = (candidate.textContent || '').replace(/\s+/g, ' ').trim();
          if (label.length > 90 || !word.test(label) || other.test(label)) continue;
          const count = countFromLink(candidate, kind);
          if (!count) continue;
          seen.add(candidate);
          let score = candidate.tagName === 'LI' ? 100 : 0;
          if (candidate.matches('button, [role="button"], [tabindex]')) score += 80;
          if (getComputedStyle(candidate).cursor === 'pointer') score += 50;
          if (count.exact) score += 25;
          score -= label.length / 10;
          scored.push({node:candidate,score});
        }
      }
    }
    scored.sort((a,b) => b.score - a.score);
    return [...anchors, ...scored.map(x => x.node)].filter((node,i,a) => a.indexOf(node) === i);
  }
  function parseCount(label) {
    // Exact labels: 1,234 / 1.234 / 1234. Abbreviated K/M counts are approximate.
    const clean = String(label || '').replace(/\u00a0/g, ' ');
    const match = clean.match(/(\d[\d\s,.]*)(\s*[KkMm])?\b/);
    if (!match) return null;
    const suffix = (match[2] || '').trim().toLowerCase();
    const raw = match[1].trim();
    if (suffix) {
      const n = Number(raw.replace(',', '.').replace(/\s/g, ''));
      if (!Number.isFinite(n)) return null;
      return { value: Math.round(n * (suffix === 'k' ? 1000 : 1000000)), exact: false };
    }
    if (!/^\d[\d\s,.]*$/.test(raw)) return null;
    const integer = Number(raw.replace(/[\s,.]/g, ''));
    return Number.isSafeInteger(integer) ? { value: integer, exact: true } : null;
  }
  function countFromLink(link, kind) {
    if (!link) return null;
    const contexts = [link, link.closest('li'), link.parentElement, link.parentElement?.parentElement]
      .filter(Boolean);
    const other = kind === 'followers' ? /\bfollowing\b/i : /\bfollowers\b/i;
    for (const context of contexts) {
      const content = (context.textContent || '').replace(/\s+/g, ' ').trim();
      // Don't accidentally use the post count or another header statistic.
      if (other.test(content) || content.length > 120) continue;
      const labels = [
        context.getAttribute('aria-label'),
        context.getAttribute('title'),
        context.querySelector('[title]')?.getAttribute('title'),
        content
      ].filter(Boolean);
      const parsed = labels.map(parseCount).filter(Boolean);
      if (parsed.length) return parsed.find(x => x.exact) || parsed[0];
    }
    return null;
  }
  function usernameFromAnchor(anchor) {
    const href = anchor.getAttribute('href');
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      if (!['instagram.com','www.instagram.com'].includes(url.hostname) || url.protocol !== 'https:') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1 || !USER_RE.test(parts[0])) return null;
      const candidate = parts[0].toLowerCase();
      return RESERVED.has(candidate) || candidate === owner ? null : candidate;
    } catch { return null; }
  }
  function dialogs() { return Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).filter(visible); }
  function findDialog(previous = null) {
    const dialogsNow = dialogs();
    return dialogsNow.reverse().find(d => d !== previous && d.querySelector('a[href]')) || dialogsNow.find(d => d.querySelector('a[href]')) || null;
  }
  async function waitDialog(previous, timeout = LOAD_TIMEOUT_MS) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      check();
      const dialog = findDialog(previous);
      if (dialog && dialog.querySelector('a[href]')) return dialog;
      await sleep(400);
    }
    throw new Error('Không nhận diện được danh sách Instagram. Giao diện có thể đã thay đổi.');
  }
  function collect(kind, dialog) {
    check();
    if (!visible(dialog)) throw new Error('Danh sách Instagram bị đóng trong khi quét.');
    const before = data[kind].size;
    for (const link of dialog.querySelectorAll('a[href]')) {
      const username = usernameFromAnchor(link);
      if (username) data[kind].add(username);
      if (data[kind].size > MAX_USERS) throw new Error('Vượt giới hạn 75.000 tài khoản. Dùng export chính thức.');
    }
    if (data[kind].size !== before) updateCounters();
    return data[kind].size - before;
  }
  function scrollbox(dialog) {
    if (cachedScroller?.isConnected && dialog.contains(cachedScroller) &&
        cachedScroller.scrollHeight > cachedScroller.clientHeight + 12) return cachedScroller;
    const options = [dialog, ...dialog.querySelectorAll('*')].filter(node => {
      if (!visible(node) || node.clientHeight < 48) return false;
      return node.scrollHeight > node.clientHeight + 12;
    });
    if (!options.length) return null;
    cachedScroller = options.map(node => {
      const overflow = getComputedStyle(node).overflowY;
      const links = node.querySelectorAll('a[href]').length;
      const scrollRange = node.scrollHeight - node.clientHeight;
      const score = (/auto|scroll/.test(overflow) ? 1000 : 0) + (links ? 120 : 0) + Math.min(scrollRange / 100, 60) - Math.max(0, node.clientHeight - 900) / 100;
      return { node, score };
    }).sort((a,b) => b.score - a.score)[0].node;
    return cachedScroller;
  }
  function atEnd(node) { return node.scrollTop + node.clientHeight >= node.scrollHeight - 9; }
  // Compare rendered IDs with the previous VISIBLE set, never the cumulative
  // total. v2.0.2 compared visible count against all users captured so far,
  // and consequently hit a 1.8-second timeout at almost every scroll step.
  function renderedNames(dialog) {
    const names = new Set();
    for (const link of dialog.querySelectorAll('a[href]')) {
      const username = usernameFromAnchor(link);
      if (username) names.add(username);
    }
    return names;
  }
  function waitForContentChange(dialog, scroller, beforeVisible, previousHeight, nearEnd) {
    const started = Date.now();
    const idleTimeout = nearEnd ? 700 : MAX_IDLE_WAIT_MS;
    return new Promise(resolve => {
      let done = false, paceTimer = null;
      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(paceTimer);
        clearTimeout(deadlineTimer);
        resolve();
      };
      const changed = () => {
        if ((scroller?.scrollHeight ?? 0) !== previousHeight) return true;
        for (const name of renderedNames(dialog)) if (!beforeVisible.has(name)) return true;
        return false;
      };
      const ready = () => {
        if (!changed()) return;
        const remaining = MIN_PACE_MS - (Date.now() - started);
        if (remaining <= 0) finish();
        else if (!paceTimer) paceTimer = setTimeout(finish, remaining);
      };
      const observer = new MutationObserver(ready);
      observer.observe(dialog, {childList: true, subtree: true, attributes:true, attributeFilter:['href']});
      const deadlineTimer = setTimeout(finish, Math.max(MIN_PACE_MS, idleTimeout));
      // The DOM might have rendered synchronously before observer registration.
      ready();
    });
  }
  async function collectToEnd(kind, dialog) {
    let steady = 0;
    let lastSize = 0;
    let lastHeight = -1;
    let noScrollCount = 0;
    const began = Date.now();
    let stepsWithoutNewNames = 0;
    cachedScroller = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (Date.now() - began > MAX_SCAN_MS) throw new Error('Scan time limit exceeded; data was not saved.');
      check();
      collect(kind, dialog);
      const node = scrollbox(dialog);
      const count = data[kind].size;
      const height = node?.scrollHeight ?? 0;
      const beforeVisible = renderedNames(dialog);
      const end = !node || atEnd(node);
      if (end && lastSize === count && lastHeight === height) steady++;
      else steady = 0;
      const target = expected[kind]?.value;
      status(`Đang quét ${DIAG[kind]}: ${count.toLocaleString('vi-VN')}${target != null ? '/' + target.toLocaleString('vi-VN') : ''} tài khoản\nCuộn ${step+1}, chờ danh sách tải xong trước khi cuộn tiếp.`);
      if (steady >= 4) {
        if (count === 0 && expected[kind]?.value !== 0) throw new Error(`${DIAG[kind]} trống hoặc chưa tải được.`);
        return;
      }
      if (node) {
        const beforeTop = node.scrollTop;
        // If all exact-count profiles are already rendered, jump only to
        // verify the bottom. Otherwise use overlapping viewports so virtual
        // rows are not skipped while Instagram loads additional batches.
        const allCollected = expected[kind]?.exact && count === expected[kind].value;
        node.scrollTop = allCollected ? node.scrollHeight :
          Math.min(node.scrollHeight, beforeTop + Math.max(140, Math.floor(node.clientHeight * 0.78)));
        if (node.scrollTop === beforeTop && !end) {
          noScrollCount++;
          if (noScrollCount >= 6) throw new Error(`Không cuộn được ${DIAG[kind]}. Dừng để tránh dữ liệu thiếu.`);
        } else noScrollCount = 0;
      }
      lastSize = count;
      lastHeight = height;
      await waitForContentChange(dialog, node, beforeVisible, height, end);
      check();
      const added = collect(kind, dialog);
      stepsWithoutNewNames = added ? 0 : stepsWithoutNewNames + 1;
      if (stepsWithoutNewNames > 24 && !atEnd(node) && data[kind].size !== expected[kind]?.value) {
        throw new Error(`${DIAG[kind]} ngừng cung cấp dữ liệu mới. Dừng an toàn, không lưu snapshot thiếu.`);
      }
    }
    throw new Error('Đã đạt giới hạn số lần cuộn. Chưa xác thực đủ dữ liệu.');
  }
  function findClose(dialog) {
    const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'));
    return buttons.find(button => {
      const aria = [button.getAttribute('aria-label'), button.getAttribute('title'), button.querySelector('svg')?.getAttribute('aria-label')].filter(Boolean).join(' ');
      return /^(close|đóng|cerrar|fermer|schließen|chiudi|閉じる)$/i.test(aria.trim());
    }) || null;
  }
  async function closeDialog(dialog) {
    let button = findClose(dialog);
    if (!button) {
      // Some layouts place the close control on a parent overlay, outside role=dialog.
      button = Array.from(document.querySelectorAll('button')).find(b => visible(b) && !host.contains(b) && /^(close|đóng)$/i.test((b.getAttribute('aria-label') || '').trim()));
    }
    if (!button) throw new Error('Instagram không hiển thị nút đóng danh sách. Không thể chuyển sang bước tiếp theo.');
    button.click();
    for (let i=0; i<16; i++) {
      check();
      if (!visible(dialog)) return;
      await sleep(350);
    }
    throw new Error('Không thể đóng danh sách Instagram. Không ghi dữ liệu chưa đủ.');
  }
  async function scanOne(kind) {
    status(`Đang mở ${DIAG[kind]}...`);
    const targets = profileTargets(kind);
    if (!targets.length) throw new Error(`Không tìm thấy mục ${DIAG[kind]} trên profile (kể cả dạng text/clickable li). Dữ liệu cũ được giữ nguyên.`);
    expected[kind] = targets.map(t => countFromLink(t, kind)).find(Boolean) || null;
    const previous = findDialog();
    if (previous) await closeDialog(previous);
    check();
    let dialog = null;
    // Try at most 3 independent UI targets, not API endpoints or extra pages.
    for (const target of targets.slice(0, 3)) {
      check();
      if (!visible(target)) continue;
      target.click();
      try {
        dialog = await waitDialog(null, 4300);
        break;
      } catch (error) {
        if (!/Không nhận diện được danh sách/.test(String(error?.message))) throw error;
      }
    }
    if (!dialog) throw new Error(`Đã tìm thấy mục ${DIAG[kind]} nhưng Instagram không mở danh sách. Không lưu snapshot thiếu.`);
    currentDialog = dialog;
    cachedScroller = null;
    await collectToEnd(kind, currentDialog);
    const got = data[kind].size;
    const estimate = expected[kind];
    if (!estimate?.exact || got !== estimate.value) {
      throw new Error(`${DIAG[kind]}: thu được ${got}; số đếm ${estimate?.value ?? '?'}${estimate?.exact ? '' : ' (xấp xỉ)'}. Chưa xác thực đầy đủ, không lưu.`);
    }
    status(`Đã lấy ${got.toLocaleString('vi-VN')} ${DIAG[kind]}.`, 'good');
    await closeDialog(currentDialog);
    currentDialog = null;
    await sleep(750);
  }
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Không thể lưu dữ liệu');
    return response.result;
  }
  async function save() {
    check();
    const saved = await send({
      type: 'SAVE_SCAN', owner, followers: [...data.followers],
      following: scanningFull ? [...data.following] : null,
      expectedFollowers: expected.followers?.value,
      expectedFollowing: scanningFull ? expected.following?.value : null,
      reachedEndFollowers: true, reachedEndFollowing: scanningFull,
      full: scanningFull
    });
    resultSaved = true;
    status(`Đã lưu mốc #${saved.id}: ${saved.followerCount} followers.${scanningFull ? ' Đã cập nhật Following.' : ' Giữ cache Following.'}\n${saved.lostCount == null ? 'Mốc đầu tiên, chưa có dữ liệu unfollow.' : `${saved.lostCount} người biến mất, ${saved.gainedCount} người xuất hiện.`} Xem dashboard để kiểm tra.`, 'good');
  }
  async function run(forceFull = false) {
    if (running) return;
    cancelled = false; resultSaved = false;
    data.followers.clear(); data.following.clear();
    cachedScroller = null;
    expected = { followers: null, following: null };
    updateCounters();
    running = true;
    el('run').disabled = true; el('full').disabled = true; el('stop').disabled = false;
    try {
      check();
      const old = await send({type:'GET_SUMMARY',owner});
      scanningFull = forceFull || !old.following;
      status(scanningFull ? 'Full Scan: tự quét Followers + Following' : 'Smart Scan: chỉ cập nhật Followers');
      await scanOne('followers');
      if (scanningFull) await scanOne('following');
      await save();
    } catch (error) {
      if (!closed) status(`${error?.message || 'Quét bị gián đoạn.'}\n${resultSaved ? '' : 'Dữ liệu cũ được giữ nguyên.'}`, 'warn');
    } finally {
      running = false; currentDialog = null;
      el('run').disabled = false; el('full').disabled = false; el('stop').disabled = true;
    }
  }
  el('run').addEventListener('click', () => run(false));
  el('full').addEventListener('click', () => run(true));
  el('stop').addEventListener('click', () => { cancelled = true; status('Đang dừng. Dữ liệu cũ vẫn nguyên.', 'warn'); });
  el('dashboard').addEventListener('click', () => chrome.runtime.sendMessage({ type:'OPEN_DASHBOARD', owner }));
  el('close').addEventListener('click', () => {
    cancelled = true; closed = true; host.remove(); delete window[INSTANCE];
  });
  el('stop').disabled = true;
  window[INSTANCE] = { show() { host.style.display = ''; } };
  // User clicking the extension icon is the authorization to start this one scan.
  run(false);
})();
