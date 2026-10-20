// Real IndexedDB in an isolated Chrome profile. All audio is synthetic fixture
// repetition; no provider, account, payment or user's browser is contacted.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = "work/persistent-audio";
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://local").pathname;
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      return res.end("<!doctype html><title>Device audio tests</title>");
    }
    const file = path.slice(1);
    if (!/^(public|cloudflare\/prepared|tests\/fixtures)\//.test(file) || file.includes("..")) throw Error();
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port);
  const first = await page.evaluate(async () => {
    const { PersistentReadingAssets } = await import("/public/persistent-reading-assets.js"), { DeviceAudioStore, digest } = await import("/public/device-audio-store.js"), { inspectMp3 } = await import("/cloudflare/prepared/mp3.js");
    Object.assign(window, { PersistentReadingAssets, DeviceAudioStore });
    const small = new Uint8Array(await (await fetch("/tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3")).arrayBuffer()), repeat = Math.ceil(1024 * 1024 / small.length), bytes = new Uint8Array(small.length * repeat);
    for (let i = 0; i < repeat; i++) bytes.set(small, i * small.length);
    const meta = inspectMp3(bytes), sha256 = await digest(bytes), chunks = Array(70).fill("Synthetic saved section."), sections = chunks.map((_, index) => ({ index, start: index * meta.samples / 24e3, bytes: meta.bytes, samples: meta.samples, sha256 })), status = { state: "ready", total: chunks.length, completed: chunks.length, sections, starts: sections.map((s) => s.start), duration: chunks.length * meta.samples / 24e3 };
    let fetches = 0;
    const assets = new PersistentReadingAssets(async () => {
      fetches++;
      return new Response(bytes);
    }, { ramBytes: 2 * 1024 * 1024 });
    assets.setScope("owner-a");
    assets.shellReady = assets.manifestReady = true;
    assets.allow("large");
    assets.register("large", chunks, "F");
    assets.observe("large", status);
    const deadline = Date.now() + 12e4;
    while (!assets.complete("large") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    if (!assets.complete("large")) throw Error("Large save incomplete: " + JSON.stringify(assets.info(["large"], 70)));
    if (assets.ramUsed > 2 * 1024 * 1024) throw Error("RAM cache overflow");
    assets.shellReady = false;
    if (assets.info(["large"], 70).ready) throw Error("Ready without offline shell");
    assets.shellReady = true;
    assets.manifestReady = false;
    if (assets.info(["large"], 70).ready) throw Error("Ready without reading manifest");
    assets.manifestReady = true;
    const saved = fetches;
    for (const index of [69, 0, 44, 2, 65, 1, 50, 68, 3]) await assets.section("large", index);
    if (fetches !== saved) throw Error("Seeks redownloaded stored audio");
    await assets.store.save("readings", "large", { id: "large", text: "Synthetic source", voice: "F", position: 123.25, updated: Date.now(), chunks, status });
    const result = { bytes: status.sections.reduce((n, s) => n + s.bytes, 0), sections: 70, fetches, ramBytes: assets.ramUsed, rapidArbitrarySeeksReuseDisk: true };
    assets.dispose();
    return result;
  });
  assert.ok(first.bytes > 64 * 1024 * 1024);
  assert.equal(first.fetches, 70);
  await page.reload();
  const second = await page.evaluate(async () => {
    const { PersistentReadingAssets } = await import("/public/persistent-reading-assets.js"), { DeviceAudioStore } = await import("/public/device-audio-store.js");
    const store = new DeviceAudioStore("owner-a"), record = await store.get("readings", "large");
    if (record.position !== 123.25 || record.text !== "Synthetic source") throw Error("Text/place recovery failed");
    let fetches = 0;
    const assets = new PersistentReadingAssets(async () => {
      fetches++;
      throw Error("No network needed");
    }, { ramBytes: 2 * 1024 * 1024 });
    assets.setScope("owner-a");
    assets.shellReady = assets.manifestReady = true;
    assets.allow("large");
    const job = assets.register("large", record.chunks, "F");
    await job.hydrating;
    if (!assets.complete("large")) throw Error("Reload verification incomplete");
    await Promise.all([69, 0, 44, 2, 65, 1, 50, 68, 3].map((index) => assets.section("large", index)));
    if (fetches) throw Error("Reload fetched audio");
    const part = await assets.part({ id: "large" });
    if (part.blob.size <= 64 * 1024 * 1024) throw Error("Export did not reuse full saved audio");
    assets.setScope("owner-b");
    if ((await assets.store.readings()).length) throw Error("Account isolation failed");
    if (await assets.store.section("large", 0)) throw Error("Foreign audio returned");
    assets.dispose();
    return { reload: true, textAndPosition: true, exportBytes: part.blob.size, networkFetches: fetches, accountIsolation: true };
  });
  const failures = await page.evaluate(async () => {
    const { PersistentReadingAssets } = await import("/public/persistent-reading-assets.js"), { DeviceAudioStore, digest } = await import("/public/device-audio-store.js"), { inspectMp3 } = await import("/cloudflare/prepared/mp3.js");
    const bytes = new Uint8Array(await (await fetch("/tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3")).arrayBuffer()), meta = inspectMp3(bytes), sha256 = await digest(bytes), status = { state: "ready", total: 1, completed: 1, sections: [{ index: 0, start: 0, bytes: meta.bytes, samples: meta.samples, sha256 }], starts: [0], duration: meta.samples / 24e3 };
    const checks = [];
    for (const mode of ["quota", "abort"]) {
      let blocked = true, calls = 0;
      const backing = new DeviceAudioStore("failure-" + mode, { storage: { estimate: async () => blocked && mode === "quota" ? { quota: 0, usage: 0 } : { quota: 1e9, usage: 0 } } }), transaction = backing.transaction.bind(backing);
      backing.transaction = (name, modeName, operation) => transaction(name, modeName, (store) => {
        const request = operation(store);
        if (blocked && mode === "abort" && (Array.isArray(name) ? name.includes("sections") : name === "sections") && modeName === "readwrite") store.transaction.abort();
        return request;
      });
      const assets = new PersistentReadingAssets(async () => {
        calls++;
        return new Response(bytes);
      }, { storeFactory: () => backing });
      assets.setScope("failure-" + mode);
      assets.shellReady = assets.manifestReady = true;
      assets.allow(mode);
      assets.register(mode, ["text"], "F");
      assets.observe(mode, status);
      await new Promise((r) => setTimeout(r, 200));
      if (assets.complete(mode)) throw Error("False ready after " + mode);
      if (await backing.section(mode, 0)) throw Error("Partial write visible after " + mode);
      if ((await assets.section(mode, 0)).size !== bytes.length) throw Error("Playback blocked by storage failure");
      blocked = false;
      assets.retry();
      for (let i = 0; i < 100 && !assets.complete(mode); i++) await new Promise((r) => setTimeout(r, 20));
      if (!assets.complete(mode)) throw Error("Resume failed " + mode);
      if (calls !== 1) throw Error("Retry redownloaded verified RAM audio");
      assets.dispose();
      checks.push(mode + " failure keeps playback, atomic write, retry reuses bytes");
    }
    const partialStore = new DeviceAudioStore("partial-owner");
    let firstReads = 0;
    const partial = new PersistentReadingAssets(async () => {
      firstReads++;
      if (firstReads === 3) throw Error("network interrupted");
      return new Response(bytes);
    }, { storeFactory: () => partialStore });
    partial.setScope("partial-owner");
    partial.shellReady = partial.manifestReady = true;
    partial.allow("partial");
    const many = { ...status, total: 5, completed: 5, sections: Array.from({ length: 5 }, (_, index) => ({ ...status.sections[0], index, start: index * meta.samples / 24e3 })), starts: Array.from({ length: 5 }, (_, i) => i * meta.samples / 24e3), duration: 5 * meta.samples / 24e3 };
    partial.register("partial", Array(5).fill("text"), "F");
    partial.observe("partial", many);
    for (let i = 0; i < 100 && !partial.jobs.get("partial").storageError; i++) await new Promise((r) => setTimeout(r, 20));
    if (partial.complete("partial") || partial.jobs.get("partial").data.size !== 2) throw Error("Partial interruption accounting failed");
    partial.dispose();
    let resumedReads = 0;
    const resumed = new PersistentReadingAssets(async () => {
      resumedReads++;
      return new Response(bytes);
    });
    resumed.setScope("partial-owner");
    resumed.shellReady = resumed.manifestReady = true;
    resumed.allow("partial");
    const resumeJob = resumed.register("partial", Array(5).fill("text"), "F");
    await resumeJob.hydrating;
    for (let i = 0; i < 100 && !resumed.complete("partial"); i++) await new Promise((r) => setTimeout(r, 20));
    if (!resumed.complete("partial") || resumedReads !== 3) throw Error("Downloads did not resume only missing sections");
    resumed.dispose();
    checks.push("interrupted download reload resumes only 3 missing sections");
    const denied = new PersistentReadingAssets(async () => new Response(bytes), { storeFactory: () => ({ get: async () => {
      throw Error("blocked");
    }, save: async () => {
      throw Error("blocked");
    }, section: async () => {
      throw Error("blocked");
    }, writeSection: async () => {
      throw Error("blocked");
    } }) });
    denied.setScope("blocked-owner");
    denied.shellReady = denied.manifestReady = true;
    denied.allow("blocked");
    denied.register("blocked", ["text"], "F");
    denied.observe("blocked", status);
    if ((await denied.section("blocked", 0)).size !== bytes.length || denied.complete("blocked")) throw Error("Unavailable IndexedDB blocked playback or claimed ready");
    denied.dispose();
    checks.push("unavailable IndexedDB preserves online playback");
    const shared = new DeviceAudioStore("failure-quota");
    for (const id of ["one", "two"]) await shared.save("readings", id, { id, records: [{ id: "quota" }], text: "Synthetic" });
    await shared.save("positions", "one", { id: "one", position: 3 });
    if ((await shared.removeReading("one")).length || !await shared.section("quota", 0)) throw Error("Removal erased another saved reading");
    if (await shared.get("positions", "one")) throw Error("Position remained after removal");
    const removed = await shared.removeReading("two");
    if (removed[0] !== "quota" || await shared.section("quota", 0) || await shared.get("jobs", "quota")) throw Error("Explicit removal left orphan audio/text");
    checks.push("atomic removal preserves shared readings and deletes only last device copy");
    await shared.save("readings", "generation", { id: "generation", generation: "old", text: "Synthetic", records: [{ id: "late" }] });
    const otherTab = new DeviceAudioStore("failure-quota");
    await shared.removeReading("generation");
    for (const operation of [() => otherTab.save("readings", "generation", { id: "generation", generation: "old", text: "Synthetic", records: [{ id: "late" }] }, { updateOnly: true }), () => otherTab.save("positions", "generation", { id: "generation", generation: "old", position: 2 }), () => otherTab.save("jobs", "late", { id: "late" }), () => otherTab.writeSection("late", 0, { blob: new Blob([bytes]), bytes: bytes.length, samples: meta.samples, sha256 })]) {
      let blocked = false;
      try {
        await operation();
      } catch (e) {
        blocked = e.name === "LocalCopyRemovedError";
      }
      if (!blocked) throw Error("Another tab resurrected a deleted device copy");
    }
    await shared.save("readings", "generation", { id: "generation", generation: "new", text: "Synthetic", records: [{ id: "late" }] });
    await shared.restoreJobs(["late"], { readingId: "generation", generation: "new" });
    await shared.writeSection("late", 0, { blob: new Blob([bytes]), bytes: bytes.length, samples: meta.samples, sha256 });
    if (!await shared.section("late", 0)) throw Error("Explicit Save could not create a new copy");
    checks.push("durable deletion blocks stale tabs; only explicit Save re-enables a new generation");
    await shared.save("readings", "damaged", { id: "damaged", text: "Original", records: [] });
    await shared.transaction("readings", "readwrite", (store) => store.put({ id: "wrong-key", scope: "failure-quota", text: "corrupt", sha256: "bad" }, ["failure-quota", "damaged"]));
    const damaged = (await shared.readings()).find((r) => r.id === "damaged");
    if (!damaged?.damaged) throw Error("Corrupt book hid the library or was accepted");
    await shared.removeReading("damaged");
    if ((await shared.readings()).some((r) => r.id === "damaged")) throw Error("Corrupt book could not be removed");
    checks.push("corrupt reading is isolated and explicitly removable");
    const kept = { id: "kept", scope: "upgrade-owner", text: "Synthetic preserved source", updated: 0 }, receipt = await digest(JSON.stringify(kept));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("device-audio-upgrade-proof", 1);
      request.onupgradeneeded = () => {
        for (const name of ["jobs", "sections", "readings", "positions"]) request.result.createObjectStore(name);
      };
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("readings", "readwrite");
        tx.objectStore("readings").put({ ...kept, sha256: receipt }, ["upgrade-owner", "kept"]);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    const upgraded = new DeviceAudioStore("upgrade-owner", { name: "device-audio-upgrade-proof" });
    if ((await upgraded.get("readings", "kept")).text !== kept.text || !(await upgraded.db()).objectStoreNames.contains("removed")) throw Error("Schema upgrade lost a reading");
    checks.push("schema upgrade adds deletion journal without changing saved readings");
    const { LongReadingTransport } = await import("/public/long-reading.js");
    let restoreRelease;
    const restoringAssets = new PersistentReadingAssets(async () => {
      throw Error("No request expected");
    }, { storeFactory: (scope) => ({ get: () => scope === "restore-a" ? new Promise((resolve) => restoreRelease = () => resolve(null)) : Promise.resolve(null) }) });
    restoringAssets.setScope("restore-a");
    const transport = new LongReadingTransport(() => {
      throw Error("No request expected");
    });
    transport.assets = restoringAssets;
    const restoring = transport.restoreLocal({ scope: "restore-a", key: "synthetic", voice: "F", parts: [{ chunks: ["text"] }], records: [{ id: "restorer", state: "ready" }], statuses: [status] }).then(() => false, () => true);
    while (!restoreRelease) await new Promise((r) => setTimeout(r, 5));
    restoringAssets.setScope("restore-b");
    restoreRelease();
    await restoring;await new Promise(resolve=>setTimeout(resolve,0));
    if (restoringAssets.jobs.size || transport.groups.size || transport.localRestore) throw Error("Restore crossed an account boundary");
    restoringAssets.dispose();
    checks.push("account switch discards old group and background verification without exposing old audio");
    let releaseEstimate, conversionGets=0;
    const conversion = new PersistentReadingAssets(async () => {conversionGets++;return new Response(bytes);}, { storeFactory: (scope) => new DeviceAudioStore(scope, { storage: { estimate: () => new Promise((r) => releaseEstimate = () => r({ quota: 1e9, usage: 0 })) } }) });
    conversion.setScope("convert-a");
    conversion.register("convert", ["text"], "F");
    conversion.observe("convert", status);
    for (let i = 0; i < 100 && !conversion.jobs.get("convert").data.size; i++) await new Promise((r) => setTimeout(r, 10));
    const enabling = conversion.enable(["convert"]).catch((e) => e);
    while (!releaseEstimate) await new Promise((r) => setTimeout(r, 5));
    const conversionBefore=conversionGets;
    await Promise.race([conversion.section("convert",0),new Promise((_,reject)=>setTimeout(()=>reject(Error("Playback waited for RAM conversion")),2000))]);
    if(conversionGets!==conversionBefore||conversion.complete("convert"))throw Error("RAM conversion refetched audio or claimed it was durable");
    conversion.setScope("convert-b");
    releaseEstimate();
    await enabling;
    if (await conversion.store.section("convert", 0) || await new DeviceAudioStore("convert-a").section("convert", 0)) throw Error("Account changed during conversion wrote audio");
    conversion.dispose();
    checks.push("account change during RAM-to-disk conversion aborts before write");
    let release;
    const delayed = new PersistentReadingAssets(() => new Promise((r) => release = () => r(new Response(bytes))));
    delayed.setScope("old-owner");
    delayed.shellReady = delayed.manifestReady = true;
    delayed.allow("delayed");
    delayed.register("delayed", ["text"], "F");
    delayed.observe("delayed", status);
    while (!release) await new Promise((r) => setTimeout(r, 5));
    delayed.setScope("new-owner");
    release();
    await new Promise((r) => setTimeout(r, 100));
    if (await delayed.store.section("delayed", 0)) throw Error("Late write crossed account");
    if (await new DeviceAudioStore("old-owner").section("delayed", 0)) throw Error("Aborted write became durable");
    delayed.dispose();
    checks.push("account change aborts late audio");
    const corrupt = new DeviceAudioStore("owner-a");
    await corrupt.transaction("jobs", "readwrite", (s) => s.put({ scope: "owner-a", voice: "F", sha256: "0".repeat(64) }, ["owner-a", "large"]));
    const a = new PersistentReadingAssets(() => {
      throw Error("blocked");
    });
    a.setScope("owner-a");
    a.shellReady = a.manifestReady = true;
    a.allow("large");
    const j = a.register("large", ["text"], "F");
    await j.hydrating;
    if (a.complete("large")) throw Error("Corrupt manifest accepted");
    a.dispose();
    checks.push("corrupt manifest rejected");
    const automatic = new DeviceAudioStore("automatic-guard",{name:"automatic-guard-proof"});
    const book={id:"deleted",generation:"g",text:"Synthetic automatic copy",records:[{id:"deleted-job"}]};
    await automatic.save("readings",book.id,book,{automatic:true});
    await automatic.writeSection("unpublished-part",0,{blob:new Blob([bytes]),bytes:bytes.length,samples:status.sections[0].samples},{reference:{readingId:book.id,generation:book.generation}});
    await automatic.removeReading(book.id);
    if(await automatic.section("unpublished-part",0))throw Error("Deletion left an admitted part outside the last manifest snapshot");
    let automaticallyRemoved=false;try{await automatic.save("readings",book.id,book,{automatic:true});}catch(e){automaticallyRemoved=e.name==="LocalCopyRemovedError";}
    if(!automaticallyRemoved||await automatic.reading(book.id))throw Error("Automatic save resurrected a removed reading");
    let lateBlocked=false;try{await automatic.writeSection("late-new-job",0,{blob:new Blob([bytes]),bytes:bytes.length,samples:status.sections[0].samples},{reference:{readingId:book.id,generation:book.generation}});}catch(e){lateBlocked=e.name==="LocalCopyRemovedError";}
    if(!lateBlocked||await automatic.section("late-new-job",0))throw Error("Late admission survived parent reading deletion");
    for(let i=0;i<20;i++)await automatic.save("readings","bounded-"+i,{id:"bounded-"+i,text:"Synthetic"},{automatic:true});
    let limited=false;try{await automatic.save("readings","over-limit",{id:"over-limit",text:"Synthetic"},{automatic:true});}catch(e){limited=e.name==="QuotaExceededError";}
    if(!limited)throw Error("Automatic library is unbounded");
    // A ledger seeded at the bound simulates disk occupancy without a 512 MiB fixture.
    await automatic.transaction("usage","readwrite",s=>s.put(512*1024*1024,"audio-bytes"));
    let byteLimited=false;try{await automatic.writeSection("over-budget",0,{blob:new Blob([bytes]),bytes:bytes.length,samples:status.sections[0].samples});}catch(e){byteLimited=e.name==="AudioBudgetExceededError";}
    if(!byteLimited||await automatic.section("over-budget",0))throw Error("Audio budget was exceeded");
    checks.push("automatic reading tombstones, 20-book limit and transactional 512 MiB audio budget");
    let releaseWrite;
    const nonblocking=new PersistentReadingAssets(async()=>new Response(bytes),{storeFactory:()=>({get:async()=>null,section:async()=>null,save:async()=>{},writeSection:()=>new Promise(resolve=>releaseWrite=resolve)})});
    nonblocking.setScope("nonblocking");nonblocking.allow("nonblocking");nonblocking.register("nonblocking",["text"],"F");nonblocking.observe("nonblocking",status);
    const result=await Promise.race([nonblocking.section("nonblocking",0),new Promise((_,reject)=>setTimeout(()=>reject(Error("Playback waited for disk write")),2000))]);
    if(!result.size||!releaseWrite||nonblocking.complete("nonblocking"))throw Error("Pending disk write reported ready");
    releaseWrite();while(nonblocking.jobs.get("nonblocking").writes?.size)await new Promise(r=>setTimeout(r,5));
    nonblocking.dispose();checks.push("foreground audio never waits for a background disk write or falsely reports offline-ready");
    let optOutGets=0;
    const optOut = new PersistentReadingAssets(async()=>{optOutGets++;return new Response(bytes);});
    optOut.setScope("opt-out");optOut.allow("opt-out");optOut.register("opt-out",["text"],"F");optOut.writesEnabled=false;optOut.observe("opt-out",status);
    const playable=await optOut.section("opt-out",0);
    if(!playable.size||optOutGets!==1||await optOut.store.section("opt-out",0)||await optOut.store.get("jobs","opt-out"))throw Error("Opt-out prevented playback or saved new data");
    optOut.dispose();checks.push("automatic-saving opt-out prevents metadata/audio writes while preserving foreground playback");
    return checks;
  });
  await writeFile(out + "/store-verification.json", JSON.stringify({ first, second, failures, realProviderCalls: 0, physicalPixel: false }, null, 2) + "\n");
  console.log(JSON.stringify({ first, second, failures }));
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
