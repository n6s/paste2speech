import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = "work/reading-history";
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      return res.end("<title>Isolated reading lifecycle</title>");
    }
    res.setHeader("Content-Type", "text/javascript");
    res.end(await readFile("." + path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  const context = await browser.newContext(), origin = "http://127.0.0.1:" + server.address().port, reading = await context.newPage(), exporter = await context.newPage(), cleaner = await context.newPage();
  for (const page of [reading, exporter, cleaner]) {
    await page.goto(origin);
    await page.evaluate(async () => {
      const { DeviceAudioStore, digest: digest2 } = await import("/public/device-audio-store.js"), { ReadingProtection } = await import("/public/reading-protection.js");
      window.store = new DeviceAudioStore("owner");
      window.protection = new ReadingProtection();
      window.digest = digest2;
    });
  }
  assert.equal(await reading.evaluate(() => protection.supported), true);
  await reading.evaluate(async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]), entry = { blob: new Blob([bytes]), bytes: 5, samples: 1, sha256: await digest(bytes) };
    window.entry = entry;
    for (const [id, state] of [["finished", "ready"], ["unfinished", "preparing"]]) {
      const record = { id, generation: "generation-" + id, engine: "google", text: "Synthetic " + id, voice: "F", parts: [{ chunks: ["Synthetic"] }], records: [{ id: "job-" + id, state }], statuses: [], options: { rate: 1 }, offlineReady: state === "ready" };
      await store.save("readings", id, record, { automatic: true });
      await store.save("positions", id, { id, generation: record.generation, position: 42, updated: 100 });
      await store.writeSection("job-" + id, 0, entry, { reference: { readingId: id, generation: record.generation } });
      await store.setLifecycle(id, { finishedAt: 123 });
    }
    window.releaseReading = await protection.hold("owner", "finished");
  });
  await exporter.evaluate(async () => window.releaseExport = await protection.hold("owner", "finished"));
  const cleanup = () => cleaner.evaluate(async () => {
    const record = await store.reading("finished");
    return protection.exclusive("owner", "finished", () => store.dropFinishedAudio(record));
  });
  assert.equal((await cleanup()).protected, true);
  await reading.evaluate(() => releaseReading());
  assert.equal((await cleanup()).protected, true);
  await exporter.evaluate(() => releaseExport());
  assert.deepEqual((await cleanup()).removed, ["job-finished"]);
  assert.deepEqual(await cleaner.evaluate(async () => {
    const record = await store.reading("finished");
    return { text: record.text, position: record.position, audioMissing: record.audioMissing, offlineReady: record.offlineReady, section: await store.section("job-finished", 0) };
  }), { text: "Synthetic finished", position: 42, audioMissing: true, offlineReady: false, section: void 0 });
  assert.equal((await cleaner.evaluate(async () => store.dropFinishedAudio(await store.reading("unfinished")))).protected, true);
  assert.equal(await cleaner.evaluate(async () => !!await store.section("job-unfinished", 0)), true);
  const checks = await cleaner.evaluate(async () => {
    const checks2 = [];
    await store.save("readings", "native", { id: "native", generation: "native-g", engine: "browser", text: "Native text", voice: "native-a", records: [], parts: [], options: { rate: 1 } }, { automatic: true });
    await store.save("positions", "native", { id: "native", generation: "native-g", index: 3, offset: 12, rate: 1.5, updated: 200 });
    await store.save("positions", "native", { id: "native", generation: "native-g", index: 0, offset: 0, updated: 100 });
    const native = await store.reading("native");
    if (native.nativeIndex !== 3 || native.nativeOffset !== 12 || native.options.rate !== 1.5) throw Error("A stale switch overwrote the native bookmark");
    checks2.push("native bookmark and latest-position ordering");
    const removed = await store.reading("unfinished");
    await store.removeReading("unfinished");
    let blocked = false;
    try {
      await store.save("readings", removed.id, removed, { automatic: true });
    } catch (error) {
      blocked = error.name === "LocalCopyRemovedError";
    }
    if (!blocked) throw Error("Deletion resurrected silently");
    const again = { ...removed, generation: "explicit-new-generation" };
    await store.save("readings", again.id, again, { automatic: true, rekeep: true });
    await store.restoreJobs(["job-unfinished"], { readingId: again.id, generation: again.generation });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]), entry = { blob: new Blob([bytes]), bytes: 5, samples: 1, sha256: await digest(bytes) };
    await store.writeSection("job-unfinished", 0, entry, { reference: { readingId: again.id, generation: again.generation } });
    if (!await store.section("job-unfinished", 0)) throw Error("Explicit re-keep failed");
    checks2.push("durable removal plus explicit re-keep without synthesis");
    await store.setLifecycle(again.id, { finishedAt: 456 });
    again.records = [{ id: "job-unfinished", state: "ready" }];
    await store.save("readings", again.id, again, { updateOnly: true });
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(...args) {
      const request = original.apply(this, args);
      if (this.name === "sections") request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
    let interrupted = false;
    try {
      await store.dropFinishedAudio(await store.reading(again.id));
    } catch {
      interrupted = true;
    } finally {
      IDBObjectStore.prototype.delete = original;
    }
    if (!interrupted || !await store.section("job-unfinished", 0) || (await store.reading(again.id)).audioMissing) throw Error("Interrupted cleanup published partial state");
    checks2.push("aborted cleanup retains audio, text and bookmark atomically");
    await store.transaction("usage", "readwrite", (s) => s.put(512 * 1024 * 1024, "audio-bytes"));
    let budget = false;
    try {
      await store.writeSection("new", 0, entry);
    } catch (error) {
      budget = error.name === "AudioBudgetExceededError";
    }
    if (!budget || await store.section("new", 0)) throw Error("Application audio budget not enforced");
    checks2.push("512 MiB budget has a distinct error and no partial section");
    return checks2;
  });
  const proof = { crossTabReadingAndExportProtection: true, cleanupAfterLastRelease: true, finishedAudioOnly: true, textAndPlaceRetained: true, checks, realProviderCalls: 0, realUserDataTouched: false };
  await writeFile(out + "/lifecycle-verification.json", JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof));
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
