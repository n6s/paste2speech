import { ReadingAssets } from "./reading-assets.js";
import { DeviceAudioStore, digest } from "./device-audio-store.js";
import { checkAudioResponse } from "./prepared-response.js";
import { inspectMp3, captions } from "../cloudflare/prepared/mp3.js";
const matches = (a, b) => a && a.bytes === b.bytes && a.samples === b.samples && (!b.sha256 || a.sha256 === b.sha256);
const wait = (promise, signal) => {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
};
export class PersistentReadingAssets extends ReadingAssets {
  constructor(fetcher, { ramBytes = 8 * 1024 * 1024, storeFactory = (scope) => new DeviceAudioStore(scope), ...options } = {}) {
    super(fetcher, options);
    Object.assign(this, { ramBytes, storeFactory, revoking: /* @__PURE__ */ new Set(), allowed: /* @__PURE__ */ new Set(), ram: /* @__PURE__ */ new Map(), ramUsed: 0, scope: null, store: null });
  }
  setScope(scope) {
    if (scope === this.scope) return;
    if (this.scope) this.clear();
    this.allowed.clear();
    this.revoking.clear();
    this.manifestReady = false;
    this.ram.clear();
    this.ramUsed = 0;
    void this.store?.close?.();
    this.scope = scope;
    this.store = scope ? this.storeFactory(scope) : null;
  }
  allow(id) {
    if (!this.store) throw Error("Confirm your account before saving audio.");
    this.allowed.add(id);
  }
  saved(id) {
    return this.allowed.has(id) && !!this.store;
  }
  register(id, chunks, voice) {
    const job = super.register(id, chunks, voice);
    if (this.saved(id) && !job.hydrating) {
      job.hydrating = this.hydrate(job).catch((e) => {
        job.storageError = e.message;
        this.onChange();
      });
    }
    return job;
  }
  async verify(entry, meta) {
    if (!entry?.blob || !matches(entry, meta)) throw Error("Saved audio metadata does not match this reading.");
    const bytes = new Uint8Array(await entry.blob.arrayBuffer()), info = inspectMp3(bytes), sha256 = await digest(bytes);
    if (info.bytes !== meta.bytes || info.samples !== meta.samples || sha256 !== entry.sha256 || meta.sha256 && sha256 !== meta.sha256) throw Error("Saved audio integrity could not be verified.");
    return entry;
  }
  remember(id, index, entry) {
    const key = id + ":" + index, old = this.ram.get(key);
    if (old) this.ramUsed -= old.bytes;
    this.ram.delete(key);
    if (entry.bytes <= this.ramBytes) {
      while (this.ramUsed + entry.bytes > this.ramBytes && this.ram.size) {
        const [key2, value] = this.ram.entries().next().value;
        this.ram.delete(key2);
        this.ramUsed -= value.bytes;
      }
      this.ram.set(key, entry);
      this.ramUsed += entry.bytes;
    }
  }
  metadata(entry) {
    return { bytes: entry.bytes, samples: entry.samples, sha256: entry.sha256 };
  }
  async hydrate(job) {
    const store = this.store, epoch = job.localEpoch || 0, record = await store.get("jobs", job.id);
    if (job.controller.signal.aborted || store !== this.store || epoch !== (job.localEpoch || 0) || this.revoking.has(job.id)) return;
    for (const [index, entry] of job.data) if (!entry.blob) job.data.delete(index);
    this.onChange();
    if (!record) return;
    if (record.id !== job.id || record.voice !== job.voice || JSON.stringify(record.chunks) !== JSON.stringify(job.chunks)) throw Error("Saved audio identity does not match this reading.");
    if (!job.status) super.observe(job.id, record.status);
    if (job.invalid) return;
    for (const meta of job.status?.sections || []) {
      if (job.controller.signal.aborted || store !== this.store || epoch !== (job.localEpoch || 0) || this.revoking.has(job.id)) return;
      const entry = await store.section(job.id, meta.index);
      if (!entry) continue;
      try {
        await this.verify(entry, meta);
        if (job.controller.signal.aborted || store !== this.store || epoch !== (job.localEpoch || 0) || this.revoking.has(job.id)) return;
        job.data.set(meta.index, this.metadata(entry));
        this.remember(job.id, meta.index, entry);
      } catch {
        job.data.delete(meta.index);
        job.storageError = "A saved section could not be verified. Reconnect and retry the download.";
      }
    }
    this.onChange();
  }
  observe(id, status) {
    super.observe(id, status);
    const job = this.jobs.get(id);
    if (this.saved(id) && job && !job.invalid) {
      const store = this.store, epoch = job.localEpoch || 0;
      job.saving = (job.saving || Promise.resolve()).catch(() => {
      }).then(() => {
        if (job.controller.signal.aborted || store !== this.store || !this.saved(id) || epoch !== (job.localEpoch || 0)) return;
        return store.save("jobs", id, { id, chunks: job.chunks, voice: job.voice, status }, { valid: () => !job.controller.signal.aborted && store === this.store && !this.revoking.has(id) && this.saved(id) && epoch === (job.localEpoch || 0) });
      }).catch((e) => {
        job.storageError = e.message;
        this.onChange();
      });
    }
  }
  prefetch(job) {
    if (!this.saved(job.id)) return super.prefetch(job);
    if (job.controller.signal.aborted || job.terminal || job.invalid || job.accessBlocked || job.storageBlocked || job.loading) return;
    job.loading = true;
    void (async () => {
      await job.hydrating;
      for (const meta of job.status?.sections || []) {
        if (job.controller.signal.aborted || job.storageBlocked || job.invalid || job.accessBlocked) break;
        if (matches(job.data.get(meta.index), meta)) continue;
        try {
          await this.section(job.id, meta.index, { background: true });
        } catch (e) {
          if (job.controller.signal.aborted) break;
          if (e.invalidAudio) {
            job.invalid = true;
            job.error = "Audio could not be verified.";
          } else if (e.authRequired || e.audioUnavailable) {
            job.accessBlocked = true;
            job.error = e.message;
          } else {
            job.storageError = "Download interrupted. Saved sections are kept; reconnect and retry.";
          }
          break;
        }
      }
    })().finally(() => {
      job.loading = false;
      this.onChange();
      if (!job.controller.signal.aborted && !job.storageError && !job.storageBlocked && !job.invalid && !job.accessBlocked && (job.status?.sections || []).some((meta) => !matches(job.data.get(meta.index), meta))) queueMicrotask(() => this.prefetch(job));
    });
  }
  async enable(ids, reference) {
    const store = this.store;
    if (reference) await store.restoreJobs(ids, reference, () => store === this.store);
    for (const id of ids) {
      if (store !== this.store) throw Error("The account changed.");
      this.allow(id);
      const job = this.jobs.get(id);
      if (!job) continue;
      job.loading = true;
      try {
        await Promise.allSettled([...job.pending.values()]);
        job.controller.signal.throwIfAborted();
        if (store !== this.store) throw Error("The account changed.");
        const entries = [...job.data];
        job.hydrating = Promise.resolve();
        for (const [index, entry] of entries) if (entry.blob) {
          job.controller.signal.throwIfAborted();
          if (store !== this.store) throw Error("The account changed.");
          try {
            await store.writeSection(id, index, entry, { valid: () => !job.controller.signal.aborted && store === this.store && !this.revoking.has(id) && this.saved(id) });
            job.controller.signal.throwIfAborted();
            if (store !== this.store) throw Error("The account changed.");
            job.data.set(index, this.metadata(entry));
            this.remember(id, index, entry);
            this.bytes -= entry.bytes;
          } catch (e) {
            job.controller.signal.throwIfAborted();
            if (store !== this.store) throw Error("The account changed.");
            job.data.delete(index);
            this.bytes -= entry.bytes;
            this.remember(id, index, entry);
            job.storageBlocked = true;
            job.storageError = this.storageMessage(e);
          }
        }
      } finally {
        job.loading = false;
      }
      if (job.status) this.observe(id, job.status);
      this.prefetch(job);
    }
    this.onChange();
  }
  storageMessage(e) {
    if (e.name === "LocalCopyRemovedError") return e.message;
    return e.name === "QuotaExceededError" ? "Device storage is full. Saved sections are kept. Online playback can continue; free space and Retry saving." : "Device storage is unavailable or a write was interrupted. Saved sections are kept; Retry saving.";
  }
  async section(id, index, { signal, background = false } = {}) {
    if (!this.saved(id)) return super.section(id, index, { signal });
    signal?.throwIfAborted();
    const job = this.jobs.get(id), meta = job?.status?.sections[index], store = this.store;
    if (!job || !meta || job.controller.signal.aborted) throw Error("Saved audio section is unavailable.");
    const epoch = job.localEpoch || 0, key = id + ":" + index, cached = this.ram.get(key);
    if (cached && matches(cached, meta) && (!background || job.data.has(index))) {
      this.remember(id, index, cached);
      return cached.blob;
    }
    let pending = job.pending.get(index);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const task = { resolve, reject, run: async () => {
          job.controller.signal.throwIfAborted();
          let entry;
          try {
            entry = await store.section(id, index);
          } catch (e) {
            job.storageBlocked = true;
            job.storageError = this.storageMessage(e);
          }
          let durable = !!entry;
          if (entry) {
            try {
              await this.verify(entry, meta);
            } catch {
              job.data.delete(index);
              entry = null;
              durable = false;
            }
          }
          if (!entry && cached && matches(cached, meta)) entry = cached;
          if (!entry) {
            job.data.delete(index);
            this.onChange();
            if (globalThis.navigator?.onLine === false) throw Error("This section is not saved. Reconnect to continue.");
            const response = await this.fetcher(`/api/readings/${id}/sections/${index}`, { signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(1e4)]) });
            await checkAudioResponse(response);
            const bytes = new Uint8Array(await response.arrayBuffer()), info = inspectMp3(bytes), sha256 = await digest(bytes);
            if (info.bytes !== meta.bytes || info.samples !== meta.samples || meta.sha256 && meta.sha256 !== sha256) {
              const e = Error("Downloaded audio could not be verified.");
              e.invalidAudio = true;
              throw e;
            }
            entry = { blob: new Blob([bytes], { type: "audio/mpeg" }), bytes: info.bytes, samples: info.samples, sha256 };
          }
          job.controller.signal.throwIfAborted();
          if (store !== this.store) throw Error("The account changed.");
          if (!durable) {
            try {
              await job.saving;
              await store.writeSection(id, index, entry, { valid: () => !job.controller.signal.aborted && store === this.store && !this.revoking.has(id) && this.saved(id) && epoch === (job.localEpoch || 0) });
              durable = true;
              job.storageError = "";
              job.storageBlocked = false;
            } catch (e) {
              if (this.saved(id) && !this.revoking.has(id) && epoch === (job.localEpoch || 0)) {
                job.storageBlocked = true;
                job.storageError = this.storageMessage(e);
              }
            }
          }
          job.controller.signal.throwIfAborted();
          if (store !== this.store) throw Error("The account changed.");
          if (this.revoking.has(id) || !this.saved(id) || epoch !== (job.localEpoch || 0)) {
            if (!this.saved(id) && this.bytes + entry.bytes <= this.maxBytes && !job.data.has(index)) {
              job.data.set(index, entry);
              this.bytes += entry.bytes;
            }
            return entry.blob;
          }
          if (durable) job.data.set(index, this.metadata(entry));
          else job.data.delete(index);
          this.remember(id, index, entry);
          this.onChange();
          return entry.blob;
        } };
        if (background) this.queue.push(task);
        else this.queue.unshift(task);
        this.drain();
      });
      job.pending.set(index, pending);
      pending.finally(() => {
        if (job.pending.get(index) === pending) job.pending.delete(index);
      }).catch(() => {
      });
    }
    return wait(pending, signal);
  }
  complete(id) {
    if (!this.saved(id)) return super.complete(id);
    const job = this.jobs.get(id), status = job?.status;
    return !!job && !job.invalid && !job.terminal && status?.state === "ready" && status.total === job.chunks.length && status.completed === status.total && status.sections.length === status.total && status.sections.every((s) => matches(job.data.get(s.index), s));
  }
  info(ids, total) {
    if (!ids.length || !ids.every((id) => this.saved(id))) return super.info(ids, total);
    const jobs = ids.map((id) => this.jobs.get(id)), downloaded = jobs.reduce((n, j) => n + (j?.data.size || 0), 0);
    return { ready: this.shellReady === true && this.manifestReady === true && jobs.every((j) => j && this.complete(j.id)) && downloaded === total, downloaded, total, bytes: jobs.reduce((n, j) => n + [...j?.data.values() || []].reduce((n2, e) => n2 + e.bytes, 0), 0), ramBytes: this.ramUsed, error: jobs.find((j) => j?.storageError || j?.error)?.storageError || jobs.find((j) => j?.error)?.error || "", retention: "this device" };
  }
  beginRemoval(ids) {
    this.manifestReady = false;
    for (const id of ids) {
      this.revoking.add(id);
      const job = this.jobs.get(id);
      if (job) job.localEpoch = (job.localEpoch || 0) + 1;
    }
  }
  endRemoval(ids) {
    for (const id of ids) this.revoking.delete(id);
  }
  forgetLocal(ids) {
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (!job) {
        this.allowed.delete(id);
        continue;
      }
      job.localEpoch = (job.localEpoch || 0) + 1;
      for (const entry of job.data.values()) if (entry.blob) this.bytes -= entry.bytes;
      job.data.clear();
      for (const [key, entry] of this.ram) if (key.startsWith(id + ":")) {
        job.data.set(Number(key.slice(id.length + 1)), entry);
        this.bytes += entry.bytes;
        this.ramUsed -= entry.bytes;
        this.ram.delete(key);
      }
      this.allowed.delete(id);
    }
    this.manifestReady = false;
    this.onChange();
  }
  async recheck() {
    for (const job of this.jobs.values()) if (this.saved(job.id)) {
      await this.hydrate(job).catch((e) => {
        job.storageError = e.message;
        job.data.clear();
      });
      this.onChange();
    }
  }
  retry() {
    for (const job of this.jobs.values()) {
      job.storageBlocked = false;
      job.accessBlocked = false;
      job.storageError = "";
      this.prefetch(job);
    }
  }
  evict(id, index) {
    if (!this.saved(id)) return super.evict(id, index);
    const job = this.jobs.get(id);
    job?.data.delete(index);
    const key = id + ":" + index, old = this.ram.get(key);
    if (old) this.ramUsed -= old.bytes;
    this.ram.delete(key);
    this.revoke(job);
    this.onChange();
  }
  url(id, kind) {
    if (!this.saved(id)) return super.url(id, kind);
    const job = this.jobs.get(id);
    if (!this.complete(id) || kind !== "vtt") return null;
    if (!job.urls.has(kind)) job.urls.set(kind, URL.createObjectURL(new Blob([captions(job.chunks, job.status)], { type: "text/vtt" })));
    return job.urls.get(kind);
  }
  cancel(id) {
    const job = this.jobs.get(id);
    if (this.saved(id) && job) {
      for (const entry of job.data.values()) if (entry.blob) this.bytes -= entry.bytes;
      for (const index of job.data.keys()) {
        const key = id + ":" + index, e = this.ram.get(key);
        if (e) this.ramUsed -= e.bytes;
        this.ram.delete(key);
      }
      job.data.clear();
    }
    super.cancel(id);
  }
}
