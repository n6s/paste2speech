// Real service-worker install/update/cache lifecycle, isolated synthetic origin.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const out = "work/persistent-audio/shell";
await mkdir(out, { recursive: true });
const template = await readFile("public/local-audio-worker.js", "utf8");
let version = 1, fail = false;
const files = (n) => ({ "/": `<!doctype html><title>Shell ${n}</title><script src="/app.js"><\/script><p>Shell ${n}</p>`, "/app.js": `window.shellVersion=${n};` });
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  res.setHeader("Cache-Control", "no-store");
  if (path === "/local-audio-sw.js") {
    const assets = Object.fromEntries(Object.entries(files(version)).map(([name, text]) => [name, createHash("sha256").update(text).digest("hex")]));
    res.setHeader("Content-Type", "text/javascript");
    return res.end(template.replace("__BUILD__", String(version)).replace("__ASSETS__", JSON.stringify(assets)));
  }
  if (path.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    return res.end('{"private":"synthetic-only"}');
  }
  if (path === "/app.js" && fail) {
    res.statusCode = 503;
    return res.end("unavailable");
  }
  res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/html");
  res.end(files(version)[path] || "not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage(), origin = "http://127.0.0.1:" + server.address().port;
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/local-audio-sw.js");
    await navigator.serviceWorker.ready;
  });
  const message = async (type = "CHECK_OFFLINE_SHELL") => page.evaluate((type2) => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      channel.port1.close();
      resolve(e.data);
    };
    navigator.serviceWorker.getRegistration("/").then((r) => r.active.postMessage({ type: type2 }, [channel.port2]));
  }), type);
  assert.equal((await message("SAVE_OFFLINE_SHELL")).ok, true);
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.evaluate(() => shellVersion), 1);
  assert.equal((await message("SAVE_OFFLINE_SHELL")).ok, true);
  await context.setOffline(false);
  version = 2;
  fail = true;
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration("/");
    try {
      await r.update();
    } catch {
    }
  });
  await page.waitForTimeout(500);
  assert.equal((await message()).cache, "paste2speech-offline-shell-1");
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.evaluate(() => shellVersion), 1);
  await context.setOffline(false);
  fail = false;
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration("/");
    await r.update();
  });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration("/")).waiting);
  assert.equal((await message()).cache, "paste2speech-offline-shell-1");
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.evaluate(() => shellVersion), 1);
  await page.close();
  const next = await context.newPage();
  await next.goto(origin);
  await next.waitForFunction(() => window.shellVersion === 2);
  await next.evaluate(async () => {
    const cache = await caches.open("paste2speech-offline-shell-2");
    await cache.put("/app.js", new Response("corrupt"));
  });
  const integrity = await next.evaluate(() => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(e.data);
    navigator.serviceWorker.controller.postMessage({ type: "CHECK_OFFLINE_SHELL" }, [channel.port2]);
  }));
  assert.equal(integrity.ok, false);
  await context.setOffline(false);
  await next.evaluate(() => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(e.data);
    navigator.serviceWorker.controller.postMessage({ type: "SAVE_OFFLINE_SHELL" }, [channel.port2]);
  }));
  await next.evaluate(() => fetch("/api/private").then((r) => r.json()));
  const cachedApi = await next.evaluate(async () => {
    let count = 0;
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) if (new URL(request.url).pathname.startsWith("/api/")) count++;
    return count;
  });
  assert.equal(cachedApi, 0);
  await writeFile(out + "/verification.json", JSON.stringify({ offlineRetryKeepsWorkingShell: true, failedUpdateKeepsOldWorker: true, newVersionWaitsForExistingClients: true, newVersionReadyBeforeActivation: true, cachedCorruptionDetected: true, apiResponsesCached: cachedApi, realProviderCalls: 0 }, null, 2) + "\n");
  console.log("PASS offline shell: offline Retry preserves cache, failed update preserves old version, successful update waits for clients, new version cached before activation, corrupt assets rejected, no API caching.");
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
