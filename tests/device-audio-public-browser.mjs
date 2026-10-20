// Public build must never initialize the private staging storage trial.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import assert from "node:assert/strict";
const root = "work/production-reader/site", out = "work/persistent-audio/public-off";
await mkdir(out, { recursive: true });
const app = await readFile(root + "/app.js", "utf8");
assert.match(app, /var PERSISTENT_AUDIO = false;/);
assert.match(app, /production-public/);
await assert.rejects(access(root + "/local-audio-sw.js"));
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    if (path.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(path === "/api/reader" ? { eligible: false, account: null } : { available: false }));
    }
    const file = path === "/" ? "index.html" : path.slice(1);
    if (file.includes("..")) throw Error();
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(await readFile(root + "/" + file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.deviceOpens = 0;
    window.workerRegistrations = 0;
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, ...args) => {
      if (String(name).startsWith("paste2speech-device-audio")) deviceOpens++;
      return open(name, ...args);
    };
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (...args) => {
      workerRegistrations++;
      return register(...args);
    };
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(() => document.querySelector("#status").textContent);
  assert.equal(await page.locator("#device-readings").count(), 0);
  assert.equal(await page.evaluate(() => deviceOpens), 0);
  assert.equal(await page.evaluate(() => workerRegistrations), 0);
  assert.deepEqual(errors, []);
  await writeFile(out + "/verification.json", JSON.stringify({ publicFlagForcedOff: true, deviceControls: 0, deviceIndexedDbOpens: 0, serviceWorkerRegistrations: 0, serviceWorkerAssetAbsent: true, realProviderCalls: 0 }, null, 2) + "\n");
  console.log("PASS public build: persistent audio forced off, no device controls, no audio database opening, no service-worker registration or asset.");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
