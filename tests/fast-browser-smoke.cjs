/*
 * Browser fixture against a synthetic page only. No instagram.com network use.
 * To run: NODE_PATH=/path/to/node_modules CHROME_PATH=/usr/bin/google-chrome node tests/fast-browser-smoke.cjs
 */
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = resolve(__dirname, '..');
const adapter = readFileSync(resolve(root,'extension/fast-api.js'),'utf8');
const capture = readFileSync(resolve(root,'extension/capture.js'),'utf8')
  .replaceAll("location.pathname.split('/').filter(Boolean)", "['testowner']")
  .replace("!['instagram.com', 'www.instagram.com'].includes(location.hostname)", 'false')
  .replace('location.origin', "'https://www.instagram.com'");
const html = '<html><body><header><ul>' +
    '<li>5 posts</li><li style="cursor:pointer"><span>3</span> followers</li>' +
    '<li style="cursor:pointer"><span>2</span> following</li></ul></header></body></html>';
async function scenario(browser,mode) {
  const page=await browser.newPage();
  await page.setContent(html);
  await page.evaluate((scenario) => {
    window.__messages=[];window.__network=[];window.__counter=0;
    window.chrome={runtime:{sendMessage:async (m)=>{
      window.__messages.push(m);
      if(m.type==='GET_SUMMARY')return {ok:true,result:{following:null}};
      if(m.type==='FAST_SCAN_RESERVE')return {ok:true,result:{reserved:true}};
      if(m.type==='SAVE_FAST_SCAN')return {ok:true,result:{id:1,followerCount:m.followers.length}};
      return {ok:true,result:{}};
    }}};
    window.fetch=async (path, opts)=>{
      window.__network.push({path,method:opts.method,credentials:opts.credentials});
      const json=(body,status=200)=>({ok:status===200,status,headers:{get:()=> 'application/json'},json:async()=>body});
      if(path.includes('web_profile_info'))return json({data:{user:{id:'123',username:'testowner'}}});
      if(scenario==='429')return json({},429);
      if(path.includes('followers'))return json({users:[{username:'first'},{username:'second'},{username:'third'}],has_more:false});
      if(path.includes('following'))return json({users:[{username:'first'},{username:'second'}],has_more:false});
      return json({},404);
    };
  },mode);
  await page.addScriptTag({content:adapter});
  await page.addScriptTag({content:capture});
  const inspect=(js)=>page.locator('#followlens-auto-host').evaluate((host,expr)=>Function('root','return '+expr)(host.shadowRoot),js);
  assert.equal(await page.evaluate('window.__network.length'),0, 'No background requests on mere injection');
  assert.equal(await inspect('root.getElementById("fast").disabled'),true, 'Fast API disabled by default');
  // Programmatic page events must never turn on Fast API.
  await page.locator('#followlens-auto-host').evaluate(host=>{
    const shadow=host.shadowRoot, consent=shadow.getElementById('fastConsent');
    consent.checked=true;
    consent.dispatchEvent(new Event('change',{bubbles:true}));
    shadow.getElementById('fast').click();
  });
  assert.equal(await page.evaluate('window.__network.length'),0, 'Untrusted page events cannot trigger Fast API');
  assert.equal(await inspect('root.getElementById("fast").disabled'),true);
  await page.locator('#followlens-auto-host #fastConsent').check();
  await page.locator('#followlens-auto-host #fast').click();
  await page.waitForFunction(() => {
    const root=document.querySelector('#followlens-auto-host')?.shadowRoot;
    return root && !root.getElementById('run').disabled;
  },null,{timeout:15000});
  const status=await inspect('root.getElementById("status").textContent');
  const history=await page.evaluate('window.__messages');
  const network=await page.evaluate('window.__network');
  if(mode==='429'){
    assert.match(status,/429/);
    assert.equal(history.filter(x=>x.type==='SAVE_FAST_SCAN').length,0);
    assert.equal(network.length,2);
  }else{
    assert.match(status,/đã lưu mốc/);
    const saved=history.filter(x=>x.type==='SAVE_FAST_SCAN');
    assert.equal(saved.length,1);
    assert.equal(saved[0].followers.length,3);
    assert.equal(saved[0].following.length,2);
    assert.equal(network.length,3);
    assert(network.every(x=>x.method==='GET' && x.credentials==='include'));
  }
  assert.equal(await page.locator('[role="dialog"]').count(),0,'No Instagram dialogs');
  await page.close();
  console.log('PASS browser Fast API opt-in '+mode+' no scroll, no premature persistence');
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
  try{
    await scenario(browser,'ok');
    await scenario(browser,'429');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
