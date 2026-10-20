// Build supplies a fixed, hashed static allowlist. Never cache API responses,
// account pages, access/login pages, requests with credentials in URLs, or audio.
const CACHE = "paste2speech-offline-shell-__BUILD__";
const ASSETS = __ASSETS__;
const hex = (bytes) => [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
async function complete() {
  const cache = await caches.open(CACHE);
  if (!await cache.match("/local-audio-ready")) return false;
  for (const file of Object.keys(ASSETS)) if (!await cache.match(file)) return false;
  return true;
}
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (!["SAVE_OFFLINE_SHELL", "CHECK_OFFLINE_SHELL"].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === "SAVE_OFFLINE_SHELL") {
        const cache = await caches.open(CACHE);
        await cache.delete("/local-audio-ready");
        for (const [path, sha256] of Object.entries(ASSETS)) {
          const response = await fetch(path, { cache: "no-store", redirect: "error" });
          if (!response.ok || hex(await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer())) !== sha256) throw Error("The offline app download could not be verified. Retry saving while connected.");
          await cache.put(path, response);
        }
        await cache.put("/local-audio-ready", new Response("verified"));
      }
      event.ports[0]?.postMessage({ ok: await complete() });
    } catch {
      event.ports[0]?.postMessage({ ok: false, error: "Offline app storage is unavailable or full. Audio is kept; retry while connected." });
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
      if (!saved) throw error;
      return saved;
    }
  })());
});
