/* Optional, explicitly enabled: at most one attempted scan per profile per 24 hours, on visible visit. */
(() => {
  const match = location.pathname.match(/^\/([a-z0-9._]{1,30})\/?$/i);
  const owner = match?.[1]?.toLowerCase();
  if (!owner || ['explore','accounts','reels','direct','stories','p','challenge'].includes(owner) || document.visibilityState !== 'visible') return;
  const key = 'watchLastAttempt:' + owner;
  chrome.storage.local.get(['watchEnabled','watchOwners',key]).then(async data => {
    if (!data.watchEnabled || !(data.watchOwners || []).includes(owner) || Date.now() - (data[key] || 0) < 24 * 3600 * 1000) return;
    await chrome.storage.local.set({[key]:Date.now()});
    chrome.runtime.sendMessage({type:'RUN_WATCH',owner}).catch(() => {});
  }).catch(() => {});
})();
