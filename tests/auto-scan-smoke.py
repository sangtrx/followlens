"""Deterministic Chromium DOM integration smoke test. NEVER opens Instagram."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / 'extension' / 'capture.js').read_text(encoding='utf-8')
SCRIPT = SCRIPT.replace('const PAUSE_MS = 700;', 'const PAUSE_MS = 30;')
SCRIPT = SCRIPT.replace("location.pathname.split('/').filter(Boolean)", "['testowner']")
SCRIPT = SCRIPT.replace("!['instagram.com', 'www.instagram.com'].includes(location.hostname)", "false")
SCRIPT = SCRIPT.replace("location.origin", "'https://www.instagram.com'")
SCRIPT = SCRIPT.replace('await sleep(750);', 'await sleep(10);')
SCRIPT = SCRIPT.replace('await sleep(350);', 'await sleep(12);')
SCRIPT = SCRIPT.replace('await sleep(400);', 'await sleep(15);')
SCRIPT = SCRIPT.replace('setTimeout(finish, 1800)', 'setTimeout(finish, 70)')
MOCK = r'''<!doctype html><html><style>
.roll {height:130px;overflow-y:auto;width:300px;}.canvas{position:relative}.person{position:absolute;left:0;height:28px}
[role=dialog]{width:350px;border:1px solid #555}
</style><body><header><a href="/testowner/followers/" id="followersLink">23 followers</a><a href="/testowner/following/" id="followingLink">17 following</a></header>
<div id="modal"></div><script>
window.__fixture={followers:Array.from({length:23},(_,i)=>'fuser'+i),following:Array.from({length:17},(_,i)=>'fuser'+(i+10)),opened:[]};
function show(kind){
  window.__fixture.opened.push(kind);
  const d=document.createElement('div');d.setAttribute('role','dialog');
  const close=document.createElement('button');close.setAttribute('aria-label','Close');close.textContent='X';close.onclick=()=>d.remove();
  const box=document.createElement('div');box.className='roll';
  const canvas=document.createElement('div');canvas.className='canvas';
  const list=window.__fixture[kind];canvas.style.height=(list.length*28)+'px';box.append(canvas);d.append(close,box);
  document.querySelector('#modal').replaceChildren(d);
  function render(){let start=Math.max(0,Math.floor(box.scrollTop/28)-1),end=Math.min(list.length,start+8);canvas.replaceChildren();for(let i=start;i<end;i++){const a=document.createElement('a');a.className='person';a.style.top=(i*28)+'px';a.href='https://www.instagram.com/'+list[i]+'/';a.textContent=list[i];canvas.append(a);}}
  box.addEventListener('scroll',render);render();
}
for(const kind of ['followers','following'])document.querySelector('#'+kind+'Link').addEventListener('click',e=>{e.preventDefault();show(kind)});
</script></body></html>'''

async def run_case(browser, previous=False, wrong_count=False):
    page=await browser.new_page()
    await page.set_content(MOCK)
    if wrong_count:
        await page.evaluate("document.querySelector('#followersLink').textContent='24 followers'")
    await page.evaluate('''() => {
      window.__sent=[];
      window.chrome={runtime:{sendMessage:async (msg)=>{
        window.__sent.push(msg);
        if(msg.type==='GET_SUMMARY') return {ok:true,result:{following:window.__previous?{usernames:['a']}:null}};
        if(msg.type==='SAVE_SCAN') return {ok:true,result:{id:2,followerCount:msg.followers.length,lostCount:0,gainedCount:0}};
        return {ok:true,result:{}};
      }}};
    }''')
    if previous:
        await page.evaluate('window.__previous=true')
    await page.add_script_tag(content=SCRIPT)
    await page.wait_for_function('''() => {const h=document.querySelector('#followlens-auto-host');return h && !h.shadowRoot.getElementById('run').disabled;}''', timeout=15000)
    status=await page.locator('#followlens-auto-host').evaluate('(el)=>el.shadowRoot.getElementById("status").textContent')
    sent=await page.evaluate('window.__sent')
    opened=await page.evaluate('window.__fixture.opened')
    await page.close()
    return status,sent,opened

async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await browser.new_page()
        requests=[]
        # Mock pages use set_content and never navigate to instagram.com.
        await page.close()
        status, sent, opened=await run_case(browser)
        assert 'Đã lưu mốc' in status, status
        assert opened==['followers','following'],opened
        scan=next(x for x in sent if x['type']=='SAVE_SCAN')
        assert len(scan['followers'])==23 and len(scan['following'])==17 and scan['full']
        print('PASS full scan: auto-open + virtualized scroll + save')
        status, sent, opened=await run_case(browser,previous=True)
        assert 'Đã lưu mốc' in status, status
        assert opened==['followers'],opened
        scan=next(x for x in sent if x['type']=='SAVE_SCAN')
        assert scan['following'] is None and not scan['full']
        print('PASS incremental scan: followers only; no extra Following scan')
        status, sent, opened=await run_case(browser,wrong_count=True)
        assert 'chưa xác thực đầy đủ' in status.lower(),status
        assert not any(x['type']=='SAVE_SCAN' for x in sent)
        print('PASS incomplete scan: refuses persistence')
        await browser.close()

if __name__=='__main__': asyncio.run(main())
