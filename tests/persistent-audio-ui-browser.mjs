// Real built reader + service worker + IndexedDB + MSE + MP4 encoder. HTTP
// fixtures implement all APIs; no remote origin, user's account or provider.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { inspectMp3 } from "../cloudflare/prepared/mp3.js";
const root = process.env.READER_SITE || "work/private-reader/site", out = "work/persistent-audio/ui";
await mkdir(out, { recursive: true });
const audio = await readFile("tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3"), meta = inspectMp3(audio), sha256 = createHash("sha256").update(audio).digest("hex"), jobs = /* @__PURE__ */ new Map();
let preparing = false, available = 2;
let posts = 0, sectionGets = 0, scope = "device-owner";
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    res.setHeader("Content-Type", "application/json");
    if (path === "/api/reader") return res.end(JSON.stringify({ eligible: true, accessAllowed: true, account: { balance: 1e7, creditRequired: true } }));
    if (path === "/api/ocr/jobs/config") return res.end(JSON.stringify({ durable: true, enabled: false, consentScope: scope, balance: { balance: 0 } }));
    if (path === "/api/ocr/jobs/recent") return res.end('{"jobs":[],"saved":[]}');
    if (path === "/api/billing/session") return res.end("{}");
    if (path === "/api/readings" && req.method === "POST") {
      let raw = "";
      for await (const part of req) raw += part;
      const body = JSON.parse(raw), id = req.headers["idempotency-key"];
      posts++;
      jobs.set(id, { id, state: "ready", voice: body.voice, total: body.chunks.length, completed: body.chunks.length, starts: body.chunks.map((_, i) => i * meta.samples / 24e3), sections: body.chunks.map((_, index) => ({ index, start: index * meta.samples / 24e3, bytes: meta.bytes, samples: meta.samples, sha256 })), duration: body.chunks.length * meta.samples / 24e3 });
      return res.end(JSON.stringify({ id }));
    }
    const match = path.match(/^\/api\/readings\/([^/]+)(.*)$/);
    if (match) {
      if (req.method === "DELETE") {
        res.statusCode = 204;
        return res.end();
      }
      if (match[2].startsWith("/sections/")) {
        sectionGets++;
        res.setHeader("Content-Type", "audio/mpeg");
        return res.end(audio);
      }
      const status = jobs.get(match[1]);
      const sections = preparing ? status.sections.slice(0, available) : status.sections;
      return res.end(JSON.stringify({...status, state:sections.length===status.total?"ready":"preparing", sections, starts:status.starts.slice(0,sections.length),completed:sections.length,duration:sections.length*meta.samples/24000}));
    }
    if (path.startsWith("/api/")) return res.end('{"available":false}');
    const file = path === "/" ? "index.html" : path.slice(1);
    if (file.includes("..")) throw Error();
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : file.endsWith(".bin") ? "application/octet-stream" : "text/html");
    res.end(await readFile(root + "/" + file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }), page = await context.newPage(), errors = [], deletes = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE") deletes.push(request.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.fixtureAudio = [];
    const Original = window.Audio;
    window.Audio = function(...args) {
      const audio2 = new Original(...args);
      fixtureAudio.push(audio2);
      return audio2;
    };
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  if(!process.argv.includes("--partial-only")) {
  await page.goto(origin);
  if (await page.getByRole("button", { name: "Dismiss guide", exact: true }).isVisible()) await page.getByRole("button", { name: "Dismiss guide", exact: true }).click();
  await page.locator("#voice-settings").evaluate((e) => e.open = true);
  await page.selectOption("#engine", "google");
  await page.selectOption("#voice", "en-US-Wavenet-H");
  await page.locator("#video-split-limit").evaluate((e) => {
    e.value = "20000";
    e.dispatchEvent(new Event("change"));
  });
  const source = "Synthetic offline briefing. " + Array(60).fill("This is verified local audio, with saved text and a remembered place.").join(" ");
  await page.fill("#text", source);
  await page.click("#play");
  await page.waitForFunction(() => document.querySelector("#status").textContent === "Reading aloud");
  await page.locator("#device-readings").evaluate((e) => e.open = true);
  await page.waitForFunction(() => document.querySelector("#offline-progress").textContent==="Ready for offline listening.", {}, { timeout: 9e4 });
  await page.waitForFunction(()=>document.querySelector("#device-audio-status").textContent==="");
  assert.equal(await page.locator("#device-audio-status").textContent(),"");
  assert.equal(await page.locator("#device-audio-status").getAttribute("role"),"status");
  assert.equal(await page.locator("#offline-progress").isVisible(),true);
  assert.equal(await page.locator("#offline-progress").getAttribute("role"),"status");
  assert.equal(await page.locator(".player").evaluate(el=>(el.innerText.match(/ready (?:for )?offline/gi)||[]).length),1,"One visible readiness message in the player");
  assert.match(await page.locator("#device-readings").textContent(),/Unfinished readings expire 24 hours/);
  assert.equal(posts, 1);
  await page.click("#pause");
  await page.locator("#next-section").click();
  await page.locator("#next-section").click();
  await page.locator("#previous-section").click();
  await page.waitForFunction(() => fixtureAudio.find((a) => a.src.startsWith("blob:")).currentTime > 0);
  const place = await page.evaluate(() => fixtureAudio.find((a) => a.src.startsWith("blob:")).currentTime);
  await page.waitForTimeout(1200);
  const before = { posts, sectionGets, place };
  await context.setOffline(true);
  await page.reload();
  await page.locator("#device-readings").evaluate((e) => e.open = true);
  await page.waitForFunction((source2) => document.querySelector("#text").value === source2, source);
  assert.equal(await page.locator("#text").inputValue(), source);
  assert.equal(await page.locator("#voice").inputValue(), "en-US-Wavenet-H");
  assert.equal(await page.locator("#status").textContent(), "Ready when you are");
  await page.click("#play");
  await page.waitForFunction(() => document.querySelector("#status").textContent === "Reading aloud");
  await page.click("#pause");
  const restored = await page.evaluate(() => fixtureAudio.find((a) => a.src.startsWith("blob:")).currentTime);
  assert.ok(Math.abs(restored - place) < 0.5, `${restored} vs ${place}`);
  assert.equal(posts, before.posts);
  assert.equal(sectionGets, before.sectionGets);
  await page.locator("#video-download").evaluate((e) => e.open = true);
  await page.click("#download-video");
  await page.waitForSelector("#open-video", { state: "visible", timeout: 9e4 });
  const mp4 = await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector("#open-video").href)).arrayBuffer())]);
  await writeFile(out + "/offline.mp4", Buffer.from(mp4));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", out + "/offline.mp4"], { encoding: "utf8" }));
  assert.deepEqual(probe.streams.map((s) => s.codec_name), ["h264", "aac", "mov_text"]);
  assert.equal(posts, before.posts);
  assert.equal(sectionGets, before.sectionGets);
  assert.deepEqual(errors, []);
  for (const width of [320, 390, 780]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Offline library overflows at " + width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/offline-mobile.png", fullPage: true });
  const peer = await context.newPage();await peer.goto(origin);
  await peer.waitForFunction(t=>document.querySelector("#text").value===t,source);
  await page.locator("#automatic-device-audio").evaluate(e=>{e.checked=false;e.dispatchEvent(new Event("change"));});
  await peer.waitForFunction(()=>!document.querySelector("#automatic-device-audio").checked);
  assert.equal(await peer.locator("#automatic-device-audio").isChecked(),false);
  assert.equal(posts,before.posts);assert.equal(sectionGets,before.sectionGets);
  await peer.close();await page.locator("#automatic-device-audio").evaluate(e=>{e.checked=true;e.dispatchEvent(new Event("change"));});
  await page.waitForFunction(()=>document.querySelector("#offline-progress").textContent==="Ready for offline listening.");
  await page.click("#clear");
  await page.reload();await page.waitForTimeout(500);
  assert.equal(await page.locator("#text").inputValue(),"","Clear must remain blank in this tab after reload");
  const preserved=await context.newPage();await preserved.goto(origin);
  await preserved.waitForFunction(text=>document.querySelector("#text").value===text,source);
  await preserved.click("#play");await preserved.waitForFunction(()=>document.querySelector("#status").textContent==="Reading aloud");
  await preserved.click("#pause");await preserved.close();
  assert.equal(posts,before.posts,"Opening the preserved reading must reuse its paid audio");
  assert.deepEqual(deletes, [], "Opening/Clear of a device copy must not delete server jobs");
  await context.setOffline(false);
  scope = "other-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.querySelector("#device-audio-list").children.length === 0);
  assert.ok(await page.evaluate(() => fixtureAudio.every((a) => a.paused)));
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('paste2speech-device-audio-v1');r.onsuccess=()=>resolve(r.result);});
    const entries=await new Promise(resolve=>{const r=db.transaction('readings').objectStore('readings').getAll();r.onsuccess=()=>resolve(r.result);});
    for(const record of entries){record.createdAt=Date.now()-86400001;delete record.sha256;record.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(record))))].map(n=>n.toString(16).padStart(2,'0')).join('');await new Promise(resolve=>{const tx=db.transaction('readings','readwrite');tx.objectStore('readings').put(record,[record.scope,record.id]);tx.oncomplete=resolve;});}db.close();
  });
  scope = "device-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('paste2speech-device-audio-v1');r.onsuccess=()=>resolve(r.result);});const count=await new Promise(resolve=>{const r=db.transaction('readings').objectStore('readings').count();r.onsuccess=()=>resolve(r.result);});db.close();return count===0;});
  await page.waitForTimeout(1200);
  await context.setOffline(true);
  await page.reload();
  await page.locator("#device-readings").evaluate((e) => e.open = true);
  assert.equal(await page.getByRole("button", { name: /^Open:/ }).count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(out + "/verification.json", JSON.stringify({ offlineReloadAppShell: true, textAndVoiceRecovered: true, place, restored, rapidPreviousNext: true, offlineMp4Verified: true, sourceAudioGets: sectionGets, additionalSpeechPosts: posts - before.posts, additionalSectionGets: sectionGets - before.sectionGets, physicalPixel: false, realProviderCalls: 0, localClearBackendDeletes: deletes.length, automaticSavedRestore: true, accountSwitchIsolation: true, expirySurvivesOfflineReload: true, mobileWidths: [320, 390, 780] }, null, 2) + "\n");
  console.log("PASS account switch hides old device audio and pauses playback; expiry survives reload without late resurrection.");
  console.log("PASS saved device reading: offline shell reload, automatic text/voice/place restore, rapid seeks and MP4 with subtitles reuse the same disk sections; no extra speech or section download.");
  await context.close();
  }
  await browser.close();
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
  preparing = true; available = 2;
  const partialContext = await browser.newContext({viewport:{width:390,height:844}}), partial = await partialContext.newPage();
  const eventually = async predicate => { const end=Date.now()+90000; while(!await partial.evaluate(predicate)){if(Date.now()>end)throw Error("Incremental condition timed out");await partial.waitForTimeout(100);} };
  await partial.goto(origin);
  if(await partial.getByRole("button",{name:"Dismiss guide",exact:true}).isVisible())await partial.getByRole("button",{name:"Dismiss guide",exact:true}).click();
  await partial.locator("#voice-settings").evaluate(e=>e.open=true);
  await partial.selectOption("#engine","google");await partial.selectOption("#voice","en-US-Wavenet-H");
  const partialText = "Incremental generation briefing. " + Array(10).fill("Audio is saved while the server is still preparing later sections.").join(" ");
  const partialPosts = posts, partialGets = sectionGets;
  await partial.fill("#text",partialText);await partial.click("#play");
  await eventually(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open("paste2speech-device-audio-v1");r.onsuccess=()=>resolve(r.result);});
    if(!db.objectStoreNames.contains("sections")){db.close();return false;}
    const count=await new Promise(resolve=>{const tx=db.transaction("sections");const r=tx.objectStore("sections").count();r.onsuccess=()=>resolve(r.result);});db.close();return count===2;
  });
  await partial.click("#pause");await partial.waitForTimeout(1000);
  await eventually(async()=>{
    const registration=await navigator.serviceWorker.getRegistration("/");if(!registration?.active||!navigator.serviceWorker.controller)return false;
    return new Promise(resolve=>{const channel=new MessageChannel();const timeout=setTimeout(()=>resolve(false),10000);channel.port1.onmessage=e=>{clearTimeout(timeout);resolve(e.data.ok===true);};registration.active.postMessage({type:"CHECK_OFFLINE_SHELL"},[channel.port2]);});
  });
  assert.equal(posts,partialPosts+1);assert.equal(sectionGets,partialGets+2);
  await partialContext.setOffline(true);
  await partial.reload();
  await partial.waitForFunction(t=>document.querySelector("#text").value===t,partialText);
  assert.equal(await partial.locator("#status").textContent(),"Ready when you are");
  assert.ok(!await partial.locator("#offline-progress").textContent().then(t=>t.includes("Ready for offline listening")));
  await partial.click("#play");await partial.waitForFunction(()=>document.querySelector("#status").textContent==="Reading aloud");await partial.click("#pause");
  assert.equal(posts,partialPosts+1);assert.equal(sectionGets,partialGets+2);
  available=10000;preparing=false;await partialContext.setOffline(false);
  await partial.evaluate(()=>window.dispatchEvent(new Event("online")));
  try { await partial.waitForFunction(()=>document.querySelector("#offline-progress").textContent==="Ready for offline listening.",{},{timeout:30000}); }
  catch(error){console.log("PARTIAL RESUME",await partial.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open("paste2speech-device-audio-v1");r.onsuccess=()=>resolve(r.result);});const records=await new Promise(resolve=>{const r=db.transaction("readings").objectStore("readings").getAll();r.onsuccess=()=>resolve(r.result);});db.close();return {status:document.querySelector("#status").textContent,device:document.querySelector("#device-audio-status").textContent,records};}),{posts,sectionGets});throw error;}
  assert.equal(posts,partialPosts+1,"Interrupted preparation must never admit new speech on reload");
  assert.deepEqual(await partial.evaluate(()=>[...document.querySelectorAll("#save-device-reading")].length),0);
  await writeFile(out+"/incremental-verification.json",JSON.stringify({savedDuringGeneration:true,partialOfflinePlayback:true,automaticReloadWithoutAutoplay:true,resumedExistingJob:true,additionalSpeechPosts:0,realProviderCalls:0},null,2)+"\n");
  await partial.locator("#next-section").click();await partial.locator("#next-section").click();
  await partial.waitForTimeout(1200);
  await partial.reload();await partial.waitForFunction(t=>document.querySelector("#text").value===t,partialText);
  await partial.waitForFunction(()=>!document.querySelector("#play").disabled);
  const explicitPosts=posts;
  await partial.click("#edit-mode");
  await partial.fill("#text",partialText+" Explicitly edited new source.");await partial.click("#play");
  await partial.waitForFunction(()=>document.querySelector("#status").textContent==="Reading aloud");
  assert.equal(posts,explicitPosts+1,"Explicit Play after an edit must use the ordinary new-reading flow exactly once");
  assert.equal(Number(await partial.locator("#seek").inputValue()),0,"New text must not inherit a restored book position");
  await partialContext.close();
  console.log("PASS automatic incremental saving: preparation interrupted/reloaded offline, saved prefix plays, reconnect resumes existing IDs only; no Save/Open action or new speech.");
} catch (e) {
  console.error(e);
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
