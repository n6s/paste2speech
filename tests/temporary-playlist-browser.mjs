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
  await page.fill("#text", "First native section.\n\nSecond native section.\n\nThird native section.");
  await page.click("#play");
  await page.waitForFunction(async () => document.querySelector("#status").textContent === "Reading aloud");
  assert.equal(await page.evaluate(() => __spoken.at(-1).voice.voiceURI), "native-a");
  await page.evaluate(() => __spoken.at(-1).onboundary({ name: "word", charIndex: 6 }));
  await page.click("#pause");
  await page.click("#play");
  assert.equal(await page.evaluate(() => __spoken.at(-1).text), "native section.");
  await page.click("#pause");
  await page.locator("#seek").evaluate((e) => {
    e.value = "2";
    e.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.match(await page.locator("#status").textContent(), /Paused/);
  await page.click("#play");
  assert.equal(await page.evaluate(() => __spoken.at(-1).text), "Third native section.");
  assert.equal(await page.locator("#offline-progress").isVisible(), false);
  await page.click("#pause");
  const ids=()=>page.locator('#queue-items li').evaluateAll(rows=>rows.map(row=>row.dataset.queueId));
  const waitRows=n=>page.waitForFunction(n=>document.querySelectorAll('#queue-items li').length===n,n);
  const enqueue=async text=>{await page.evaluate(text=>clipboardText=text,text);await page.click('#paste-options');await page.click('#paste-queue');};
  await waitRows(1);const first=(await ids())[0];
  await enqueue('Second newsletter.');await waitRows(2);const second=(await ids())[1];
  await page.click('#next-reading');await page.waitForFunction(()=>document.querySelector('#text').value==='Second newsletter.'&&!document.querySelector('#play').disabled);
  assert.deepEqual(await ids(),[first,second]);
  const spokenBefore=await page.evaluate(()=>__spoken.length);await page.click('#play');await page.evaluate(()=>__spoken.at(-1).onboundary({name:'word',charIndex:7}));await page.click('#pause');
  await context.setOffline(true);await page.click('#previous-reading');await page.waitForFunction(()=>document.querySelector('#text').value.startsWith('First native'));
  await page.click('#next-reading');await page.waitForFunction(()=>document.querySelector('#text').value==='Second newsletter.');
  assert.equal(await page.evaluate(()=>__spoken.length),spokenBefore+1);await page.click('#play');assert.equal(await page.evaluate(()=>__spoken.at(-1).text),'newsletter.');await page.click('#pause');await context.setOffline(false);
  await page.locator('#reading-queue').evaluate(el=>el.open=true);
  await page.getByLabel('Actions: Second newsletter.',{exact:true}).click();await page.getByRole('button',{name:'Move up: Second newsletter.',exact:true}).click();await page.waitForFunction(first=>document.querySelector('#queue-items li')?.dataset.queueId!==first,first);
  assert.deepEqual(await ids(),[second,first]);assert.equal(await page.locator('#reading-order').textContent(),'Reading 1 of 2');
  await page.evaluate(()=>clipboardText='');await page.click('#paste-play');assert.deepEqual(await ids(),[second,first]);assert.equal(await page.locator('#text').inputValue(),'Second newsletter.');
  // Pending text is recoverable after reload without starting speech or a paid job.
  await enqueue('Third queued newsletter.');await waitRows(3);const beforeReload=await ids();await page.waitForTimeout(300);await page.reload();await waitRows(3);
  assert.deepEqual(await ids(),beforeReload);assert.equal(await page.evaluate(()=>__spoken.length),0);
  await page.locator('#reading-queue').evaluate(el=>el.open=true);
  await page.getByRole('button',{name:'Open reading: Third queued newsletter.',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#text').value==='Third queued newsletter.'&&!document.querySelector('#play').disabled);
  await waitRows(3);assert.deepEqual(await ids(),beforeReload);
  // Identical text intentionally enqueued twice remains two distinct logical entries.
  await enqueue('Third queued newsletter.');await waitRows(4);assert.equal(new Set(await ids()).size,4);
  await page.locator('#reading-queue').evaluate(el=>el.open=true);
  for(const width of [320,390,1100]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`work/reading-history/unified-after-${width}.png`,fullPage:true});}
  // Replacement retires membership immediately, but another tab's active audio
  // retains its physical source until it safely stops.
  const peer=await context.newPage();await peer.goto(origin);await peer.waitForFunction(()=>document.querySelector('#text').value==='Third queued newsletter.'&&!document.querySelector('#play').disabled);await peer.click('#play');
  const protectedId=(await ids())[2];
  await page.evaluate(()=>clipboardText='Successful replacement.');await page.click('#paste-play');await waitRows(1);await page.waitForFunction(()=>document.querySelector('#status').textContent==='Reading aloud');assert.equal(await page.locator('#text').inputValue(),'Successful replacement.');
  assert.ok(!(await ids()).some(id=>beforeReload.includes(id)));await page.click('#pause');
  assert.equal(await peer.locator('#status').textContent(),'Reading aloud');
  const retained=await page.evaluate(async id=>{const db=await new Promise(r=>{const q=indexedDB.open('paste2speech-device-audio-v1');q.onsuccess=()=>r(q.result);});const result=await new Promise(r=>{const q=db.transaction('readings').objectStore('readings').get(['native-fixture',id]);q.onsuccess=()=>r(!!q.result);});db.close();return result;},protectedId);assert.equal(retained,true);
  await peer.click('#pause');await peer.evaluate(()=>window.dispatchEvent(new Event('focus')));await peer.close();

  await enqueue('After completion.');await waitRows(2);
  await page.click('#play');await page.evaluate(()=>__spoken.at(-1).onend());
  await page.waitForFunction(()=>document.querySelector('#text').value==='After completion.');await waitRows(1);
  await page.click('#pause');await page.locator('#reading-queue').evaluate(el=>el.open=true);await page.getByLabel('Actions: After completion.',{exact:true}).click();await page.getByRole('button',{name:'Remove: After completion.',exact:true}).click();await waitRows(0);await page.waitForTimeout(700);assert.equal(await page.locator('#queue-items li').count(),0,'Removing the current reading must not silently save it again');
  assert.equal(await page.locator('#device-audio-list li').count(),0);
  assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/readings')||r.path.includes('synth')||r.method==='POST'&&r.path!=='/api/events'),[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({singlePlaylist:true,reorder:true,offlineBookmark:true,failedPastePreserves:true,successfulPasteReplaces:true,reloadPendingWithoutAutoplay:true,distinctIntentionalDuplicates:true,completedMovedRetires:true,widths:[320,390,1100],paidCalls:0,errors,physicalPixel:false}));
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
