import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = process.env.READER_SITE || "work/private-reader/site", release = JSON.parse(await readFile(root + "/release.json"));
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
      if(window.holdNativeStart)window.releaseNativeStart=()=>{window.holdNativeStart=false;u.onstart?.();};else queueMicrotask(() => u.onstart?.());
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth });
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    window.clipboardText = "";
    Object.defineProperty(navigator, "clipboard", { value: { readText: async () => {if(window.holdClipboard)await new Promise(resolve=>window.releaseQueuedClipboard=()=>{window.holdClipboard=false;resolve();});return clipboardText;} } });
  });
  const page = await context.newPage();page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => (errors.push(e.message),console.error(e.message)));
  await page.goto(origin);
  if (await page.getByRole("button", { name: "Dismiss guide", exact: true }).isVisible()) await page.getByRole("button", { name: "Dismiss guide", exact: true }).click();
  await page.locator("#voice-settings").evaluate((e) => e.open = true);
  await page.selectOption("#engine", "browser");
  await page.selectOption("#voice", "native-a");

  const rows=()=>page.locator('#queue-items li').count();
  const waitRows=n=>page.waitForFunction(n=>document.querySelectorAll('#queue-items li').length===n,n);
  const enqueue=async text=>{await page.evaluate(text=>clipboardText=text,text);await page.click('#paste-options');await page.click('#paste-queue');await page.waitForFunction(text=>[...document.querySelectorAll('.queue-title')].some(row=>row.textContent.includes(text)),text);};
  const paste=async text=>{await page.evaluate(text=>clipboardText=text,text);await page.click('#paste-play');await playing(text);};
  const playing=text=>page.waitForFunction(text=>document.querySelector('#text').value===text&&document.querySelector('#status').textContent==='Reading aloud',text);
  const finish=()=>page.evaluate(()=>__spoken.at(-1).onend());
  await page.evaluate(()=>window.holdNativeStart=true);await enqueue('Waiting for speech.');await waitRows(1);assert.equal(await page.locator('#reading-queue').isVisible(),true);await page.click('#play');await page.waitForFunction(()=>!!window.releaseNativeStart);assert.equal(await page.locator('#reading-queue').isVisible(),true,'requesting playback is not audible playback');await page.evaluate(()=>releaseNativeStart());await page.waitForFunction(()=>document.querySelector('#reading-queue').hidden);await page.click('#pause');assert.equal(await page.locator('#reading-queue').isVisible(),false);await page.click('#stop');await page.waitForFunction(()=>!document.querySelector('#reading-queue').hidden);await page.locator('#reading-queue').evaluate(el=>el.open=true);await page.getByLabel('Actions: Waiting for speech.',{exact:true}).click();await page.getByRole('button',{name:'Mark as read: Waiting for speech.',exact:true}).click();await waitRows(0);
  await paste('The Verdict political episode.');await enqueue('Coast one.');await enqueue('Coast two.');await waitRows(3);
  await page.evaluate(()=>__spoken.at(-1).onboundary({name:'word',charIndex:4}));
  await page.evaluate(()=>window.skippedUtterance=__spoken.at(-1));
  await page.click('#next-reading');await playing('Coast one.');await waitRows(3);
  await page.evaluate(()=>skippedUtterance.onend());await waitRows(3);assert.equal(await page.locator('#text').inputValue(),'Coast one.','late skipped utterance completion must not retire or replace current reading');
  await finish();await playing('Coast two.');await waitRows(2);
  await finish();await waitRows(1);assert.equal(await page.locator('#reading-queue').isVisible(),true);assert.equal(await page.locator('#next-reading').isDisabled(),true);
  const count=await page.evaluate(()=>__spoken.length);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>__spoken.length),count,'end of forward traversal must not wrap');
  assert.equal(await page.locator('#previous-reading').isEnabled(),true);await page.click('#previous-reading');await playing('The Verdict political episode.');assert.equal(await page.evaluate(()=>__spoken.at(-1).text),'Verdict political episode.');await page.waitForFunction(()=>document.querySelector('#reading-queue').hidden&&document.querySelector('#reading-navigation').hidden);
  await finish();await waitRows(0);assert.equal(await page.locator('#reading-queue').isVisible(),false);assert.ok(await page.evaluate(()=>__readingCount())>=3,'played membership must not delete cache records');
  const beforeReplay=await page.evaluate(()=>__readingCount());await page.click('#play');await playing('The Verdict political episode.');assert.equal(await page.evaluate(()=>__spoken.at(-1).text),'The Verdict political episode.');await waitRows(1);await page.waitForFunction(async n=>(await __readingCount())===n+1,beforeReplay);await finish();await waitRows(0);
  // Hold only the newly recreated reading's metadata signature, then Stop.
  const stoppedReplayCount=await page.evaluate(()=>__spoken.length);
  await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('paste2speech-device-audio-v1');q.onsuccess=()=>r(q.result);});const ids=new Set(await new Promise(r=>{const q=db.transaction('readings').objectStore('readings').getAll();q.onsuccess=()=>r(q.result.map(x=>x.id));}));db.close();const original=SubtleCrypto.prototype.digest;SubtleCrypto.prototype.digest=async function(algorithm,bytes){let record;try{record=JSON.parse(new TextDecoder().decode(bytes));}catch{}if(record?.version===2&&record.engine==='browser'&&record.id&&!ids.has(record.id)){SubtleCrypto.prototype.digest=original;window.__replayMetadataHeld=true;await new Promise(r=>window.__releaseReplayMetadata=r);}return original.call(this,algorithm,bytes);};});
  await page.click('#play');await page.waitForFunction(()=>window.__replayMetadataHeld);await page.click('#stop');await page.evaluate(()=>__releaseReplayMetadata());await waitRows(1);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>__spoken.length),stoppedReplayCount,'Stop cancels a pending local Replay start');assert.notEqual(await page.locator('#status').textContent(),'Reading aloud');await page.click('#play');await playing('The Verdict political episode.');await finish();await waitRows(0);
  await paste('Mark current.');await enqueue('Mark later.');await page.click('#pause');await page.locator('#reading-queue').evaluate(el=>el.open=true);await page.getByLabel('Actions: Mark later.',{exact:true}).click();await page.getByRole('button',{name:'Mark as read: Mark later.',exact:true}).click();await waitRows(1);await page.click('#stop');await page.waitForFunction(()=>!document.querySelector('#reading-queue').hidden);await page.getByLabel('Actions: Mark current.',{exact:true}).click();await page.getByRole('button',{name:'Mark as read: Mark current.',exact:true}).click();await waitRows(0);
  await paste('First section.\n\nMiddle section.\n\nLast section.');await page.click('#pause');await page.locator('#seek').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('change',{bubbles:true}));});await waitRows(1);await page.click('#play');await page.locator('#seek').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('change',{bubbles:true}));});await waitRows(0);
  // All viewport tests use populated rather than empty queues.
  await paste('Mobile current.');await enqueue('Mobile later.');await page.click('#pause');for(const width of[320,390,1100]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`work/reading-history/podcast-${width}.png`,fullPage:true});}

  await page.reload();await waitRows(2);await page.waitForFunction(()=>document.querySelector('#text').value==='Mobile current.');assert.equal(await page.evaluate(()=>__spoken.length),0,'reload restores paused');
  assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.path.startsWith('/api/readings')||r.path.includes('synth')).length,0);
  console.log(JSON.stringify({podcastForwardTraversal:true,skippedBookmark:true,noWrap:true,previousFromFinishedEndpoint:true,singlePlayingHidesReadingNavigation:true,waitsForActualSpeechBeforeHiding:true,lastCompletionEmpty:true,directReplayFreshRun:true,stopCancelsPendingReplay:true,markRead:true,reloadMembership:true,pausedSeekNotCompletion:true,playingSeekCompletes:true,widths:[320,390,1100],paidCalls:0,physicalPixel:false}));
  await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
