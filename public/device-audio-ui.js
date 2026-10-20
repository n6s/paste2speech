// Verified audio saves in the background. Management stays in this collapsed panel.
export function setupDeviceAudio({ getPlayer, getText, snapshot, apply, matches = () => true, refresh = () => {
} }) {
  const player = getPlayer(), transport = player.longReadings, assets = transport?.assets;
  if (!assets?.setScope) return;
  const panel = document.createElement("details");
  panel.id = "device-readings";
  panel.innerHTML = '<summary>Offline storage</summary><p>Readings save automatically in this browser as audio becomes available, including text, voice and place. Saving creates no new speech. Copies remain until you remove them or clear site data; the browser may also remove them. Other people using this browser profile may access saved readings offline. Up to 20 readings and 512 MiB of audio are kept; reaching a limit pauses saving without deleting copies or stopping online playback.</p><label><input id="automatic-device-audio" type="checkbox" checked> Automatically keep readings on this device</label><div class="controls"><button id="retry-device-reading" type="button">Retry offline saving</button></div><p id="device-audio-status" role="status"></p><ul id="device-audio-list"></ul>';
  panel.style.overflowWrap = "anywhere";
  panel.querySelector(".controls").style.gridTemplateColumns = "repeat(2,minmax(0,1fr))";
  panel.querySelector("summary").style.minHeight = "44px";
  for (const button of panel.querySelectorAll("button")) button.style.minWidth = "0";
  document.getElementById("section-progress").after(panel);
  const $ = (id) => panel.querySelector("#" + id), message = (text) => $("device-audio-status").textContent = text;
  let restoredScope = null, attaching = null, suppressed = new Set(), selected = null, saving = false, timer, checking = 0, shellReady = false, persistentStorage = false, persistenceBusy = false, openSerial = 0, opening = false;
  const lastScopeKey = "paste2speech.device-audio.scope";
  const latestKey = () => "paste2speech.device-audio.latest." + assets.scope;
  const preferenceKey = "paste2speech.device-audio.automatic";
  $("automatic-device-audio").checked = localStorage.getItem(preferenceKey) !== "false";
  assets.writesEnabled = $("automatic-device-audio").checked;
  function disableSaving() {
    for(const group of transport.groups.values()) group.localSave=false;
    assets.writesEnabled=false;
    selected=null;
  }
  $("automatic-device-audio").onchange = () => {
    localStorage.setItem(preferenceKey, String($("automatic-device-audio").checked));
    assets.writesEnabled = $("automatic-device-audio").checked;
    if (!$("automatic-device-audio").checked) disableSaving();
    update();
  };
  async function shell() {
    if (!navigator.serviceWorker) throw Error("Offline reopening is unavailable in this browser.");
    const registration = await navigator.serviceWorker.register("/local-audio-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const worker = registration.active || registration.waiting || registration.installing;
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel(), timeout = setTimeout(() => reject(Error("Offline app download interrupted. Retry saving.")), 6e4);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        event.data.ok ? resolve() : reject(Error(event.data.error || "Offline app download failed."));
      };
      worker.postMessage({ type: "SAVE_OFFLINE_SHELL" }, [channel.port2]);
    });
    shellReady = true;
    assets.shellReady = true;
  }
  async function list() {
    const scope = assets.scope, store = assets.store;
    if (!store) {
      $("device-audio-list").replaceChildren();
      return;
    }
    const records = await store.readings();
    if (scope !== assets.scope) return;
    const items = [];
    for (let record of records) {
      const li = document.createElement("li"), open = document.createElement("button"), remove = document.createElement("button");
      open.type = remove.type = "button";
      open.disabled = record.damaged === true;
      open.textContent = "Open: " + (record.text.trim().split("\n")[0].slice(0, 70) || "Saved reading") + (record.offlineReady ? " (saved copy)" : " (download incomplete)");
      remove.textContent = "Remove from device";
      remove.disabled = saving;
      open.onclick = async () => {
        const serial = ++openSerial, editorBefore = getText();
        opening = true;
        refresh();
        try {
          if (assets.scope !== record.scope) throw Error("The account changed.");
          const current = await store.reading(record.id);
          if (serial !== openSerial) return;
          if (getText() !== editorBefore) throw Error("The editor changed while opening. Your current text is kept.");
          if (!current || store !== assets.store) throw Error("The saved reading was removed or the account changed.");
          record = current;
          player.pause();
          await apply(record);
          const group = await transport.restoreLocal(record, { valid: () => serial === openSerial && store === assets.store && getText() === record.text && snapshot().voice === record.voice });
          if (serial !== openSerial) return;
          selected = { ...record, groupId: group.id };
          group.deviceChanged = () => { if(selected?.groupId===group.id) selected.manifestStored=false; update(); };
          localStorage.setItem(latestKey(),record.id);
          assets.manifestReady = record.records.length === record.parts.length && record.records.every((r) => r.id && r.state === "ready");
          player.deviceRestoreTime = Math.max(0, Number(record.position) || 0);
          player.deviceRestoreIndex = Math.max(0, transport.status(group).starts.findLastIndex((t) => t <= player.deviceRestoreTime));
          message((record.positionUnavailable ? "Saved place could not be verified; starting at the beginning. " : "") + "Saved text and place loaded. Press Play to listen. Missing sections need a connection; no new speech is created by opening a saved reading.");
        } catch (e) {
          if (serial === openSerial) message(e.message);
        } finally {
          if (serial === openSerial) {
            opening = false;
            refresh();
          }
        }
      };
      remove.onclick = async () => {
        ++openSerial;
        opening = false;
        refresh();
        try {
          if (store !== assets.store || record.scope !== assets.scope) throw Error("The account changed.");
          suppressed.add(record.id);
          if (localStorage.getItem(latestKey()) === record.id) localStorage.removeItem(latestKey());
          const removingSelected = selected?.id === record.id;
          if (removingSelected) {
            const group = transport.groups.get(selected.groupId); if(group) group.localSave=false;
            selected = null;
            assets.manifestReady = false;
          }
          const removingJobs = (record.records || []).map((r) => r.id).filter(Boolean);
          assets.beginRemoval(removingJobs);
          try {
            const ids = await store.removeReading(record.id);
            if (store === assets.store) assets.forgetLocal(ids);
          } finally {
            assets.endRemoval(removingJobs);
          }
          if (removingSelected) {
            message("Device copy removed. Current tab playback is unchanged.");
          }
          await list();
        } catch (e) {
          message(e.message);
        }
      };
      li.style.cssText = "display:grid;gap:8px;margin:12px 0;min-width:0";
      open.style.cssText = "overflow-wrap:anywhere;max-width:100%;min-width:0";
      li.append(open, remove);
      items.push(li);
      if (restoredScope !== scope && record.id === localStorage.getItem(latestKey()) && !record.damaged && !player.getVideoPreparation?.() && (!getText().trim() || getText() === record.text)) {
        restoredScope = scope;
        queueMicrotask(() => void open.onclick());
      }
    }
    $("device-audio-list").replaceChildren(...items);
  }
  async function account() {
    const serial = ++checking;
    let scope;
    try {
      if (navigator.onLine === false) {
        scope = assets.scope || localStorage.getItem(lastScopeKey) || null;
      } else {
        const response = await fetch("/api/ocr/jobs/config", { cache: "no-store" });
        if (response.status === 401 || response.status === 403) scope = null;
        else {
          if (!response.ok) throw Error();
          scope = (await response.json()).consentScope;
          if (typeof scope !== "string" || !scope) throw Error("Account status unavailable.");
        }
      }
      if (serial !== checking) return;
      if (scope !== assets.scope) {
        if (assets.scope) player.invalidate({ preserveReady: true });
        assets.setScope(scope);
        selected = null;
        suppressed = new Set();
      }
      if (scope && localStorage.getItem(lastScopeKey) !== scope) localStorage.setItem(lastScopeKey, scope);
      if (!scope) {
        localStorage.removeItem(lastScopeKey);
        message("Sign in to save or open account-scoped readings on this device.");
      }
      await list();
    } catch {
      if (!assets.scope) message("Confirm your account online before saving. Saved offline readings can be opened when offline.");
    }
  }
  async function persist() {
    timer = null;
    if (!$("automatic-device-audio").checked || !matches() || persistenceBusy || !selected || saving || !assets.store || selected.scope !== assets.scope) return;
    const group = transport.groups.get(selected.groupId);
    if (!group || player.id && player.id !== selected.groupId || getText() !== selected.text) return;
    const store = assets.store, id = selected.id, scope = selected.scope, valid = () => selected?.id === id && selected?.groupId === group.id && (!player.id || player.id === group.id) && scope === assets.scope;
    const position = Math.max(0, player.pendingTime ?? player.audio.currentTime ?? 0), updated = Date.now();
    const offlineReady = group.session.records.length === group.parts.length && group.session.records.every((r) => r.id && assets.complete(r.id)) && shellReady;
    const readinessBefore = assets.manifestReady;
    persistenceBusy = true;
    try {
      if (!selected.manifestStored || selected.revision !== group.deviceRevision || selected.offlineReady !== offlineReady) {
        const next = { ...selected, records: structuredClone(group.session.records), statuses: structuredClone(group.statuses), updated, offlineReady, position };
        delete next.groupId;
        delete next.manifestStored;
        await store.save("readings", id, next, { valid, updateOnly: true });
        if (valid()) {
          selected.manifestStored = true;
          selected.revision = group.deviceRevision;
          selected.offlineReady = offlineReady;
        }
      }
      await store.save("positions", id, { id, generation: selected?.generation, position, rate: player.rate || 1, updated }, { valid });
      if (valid()) assets.manifestReady = true;
    } catch (e) {
      if (valid()) {
        assets.manifestReady = false;
        if (e.name === "LocalCopyRemovedError") {
          const ids = selected.records.map((r) => r.id).filter(Boolean);
          suppressed.add(id);
          selected = null;
          assets.forgetLocal(ids);
          await list().catch(() => {
          });
        }
        message(assets.storageMessage(e));
      }
    } finally {
      persistenceBusy = false;
      if (readinessBefore !== assets.manifestReady) refresh();
    }
  }
  function update() {
    if (selected && !timer) timer = setTimeout(() => void persist(), 500);
    const group = player.getVideoPreparation?.(), info = player.offlineInfo;
    if (!saving && !attaching && $("automatic-device-audio").checked && assets.scope && group && !group.cancelled && !suppressed.has(group.key) && matches() && selected?.groupId !== group.id) {
      attaching = group;
      void startSaving(group).finally(() => { attaching = null; });
    }
    if (selected && !getText().trim() && !group) localStorage.removeItem(latestKey());
    $("retry-device-reading").disabled = saving || !assets.scope;
    if (selected && info?.retention === "this device") {
      message(info.ready ? shellReady ? "Ready offline on this device. " + (persistentStorage ? "Browser persistence is granted." : "The browser may remove this copy if storage runs low.") : "Audio saved on this device. Retry saving to verify the offline app download." : `${info.error || "Saving audio\u2026"} ${info.downloaded} / ${info.total} sections saved on this device.`);
    }
  }
  async function startSaving(group) {
    saving = true;
    const store = assets.store, scope = assets.scope, text = getText();
    const valid = () => store === assets.store && scope === assets.scope && matches() && getText() === text && !group.cancelled && !suppressed.has(group.key) && $("automatic-device-audio").checked;
    try {
      if (!valid()) return;
      if (!group.ownerScope) {
        const ids = group.session.records.filter(r=>r.id).map(r=>r.id);
        if (!ids.length) return;
        for(const id of ids) {
          const response = await transport.rawFetch(`/api/readings/${id}`);
          if(!response.ok || !valid()) return;
        }
        group.ownerScope = scope;
      }
      if (group.ownerScope !== scope) return;
      const old = await store.reading(group.key);
      if (!valid()) return;
      selected = { version: 1, generation: old?.generation || crypto.randomUUID(), id: group.key, scope, groupId: group.id, key: group.key, parts: structuredClone(group.parts), voice: group.session.voice, text, options: snapshot(), records: structuredClone(group.session.records), statuses: structuredClone(group.statuses), position: player.audio.currentTime || 0, updated: Date.now() };
      const initial = {...selected}; delete initial.groupId;
      await store.save("readings", initial.id, initial, {valid, automatic:true});
      if (!valid()) return;
      group.localSave = true;
      group.deviceReference = {readingId: initial.id,generation: initial.generation,automatic:true};
      group.deviceChanged = () => { selected && (selected.manifestStored = false); update(); };
      assets.manifestReady = false;
      localStorage.setItem(latestKey(), initial.id);
      await assets.enable(group.session.records.filter(r=>r.id).map(r=>r.id), group.deviceReference);
      if (!valid()) return;
      // App-shell I/O never gates Play or section delivery.
      void shell().then(() => persist()).catch(e => message(e.message));
      await list();
    } catch(e) {
      if (store === assets.store) {
        suppressed.add(group.key);
        selected = null;
        message(e.message);
      }
    } finally { saving = false; void persist(); update(); }
  }
  $("retry-device-reading").onclick = async () => {
    try {
      await account();
      suppressed.clear();
      assets.retry();
      await shell();
      await persist();
      await list();
      update();
    } catch (e) {
      message(e.message);
    }
  };
  window.addEventListener("focus", () => {
    void account().then(() => assets.recheck());
  });
  window.addEventListener("online", () => void account().then(() => {
    for(const group of transport.groups.values()) if(group.localOnly) void transport.refreshLocal(group);
    assets.retry();
  }));
  window.addEventListener("pagehide", () => void persist());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void persist();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === preferenceKey) {
      $("automatic-device-audio").checked = event.newValue !== "false";
      assets.writesEnabled = event.newValue !== "false";
      if(event.newValue === "false") {
        disableSaving();
      }
      update();
    }
    if (event.key === lastScopeKey && event.newValue !== assets.scope) {
      player.invalidate({ preserveReady: true });
      assets.setScope(null);
      selected = null;
      void account();
    }
  });
  if (globalThis.BroadcastChannel) {
    const channel = new BroadcastChannel("paste2speech-device-audio");
    channel.onmessage = (event) => {
      const data = event.data;
      if (data?.type !== "removed" || data.scope !== assets.scope || !Array.isArray(data.jobs)) return;
      ++openSerial;
      opening = false;
      refresh();
      suppressed.add(data.id);
      if (localStorage.getItem(latestKey()) === data.id) localStorage.removeItem(latestKey());
      if (selected?.id === data.id) {
        const group = transport.groups.get(selected.groupId); if(group) group.localSave=false;
        selected = null;
        assets.manifestReady = false;
        message("This device copy was removed in another tab. Current playback can continue.");
      }
      assets.forgetLocal(data.jobs.filter((id) => typeof id === "string" && assets.saved(id)));
      void list().catch(() => {
      });
    };
  }
  void Promise.resolve(navigator.storage?.persisted?.()).then((value) => {
    persistentStorage = value === true;
  }).catch(() => {
  });
  void account();
  if (navigator.serviceWorker) void navigator.serviceWorker.getRegistration("/").then(async (registration) => {
    if (!registration?.active) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      shellReady = assets.shellReady = event.data.ok === true;
      update();
    };
    registration.active.postMessage({ type: "CHECK_OFFLINE_SHELL" }, [channel.port2]);
  }).catch(() => {
  });
  return { update, get opening() {
    return opening;
  } };
}
