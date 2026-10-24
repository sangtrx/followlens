const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');
test('case insensitive, deterministic normalized relationships', () => {
  const r=core.compare(['Alice','bob'],['BOB','New_User'],['bob','x']);
  assert.deepEqual(r.lost,['alice']);assert.deepEqual(r.gained,['new_user']);
  assert.deepEqual(r.notFollowingBack,['x']);assert.deepEqual(r.mutual,['bob']);
});
test('delta history reconstructs snapshots exactly', () => {
  let current=['alice','Bob','cat'];
  for(let i=0;i<50;i++){
    const next=i%2?['cat','new'+i]:['cat','bob','alice','new'+i];
    const d=core.delta(current,next);
    assert.deepEqual(core.applyDelta(current,d),core.normalize(next));current=next;
  }
});
test('exact counts and scroll-end required for persistence', () => {
  const good={followers:['Alice','Bob'],following:['alice'],expectedFollowers:2,expectedFollowing:1,reachedEndFollowers:true,reachedEndFollowing:true,full:true};
  assert.deepEqual(core.validateScan(good),{followers:['alice','bob'],following:['alice']});
  assert.throws(()=>core.validateScan({...good,expectedFollowers:3}),/incomplete/);
  assert.throws(()=>core.validateScan({...good,reachedEndFollowers:false}),/incomplete/);
  assert.throws(()=>core.validateScan({...good,expectedFollowing:null}),/incomplete/);
});
test('follower-only scans do not require following or overwrite it',()=>{
  const r=core.validateScan({followers:[],following:null,expectedFollowers:0,expectedFollowing:null,reachedEndFollowers:true,reachedEndFollowing:false,full:false});
  assert.equal(r.following,null);assert.deepEqual(r.followers,[]);
});
test('large unexpected losses trigger protective gate',()=>{
  const list=Array.from({length:100},(_,i)=>'person'+i);
  assert.equal(core.suspicious(list,list.slice(20)),true);
  assert.equal(core.suspicious(list,list.slice(2)),false);
});
test('username validation rejects unsafe CSV/script payloads',()=>{
  assert.throws(()=>core.normalize(['=1+1']),/Invalid/);
  assert.throws(()=>core.normalize(['foo/bar']),/Invalid/);
});
