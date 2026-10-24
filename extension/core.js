/* Pure comparison and snapshot validation logic. No network, DOM or Chrome APIs. */
(function (root) {
  'use strict';
  const USER = /^[a-z0-9._]{1,30}$/;
  function normalize(items) {
    if (!Array.isArray(items)) throw new TypeError('Expected a list of usernames');
    const out = new Set();
    for (const raw of items) {
      if (typeof raw !== 'string') throw new TypeError('Invalid username');
      const u = raw.trim().replace(/^@/, '').toLowerCase();
      if (!USER.test(u)) throw new TypeError('Invalid username: ' + raw);
      out.add(u);
    }
    return [...out].sort();
  }
  function difference(a, b) { const s = new Set(b); return a.filter(x => !s.has(x)); }
  function compare(previous, current, following) {
    const old = previous ? normalize(previous) : null;
    const now = normalize(current);
    const youFollow = following == null ? null : normalize(following);
    const followingSet = youFollow ? new Set(youFollow) : null;
    return {
      lost: old ? difference(old, now) : null,
      gained: old ? difference(now, old) : null,
      notFollowingBack: youFollow ? difference(youFollow, now) : null,
      youDontFollowBack: youFollow ? difference(now, youFollow) : null,
      mutual: youFollow ? now.filter(x => followingSet.has(x)) : null
    };
  }
  function validateScan({ followers, following, expectedFollowers, expectedFollowing, reachedEndFollowers, reachedEndFollowing, full }) {
    const fa = normalize(followers);
    const validCount = x => Number.isSafeInteger(x) && x >= 0;
    if (!reachedEndFollowers || !validCount(expectedFollowers) || fa.length !== expectedFollowers)
      throw new Error('Followers scan is incomplete or cannot be verified against an exact count.');
    let ga = null;
    if (full) {
      ga = normalize(following);
      if (!reachedEndFollowing || !validCount(expectedFollowing) || ga.length !== expectedFollowing)
        throw new Error('Following scan is incomplete or cannot be verified against an exact count.');
    }
    return { followers: fa, following: ga };
  }
  function delta(previous, current) {
    const before = normalize(previous), after = normalize(current);
    return { added: difference(after, before), removed: difference(before, after) };
  }
  function applyDelta(previous, { added, removed }) {
    const s = new Set(normalize(previous));
    for (const x of normalize(removed)) s.delete(x);
    for (const x of normalize(added)) s.add(x);
    return [...s].sort();
  }
  function suspicious(previous, current) {
    if (!previous) return false;
    const gone = difference(normalize(previous), normalize(current)).length;
    return gone > Math.max(5, Math.ceil(previous.length * 0.15));
  }
  const api = Object.freeze({ normalize, compare, delta, applyDelta, validateScan, suspicious });
  root.FollowLensCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
