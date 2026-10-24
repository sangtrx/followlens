import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, computeLists } from '../extension/parser.mjs';
import { deflateRawSync } from 'node:zlib';

const ent = name => ({ title: '', string_list_data:[{ value:name, href:`https://www.instagram.com/${name}/`, timestamp:1720000000 }] });
const jf = names => JSON.stringify(names.map(ent));
const jg = names => JSON.stringify({ relationships_following: names.map(ent) });
const file = (name, text) => new File([text], name, { type:'application/json' });
function crc32(bytes) {
  const table = new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
  let crc=0xffffffff;for(let b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;
}
function makeZip(files) {
  const items=[], central=[]; let offset=0;
  for (const [name, content] of Object.entries(files)) {
    const fn=Buffer.from(name);const bytes=Buffer.from(content);const compressed=deflateRawSync(bytes);const crc=crc32(bytes);
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(compressed.length,18);l.writeUInt32LE(bytes.length,22);l.writeUInt16LE(fn.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(fn.length,28);c.writeUInt32LE(offset,42);
    const local=Buffer.concat([l,fn,compressed]);items.push(local);central.push(c,fn);offset+=local.length;
  }
  const cd=Buffer.concat(central); const e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(Object.keys(files).length,8);e.writeUInt16LE(Object.keys(files).length,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(offset,16);
  return new File([Buffer.concat([...items,cd,e])],'export.zip',{type:'application/zip'});
}

test('compare sets with case normalization', async () => {
  const data=await parseImport([file('followers_1.json',jf(['alice','Bob','nina'])),file('following.json',jg(['bob','carol']))]);
  const old=await parseImport([file('followers_1.json',jf(['alice','oldfriend','Bob']))],{requireFollowing:false});
  assert.deepEqual(data.followers,['alice','bob','nina']);
  assert.deepEqual(data.following,['bob','carol']);
  assert.deepEqual(computeLists(data,old),{
    notFollowingBack:['carol'],youDontFollowBack:['alice','nina'],mutual:['bob'],lost:['oldfriend'],gained:['nina']
  });
});
test('multi part followers import',async()=>{
  const current=await parseImport([file('followers_1.json',jf(['one'])),file('followers_2.json',jf(['two'])),file('following.json',jg(['one','three']))]);
  assert.equal(current.followers.length,2);assert.equal(current.followerParts,2);
});
test('reject incomplete multi part, duplicates, missing following, damaged JSON',async()=>{
  await assert.rejects(parseImport([file('followers_1.json',jf(['one'])),file('followers_3.json',jf(['two'])),file('following.json',jg(['x']))]),/Thiếu một phần/);
  await assert.rejects(parseImport([file('followers_1.json',jf(['one']))]),/Thiếu following/);
  await assert.rejects(parseImport([file('followers_1.json','bad'),file('following.json',jg(['x']))]),/JSON không hợp lệ/);
  await assert.rejects(parseImport([file('followers_1.json',jf(['one'])),file('followers_1.json',jf(['two'])),file('following.json',jg(['x']))]),/tệp trùng/);
});
test('ZIP DEFLATE parse, ignore other content',async()=>{
  const zip=makeZip({
    'instagram-name-2026/connections/followers_and_following/followers_1.json':jf(['a','b']),
    'instagram-name-2026/connections/followers_and_following/following.json':jg(['a','c']),
    'instagram-name-2026/personal_information/sensitive.json':JSON.stringify({secret:'SECRET'})
  });
  const current=await parseImport([zip]);assert.deepEqual(current.followers,['a','b']);assert.deepEqual(current.following,['a','c']);
});
test('reject malformed entry and fall back to valid username href',async()=>{
  const valid=JSON.stringify([{title:'',string_list_data:[{href:'https://www.instagram.com/_u/Good_Name/',value:''}]}]);
  const current=await parseImport([file('followers_1.json',valid),file('following.json',jg(['Good_Name']))]);
  assert.deepEqual(current.followers,['good_name']);
  const bad=JSON.stringify([{title:'<script>alert(1)</script>',string_list_data:[{value:'=',href:'https://evil.test/foo'}]}]);
  await assert.rejects(parseImport([file('followers_1.json',bad),file('following.json',jg(['foo']))]),/không đọc được/);
});
