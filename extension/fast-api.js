/*
 * Experimental opt-in adapter for Instagram's undocumented same-origin REST.
 * Read-only GET; no cookie inspection, token extraction, proxies or retries.
 * Stop on auth/rate-limit/checkpoint, incomplete pagination, or count mismatch.
 * Its existence does NOT imply permission from Meta or account safety.
 */
(function(root) {
  'use strict';
  const APP_ID = '936619743392459';
  const USERNAME = /^[a-z0-9._]{1,30}$/i;
  const USER_ID = /^\d{1,24}$/;
  const KINDS = new Set(['followers', 'following']);
  const DEFAULT_PACE = 1250, MAX_PAGES = 180, MAX_USERS = 20000;
  function fail(message) { throw new Error(message); }
  function assertActive(signal) {
    if (signal?.aborted) fail('Fast Scan cancelled. No snapshot saved.');
  }
  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Fast Scan cancelled.'));
      let timer;
      const onAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(new Error('Fast Scan cancelled.')); };
      timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
      signal?.addEventListener('abort', onAbort, {once:true});
    });
  }
  async function readJSON(path, {fetchImpl=fetch, signal}={}) {
    assertActive(signal);
    if (typeof path !== 'string' || !path.startsWith('/api/v1/')) fail('Unsafe API URL rejected.');
    let response;
    try {
      response = await fetchImpl(path, {
        method:'GET', credentials:'include', mode:'same-origin', redirect:'manual',
        cache:'no-store', headers:{'accept':'application/json','x-ig-app-id':APP_ID},
        signal
      });
    } catch (error) {
      if (signal?.aborted) fail('Fast Scan cancelled.');
      fail('Instagram API network request failed. No retry; use DOM or official export.');
    }
    if (!response || response.type === 'opaqueredirect' || response.status === 0 || (response.status >= 300 && response.status < 400))
      fail('Instagram redirected the API request. Login/checkpoint suspected; stopped.');
    if (response.status === 429) fail('Instagram HTTP 429 rate limit. Stopped immediately; do not retry.');
    if (response.status === 401 || response.status === 403) fail('Instagram denied API access (401/403). Stopped.');
    if (!response.ok) fail('Instagram API HTTP ' + response.status + '. Stopped without retry.');
    const type = response.headers?.get?.('content-type') || '';
    if (!/json/i.test(type)) fail('Instagram returned non-JSON data (login/challenge suspected). Stopped.');
    let json;
    try { json = await response.json(); } catch { fail('Invalid API JSON response. Stopped.'); }
    if (!json || typeof json !== 'object' || json.status === 'fail' ||
        /challenge|checkpoint|login_required|feedback_required|please wait|rate limit/i.test(String(json.message || '')))
      fail('Instagram rejected API access or requested verification. Stopped.');
    return json;
  }
  async function resolveUserId(owner, options={}) {
    if (!USERNAME.test(owner)) fail('Invalid Instagram owner.');
    const result = await readJSON('/api/v1/users/web_profile_info/?username=' + encodeURIComponent(owner), options);
    const user = result?.data?.user || result?.user;
    const id = String(user?.id ?? user?.pk ?? '');
    if (!USER_ID.test(id) || String(user?.username || '').toLowerCase() !== owner.toLowerCase())
      fail('Instagram profile ID is missing or does not match the selected account.');
    return id;
  }
  async function scanList({userId, kind, expected, fetchImpl, signal, paceMs=DEFAULT_PACE, onProgress=()=>{}, maxPages=MAX_PAGES}) {
    if (!USER_ID.test(String(userId)) || !KINDS.has(kind)) fail('Invalid Instagram scan target.');
    if (!Number.isSafeInteger(expected) || expected < 0 || expected > MAX_USERS) fail('Exact list count is unavailable or exceeds the fast-scan cap. Use official export.');
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES || paceMs < 0) fail('Invalid pacing/limit.');
    const people = new Set(), cursors = new Set();
    let cursor = null, pages = 0;
    for (;;) {
      assertActive(signal);
      if (pages >= maxPages) fail('Fast API page cap reached; result not saved.');
      let path = '/api/v1/friendships/' + userId + '/' + kind + '/?count=200';
      if (cursor) path += '&max_id=' + encodeURIComponent(cursor);
      const json = await readJSON(path, {fetchImpl,signal});
      pages++;
      if (!Array.isArray(json.users)) fail('Instagram changed the API response structure. No snapshot saved.');
      for (const user of json.users) {
        const username = String(user?.username || '').toLowerCase();
        if (!USERNAME.test(username)) fail('Invalid user entry in API page. No snapshot saved.');
        people.add(username);
      }
      if (people.size > expected || people.size > MAX_USERS) fail('Instagram list exceeds expected count; no snapshot saved.');
      onProgress({kind,pages,count:people.size,expected});
      const next = json.next_max_id == null ? '' : String(json.next_max_id);
      const hasMore = json.has_more === true || (json.has_more == null && !!next);
      if (!hasMore) break;
      if (!next || next.length > 2048 || cursors.has(next)) fail('Instagram pagination is missing or repeated a cursor. No snapshot saved.');
      cursors.add(next);
      cursor = next;
      await pause(paceMs,signal);
    }
    if (people.size !== expected) fail('Incomplete ' + kind + ': collected ' + people.size + '/' + expected + '. No snapshot saved.');
    return {usernames:[...people],pages};
  }
  root.FollowLensFastAPI = Object.freeze({resolveUserId,scanList,readJSON});
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FollowLensFastAPI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
