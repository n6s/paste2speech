// Build supplies a fixed, hashed static allowlist. Never cache API responses,
// account pages, access/login pages, requests with credentials in URLs, or audio.
const CACHE = "paste2speech-offline-shell-__BUILD__";
const ASSETS = __ASSETS__;
const hex = (bytes) => [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
async function verified(response, hash) {
  return !!response && hex(await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer())) === hash;
}
async function complete(checkHashes = false) {
  const cache = await caches.open(CACHE);
  if (!await cache.match("/local-audio-ready")) return false;
  for (const [file, hash] of Object.entries(ASSETS)) {
    const response = await cache.match(file);
    if (!response || checkHashes && !await verified(response, hash)) return false;
  }
  return true;
}
async function prepare() {
  if (await complete(true)) return;
  const cache = await caches.open(CACHE);
  for (const [path, hash] of Object.entries(ASSETS)) {
    const existing = await cache.match(path);
    if (await verified(existing, hash)) continue;
    const response = await fetch(path, { cache: "no-store", redirect: "error" });
    if (!response.ok || !await verified(response, hash)) throw Error("Offline app download could not be verified.");
    await cache.put(path, response);
  }
  await cache.put("/local-audio-ready", new Response("verified"));
}
self.addEventListener("install", (event) => event.waitUntil((async () => {
  const previous = (await caches.keys()).some((name) => name.startsWith("paste2speech-offline-shell-") && name !== CACHE);
  if (previous) await prepare();
})()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (!["SAVE_OFFLINE_SHELL", "CHECK_OFFLINE_SHELL"].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === "SAVE_OFFLINE_SHELL") await prepare();
      event.ports[0]?.postMessage({ ok: await complete(true), cache: CACHE });
    } catch {
      event.ports[0]?.postMessage({ ok: false, cache: CACHE, error: "Offline app storage is unavailable or full. Audio is kept; retry while connected." });
    }
  })());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !Object.hasOwn(ASSETS, url.pathname)) return;
  event.respondWith((async () => {
    try {
      return await fetch(event.request);
    } catch (error) {
      if (!await complete()) throw error;
      const saved = await (await caches.open(CACHE)).match(url.pathname);
      if (!await verified(saved, ASSETS[url.pathname])) throw error;
      return saved;
    }
  })());
});
