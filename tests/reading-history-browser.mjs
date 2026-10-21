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
  await page.selectOption("#voice", "native-b");
  await page.locator("#rate").evaluate((e) => {
    e.value = "1.5";
    e.dispatchEvent(new Event("input"));
  });
  await page.evaluate(() => clipboardText = "Queued native newsletter.");
  await page.click("#paste-options");
  await page.click("#paste-queue");
  await page.waitForFunction(async () => document.querySelector(".queue-pending")?.textContent === "Queued native newsletter.");
  await page.selectOption("#voice", "native-a");
  await page.locator("#rate").evaluate((e) => {
    e.value = "1";
    e.dispatchEvent(new Event("input"));
  });
  const queuedBefore = await page.evaluate(() => __spoken.length);
  await page.click("#next-reading");
  await page.waitForFunction(async () => document.querySelector("#text").value === "Queued native newsletter." && !document.querySelector("#play").disabled);
  assert.equal(await page.evaluate(() => __spoken.length), queuedBefore);
  await page.click("#play");
  await page.waitForFunction(async () => __spoken.at(-1).text === "Queued native newsletter.");
  assert.equal(await page.evaluate(() => __spoken.at(-1).voice.voiceURI), "native-b");
  assert.equal(await page.evaluate(() => __spoken.at(-1).rate), 1.5);
  await page.evaluate(() => __spoken.at(-1).onboundary({ name: "word", charIndex: 7 }));
  await page.click("#pause");
  await page.waitForFunction(async () => (await window.__readingCount()) === 2 && document.querySelector("#reading-order").textContent === "Reading 2 of 2");
  const beforeSwitch = await page.evaluate(() => __spoken.length);
  await page.click("#previous-reading");
  await page.waitForFunction(async () => document.querySelector("#voice").value === "native-a" && !document.querySelector("#play").disabled);
  assert.equal(await page.evaluate(() => __spoken.length), beforeSwitch);
  await page.click("#play");
  assert.equal(await page.evaluate(() => __spoken.at(-1).text), "Third native section.");
  await page.click("#pause");
  await context.setOffline(true);
  await page.click("#next-reading");
  await page.waitForFunction(async () => document.querySelector("#voice").value === "native-b" && !document.querySelector("#play").disabled);
  await page.click("#play");
  assert.equal(await page.evaluate(() => __spoken.at(-1).text), "native newsletter.");
  await page.click("#pause");
  await page.click("#previous-reading");
  await page.waitForFunction(async () => document.querySelector("#voice").value === "native-a" && !document.querySelector("#play").disabled);
  await page.click("#next-reading");
  await page.waitForFunction(async () => document.querySelector("#voice").value === "native-b" && !document.querySelector("#play").disabled);
  await context.setOffline(false);
  await page.click("#play");
  await page.evaluate(() => clipboardText = "Unavailable native queued item.");
  await page.click("#paste-options");
  await page.click("#paste-queue");
  await page.waitForFunction(async () => document.querySelector(".queue-pending")?.textContent === "Unavailable native queued item.");
  const spoken = await page.evaluate(() => __spoken.length);
  await page.evaluate(() => {
    __nativeVoices = __nativeVoices.slice(0, 1);
    __spoken.at(-1).onend();
  });
  await page.waitForFunction(async () => document.querySelector(".queue-pending")?.textContent.includes("browser voice is unavailable"));
  assert.equal(await page.evaluate(() => __spoken.length), spoken);
  assert.equal(await page.locator("#engine").inputValue(), "browser");
  const disk = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("paste2speech-device-audio-v1");
      r.onsuccess = () => resolve(r.result);
    });
    const result = {};
    for (const name of ["readings", "sections"]) result[name] = await new Promise((resolve) => {
      const r = db.transaction(name).objectStore(name).count();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return result;
  });
  assert.ok(disk.readings >= 2);
  assert.equal(disk.sections, 0);
  assert.deepEqual(requests.filter((r) => r.path.startsWith("/api/readings") || r.path.includes("synth") || r.method === "POST" && r.path !== "/api/events"), []);
  assert.deepEqual(errors, []);
  // A newer Natural bookmark must not override a browser-engine preference.
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open("paste2speech-device-audio-v1");r.onsuccess=()=>resolve(r.result);});
    const record={id:"synthetic-natural",key:"synthetic-natural",scope:"native-fixture",generation:"natural-g",engine:"google",text:"Saved Natural book.",voice:"en-US-Wavenet-H",parts:[{chunks:["Saved Natural book."]}],records:[{state:"unprepared"}],statuses:[],options:{engine:"google",cleanup:{},rate:1},createdAt:Date.now(),updated:Date.now()};
    const bytes=new TextEncoder().encode(JSON.stringify(record));record.sha256=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");
    await new Promise(resolve=>{const tx=db.transaction("readings","readwrite");tx.objectStore("readings").put(record,[record.scope,record.id]);tx.oncomplete=resolve;});db.close();localStorage.setItem("paste2speech.device-audio.latest.native-fixture",record.id);
  });
  const end=Date.now()+90000;
  for(;;){const ready=await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration("/");if(!registration?.active||!navigator.serviceWorker.controller)return false;return new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>resolve(false),10000);channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data.ok===true);};registration.active.postMessage({type:"CHECK_OFFLINE_SHELL"},[channel.port2]);});});if(ready)break;if(Date.now()>end)throw Error("Native offline shell did not finish");await page.waitForTimeout(100);}
  await context.setOffline(true);await page.reload();
  await page.waitForFunction(async()=>document.querySelector("#engine").value==="browser"&&!document.querySelector("#play").disabled&&document.querySelector("#text").value==="Queued native newsletter.");
  assert.equal(await page.evaluate(()=>__spoken.length),0);assert.equal(await page.locator("#voice").inputValue(),"native-b");await page.click("#play");assert.ok(await page.evaluate(()=>__spoken.length)>0);await page.click("#pause");
  await context.setOffline(false);accountScope=null;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.waitForFunction(async()=>(await window.__readingCount())===0);
  await page.click("#edit-mode");await page.fill("#text","Signed-out native reading.");await page.click("#play");await page.waitForFunction(async()=>(await window.__readingCount())===1);
  accountScope="different-owner";await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.waitForFunction(async()=>(await window.__readingCount())===0);
  const isolation=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open("paste2speech-device-audio-v1");r.onsuccess=()=>resolve(r.result);});const records=await new Promise(resolve=>{const r=db.transaction("readings").objectStore("readings").getAll();r.onsuccess=()=>resolve(r.result);});db.close();return{old:records.filter(record=>record.scope==="native-fixture").length,anonymous:records.filter(record=>record.scope.startsWith("browser-profile:")).length,newAccount:records.filter(record=>record.scope==="different-owner").length};});
  assert.deepEqual(isolation,{old:3,anonymous:1,newAccount:0});assert.deepEqual(requests.filter(request=>request.path.startsWith("/api/readings")||request.path.includes("synth")),[]);assert.deepEqual(errors,[]);
  const proof = { signedOutNativePlayback:true,accountHistoriesNotMerged:isolation,nativeOfflineColdReload:true,naturalHistoryDoesNotOverrideNative:true,nativeTwoReadingRoundTrip: true, offlineNativeSwitching: true, nativeReloadWithoutAutoplay: true, commit: release.commit, syntheticNativeSpeech: true, actualAudibleOutputTested: false, pauseResumeWordOffset: true, pausedSectionSeek: true, queuedNativeVoiceAndRateRestored: true, missingQueuedVoiceStopsWithoutFallback: true, noPreparedAudioDiskCopies: disk, noSpeechCreditApiCalls: true, pageErrors: errors, physicalPixel: false };
  await writeFile("work/reading-history/native-verification.json", JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof));
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
