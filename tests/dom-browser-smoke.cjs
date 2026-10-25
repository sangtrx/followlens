/* Browser fixture: the v2.1 manual-mode UI must still run old DOM Smart Scan. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.resolve(__dirname,'../extension/capture.js'),'utf8')
 .replaceAll("location.pathname.split('/').filter(Boolean)","['testowner']")
 .replaceAll("!['instagram.com', 'www.instagram.com'].includes(location.hostname)",'false')
 .replaceAll('location.origin',"'https://www.instagram.com'")
 .replace('const PAUSE_MS = 340;', 'const PAUSE_MS = 30;')
 .replace('setTimeout(finish, 1800)','setTimeout(finish, 70)')
 .replace('await sleep(750);','await sleep(10);')
 .replace('await sleep(350);','await sleep(12);')
 .replace('await sleep(400);','await sleep(15);');
const html='<html><style>.roll{height:130px;overflow-y:auto;width:300px}.canvas{height:260px}.person{height:32px;display:block}</style><body>'+
 '<header><a href="/testowner/followers/" id="fl">5 followers</a> <a href="/testowner/following/" id="fg">3 following</a></header>'+
 '<section id="modal"></section><script>'+
 'window.__opened=[];function show(kind){window.__opened.push(kind);let d=document.createElement("div");d.setAttribute("role","dialog");'+
 'let close=document.createElement("button");close.setAttribute("aria-label","Close");close.onclick=()=>d.remove();d.append(close);'+
 'let roll=document.createElement("div");roll.className="roll";let canvas=document.createElement("div");canvas.className="canvas";'+
 'let names=kind==="followers"?["alpha","bravo","charlie","delta","echo"]:["alpha","bravo","charlie"];'+
 'for(let name of names){let a=document.createElement("a");a.className="person";a.href="https://www.instagram.com/"+name+"/";a.textContent=name;canvas.append(a)};'+
 'roll.append(canvas);d.append(roll);document.querySelector("#modal").replaceChildren(d)};'+
 'document.querySelector("#fl").onclick=e=>{e.preventDefault();show("followers")};'+
 'document.querySelector("#fg").onclick=e=>{e.preventDefault();show("following")};'+
 '</script></body></html>';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.setContent(html);
  await page.evaluate(()=>{
   window.__messages=[];
   window.chrome={runtime:{sendMessage:async(m)=>{
      window.__messages.push(m);
      if(m.type==='GET_SUMMARY')return{ok:true,result:{following:null}};
      if(m.type==='SAVE_SCAN')return{ok:true,result:{id:1,followerCount:m.followers.length,lostCount:null,gainedCount:null}};
      return{ok:true,result:{}};
   }}};
  });
  await page.addScriptTag({content:source});
  assert.equal(await page.evaluate('window.__messages.length'),0,'no auto-run on toolbar click');
  await page.locator('#followlens-auto-host #run').click();
  await page.waitForFunction(()=>{
   const h=document.querySelector('#followlens-auto-host');
   const root=h?.shadowRoot;
   return root && !root.getElementById('run').disabled;
  },null,{timeout:15000});
  const status=await page.locator('#followlens-auto-host').evaluate(h=>h.shadowRoot.getElementById('status').textContent);
  const messages=await page.evaluate('window.__messages');
  const opened=await page.evaluate('window.__opened');
  assert.match(status,/Đã lưu mốc/,status);
  const saved=messages.find(x=>x.type==='SAVE_SCAN');
  assert(saved && saved.followers.length===5 && saved.following.length===3);
  assert.deepEqual(opened,['followers','following']);
  console.log('PASS preserved DOM Smart Scan: manual launch, both lists, exact-count save');
  await page.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
