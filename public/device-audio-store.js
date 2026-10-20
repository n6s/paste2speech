// Private to this browser origin. No audio, text or account identifiers leave
// this store. Transactions publish complete verified sections, never partial data.
export const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : value))].map((n) => n.toString(16).padStart(2, "0")).join("");
export class DeviceAudioStore {
  constructor(scope, { indexedDB = globalThis.indexedDB, name = "paste2speech-device-audio-v1", storage = globalThis.navigator?.storage } = {}) {
    if (!scope) throw Error("Confirm your account before saving audio.");
    Object.assign(this, { scope, indexedDB, name, storage });
  }
  async db() {
    return this.opening ??= new Promise((resolve, reject) => {
      if (!this.indexedDB) return reject(Error("Device storage is unavailable."));
      const r = this.indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => {
        for (const name of ["jobs", "sections", "readings", "positions"]) r.result.createObjectStore(name);
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(Error("Close other reader tabs to enable device storage."));
    });
  }
  async close() {
    if (this.opening) (await this.opening.catch(() => null))?.close();
  }
  async transaction(name, mode, operation) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error("Device storage write was interrupted."));
      try {
        const r = operation(tx.objectStore(name));
        if (r) {
          r.onsuccess = () => {
            result = r.result;
          };
        }
      } catch (e) {
        tx.abort();
        reject(e);
      }
    });
  }
  key(...parts) {
    return [this.scope, ...parts];
  }
  async get(name, id) {
    const record = await this.transaction(name, "readonly", (s) => s.get(this.key(id)));
    if (!record) return null;
    const { sha256, ...data } = record;
    if (data.scope !== this.scope || data.id !== id || await digest(JSON.stringify(data)) !== sha256) throw Error("Saved reading metadata could not be verified.");
    return data;
  }
  async save(name, id, data, { valid = () => true } = {}) {
    const record = { ...data, scope: this.scope };
    const sha256 = await digest(JSON.stringify(record));
    if (!valid()) throw new DOMException("Save canceled", "AbortError");
    await this.transaction(name, "readwrite", (s) => s.put({ ...record, sha256 }, this.key(id)));
  }
  async section(id, index) {
    return this.transaction("sections", "readonly", (s) => s.get(this.key(id, index)));
  }
  async writeSection(id, index, entry, { valid = () => true } = {}) {
    const estimate = await this.storage?.estimate?.().catch(() => null);
    if (estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage) && estimate.quota - estimate.usage < entry.bytes) {
      const e = Error("Not enough device storage. Saved sections are kept; online playback can continue.");
      e.name = "QuotaExceededError";
      throw e;
    }
    if (!valid()) throw new DOMException("Save canceled", "AbortError");
    await this.transaction("sections", "readwrite", (s) => s.put(entry, this.key(id, index)));
  }
  async removeSection(id, index) {
    await this.transaction("sections", "readwrite", (s) => s.delete(this.key(id, index)));
  }
  async readings() {
    const all = await this.transaction("readings", "readonly", (s) => s.getAll(IDBKeyRange.bound([this.scope], [this.scope, []])));
    const selected = all.filter((r) => r.scope === this.scope), verified = [];
    for (const r of selected) {
      const { sha256, ...data } = r;
      if (await digest(JSON.stringify(data)) !== sha256) throw Error("Saved reading metadata could not be verified.");
      const position = await this.get("positions", data.id);
      verified.push(position ? { ...data, position: position.position, updated: position.updated, options: { ...data.options, rate: position.rate ?? data.options?.rate } } : data);
    }
    return verified.sort((a, b) => b.updated - a.updated);
  }
  async removeReading(id) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["readings", "jobs", "sections", "positions"], "readwrite");
      let removed = [];
      tx.oncomplete = () => resolve(removed);
      tx.onabort = tx.onerror = () => reject(tx.error || Error("Device removal was interrupted."));
      const readings = tx.objectStore("readings"), request = readings.getAll(IDBKeyRange.bound([this.scope], [this.scope, []]));
      request.onsuccess = () => {
        try {
          const target = request.result.find((r) => r.id === id);
          if (!target) return;
          const referenced = new Set(request.result.filter((r) => r.id !== id).flatMap((r) => (r.records || []).map((r2) => r2.id)));
          removed = (target.records || []).map((r) => r.id).filter((id2) => id2 && !referenced.has(id2));
          readings.delete(this.key(id));
          tx.objectStore("positions").delete(this.key(id));
          for (const job of removed) {
            tx.objectStore("jobs").delete(this.key(job));
            tx.objectStore("sections").delete(IDBKeyRange.bound(this.key(job, 0), this.key(job, Number.MAX_SAFE_INTEGER)));
          }
        } catch {
          tx.abort();
        }
      };
    });
  }
}
