import {parseImport} from './parser.mjs';
const C = globalThis.FollowLensCore, DB = globalThis.FollowLensDB;
const $ = id => document.getElementById(id);
const labels = {
  notFollowingBack: 'You follow these accounts, but they are absent from the selected Followers snapshot.',
  lost: 'Present in the preceding snapshot, absent from this one. This does not prove a voluntary unfollow.',
  gained: 'Present in this snapshot, absent from the preceding one.',
  youDontFollowBack: 'These followers are not in your latest captured Following list.',
  mutual: 'Accounts present in both lists.'
};
const state = {owner:'', history:[], following:null, selected:-1, tab:'notFollowingBack', search:'', visible:100, results:null};
const fmt = n => n == null ? '--' : Number(n).toLocaleString('en-US');
const date = value => value ? new Date(value).toLocaleString() : 'Not available';
function notice(message, error=false){$('notice').textContent=message; $('notice').classList.toggle('error',error); $('notice').hidden=!message;}
function empty(msg){const div=document.createElement('div');div.className='empty';div.textContent=msg;return div;}
function setOptions(select, options, value){select.replaceChildren();for(const [v,label] of options){const el=document.createElement('option');el.value=String(v);el.textContent=label;select.append(el);}select.value=String(value);}
async function refreshAccounts(preferred) {
  const accounts = await DB.owners();
  state.owner = accounts.includes(preferred) ? preferred : accounts.includes(state.owner) ? state.owner : accounts[0] || '';
  setOptions($('ownerSelect'),accounts.length ? accounts.map(a=>[a,'@'+a]) : [['','No saved profiles']],state.owner);
  $('importOwner').value = state.owner;
  await load();
}
async function load() {
  state.history=[]; state.following=null; state.selected=-1;
  if(state.owner){const result=await DB.history(state.owner);state.history=result.records;state.following=result.following;state.selected=result.records.length-1;}
  setOptions($('scanSelect'),state.history.length?state.history.map((r,i)=>[i,`#${r.id} · ${date(r.createdAt)} · ${r.source}`]).reverse():[['','No history']],state.selected);
  $('instagramLink').href = state.owner ? `https://www.instagram.com/${encodeURIComponent(state.owner)}/` : 'https://www.instagram.com/';
  draw();
}
function draw(){
  const selected=state.history[state.selected], previous=state.history[state.selected-1];
  const follow=state.following && state.following.createdAt <= (selected?.createdAt ?? 0) ? state.following : null;
  state.results = selected ? C.compare(previous?.followers||null,selected.followers,follow?.usernames||null) : null;
  const result=state.results;
  $('followersCount').textContent=fmt(selected?.followers.length);
  $('followingCount').textContent=fmt(follow?.usernames.length);
  $('nonmutualCount').textContent=fmt(result?.notFollowingBack?.length);
  $('lostCount').textContent=fmt(result?.lost?.length);
  $('followersDate').textContent=selected ? date(selected.createdAt) : 'No snapshot';
  $('followingDate').textContent=follow ? 'Updated '+date(follow.createdAt) : 'Full Scan needed';
  const evidence=selected ? (selected.source==='official-export' ? 'Imported export: completeness not independently verified.' : 'Live DOM: reached stable end and matched an exact displayed count. Not an independent completeness guarantee.') : 'Open Instagram and click the extension icon to scan.';
  $('evidence').textContent=evidence + (follow && selected?.createdAt>follow.createdAt?' Following is cached from an earlier scan.':'');
  for(const key of Object.keys(labels)) $('count-'+key).textContent=fmt(result?.[key]?.length ?? 0);
  for(const tab of document.querySelectorAll('.tab')){const active=tab.dataset.tab===state.tab;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));}
  $('listNote').textContent=labels[state.tab];
  $('csvBtn').disabled=!result?.[state.tab];
  const list=$('accounts');list.replaceChildren();
  const users=(result?.[state.tab]||[]).filter(u=>u.includes(state.search));
  $('visibleCount').textContent=fmt(users.length)+' accounts';
  if(!selected)list.append(empty('No snapshot yet. Open Instagram, then click the FollowLens icon.'));
  else if(!result?.[state.tab])list.append(empty('This view requires an earlier snapshot or a Full Scan.'));
  else if(!users.length)list.append(empty('No matching accounts.'));
  else {
    const frag=document.createDocumentFragment();
    for(const user of users.slice(0,state.visible)){
      const node=document.createElement('div');node.className='account';
      const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=user[0].toUpperCase();
      const name=document.createElement('span');name.className='username';name.textContent='@'+user;
      const link=document.createElement('a');link.className='profileLink';link.textContent='Profile ↗';link.href=`https://www.instagram.com/${encodeURIComponent(user)}/`;link.target='_blank';link.rel='noopener noreferrer';
      node.append(avatar,name,link);frag.append(node);
    }
    list.append(frag);
  }
  $('more').hidden=users.length<=state.visible;
}
function exportCSV(){
  const users=(state.results?.[state.tab]||[]).filter(u=>u.includes(state.search));
  const csv='username,profile_url\r\n'+users.map(u=>`${u},https://www.instagram.com/${u}/`).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`followlens_${state.owner}_${state.tab}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function configureWatch(enabled){
  if(enabled){const granted=await chrome.permissions.request({origins:['https://www.instagram.com/*']});if(!granted)throw new Error('Instagram permission was not granted.');}
  const r=await chrome.runtime.sendMessage({type:'SET_WATCH',enabled});
  if(!r?.ok)throw new Error(r?.error||'Could not update Auto Watch');
  notice(enabled?'Auto Watch enabled for visible Instagram profile visits.':'Auto Watch disabled.');
}
async function importExport(files){
  if(!files.length)return;
  const owner=$('importOwner').value.trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9._]{1,30}$/.test(owner))throw new Error('Enter a valid Instagram username for this export.');
  const parsed=await parseImport(files,{requireFollowing:false});
  const saved=await DB.importOfficial(owner,parsed);
  await refreshAccounts(owner);
  notice(`Imported ${fmt(saved.followerCount)} followers as snapshot #${saved.id}. Verify export completeness before interpreting changes.`);
}
function init(){
  $('ownerSelect').addEventListener('change',async e=>{state.owner=e.target.value;await load();});
  $('scanSelect').addEventListener('change',e=>{state.selected=Number(e.target.value);state.visible=100;draw();});
  $('query').addEventListener('input',e=>{state.search=e.target.value.trim().replace(/^@/,'').toLowerCase();state.visible=100;draw();});
  $('more').addEventListener('click',()=>{state.visible+=100;draw();});
  $('csvBtn').addEventListener('click',exportCSV);
  for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>{state.tab=tab.dataset.tab;state.visible=100;draw();});
  $('watch').addEventListener('change',async e=>{e.target.disabled=true;try{await configureWatch(e.target.checked);}catch(err){e.target.checked=!e.target.checked;notice(err.message,true);}finally{e.target.disabled=false;}});
  $('importBtn').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',async e=>{try{notice('Reading export locally...');await importExport([...e.target.files]);}catch(err){notice(err.message||'Import failed',true);}finally{e.target.value='';}});
  $('clear').addEventListener('click',async()=>{if(!state.owner)return;if(!confirm(`Permanently delete all local history for @${state.owner}?`))return;try{const deleted=state.owner;await DB.clear(deleted);const saved=await chrome.storage.local.get('watchOwners');await chrome.storage.local.set({watchOwners:(saved.watchOwners||[]).filter(x=>x!==deleted)});await chrome.storage.local.remove('watchLastAttempt:'+deleted);notice('Local history and Auto Watch eligibility deleted for @'+deleted+'.');await refreshAccounts('');}catch(err){notice(err.message,true);}});
}
async function start(){init();try{await DB.open();$('watch').checked=Boolean((await chrome.storage.local.get('watchEnabled')).watchEnabled);const preferred=new URLSearchParams(location.search).get('owner')||'';await refreshAccounts(preferred);}catch(err){notice('Storage unavailable: '+err.message,true);}}
start();
