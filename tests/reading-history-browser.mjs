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
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push({ path: url.pathname, method: request.method() });
    let body = url.pathname === "/api/reader" ? { eligible: true, accessAllowed: true, account: { balance: 0, creditRequired: true } } : url.pathname === "/api/ocr/jobs/config" ? { enabled: false, durable: true, consentScope: "native-fixture" } : {};
    return route.fulfill({ status: url.pathname === "/api/events" ? 204 : 200, contentType: "application/json", body: url.pathname === "/api/events" ? "" : JSON.stringify(body) });
  });
  await context.addInitScript(() => {
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
  await page.waitForFunction(() => document.querySelector("#status").textContent === "Reading aloud");
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
  await page.waitForFunction(() => document.querySelector(".queue-title")?.textContent === "Queued native newsletter.");
  await page.selectOption("#voice", "native-a");
  await page.locator("#rate").evaluate((e) => {
    e.value = "1";
    e.dispatchEvent(new Event("input"));
  });
  const queuedBefore = await page.evaluate(() => __spoken.length);
  await page.click("#next-reading");
  await page.waitForFunction(() => document.querySelector("#text").value === "Queued native newsletter." && !document.querySelector("#play").disabled);
  assert.equal(await page.evaluate(() => __spoken.length), queuedBefore);
  await page.click("#play");
  await page.waitForFunction(() => __spoken.at(-1).text === "Queued native newsletter.");
  assert.equal(await page.evaluate(() => __spoken.at(-1).voice.voiceURI), "native-b");
  assert.equal(await page.evaluate(() => __spoken.at(-1).rate), 1.5);
  await page.evaluate(() => __spoken.at(-1).onboundary({ name: "word", charIndex: 7 }));
  await page.click("#pause");
  await page.waitForFunction(() => document.querySelectorAll("#device-audio-list li").length === 2 && document.querySelector("#reading-order").textContent === "Reading 2 of 2");
  const beforeSwitch = await page.evaluate(() => __spoken.length);
  await page.click("#previous-reading");
  await page.waitForFunction(() => document.querySelector("#voice").value === "native-a" && !document.querySelector("#play").disabled);
  assert.equal(await page.evaluate(() => __spoken.length), beforeSwitch);
  await page.click("#play");
  assert.equal(await page.evaluate(() => __spoken.at(-1).text), "Third native section.");
  await page.click("#pause");
  await context.setOffline(true);
  await page.click("#next-reading");
  await page.waitForFunction(() => document.querySelector("#voice").value === "native-b" && !document.querySelector("#play").disabled);
  await page.click("#play");
  assert.equal(await page.evaluate(() => __spoken.at(-1).text), "native newsletter.");
  await page.click("#pause");
  await page.click("#previous-reading");
  await page.waitForFunction(() => document.querySelector("#voice").value === "native-a" && !document.querySelector("#play").disabled);
  await page.click("#next-reading");
  await page.waitForFunction(() => document.querySelector("#voice").value === "native-b" && !document.querySelector("#play").disabled);
  await context.setOffline(false);
  await page.click("#play");
  await page.evaluate(() => clipboardText = "Unavailable native queued item.");
  await page.click("#paste-options");
  await page.click("#paste-queue");
  await page.waitForFunction(() => document.querySelector(".queue-title")?.textContent === "Unavailable native queued item.");
  const spoken = await page.evaluate(() => __spoken.length);
  await page.evaluate(() => {
    __nativeVoices = __nativeVoices.slice(0, 1);
    __spoken.at(-1).onend();
  });
  await page.waitForFunction(() => document.querySelector(".queue-title")?.textContent.includes("browser voice is unavailable"));
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
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#engine").value === "browser" && !document.querySelector("#play").disabled && document.querySelector("#text").value === "Queued native newsletter.");
  assert.equal(await page.evaluate(() => __spoken.length), 0);
  const proof = { nativeTwoReadingRoundTrip: true, offlineNativeSwitching: true, nativeReloadWithoutAutoplay: true, commit: release.commit, syntheticNativeSpeech: true, actualAudibleOutputTested: false, pauseResumeWordOffset: true, pausedSectionSeek: true, queuedNativeVoiceAndRateRestored: true, missingQueuedVoiceStopsWithoutFallback: true, noPreparedAudioDiskCopies: disk, noSpeechCreditApiCalls: true, pageErrors: errors, physicalPixel: false };
  await writeFile("work/reading-history/native-verification.json", JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof));
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
