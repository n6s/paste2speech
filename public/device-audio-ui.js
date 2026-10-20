import { DeviceAudioStore, digest } from "./device-audio-store.js";
import { splitReadingChunks } from "./playlist-plan.js";
import { ReadingProtection } from "./reading-protection.js";
function setupDeviceAudio({ getPlayer, getActive = getPlayer, getEngine = () => "google", getText, getChunks = () => [], snapshot, apply, matches = () => true, refresh = () => {
}, getQueue = () => null, loadQueued = () => {
}, regenerate = () => {
} }) {
  const natural = getPlayer(), transport = natural.longReadings, assets = transport?.assets;
  if (!assets?.setScope) return;
  const protection = new ReadingProtection();
  assets.protection = protection;
  const preferenceKey = "paste2speech.device-audio.automatic", lastScopeKey = "paste2speech.device-audio.scope", anonymousKey = "paste2speech.browser-history.scope";
  let anonymousScope = localStorage.getItem(anonymousKey);
  if (!anonymousScope) {
    anonymousScope = "browser-profile:" + crypto.randomUUID();
    localStorage.setItem(anonymousKey, anonymousScope);
  }
  const anonymousStore = new DeviceAudioStore(anonymousScope), store = () => assets.store || anonymousStore, scope = () => store().scope, latestKey = () => "paste2speech.device-audio.latest." + scope();
  const nav = document.createElement("div");
  nav.id = "reading-navigation";
  nav.className = "controls";
  nav.hidden = true;
  nav.style.cssText = "grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin-block:12px";
  nav.innerHTML = '<button id="previous-reading" type="button" class="quiet">Previous reading</button><span id="reading-order" role="status"></span><button id="next-reading" type="button" class="quiet">Next reading</button>';
  const panel = document.createElement("details");
  panel.id = "device-readings";
  panel.style.overflowWrap = "anywhere";
  panel.innerHTML = '<summary>Readings and offline storage</summary><p>Text, voice and place are kept in this browser. Natural audio saves automatically as it becomes available; browser voices keep text and bookmarks, not audio files. Other people using this browser profile may access saved readings offline. The browser may remove site data. Up to 20 readings per account and 512 MiB of shared source audio are kept. Only audio you mark Finished may be reclaimed when space is needed; your text and place remain. Current readings, unfinished preparation and active exports are protected.</p><label><input id="automatic-device-audio" type="checkbox" checked> Automatically keep readings on this device</label><div class="controls"><button id="retry-device-reading" type="button">Retry offline saving</button><button id="keep-device-reading" type="button" hidden>Keep current reading again</button><button id="regenerate-device-reading" type="button" hidden>Generate missing audio again…</button></div><p id="device-audio-status" role="status"></p><ul id="device-audio-list"></ul>';
  panel.querySelector("summary").style.minHeight = "44px";
  for (const button of [...panel.querySelectorAll("button"), ...nav.querySelectorAll("button")]) button.style.minWidth = "0";
  document.getElementById("section-progress").after(nav, panel);
  const $ = (id) => panel.querySelector("#" + id), message = (text) => {
    $("device-audio-status").textContent = text;
  };
  $("automatic-device-audio").checked = localStorage.getItem(preferenceKey) !== "false";
  assets.writesEnabled = $("automatic-device-audio").checked;
  let selected = null, selectedRelease = null, records = [], opening = false, saving = false, attaching = false, timer = null, checking = 0, serial = 0, restoreScope = null, nativeBlocked = null, shellReady = false, persistent = false, flushing = Promise.resolve(), suppressed = /* @__PURE__ */ new Set();
  const enabled = () => $("automatic-device-audio").checked;
  const activeStore = (record) => record?.scope === scope() ? store() : null;
  function capture() {
    if (!selected) return;
    const player = getActive();
    if (selected.engine === "browser") {
      if (getEngine() === "browser" && player?.state !== "idle" && player?.chunks === selected.nativeChunks) selected.lastPlace = { index: player.index || 0, offset: player.offset || 0, rate: player.settings?.rate || 1 };
    } else if (player === natural && natural.id === selected.groupId) selected.lastPlace = { position: Math.max(0, natural.pendingTime ?? natural.audio.currentTime ?? 0), rate: natural.rate || 1 };
  }
  async function flush() {
    capture();
    if (!selected || !enabled()) return;
    const record = selected, target = activeStore(record);
    if (!target) return;
    const valid = () => target === activeStore(record), place = { ...record.lastPlace || {}, id: record.id, generation: record.generation, updated: Date.now() };
    const group = record.engine === "browser" ? null : transport.groups.get(record.groupId);
    const copy = { ...record };
    for (const key of ["groupId", "lastPlace", "nativeChunks", "storedRevision", "storedReady", "lifecycleSave"]) delete copy[key];
    if (group) {
      copy.manifestRevision = group.deviceRevision || 0;
      copy.records = structuredClone(group.session.records);
      copy.statuses = structuredClone(group.statuses);
      copy.offlineReady = group.session.records.length === group.parts.length && group.session.records.every((part) => part.id && assets.complete(part.id)) && shellReady;
    }
    const revision = group?.deviceRevision || 0, writeManifest = !!group && (record.storedRevision !== revision || record.storedReady !== copy.offlineReady);
    const operation = async () => {
      if (!valid()) return;
      try {
        await record.lifecycleSave;
        if (writeManifest) {
          await target.save("readings", record.id, copy, { valid, updateOnly: true });
          record.storedRevision = revision;
          record.storedReady = copy.offlineReady;
        }
        await target.save("positions", record.id, place, { valid });
        if (group && selected === record) {
          assets.manifestReady = true;
          if (copy.offlineReady && record.audioMissing) {
            await target.setLifecycle(record.id, { audioMissing: false }, { valid });
            record.audioMissing = false;
          }
        }
      } catch (error) {
        if (selected === record) {
          assets.manifestReady = false;
          message(error.message);
        }
      }
    };
    const current = flushing.catch(() => {
    }).then(operation);
    flushing = current;
    await current;
  }
  async function syncBackground(record, group) {
    const target = assets.store;
    if (!target || record.scope !== target.scope || !group.localSave) return;
    group.manifestPending = true;
    if (group.manifestSync) return group.manifestSync;
    group.manifestSync = (async () => {
      while (group.manifestPending && group.localSave && target === assets.store) {
        group.manifestPending = false;
        const next = { ...record, records: structuredClone(group.session.records), statuses: structuredClone(group.statuses), manifestRevision: group.deviceRevision || 0, offlineReady: group.session.records.length === group.parts.length && group.session.records.every((part) => part.id && assets.complete(part.id)) && shellReady, updated: Date.now() };
        await target.save("readings", record.id, next, { updateOnly: true, valid: () => target === assets.store && group.localSave && group.ownerScope === target.scope });
        group.savedReady = next.offlineReady;
      }
    })().catch((error) => {
      if (target === assets.store && group.localSave) message(error.message);
    }).finally(() => group.manifestSync = null);
    return group.manifestSync;
  }
  async function holdSelected(record) {
    const release = await protection.hold(record.scope, record.id);
    selectedRelease?.();
    selectedRelease = release;
  }
  async function shell() {
    if (!navigator.serviceWorker) throw Error("Offline reopening is unavailable in this browser.");
    const registration = await navigator.serviceWorker.register("/local-audio-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const worker = registration.active || registration.waiting || registration.installing;
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel(), timeout = setTimeout(() => reject(Error("Offline app download interrupted. Retry offline saving.")), 6e4);
      channel.port1.onmessage = (e) => {
        clearTimeout(timeout);
        channel.port1.close();
        e.data.ok ? resolve() : reject(Error(e.data.error || "Offline app download failed."));
      };
      worker.postMessage({ type: "SAVE_OFFLINE_SHELL" }, [channel.port2]);
    });
    shellReady = assets.shellReady = true;
    refresh();
  }
  async function openReading(record, { automatic = false } = {}) {
    const request = ++serial, editor = getText();
    opening = true;
    refresh();
    try {
      await flush();
      const target = activeStore(record);
      if (!target) throw Error("The account changed.");
      const current = await target.reading(record.id);
      if (current) current.engine ||= "google";
      if (request !== serial) return;
      if (getText() !== editor) throw Error("The editor changed while opening; your text is kept.");
      if (!current || target !== store()) throw Error("The reading was removed or the account changed.");
      if (automatic && (current.engine || "google") !== getEngine()) return;
      const release = await protection.hold(current.scope, current.id);
      if (request !== serial) {
        release();
        return;
      }
      try {
        getActive()?.pause();
        await apply(current);
        if (request !== serial) {
          release();
          return;
        }
        let group = null;
        if (current.engine !== "browser" && current.records?.some((part) => part.id)) group = await transport.restoreLocal(current, { valid: () => request === serial && target === store() && getText() === current.text });
        if (request !== serial) {
          release();
          return;
        }
        selectedRelease?.();
        selectedRelease = release;
        selected = { ...current, groupId: group?.id, nativeChunks: current.engine === "browser" ? getActive().chunks : null, lastPlace: current.engine === "browser" ? { index: current.nativeIndex || 0, offset: current.nativeOffset || 0, rate: current.options?.rate || 1 } : { position: current.position || 0, rate: current.options?.rate || 1 } };
        if (group) {
          group.historyRecord = current;
          group.deviceChanged = () => {
            void syncBackground(current, group);
            update();
          };
          assets.manifestReady = true;
          natural.deviceRestoreTime = Math.max(0, current.position || 0);
          natural.deviceRestoreIndex = Math.max(0, transport.status(group).starts.findLastIndex((time) => time <= natural.deviceRestoreTime));
        }
        localStorage.setItem(latestKey(), current.id);
        message(current.engine === "browser" ? "Browser-voice text and place restored. Press Play; voice availability offline depends on your device." : current.audioMissing ? "Text and place restored. Audio is not kept on this device; Play retrieves existing audio online. Expired audio requires an explicit new generation." : "Text, voice and place restored. Press Play to listen.");
      } catch (error) {
        release();
        throw error;
      }
    } catch (error) {
      if (request === serial) message(error.message);
    } finally {
      if (request === serial) {
        opening = false;
        refresh();
      }
    }
  }
  async function rememberCurrent() {
    await flush();
    const options = snapshot(), engine = getEngine(), chunks = [...getChunks()], voice = options.voice, target = store();
    if (!["browser", "google"].includes(engine) || !chunks.length) throw Error("This reading has no text to bookmark.");
    if (engine === "google" && !assets.scope) throw Error("Confirm your account before loading a queued Natural reading. No speech was started.");
    const parts = engine === "google" ? splitReadingChunks(chunks, options.paragraphStarts || [], transport.limit()) : [];
    const id = engine === "google" ? "paste2speech.video." + await digest(JSON.stringify({ parts, voice })) : "paste2speech.browser." + await digest(JSON.stringify({ chunks, voice }));
    const old = await target.reading(id);
    if (old) {
      await openReading(old);
      return;
    }
    const record = { version: 2, engine, id, key: id, scope: scope(), generation: crypto.randomUUID(), text: getText(), voice, chunks, parts, records: parts.map(() => ({ state: "unprepared" })), statuses: [], position: 0, nativeIndex: 0, nativeOffset: 0, options, createdAt: Date.now(), updated: Date.now() };
    await target.save("readings", id, record, { automatic: true, valid: () => target === store() });
    await list();
    await openReading(record);
  }
  function renderNavigation() {
    const ordered = records.filter((record) => !record.damaged).sort((a, b) => (a.createdAt || a.updated || 0) - (b.createdAt || b.updated || 0)), index = ordered.findIndex((record) => record.id === selected?.id), queue = getQueue()?.items || [], total = ordered.length + queue.length;
    nav.hidden = total < 2 || index < 0;
    nav.querySelector("#reading-order").textContent = `Reading ${index + 1} of ${total}`;
    const previous = nav.querySelector("#previous-reading"), next = nav.querySelector("#next-reading");
    previous.disabled = opening || index <= 0;
    next.disabled = opening || index < 0 || index >= ordered.length - 1 && !queue.length;
    previous.onclick = () => void openReading(ordered[index - 1]);
    next.onclick = async () => {
      try {
        if (index < ordered.length - 1) return openReading(ordered[index + 1]);
        const item = queue[0];
        if (!item || item.state !== "ready") {
          message("The next reading is still preparing its text.");
          return;
        }
        await flush();
        getActive()?.pause();
        await loadQueued(item);
        await list();
      } catch (error) {
        message(error.message);
      }
    };
  }
  async function list({ restore = false } = {}) {
    const target = store(), currentScope = scope(), found = await target.readings();
    if (target !== store()) return;
    records = found;
    const items = [];
    for (const record of records) {
      const li = document.createElement("li");
      li.style.cssText = "display:grid;gap:8px;margin:12px 0;min-width:0";
      const open = document.createElement("button"), remove = document.createElement("button"), finished = document.createElement("button");
      for (const button of [open, remove, finished]) {
        button.type = "button";
        button.style.cssText = "overflow-wrap:anywhere;max-width:100%;min-width:0";
      }
      const title = record.text.trim().split("\n")[0].slice(0, 70) || "Saved reading";
      open.textContent = "Open: " + title + (record.engine === "browser" ? " (browser voice)" : record.audioMissing ? " (audio needs a connection)" : record.offlineReady ? " (saved copy)" : " (download incomplete)");
      open.disabled = record.damaged;
      open.onclick = () => void openReading(record);
      remove.textContent = "Remove from device";
      remove.disabled = saving;
      remove.onclick = async () => {
        try {
          ++serial;
          opening = false;
          await flush();
          suppressed.add(record.id);
          if (localStorage.getItem(latestKey()) === record.id) localStorage.removeItem(latestKey());
          if (selected?.id === record.id) {
            if (record.engine === "browser") nativeBlocked = { chunks: getActive()?.chunks, voice: record.voice };
            const group = transport.groups.get(selected.groupId);
            if (group) group.localSave = false;
            selected = null;
            selectedRelease?.();
            selectedRelease = null;
            assets.manifestReady = false;
          }
          const ids = await target.removeReading(record.id);
          if (target === store()) assets.forgetLocal(ids);
          message("Device copy removed. Current playback may continue; use Keep current reading again if you change your mind.");
          await list();
          update();
        } catch (error) {
          message(error.message);
        }
      };
      finished.textContent = record.finishedAt ? "Keep unfinished" : "Mark finished";
      finished.disabled = record.damaged || record.engine !== "browser" && (!record.records?.length || record.records.length !== record.parts?.length || record.records.some((part) => part.state !== "ready"));
      finished.onclick = async () => {
        try {
          await flush();
          const value = record.finishedAt ? null : Date.now();
          if (value && selected?.id === record.id) getActive()?.pause();
          await target.setLifecycle(record.id, { finishedAt: value });
          if (selected?.id === record.id) selected.finishedAt = value;
          message(value ? "Marked finished. Its audio may be reclaimed under storage pressure after you switch away; text and place stay." : "Kept unfinished; automatic audio cleanup will protect it.");
          await list();
        } catch (error) {
          message(error.message);
        }
      };
      li.append(open, finished, remove);
      items.push(li);
    }
    $("device-audio-list").replaceChildren(...items);
    renderNavigation();
    if (restore && restoreScope !== currentScope) {
      restoreScope = currentScope;
      const latest = localStorage.getItem(latestKey()), candidate = records.find((record) => record.id === latest && (record.engine || "google") === getEngine()) || records.find((record) => (record.engine || "google") === getEngine());
      if (candidate && !candidate.damaged && !getActive()?.chunks?.length && (!getText().trim() || getText() === candidate.text)) void openReading(candidate, { automatic: true });
    }
  }
  async function account() {
    const request = ++checking;
    let next;
    try {
      if (navigator.onLine === false) next = assets.scope || localStorage.getItem(lastScopeKey) || null;
      else {
        const response = await fetch("/api/ocr/jobs/config", { cache: "no-store" });
        if ([401, 403].includes(response.status)) next = null;
        else {
          if (!response.ok) throw Error();
          next = (await response.json()).consentScope;
          if (typeof next !== "string" || !next) throw Error();
        }
      }
      if (request !== checking) return;
      if (next !== assets.scope) {
        await flush();
        if (assets.scope) {
          if (getEngine() === "browser") getActive()?.stop();
          else natural.invalidate({ preservePreparation: true });
        }
        selectedRelease?.();
        selectedRelease = null;
        selected = null;
        assets.setScope(next);
        suppressed = /* @__PURE__ */ new Set();
      }
      if (next) localStorage.setItem(lastScopeKey, next);
      else localStorage.removeItem(lastScopeKey);
      await list({ restore: true });
      refresh();
    } catch {
      await list({ restore: true }).catch(() => {
      });
      if (!assets.scope && getEngine() === "google") message("Confirm your account online before keeping Natural audio. Browser voices remain available.");
    }
  }
  async function saveNatural(group, { explicit = false } = {}) {
    if (!assets.store || group.ownerScope && group.ownerScope !== assets.scope) return;
    saving = true;
    const target = assets.store, text = getText(), currentScope = scope(), valid = () => target === store() && enabled() && getText() === text && !group.cancelled;
    try {
      await flush();
      if (!valid()) return;
      if (!group.ownerScope) {
        const ids = group.session.records.filter((part) => part.id).map((part) => part.id);
        if (!ids.length) return;
        for (const id of ids) {
          const response = await transport.rawFetch(`/api/readings/${id}`);
          if (!response.ok || !valid()) return;
        }
        group.ownerScope = currentScope;
      }
      const old = await target.reading(group.key);
      if (!valid()) return;
      const revision = group.deviceRevision || 0;
      const record = { version: 2, engine: "google", manifestRevision: revision, generation: explicit ? crypto.randomUUID() : old?.generation || crypto.randomUUID(), id: group.key, key: group.key, scope: currentScope, parts: structuredClone(group.parts), voice: group.session.voice, text, options: snapshot(), records: structuredClone(group.session.records), statuses: structuredClone(group.statuses), position: natural.audio.currentTime || 0, updated: Date.now(), createdAt: old?.createdAt || old?.updated || Date.now() };
      await target.save("readings", record.id, record, { valid, automatic: true, rekeep: explicit });
      if (!valid()) return;
      await holdSelected(record);
      selected = { ...record, groupId: group.id, storedRevision: revision, storedReady: false, lastPlace: { position: record.position, rate: natural.rate || 1 } };
      if (old?.finishedAt) await target.setLifecycle(record.id, { finishedAt: null });
      for (const previous of transport.groups.values()) if (previous !== group && previous.key === group.key) previous.localSave = false;
      group.localSave = true;
      group.historyRecord = record;
      group.deviceReference = { readingId: record.id, generation: record.generation, automatic: !explicit };
      group.deviceChanged = () => {
        void syncBackground(record, group);
        update();
      };
      assets.manifestReady = false;
      localStorage.setItem(latestKey(), record.id);
      suppressed.delete(record.id);
      await assets.enable(group.session.records.filter((part) => part.id).map((part) => part.id), group.deviceReference);
      group.deviceReference.automatic = true;
      void shell().catch((error) => message(error.message));
      await list();
    } catch (error) {
      if (target === store()) {
        suppressed.add(group.key);
        message(error.message);
      }
    } finally {
      saving = false;
      void flush();
      refresh();
    }
  }
  async function saveNative(player, { explicit = false } = {}) {
    saving = true;
    const target = store(), text = getText(), chunks = [...player.chunks], voice = player.settings?.voice?.voiceURI, generation = player.generation;
    const valid = () => target === store() && enabled() && getEngine() === "browser" && player.generation === generation && getText() === text;
    let id;
    try {
      await flush();
      id = "paste2speech.browser." + await digest(JSON.stringify({ chunks, voice }));
      if (!valid()) return;
      if (suppressed.has(id) && !explicit) {
        nativeBlocked = { chunks: player.chunks, voice };
        return;
      }
      const old = await target.reading(id), record = { version: 2, engine: "browser", id, key: id, scope: scope(), generation: explicit ? crypto.randomUUID() : old?.generation || crypto.randomUUID(), text, chunks, voice, options: snapshot(), records: [], parts: [], statuses: [], updated: Date.now(), createdAt: old?.createdAt || old?.updated || Date.now() };
      await target.save("readings", id, record, { valid, automatic: true, rekeep: explicit });
      if (!valid()) return;
      await holdSelected(record);
      selected = { ...record, nativeChunks: player.chunks, lastPlace: { index: player.index || 0, offset: player.offset || 0, rate: player.settings.rate || 1 } };
      suppressed.delete(id);
      localStorage.setItem(latestKey(), id);
      if (old?.finishedAt) await target.setLifecycle(id, { finishedAt: null });
      void shell().catch((error) => message(error.message));
      await list();
    } catch (error) {
      if (id) {
        suppressed.add(id);
        nativeBlocked = { chunks: player.chunks, voice };
      }
      message(error.message);
    } finally {
      saving = false;
      void flush();
      refresh();
    }
  }
  function update() {
    capture();
    if (selected && !timer) timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 500);
    const player = getActive(), group = natural.getVideoPreparation?.();
    if (selected?.finishedAt && player?.state === "playing" && (selected.engine === "browser" ? selected.nativeChunks === player.chunks : selected.groupId === natural.id)) {
      selected.finishedAt = null;
      selected.lifecycleSave = store().setLifecycle(selected.id, { finishedAt: null }).then(() => list()).catch((error) => message(error.message));
    }
    if (!opening && !saving && !attaching && enabled()) {
      if (getEngine() === "google" && assets.store && group && !group.cancelled && !suppressed.has(group.key) && matches() && selected?.groupId !== group.id) {
        attaching = true;
        void saveNatural(group).finally(() => {
          attaching = false;
          setTimeout(update, 200);
        });
      } else if (getEngine() === "browser" && player?.chunks?.length && player.state !== "idle" && (nativeBlocked?.chunks !== player.chunks || nativeBlocked?.voice !== player.settings?.voice?.voiceURI) && (selected?.nativeChunks !== player.chunks || selected?.voice !== player.settings?.voice?.voiceURI)) {
        attaching = true;
        void saveNative(player).finally(() => {
          attaching = false;
          setTimeout(update, 200);
        });
      }
    }
    $("retry-device-reading").disabled = saving;
    $("keep-device-reading").hidden = !!selected || !(getEngine() === "google" ? group : player?.chunks?.length);
    $("regenerate-device-reading").hidden = selected?.engine !== "google" || !selected.audioMissing && !selected.records?.some((part) => assets.jobs.get(part.id)?.accessBlocked);
    if (selected?.engine === "google" && group?.id === selected.groupId) {
      const info = natural.offlineInfo;
      if (info?.ready) message("Ready offline on this device. " + (persistent ? "Browser persistence is granted." : "The browser may remove this copy if storage runs low."));
      else if (info?.error) message(info.error + ` ${info.downloaded} / ${info.total} sections saved on this device.`);
    }
    for (const group2 of transport.groups.values()) if (group2.localSave && group2.ownerScope === assets.scope && group2.done && !group2.manifestSync && group2.deviceReference) {
      const ready = group2.session.records.length === group2.parts.length && group2.session.records.every((part) => part.id && assets.complete(part.id)) && shellReady;
      if (group2.savedReady !== ready) {
        const record = group2.historyRecord;
        if (record) void syncBackground(record, group2);
      }
    }
    renderNavigation();
  }
  assets.onPressure = async () => {
    if (!protection.supported) return false;
    const target = assets.store;
    if (!target) return false;
    const candidates = (await target.readings()).filter((record) => record.finishedAt && !record.audioMissing && record.engine !== "browser" && record.id !== selected?.id && record.records?.length === record.parts?.length && record.records.every((part) => part.state === "ready")).sort((a, b) => a.finishedAt - b.finishedAt);
    for (const record of candidates) {
      const result = await protection.exclusive(record.scope, record.id, () => target.dropFinishedAudio(record));
      if (result?.removed?.length) {
        for (const group of transport.groups.values()) if (group.key === record.id) group.localSave = false;
        assets.forgetLocal(result.removed);
        await list();
        return true;
      }
    }
    return false;
  };
  $("retry-device-reading").onclick = async () => {
    try {
      await account();
      suppressed.clear();
      nativeBlocked = null;
      assets.retry();
      await shell();
      await flush();
      await list();
      update();
    } catch (error) {
      message(error.message);
    }
  };
  $("keep-device-reading").onclick = async () => {
    const player = getActive(), group = natural.getVideoPreparation?.();
    if (getEngine() === "google" && group) await saveNatural(group, { explicit: true });
    else if (getEngine() === "browser" && player?.chunks?.length) await saveNative(player, { explicit: true });
    update();
  };
  $("regenerate-device-reading").onclick = async () => {
    if (!selected || selected.engine !== "google") return;
    if (!confirm("Generate this reading again using normal speech credit? This creates new audio; it is not a free offline download.")) return;
    const record = selected;
    await flush();
    await regenerate(record);
  };
  function disable() {
    void flush();
    for (const group of transport.groups.values()) group.localSave = false;
    assets.writesEnabled = false;
    selectedRelease?.();
    selectedRelease = null;
    selected = null;
  }
  $("automatic-device-audio").onchange = () => {
    localStorage.setItem(preferenceKey, String(enabled()));
    assets.writesEnabled = enabled();
    if (!enabled()) disable();
    update();
  };
  window.addEventListener("focus", () => void account().then(() => assets.recheck()));
  window.addEventListener("online", () => void account().then(() => {
    for (const group of transport.groups.values()) if (group.localOnly) void transport.refreshLocal(group);
    assets.retry();
  }));
  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flush();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === preferenceKey) {
      $("automatic-device-audio").checked = event.newValue !== "false";
      assets.writesEnabled = enabled();
      if (!enabled()) disable();
      update();
    }
    if (event.key === lastScopeKey && event.newValue !== assets.scope) void account();
  });
  if (globalThis.BroadcastChannel) {
    const channel = new BroadcastChannel("paste2speech-device-audio");
    channel.onmessage = (event) => {
      const data = event.data;
      if (data?.scope !== scope() || !["removed", "audio-reclaimed"].includes(data.type)) return;
      if (data.type === "removed") {
        suppressed.add(data.id);
        if (localStorage.getItem(latestKey()) === data.id) localStorage.removeItem(latestKey());
        if (selected?.id === data.id) {
          selected = null;
          selectedRelease?.();
          selectedRelease = null;
        }
      }
      for (const group of transport.groups.values()) if (group.key === data.id) group.localSave = false;
      assets.forgetLocal((data.jobs || []).filter((id) => typeof id === "string"));
      void list();
    };
  }
  void Promise.resolve(navigator.storage?.persisted?.()).then((value) => persistent = value === true).catch(() => {
  });
  void account();
  if (navigator.serviceWorker) void navigator.serviceWorker.getRegistration("/").then((registration) => {
    if (!registration?.active) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      shellReady = assets.shellReady = e.data.ok === true;
      update();
    };
    registration.active.postMessage({ type: "CHECK_OFFLINE_SHELL" }, [channel.port2]);
  }).catch(() => {
  });
  return { update, flush, capture, list, openReading, rememberCurrent, get scope() {
    return scope();
  }, get opening() {
    return opening;
  }, get selected() {
    return selected;
  } };
}
export {
  setupDeviceAudio
};
