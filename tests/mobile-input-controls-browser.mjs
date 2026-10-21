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
  assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),false);
  const original=await page.locator('#options input').evaluateAll(inputs=>inputs.map(input=>[input.id,input.checked]));
  await page.locator('#text-cleanup>summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),true);
  await page.locator('#clean-emoji').check();await page.locator('#text-cleanup>summary').click();assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),false);
  await page.evaluate(()=>clipboardText='First-run browser voice reading.');await page.click('#paste-play');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Reading aloud');assert.equal(await page.evaluate(()=>__spoken.at(-1).voice.voiceURI),'native-a');await page.click('#pause');
  for(const width of [320,360,412,1100]){
    await page.setViewportSize({width,height:915});
    const boxes=await page.locator('#document-choose-file,#clear,#paste-play').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return{id:button.id,x:r.x,y:r.y,width:r.width,height:r.height};}));
    assert.ok(Math.max(...boxes.map(b=>b.y))-Math.min(...boxes.map(b=>b.y))<2,JSON.stringify(boxes));assert.ok(boxes.every(b=>b.height>=44&&b.width>=44));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);
    await page.screenshot({path:`work/reading-history/mobile-controls-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:360,height:800});await page.locator('#file-options').focus();await page.keyboard.press('Enter');assert.ok(await page.locator('#file-options-menu').isVisible());await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'file-options');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#options input').length===8);assert.equal(await page.locator('#text-cleanup').evaluate(el=>el.open),false);assert.equal(await page.locator('#clean-emoji').isChecked(),true);await page.locator('#text-cleanup>summary').click();for(const [id,checked]of original)if(id!=='clean-emoji')assert.equal(await page.locator('#'+id).isChecked(),checked);
  assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/readings')||r.path.includes('synth')||r.method==='POST'&&r.path!=='/api/events'),[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({firstRunBrowserVoice:true,paidCalls:0,sameRowWidths:[320,360,412,1100],primaryTargets44:true,cleanupDisclosureKeyboard:true,cleanupPersisted:true,physicalPixel:false,errors}));
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
