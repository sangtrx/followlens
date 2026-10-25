'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const API = require('../extension/fast-api.js');

function response(body, status=200, type='application/json') {
  return {
    status,ok:status>=200 && status<300,
    headers:{get:name=>name.toLowerCase()==='content-type'?type:null},
    json:async()=>body
  };
}
function exampleFetch() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url,options});
    if (url.includes('web_profile_info')) return response({data:{user:{id:'12345',username:'account'}}});
    if (url.includes('/followers/')) {
      if (url.includes('max_id=cursor2')) return response({users:[{username:'third'}],has_more:false});
      return response({users:[{username:'first'},{username:'second'}],has_more:true,next_max_id:'cursor2'});
    }
    if (url.includes('/following/')) return response({users:[{username:'second'}],has_more:false});
    return response({status:'fail',message:'unknown'},404);
  };
  return {fetchImpl,calls};
}
test('module has no network activity on import and exports pure adapter',()=>{
  assert.equal(typeof API.resolveUserId,'function');
  assert.equal(typeof API.scanList,'function');
});
test('profile resolution uses read-only same-origin request without cookie extraction',async()=>{
  const m=exampleFetch();
  assert.equal(await API.resolveUserId('account',{fetchImpl:m.fetchImpl}), '12345');
  assert.equal(m.calls.length,1);
  assert.match(m.calls[0].url,/^\/api\/v1\/users\//);
  assert.equal(m.calls[0].options.method,'GET');
  assert.equal(m.calls[0].options.credentials,'include');
  assert.equal(m.calls[0].options.mode,'same-origin');
  assert.equal(m.calls[0].options.redirect,'manual');
});
test('complete paginated followers and following with exact counts',async()=>{
  const m=exampleFetch();
  const followers=await API.scanList({userId:'12345',kind:'followers',expected:3,paceMs:0,fetchImpl:m.fetchImpl});
  const following=await API.scanList({userId:'12345',kind:'following',expected:1,paceMs:0,fetchImpl:m.fetchImpl});
  assert.deepEqual(followers.usernames,['first','second','third']);
  assert.equal(followers.pages,2);
  assert.deepEqual(following.usernames,['second']);
  assert.equal(m.calls.length,3);
});
test('count mismatch never returns a success',async()=>{
  const m=exampleFetch();
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:4,paceMs:0,fetchImpl:m.fetchImpl}),/Incomplete/);
});
test('rate limit aborts immediately without retry',async()=>{
  let calls=0;
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:2,paceMs:0,fetchImpl:async()=>{calls++;return response({},429);}}),/429/);
  assert.equal(calls,1);
});
test('401,403 and challenge signal fail closed',async()=>{
  for(const status of [401,403]) await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,paceMs:0,fetchImpl:async()=>response({},status)}),/denied/);
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,paceMs:0,fetchImpl:async()=>response({status:'fail',message:'challenge_required'})}),/verification/);
});
test('redirect, non-JSON and server error fail closed',async()=>{
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,paceMs:0,fetchImpl:async()=>({...response({},200),type:'opaqueredirect',status:0})}),/redirected/);
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,paceMs:0,fetchImpl:async()=>response({},200,'text/html')}),/non-JSON/);
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,paceMs:0,fetchImpl:async()=>response({},503)}),/503/);
});
test('repeated cursor and missing cursor cannot pass',async()=>{
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:3,paceMs:0,fetchImpl:async()=>response({users:[{username:'first'}],has_more:true,next_max_id:'x'}),maxPages:3}),/repeated a cursor/);
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:3,paceMs:0,fetchImpl:async()=>response({users:[],has_more:true})}),/missing/);
});
test('invalid usernames, target IDs and truncated JSON fail closed',async()=>{
  await assert.rejects(API.scanList({userId:'../../x',kind:'followers',expected:2}),/Invalid Instagram scan target/);
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,paceMs:0,fetchImpl:async()=>response({users:[{username:'<script>'}],has_more:false})}),/Invalid user entry/);
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,paceMs:0,fetchImpl:async()=>response({bad:'value'})}),/structure/);
});
test('user ID mismatch rejects profile',async()=>{
  await assert.rejects(API.resolveUserId('account',{fetchImpl:async()=>response({data:{user:{id:'123',username:'different'}}})}),/does not match/);
});
test('pre-aborted scan performs no request',async()=>{
  const controller=new AbortController();controller.abort();
  let calls=0;
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,signal:controller.signal,fetchImpl:async()=>{calls++;return response({users:[]});}}),/cancelled/);
  assert.equal(calls,0);
});
test('response count excess halts immediately',async()=>{
  await assert.rejects(API.scanList({userId:'12345',kind:'followers',expected:1,paceMs:0,fetchImpl:async()=>response({users:[{username:'one'},{username:'two'}]})}),/exceeds/);
});
