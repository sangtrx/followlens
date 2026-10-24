'use strict';
importScripts('core.js', 'db.js');
const PROFILE = /^\/([a-z0-9._]{1,30})\/?$/i;
const RESERVED = new Set(['explore','accounts','reels','reel','p','stories','direct','about','privacy','legal','web','api','challenge','developer']);
function profile(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'www.instagram.com') return null;
    const m = u.pathname.match(PROFILE), name = m?.[1]?.toLowerCase();
    return name && !RESERVED.has(name) ? name : null;
  } catch { return null; }
}
async function inject(tabId) {
  await chrome.scripting.executeScript({target:{tabId}, files:['capture.js']});
}
chrome.action.onClicked.addListener(async tab => {
  try {
    if (tab?.id && profile(tab.url)) return await inject(tab.id);
    await chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')});
  } catch (err) { console.warn('FollowLens injection failed:', err); }
});
async function registerWatch(enabled) {
  const id = 'followlens-optional-watch';
  const current = await chrome.scripting.getRegisteredContentScripts({ids:[id]});
  if (current.length) await chrome.scripting.unregisterContentScripts({ids:[id]});
  if (enabled) await chrome.scripting.registerContentScripts([{id, matches:['https://www.instagram.com/*'], js:['watch.js'], runAt:'document_idle', allFrames:false}]);
}
chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await chrome.storage.local.get('watchEnabled');
  if (cfg.watchEnabled && await chrome.permissions.contains({origins:['https://www.instagram.com/*']})) await registerWatch(true);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    switch (message?.type) {
      case 'GET_SUMMARY': return await FollowLensDB.summary(message.owner);
      case 'SAVE_SCAN': {
        if (!sender.tab?.url || profile(sender.tab.url) !== message.owner) throw new Error('Source profile mismatch');
        const saved = await FollowLensDB.save(message);
        const stored = await chrome.storage.local.get('watchOwners');
        const watchOwners = Array.from(new Set([...(stored.watchOwners || []), saved.owner]));
        await chrome.storage.local.set({watchOwners});
        return saved;
      }
      case 'OPEN_DASHBOARD': {
        await chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html') + '?owner=' + encodeURIComponent(message.owner || '')});
        return {ok:true};
      }
      case 'SET_WATCH': {
        const enabled = Boolean(message.enabled);
        if (enabled && !(await chrome.permissions.contains({origins:['https://www.instagram.com/*']}))) throw new Error('Instagram site permission not granted');
        await registerWatch(enabled);
        await chrome.storage.local.set({watchEnabled:enabled});
        return {enabled};
      }
      case 'RUN_WATCH': {
        const owner = sender.tab?.url && profile(sender.tab.url);
        if (!sender.tab?.id || !owner || owner !== message.owner) return {started:false};
        if (!(await chrome.storage.local.get('watchEnabled')).watchEnabled) return {started:false};
        await inject(sender.tab.id);
        return {started:true};
      }
      default: throw new Error('Unknown message');
    }
  })().then(result => respond({ok:true, result}), err => respond({ok:false, error:String(err?.message || err)}));
  return true;
});
