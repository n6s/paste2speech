import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = "work/private-reader/site", release = JSON.parse(await readFile(root + "/release.json"));
await mkdir("work/unavailable-reading-voice", { recursive: true });
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
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  if (await page.getByRole("button", { name: "Dismiss guide", exact: true }).isVisible()) await page.getByRole("button", { name: "Dismiss guide", exact: true }).click();
  await page.locator("#voice-settings").evaluate((e) => e.open = true);
  await page.selectOption("#engine", "browser");
  await page.selectOption("#voice", "native-a");
  await page.waitForFunction(()=>localStorage.getItem('paste2speech.device-audio.scope')==='native-fixture');
  await page.fill('#text','Available first reading.\n\nSecond section.');await page.click('#play');await page.waitForFunction(async()=>(await __readingCount())===1);await page.click('#pause');
  const id=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('paste2speech-device-audio-v1');q.onsuccess=()=>r(q.result);});const records=await new Promise(r=>{const q=db.transaction('readings').objectStore('readings').getAll();q.onsuccess=()=>r(q.result);});const record={...records[0],id:'legacy-unavailable',key:'legacy-unavailable',generation:'missing-voice-g',text:'Unavailable saved voice reading.\n\nKept second section.',chunks:['Unavailable saved voice reading.','Kept second section.'],voice:'not-installed-on-this-device',createdAt:records[0].createdAt+1,updated:Date.now()+1};delete record.sha256;record.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(record))))].map(n=>n.toString(16).padStart(2,'0')).join('');await new Promise(r=>{const tx=db.transaction('readings','readwrite');tx.objectStore('readings').put(record,[record.scope,record.id]);tx.oncomplete=r;});db.close();window.dispatchEvent(new Event('focus'));return record.id;});
  await page.waitForFunction(()=>!document.querySelector('#next-reading').disabled);await context.setOffline(true);const spoken=await page.evaluate(()=>__spoken.length);await page.click('#next-reading');await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('Unavailable saved voice reading.')&&!document.querySelector('#play').disabled);
  assert.equal(await page.locator('#engine').inputValue(),'browser');assert.equal(await page.locator('#voice').inputValue(),'');assert.match(await page.locator('#device-audio-status').textContent(),/saved browser voice is unavailable/i);assert.equal(await page.evaluate(()=>__spoken.length),spoken,'Opening unavailable voice never autoplays');assert.ok(await page.locator('#previous-reading').isEnabled());
  await page.click('#previous-reading');await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('Available first reading.'));await page.click('#next-reading');await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('Unavailable saved voice reading.'));await page.selectOption('#voice','native-a');await page.waitForFunction(()=>!document.querySelector('#play').disabled);await page.click('#play');await page.waitForFunction(n=>__spoken.length>n,spoken);assert.equal(await page.evaluate(()=>__spoken.at(-1).voice.voiceURI),'native-a');await page.click('#pause');
  assert.equal(await page.evaluate(async()=>__readingCount()),2,'Choosing an available voice does not duplicate the reading');await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.click('#previous-reading');await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('Available first reading.'));await page.click('#next-reading');await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('Unavailable saved voice reading.'));assert.equal(await page.locator('#voice').inputValue(),'native-a');
  assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/readings')),[]);assert.deepEqual(errors,[]);await context.close();console.log('PASS unavailable saved browser voice: text/bookmark open offline without autoplay, navigation remains usable, available voice is kept on the same reading, reconnect does not require speech generation.');
}catch(error){console.error(await browser.contexts()[0].pages()[0].evaluate(()=>({text:document.querySelector("#text")?.value,engine:document.querySelector("#engine")?.value,voice:document.querySelector("#voice")?.value,status:document.querySelector("#device-audio-status")?.textContent,order:document.querySelector("#reading-order")?.textContent})));throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
