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
      const r = this.indexedDB.open(this.name, 2);
      r.onupgradeneeded = () => {
        for (const name of ["jobs", "sections", "readings", "positions", "removed"]) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          this.opening = null;
          r.result.close();
        };
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => {
        r.onsuccess = () => r.result.close();
        reject(Error("Close other reader tabs to enable device storage."));
      };
    }).catch((error) => {
      this.opening = null;
      throw error;
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
      tx.onerror = tx.onabort = () => reject(tx.pasteToSpeechError || tx.error || Error("Device storage write was interrupted."));
      try {
        const r = operation(tx.objectStore(Array.isArray(name) ? name[0] : name));
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
  removedError() {
    const error = Error("This saved copy was removed or replaced in another tab. Save it again explicitly to keep a new copy.");
    error.name = "LocalCopyRemovedError";
    return error;
  }
  async guardedPut(name, id, value, { valid = () => true, updateOnly = false } = {}) {
    const names = [name, "removed", ...["readings", "positions"].includes(name) && name !== "readings" ? ["readings"] : []];
    await this.transaction(names, "readwrite", (store) => {
      const tx = store.transaction;
      const fail = (error) => {
        tx.pasteToSpeechError = error;
        tx.abort();
      };
      const put = () => {
        if (!valid()) return fail(new DOMException("Save canceled", "AbortError"));
        store.put(value, this.key(id));
      };
      if (name === "jobs") {
        const r = tx.objectStore("removed").get(this.key(id));
        r.addEventListener("success", () => r.result ? fail(this.removedError()) : put());
        return r;
      }
      if (name === "readings" && updateOnly || name === "positions") {
        const r = tx.objectStore("readings").get(this.key(id));
        r.addEventListener("success", () => {
          if (!r.result || (r.result.generation || "legacy") !== (value.generation || "legacy")) fail(this.removedError());
          else put();
        });
        return r;
      }
      put();
    });
  }
  async save(name, id, data, { valid = () => true, updateOnly = false } = {}) {
    const record = { ...data, scope: this.scope }, sha256 = await digest(JSON.stringify(record));
    await this.guardedPut(name, id, { ...record, sha256 }, { valid, updateOnly });
  }
  async restoreJobs(ids, { readingId, generation }, valid = () => true) {
    await this.transaction(["readings", "removed"], "readwrite", (store) => {
      const tx = store.transaction, r = store.get(this.key(readingId));
      r.addEventListener("success", () => {
        if (!valid() || !r.result || r.result.generation !== generation) {
          tx.pasteToSpeechError = this.removedError();
          tx.abort();
          return;
        }
        for (const id of ids) tx.objectStore("removed").delete(this.key(id));
      });
      return r;
    });
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
    await this.transaction(["sections", "removed"], "readwrite", (store) => {
      const tx = store.transaction, r = tx.objectStore("removed").get(this.key(id));
      r.addEventListener("success", () => {
        if (!valid() || r.result) {
          tx.pasteToSpeechError = r.result ? this.removedError() : new DOMException("Save canceled", "AbortError");
          tx.abort();
          return;
        }
        store.put(entry, this.key(id, index));
      });
      return r;
    });
  }
  async removeSection(id, index) {
    await this.transaction("sections", "readwrite", (s) => s.delete(this.key(id, index)));
  }
  async reading(id) {
    const data = await this.get("readings", id);
    if (!data) return null;
    try {
      const position = await this.get("positions", id);
      return position && (position.generation || "legacy") === (data.generation || "legacy") ? { ...data, position: position.position, updated: position.updated, options: { ...data.options, rate: position.rate ?? data.options?.rate } } : data;
    } catch {
      return { ...data, position: 0, positionUnavailable: true };
    }
  }
  async readings() {
    let keys;
    const range = IDBKeyRange.bound([this.scope], [this.scope, []]);
    const all = await this.transaction("readings", "readonly", (store) => {
      const r = store.getAllKeys(range);
      r.addEventListener("success", () => keys = r.result);
      return store.getAll(range);
    });
    const verified = [];
    for (let i = 0; i < all.length; i++) {
      const { sha256, ...data } = all[i], id = keys[i][1];
      if (data.scope !== this.scope || data.id !== id || typeof data.text !== "string" || await digest(JSON.stringify(data)) !== sha256) {
        verified.push({ id, scope: this.scope, text: "Saved reading needs verification", damaged: true, updated: 0 });
        continue;
      }
      const reading = await this.reading(id);
      if (reading) verified.push(reading);
    }
    return verified.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }
  async removeReading(id) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["readings", "jobs", "sections", "positions", "removed"], "readwrite");
      let removed = [];
      tx.oncomplete = () => {
        resolve(removed);
        if (globalThis.BroadcastChannel) {
          const channel = new BroadcastChannel("paste2speech-device-audio");
          channel.postMessage({ type: "removed", scope: this.scope, id, jobs: removed });
          channel.close();
        }
      };
      tx.onabort = tx.onerror = () => reject(tx.error || Error("Device removal was interrupted."));
      const readings = tx.objectStore("readings"), range = IDBKeyRange.bound([this.scope], [this.scope, []]);
      let keys;
      const keyRequest = readings.getAllKeys(range);
      keyRequest.onsuccess = () => keys = keyRequest.result;
      const request = readings.getAll(range);
      request.onsuccess = () => {
        try {
          const index = keys.findIndex((key) => key[1] === id), target = request.result[index];
          if (!target) return;
          const referenced = new Set(request.result.filter((_, i) => i !== index).flatMap((r) => (Array.isArray(r.records) ? r.records : []).map((record) => record?.id)));
          removed = (Array.isArray(target.records) ? target.records : []).map((record) => record?.id).filter((id2) => typeof id2 === "string" && !referenced.has(id2));
          readings.delete(this.key(id));
          tx.objectStore("positions").delete(this.key(id));
          for (const job of removed) {
            tx.objectStore("removed").put({ removed: true }, this.key(job));
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
