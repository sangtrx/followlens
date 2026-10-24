/* IndexedDB history: atomic writes, 20-scan checkpoints, replayable deltas. */
(function (root) {
  'use strict';
  const C = root.FollowLensCore;
  const NAME = 'followlens-v2', VERSION = 1, CHECKPOINT = 20;
  let connection;
  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const records = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
        records.createIndex('by_owner', 'owner', { unique: false });
        db.createObjectStore('following', { keyPath: 'owner' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return connection;
  }
  function req(request) {
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  function done(tx) {
    return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Transaction aborted')); });
  }
  async function records(owner) {
    const db = await open();
    const tx = db.transaction('records', 'readonly');
    const values = await req(tx.objectStore('records').index('by_owner').getAll(owner));
    return values.sort((a, b) => a.id - b.id);
  }
  function hydrate(entries) {
    let state = [];
    const all = [];
    for (const entry of entries) {
      state = entry.mode === 'full' ? C.normalize(entry.full) : C.applyDelta(state, entry.diff);
      if (state.length !== entry.followerCount) throw new Error('Snapshot history is inconsistent.');
      all.push({ ...entry, followers: state });
    }
    return all;
  }
  async function following(owner) {
    const db = await open();
    const tx = db.transaction('following', 'readonly');
    return await req(tx.objectStore('following').get(owner)) || null;
  }
  async function summary(owner) {
    const list = hydrate(await records(owner));
    const rel = await following(owner);
    return { latest: list.at(-1) || null, previous: list.at(-2) || null, following: rel, scans: list.length };
  }
  async function history(owner) {
    const list = hydrate(await records(owner));
    const rel = await following(owner);
    return { records: list, following: rel };
  }
  async function owners() {
    const db = await open();
    const tx = db.transaction('records', 'readonly');
    const all = await req(tx.objectStore('records').getAll());
    return [...new Set(all.map(x => x.owner))].sort();
  }
  async function append(owner, verified, full, source, evidence) {
    const old = hydrate(await records(owner));
    const latest = old.at(-1);
    if (latest && C.suspicious(latest.followers, verified.followers))
      throw new Error('Large follower loss detected; snapshot withheld to avoid false alerts. Check with an official export.');
    const useFull = !latest || old.length % CHECKPOINT === 0;
    const record = {
      owner, createdAt: Date.now(), source, evidence,
      mode: useFull ? 'full' : 'delta', followerCount: verified.followers.length,
      full: useFull ? verified.followers : undefined,
      diff: useFull ? undefined : C.delta(latest.followers, verified.followers),
      fullScan: Boolean(full)
    };
    const db = await open();
    const tx = db.transaction(['records', 'following'], 'readwrite');
    const finished = done(tx);
    const inserted = req(tx.objectStore('records').add(record));
    if (verified.following != null) tx.objectStore('following').put({ owner, usernames: verified.following, createdAt: record.createdAt, source });
    const id = await inserted;
    await finished;
    const diff = C.compare(latest?.followers || null, verified.followers, verified.following || (await following(owner))?.usernames || null);
    return { id, owner, followerCount: verified.followers.length, followingCount: verified.following?.length ?? null, lostCount: diff.lost?.length ?? null, gainedCount: diff.gained?.length ?? null, fullScan: record.fullScan };
  }
  async function save(payload) {
    const owner = String(payload.owner || '').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(owner)) throw new Error('Invalid profile');
    return append(owner, C.validateScan(payload), payload.full, 'instagram-dom', 'exact-visible-count-and-stable-scroll-end');
  }
  async function importOfficial(owner, snapshot) {
    owner = String(owner || '').replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(owner)) throw new Error('Please enter a valid Instagram username');
    if (!snapshot || !Array.isArray(snapshot.followers) || !snapshot.followers.length) throw new Error('Export has no followers');
    return append(owner, {
      followers: C.normalize(snapshot.followers),
      following: Array.isArray(snapshot.following) && snapshot.following.length ? C.normalize(snapshot.following) : null
    }, Boolean(snapshot.following?.length), 'official-export', 'export-content-not-independently-verified');
  }
  async function clear(owner = null) {
    const db = await open();
    const tx = db.transaction(['records', 'following'], 'readwrite');
    const finished = done(tx);
    if (owner == null) {
      tx.objectStore('records').clear(); tx.objectStore('following').clear();
    } else {
      const keys = await req(tx.objectStore('records').index('by_owner').getAllKeys(owner));
      for (const key of keys) tx.objectStore('records').delete(key);
      tx.objectStore('following').delete(owner);
    }
    await finished;
  }
  root.FollowLensDB = Object.freeze({ open, records, summary, history, owners, save, importOfficial, clear, hydrate });
})(typeof globalThis !== 'undefined' ? globalThis : this);
