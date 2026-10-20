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
      const r = this.indexedDB.open(this.name, 3);
      r.onupgradeneeded = () => {
        for (const name of ["jobs", "sections", "readings", "positions", "removed", "usage", "references"]) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
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
  async guardedPut(name, id, value, { valid = () => true, updateOnly = false, automatic = false, reference } = {}) {
    const names = [...new Set([name, "removed", ...((reference || name === "positions") ? ["readings"] : []), ...(reference ? ["references"] : [])])];
    await this.transaction(names, "readwrite", (store) => {
      const tx = store.transaction;
      const fail = (error) => {
        tx.pasteToSpeechError = error;
        tx.abort();
      };
      const put = () => {
        if (!valid()) return fail(new DOMException("Save canceled", "AbortError"));
        if(reference && name === "jobs") tx.objectStore("references").put(true,this.key(reference.readingId,id));
        store.put(value, this.key(id));
      };
      if (name === "jobs") {
        const r = tx.objectStore("removed").get(this.key(id));
        r.addEventListener("success", () => {
          if(r.result)return fail(this.removedError());
          if(!reference)return put();
          const reading=tx.objectStore("readings").get(this.key(reference.readingId));
          reading.onsuccess=()=>reading.result?.generation===reference.generation?put():fail(this.removedError());
        });
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
      if (name === "readings" && automatic) {
        const r = tx.objectStore("removed").get(this.key("reading:" + id));
        r.addEventListener("success", () => {
          if (r.result) return fail(this.removedError());
          const keys = store.getAllKeys(IDBKeyRange.bound([this.scope], [this.scope, []]));
          keys.addEventListener("success", () => {
            if (keys.result.length >= 20 && !keys.result.some(key => key[1] === id)) {
              const error = Error("20 readings are kept on this device. Remove a saved reading to enable more offline copies. Online playback can continue.");
              error.name = "QuotaExceededError";
              return fail(error);
            }
            put();
          });
        });
        return r;
      }
      put();
    });
  }
  async save(name, id, data, { valid = () => true, updateOnly = false, automatic = false, reference } = {}) {
    const record = { ...data, scope: this.scope }, sha256 = await digest(JSON.stringify(record));
    await this.guardedPut(name, id, { ...record, sha256 }, { valid, updateOnly, automatic, reference });
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
  async writeSection(id, index, entry, { valid = () => true, reference } = {}) {
    const estimate = await this.storage?.estimate?.().catch(() => null);
    if (estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage) && estimate.quota - estimate.usage < entry.bytes) {
      const e = Error("Not enough device storage. Saved sections are kept; online playback can continue.");
      e.name = "QuotaExceededError";
      throw e;
    }
    if (!valid()) throw new DOMException("Save canceled", "AbortError");
    await this.transaction(["sections", "removed", "usage", "readings", "references"], "readwrite", (store) => {
      const tx = store.transaction, r = tx.objectStore("removed").get(this.key(id));
      r.addEventListener("success", () => {
        if (!valid() || r.result) {
          tx.pasteToSpeechError = r.result ? this.removedError() : new DOMException("Save canceled", "AbortError");
          tx.abort();
          return;
        }
        const writeVerified = () => {
        const usageStore = tx.objectStore("usage"), usageRequest = usageStore.get("audio-bytes");
        usageRequest.onsuccess = () => {
          const write = used => {
            const previous = store.get(this.key(id, index));
            previous.onsuccess = () => {
              const next = used - (previous.result?.bytes || 0) + entry.bytes;
              if (next > 512 * 1024 * 1024) {
                const error = Error("Device audio reached its 512 MiB limit. Remove saved readings to make space; online playback can continue.");
                error.name = "QuotaExceededError"; tx.pasteToSpeechError = error; tx.abort(); return;
              }
              if (!valid()) { tx.abort(); return; }
              usageStore.put(next, "audio-bytes");
              if(reference)tx.objectStore("references").put(true,this.key(reference.readingId,id));
              store.put(entry, this.key(id, index));
            };
          };
          if (typeof usageRequest.result === "number") write(usageRequest.result);
          else {
            let used = 0; const cursor = store.openCursor();
            cursor.onsuccess = () => { const item = cursor.result; if(item) { used += item.value.bytes || 0; item.continue(); } else write(used); };
          }
        };
        };
        if(reference){
          const reading=tx.objectStore("readings").get(this.key(reference.readingId));
          reading.onsuccess=()=>{if(reading.result?.generation===reference.generation)writeVerified();else{tx.pasteToSpeechError=this.removedError();tx.abort();}};
        }else writeVerified();
      });
      return r;
    });
  }
  async removeSection(id, index) {
    await this.transaction(["sections", "usage"], "readwrite", (s) => { s.transaction.objectStore("usage").delete("audio-bytes"); return s.delete(this.key(id, index)); });
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
      const tx = db.transaction(["readings", "jobs", "sections", "positions", "removed", "usage", "references"], "readwrite");
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
      let references=[];
      const referenceRequest=tx.objectStore("references").getAllKeys(range);
      referenceRequest.onsuccess=()=>references=referenceRequest.result;
      let keys;
      const keyRequest = readings.getAllKeys(range);
      keyRequest.onsuccess = () => keys = keyRequest.result;
      const request = readings.getAll(range);
      request.onsuccess = () => {
        try {
          const index = keys.findIndex((key) => key[1] === id), target = request.result[index];
          if (!target) return;
          const referenced = new Set(request.result.filter((_, i) => i !== index).flatMap((r) => (Array.isArray(r.records) ? r.records : []).map((record) => record?.id)));
          for(const key of references)if(key[1]!==id)referenced.add(key[2]);
          removed = [...new Set([...(Array.isArray(target.records) ? target.records : []).map(record=>record?.id),...references.filter(key=>key[1]===id).map(key=>key[2])])].filter(id2=>typeof id2 === "string"&&!referenced.has(id2));
          for(const key of references)if(key[1]===id)tx.objectStore("references").delete(key);
          tx.objectStore("removed").put({ removed: true }, this.key("reading:" + id));
          readings.delete(this.key(id));
          tx.objectStore("positions").delete(this.key(id));
          for (const job of removed) {
            tx.objectStore("removed").put({ removed: true }, this.key(job));
            tx.objectStore("jobs").delete(this.key(job));
            tx.objectStore("usage").delete("audio-bytes");
            tx.objectStore("sections").delete(IDBKeyRange.bound(this.key(job, 0), this.key(job, Number.MAX_SAFE_INTEGER)));
          }
        } catch {
          tx.abort();
        }
      };
    });
  }
}
