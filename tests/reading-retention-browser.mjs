import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = "work/private-reader/site", release = JSON.parse(await readFile(root + "/release.json"));
await mkdir("work/reading-retention", { recursive: true });
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
const origin = "http://127.0.0.1:" + server.address().port;
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
    const originalNow=Date.now;window.__time=0;Date.now=()=>originalNow()+window.__time;
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
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  if (await page.getByRole("button", { name: "Dismiss guide", exact: true }).isVisible()) await page.getByRole("button", { name: "Dismiss guide", exact: true }).click();
  await page.locator("#voice-settings").evaluate((e) => e.open = true);
  await page.selectOption("#engine", "browser");
  await page.selectOption("#voice", "native-a");
  const rows=()=>page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('paste2speech-device-audio-v1');q.onsuccess=()=>r(q.result);});const data=await new Promise(r=>{if(!db.objectStoreNames.contains('readings'))return r([]);const q=db.transaction('readings').objectStore('readings').getAll();q.onsuccess=()=>r(q.result);});db.close();return data;});
  const until=async check=>{const end=Date.now()+30000;while(!await check()){if(Date.now()>end)throw Error('Retention condition timed out: '+String(check));await page.waitForTimeout(50);}};
  async function add(n){await page.click('#clear');await page.fill('#text',`Reading ${n}: a preserved newsletter title.\n\nSecond section.\n\nThird section.`);await page.click('#play');await until(async()=>(await rows()).some(r=>r.text.startsWith(`Reading ${n}:`)));await page.click('#pause');}
  for(let n=1;n<=3;n++)await add(n);
  await page.click('#previous-reading');await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('Reading 2:'));
  await page.locator('#seek').evaluate(e=>{e.value='2';e.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal((await rows()).find(r=>r.text.startsWith('Reading 2:')).finishedAt,undefined);
  await page.click('#play');await page.evaluate(()=>__spoken.at(-1).onend());await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('All read'));
  assert.equal((await rows()).length,3,'End of final audio must not remove the current reading');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('Reading 2:'));assert.equal((await rows()).length,3,'Reloading the same completed reading is not moving on');
  await page.click('#next-reading');await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('Reading 3:'));await until(async()=>(await rows()).length===2);
  assert.ok(!(await rows()).some(r=>r.text.startsWith('Reading 2:')));
  for(let n=4;n<=21;n++){
    await add(n);const count=(await rows()).length;
    if(count===7||count===20){for(const width of [320,390,1100]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('#device-audio-list li').count(),0);assert.equal(await page.getByRole('button',{name:'Mark finished',exact:true}).count(),0);await page.screenshot({path:`work/reading-retention/queue-${count}-${width}.png`,fullPage:true});}}
  }
  assert.equal((await rows()).length,20);
  const migratedId=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('paste2speech-device-audio-v1');q.onsuccess=()=>r(q.result);});const records=await new Promise(r=>{const q=db.transaction('readings').objectStore('readings').getAll();q.onsuccess=()=>r(q.result);});const record=records[0];delete record.createdAt;delete record.sha256;record.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(record))))].map(n=>n.toString(16).padStart(2,'0')).join('');await new Promise(r=>{const tx=db.transaction('readings','readwrite');tx.objectStore('readings').put(record,[record.scope,record.id]);tx.oncomplete=r;});db.close();window.dispatchEvent(new Event('focus'));return record.id;});
  await until(async()=>Number.isFinite((await rows()).find(r=>r.id===migratedId)?.createdAt));const migrationTime=(await rows()).find(r=>r.id===migratedId).createdAt;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(100);assert.equal((await rows()).find(r=>r.id===migratedId).createdAt,migrationTime,'Unknown legacy age gets one fixed grace period, never renewed');
  assert.match(await page.locator('#device-readings').textContent(),/24 hours after adding/);
  // Active playback in this tab protects its reading from another tab's expiry.
  await page.click('#play');const activeText=await page.locator('#text').inputValue();
  const other=await context.newPage();await other.goto(origin);await other.waitForFunction(()=>document.querySelector('#text').value.startsWith('Reading 21:'));await context.setOffline(true);await other.evaluate(()=>{window.__time=86400001;window.dispatchEvent(new Event('focus'));});
  await until(async()=>(await rows()).length===1);assert.equal((await rows())[0].text,activeText);
  await page.evaluate(()=>{window.__time=86400001;window.dispatchEvent(new Event('focus'));});await page.waitForTimeout(200);assert.equal((await rows()).length,1,'Playing tab survives expiry');
  await page.click('#pause');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await until(async()=>(await rows()).length===0);
  assert.equal(await page.locator('#text').inputValue(),activeText,'Expiry must not modify editor text');
  assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/readings')),[]);assert.deepEqual(errors,[]);
  await context.close();console.log('PASS ephemeral native retention: seek alone never completes; real end retained until switch; fixed 24h expires paused/never-started; cross-tab active reading protected; 7/20 populated compact navigation at 320/390/1100; no library controls, editor intact, no paid calls.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
