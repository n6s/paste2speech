import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = "work/private-reader/site", release = JSON.parse(await readFile(root + "/release.json"));
await mkdir("work/reading-history", { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    const file = path === "/" ? "index.html" : path.slice(1);
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/html");
    res.end(await readFile(root + "/" + file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = process.env.READER_ORIGIN||"http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const requests = [], errors = [];
let accountScope="native-fixture";
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push({ path: url.pathname, method: request.method() });
    let body = url.pathname === "/api/reader" ? { eligible: true, accessAllowed: true, account: { balance: 0, creditRequired: true } } : url.pathname === "/api/ocr/jobs/config" ? { enabled: false, durable: true, consentScope: accountScope } : {};
    return route.fulfill({ status: url.pathname === "/api/events" ? 204 : url.pathname === "/api/ocr/jobs/config" && !accountScope ? 401 : 200, contentType: "application/json", body: url.pathname === "/api/events" ? "" : JSON.stringify(body) });
  });
  await context.addInitScript(() => {
    window.__readingCount=async()=>{const db=await new Promise(r=>{const q=indexedDB.open("paste2speech-device-audio-v1");q.onsuccess=()=>r(q.result);});const n=await new Promise(r=>{const q=db.transaction("readings").objectStore("readings").getAll();q.onsuccess=()=>r(q.result.filter(record=>record.scope===(localStorage.getItem("paste2speech.device-audio.scope")||localStorage.getItem("paste2speech.browser-history.scope"))).length);});db.close();return n;};
    const synth = new EventTarget();
    window.__spoken = [];
    window.__nativeVoices = [{ name: "Native A", voiceURI: "native-a", lang: "en-US", localService: true }, { name: "Native B", voiceURI: "native-b", lang: "en-GB", localService: true }];
    synth.getVoices = () => __nativeVoices;
    synth.cancel = () => {
    };
    synth.speak = (u) => {
      __spoken.push(u);
      queueMicrotask(() => u.onstart?.());
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth });
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    window.clipboardText = "";
    Object.defineProperty(navigator, "clipboard", { value: { readText: async () => clipboardText } });
  });
  if(process.env.READER_ORIGIN){const{execFileSync}=await import('node:child_process');const token=execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();await context.addCookies([{name:'CF_Authorization',value:token,url:origin}]);}
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  if (await page.getByRole("button", { name: "Dismiss guide", exact: true }).isVisible()) await page.getByRole("button", { name: "Dismiss guide", exact: true }).click();
  await page.locator("#voice-settings").evaluate((e) => e.open = true);
  await page.selectOption("#engine", "browser");
  await page.selectOption("#voice", "native-a");
  assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),false);
  const expectedLabels=['Remove Markdown formatting','Skip citation markers and footnotes','Skip web addresses','Skip code blocks','Skip tables','Skip emoji','Join broken lines','Skip math notation'];
  assert.deepEqual(await page.locator('#options > label').allTextContents(),expectedLabels);
  assert.deepEqual(await page.locator('#options input').evaluateAll(inputs=>inputs.map(input=>input.getAttribute('aria-label'))),expectedLabels);
  const original=await page.locator('#options input').evaluateAll(inputs=>inputs.map(input=>[input.id,input.checked]));
  assert.deepEqual(original,[['clean-markdown',true],['clean-citations',true],['clean-urls',true],['clean-code',true],['clean-tables',true],['clean-emoji',false],['clean-joinLines',true],['clean-math',false]]);
  await page.locator('#text-cleanup>summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),true);
  await page.locator('#clean-emoji').check();await page.locator('#text-cleanup>summary').click();assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),false);
  await page.evaluate(()=>clipboardText='First-run browser voice reading.');await page.click('#paste-play');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Reading aloud');assert.equal(await page.evaluate(()=>__spoken.at(-1).voice.voiceURI),'native-a');await page.click('#pause');assert.equal(await page.locator('#reading-queue').isVisible(),false);assert.equal(await page.locator('#reading-navigation').isVisible(),false);
  for(const width of [320,360,412,1100]){
    await page.setViewportSize({width,height:915});
    const boxes=await page.locator('#document-choose-file,#clear,#paste-play').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return{id:button.id,x:r.x,y:r.y,width:r.width,height:r.height};}));
    assert.ok(Math.max(...boxes.map(b=>b.y))-Math.min(...boxes.map(b=>b.y))<2,JSON.stringify(boxes));assert.ok(boxes.every(b=>b.height>=44&&b.width>=44));
    const gaps=await page.evaluate(()=>{const bounds=id=>{const e=document.getElementById(id);return (id==='clear'?e:e.closest('.input-action-group')).getBoundingClientRect();};const file=bounds('document-choose-file'),clear=bounds('clear'),paste=bounds('paste-play');return{left:clear.left-file.right,right:paste.left-clear.right};});assert.ok(gaps.left>=4&&gaps.right>=4&&Math.abs(gaps.left-gaps.right)<=1,'Clear balanced separation: '+JSON.stringify({width,...gaps}));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);
    await page.screenshot({path:`work/reading-history/mobile-controls-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:360,height:800});await page.locator('#file-options').focus();await page.keyboard.press('Enter');assert.ok(await page.locator('#file-options-menu').isVisible());await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'file-options');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#options input').length===8);assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),false);assert.equal(await page.locator('#clean-emoji').isChecked(),true);await page.locator('#text-cleanup>summary').click();for(const [id,checked]of original)if(id!=='clean-emoji')assert.equal(await page.locator('#'+id).isChecked(),checked);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#text-cleanup')?.open===true);
  await page.evaluate(()=>clipboardText='Disclosure preference survives Paste and Play.');await page.click('#paste-play');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Reading aloud');assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),true);await page.click('#pause');
  await page.locator('#text-cleanup>summary').click();await page.reload();await page.waitForFunction(()=>document.querySelector('#text-cleanup')&&!document.querySelector('#text-cleanup').open);
  await page.locator('#text-cleanup').evaluate(el=>el.open=true);await page.reload();await page.waitForFunction(()=>document.querySelector('#text-cleanup')&&!document.querySelector('#text-cleanup').open);
  await page.locator('#pdf-file').setInputFiles({name:'disclosure-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Local import keeps the cleanup section collapsed.')});await page.waitForFunction(()=>document.querySelector('#text').value.includes('Local import keeps'));assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),false);
  await page.locator('#text-cleanup>summary').click();
  for(const width of [320,360,412,1100])for(const scale of [1,2]){await page.setViewportSize({width,height:915});await page.evaluate(scale=>document.documentElement.style.fontSize=16*scale+'px',scale);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Expanded cleanup overflow '+width+'/'+scale);for(const label of await page.locator('#options > label').all()){const box=await label.boundingBox();assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=width+1);}if(scale===1)await page.screenshot({path:`work/reading-history/cleanup-actions-${width}.png`,fullPage:true});}
  await page.evaluate(()=>document.documentElement.style.fontSize='16px');await page.click('#edit-mode');if(await page.locator('#stop').isEnabled())await page.click('#stop');
  const linked='Read [the guide](https://example.test/guide). Visit https://example.test/raw.';await page.fill('#text',linked);await page.getByRole('checkbox',{name:'Skip web addresses',exact:true}).uncheck();assert.match(await page.locator('#preview').textContent(),/https:\/\/example/);await page.getByRole('checkbox',{name:'Skip web addresses',exact:true}).check();assert.match(await page.locator('#preview').textContent(),/the guide/);assert.doesNotMatch(await page.locator('#preview').textContent(),/https:\/\//);assert.equal(await page.locator('#text').inputValue(),linked);
  await page.fill('#text','Keep **these words**.');await page.getByRole('checkbox',{name:'Remove Markdown formatting',exact:true}).uncheck();assert.match(await page.locator('#preview').textContent(),/\*\*these words\*\*/);await page.getByRole('checkbox',{name:'Remove Markdown formatting',exact:true}).check();assert.equal(await page.locator('#preview').textContent(),'Keep these words.');assert.equal(await page.locator('#text').inputValue(),'Keep **these words**.');
  await page.addInitScript(()=>{for(const method of ['getItem','setItem']){const original=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(key==='paste2speech.ui.text-cleanup.open')throw new DOMException('Synthetic storage denial','SecurityError');return original.call(this,key,...args);};}});
  await page.reload();await page.waitForFunction(()=>document.querySelector('#text-cleanup')&&!document.querySelector('#text-cleanup').open);await page.locator('#text-cleanup>summary').click();assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),true);await page.reload();await page.waitForFunction(()=>document.querySelector('#text-cleanup')&&!document.querySelector('#text-cleanup').open);
  assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/readings')||r.path.includes('synth')||r.method==='POST'&&r.path!=='/api/events'),[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({cleanupActionLabels:true,defaultsUnchanged:true,linkWordsPreserved:true,markdownWordsPreserved:true,expandedZoom200:true,firstRunBrowserVoice:true,paidCalls:0,sameRowWidths:[320,360,412,1100],primaryTargets44:true,cleanupDisclosureKeyboard:true,cleanupPersisted:true,disclosureOpenAndClosedPersist:true,disclosureSurvivesPasteAndImport:true,programmaticOpenDoesNotPersist:true,storageDenialSafe:true,clearBalancedGaps:true,physicalPixel:false,errors}));
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
