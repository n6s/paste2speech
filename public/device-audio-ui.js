// Saving is explicit. Clear/voice changes detach playback but never remove a
// device reading. Removal is available only through this account's saved list.
export function setupDeviceAudio({ getPlayer, getText, snapshot, apply, matches = () => true, refresh = () => {
} }) {
  const player = getPlayer(), transport = player.longReadings, assets = transport?.assets;
  if (!assets?.setScope) return;
  const panel = document.createElement("details");
  panel.id = "device-readings";
  panel.innerHTML = '<summary>Offline readings on this device</summary><p>Save text, voice, place and verified audio in this browser, with the offline reader and MP4 tools. Text and audio stay in this browser; saving creates no new speech requests. Saved readings stay until you remove them or clear site data. Browser storage may be removed unless persistence is granted. Other people using this browser profile may access locally saved readings while offline.</p><div class="controls"><button id="save-device-reading" type="button">Save this reading offline</button><button id="retry-device-reading" type="button">Retry saving</button></div><p id="device-audio-status" role="status"></p><ul id="device-audio-list"></ul>';
  panel.style.overflowWrap = "anywhere";
  panel.querySelector(".controls").style.gridTemplateColumns = "repeat(2,minmax(0,1fr))";
  panel.querySelector("summary").style.minHeight = "44px";
  for (const button of panel.querySelectorAll("button")) button.style.minWidth = "0";
  document.getElementById("section-progress").after(panel);
  const $ = (id) => panel.querySelector("#" + id), message = (text) => $("device-audio-status").textContent = text;
  let selected = null, saving = false, timer, checking = 0, shellReady = false, persistentStorage = false, persistenceBusy = false, openSerial = 0, opening = false;
  const lastScopeKey = "paste2speech.device-audio.scope";
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
          const removingSelected = selected?.id === record.id;
          if (removingSelected) {
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
      }
      if (scope && localStorage.getItem(lastScopeKey) && localStorage.getItem(lastScopeKey) !== scope) localStorage.setItem(lastScopeKey, scope);
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
    if (!matches() || persistenceBusy || !selected || saving || !assets.store || selected.scope !== assets.scope) return;
    const group = transport.groups.get(selected.groupId);
    if (!group || player.id !== selected.groupId || getText() !== selected.text) return;
    const store = assets.store, id = selected.id, scope = selected.scope, valid = () => selected?.id === id && selected?.groupId === group.id && player.id === group.id && scope === assets.scope;
    const position = Math.max(0, player.pendingTime ?? player.audio.currentTime ?? 0), updated = Date.now();
    const offlineReady = group.session.records.length === group.parts.length && group.session.records.every((r) => r.id && assets.complete(r.id)) && shellReady;
    persistenceBusy = true;
    try {
      if (!selected.manifestStored || selected.offlineReady !== offlineReady) {
        const next = { ...selected, records: structuredClone(group.session.records), statuses: structuredClone(group.statuses), updated, offlineReady, position };
        delete next.groupId;
        delete next.manifestStored;
        await store.save("readings", id, next, { valid, updateOnly: true });
        if (valid()) {
          selected.manifestStored = true;
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
          selected = null;
          assets.forgetLocal(ids);
          await list().catch(() => {
          });
        }
        message(assets.storageMessage(e));
      }
    } finally {
      persistenceBusy = false;
    }
  }
  function update() {
    if (selected && !timer) timer = setTimeout(() => void persist(), 500);
    const group = player.getVideoPreparation?.(), info = player.offlineInfo;
    $("save-device-reading").disabled = saving || !matches() || !assets.scope || !group || !group.done || !!group.error || !!group.ownerScope && group.ownerScope !== assets.scope || group.session.records.some((r) => r.state !== "ready") || !getText().trim();
    $("save-device-reading").title = group && !group.done ? "Finish preparing complete audio before saving it offline." : "";
    $("retry-device-reading").disabled = saving || !assets.scope;
    if (selected && info?.retention === "this device") {
      message(info.ready ? shellReady ? "Saved for offline listening on this device. " + (persistentStorage ? "Browser persistence is granted." : "The browser may remove this copy if storage runs low.") : "Audio saved on this device. Retry saving to verify the offline app download." : `${info.error || "Saving audio\u2026"} ${info.downloaded} / ${info.total} sections saved on this device.`);
    }
  }
  $("save-device-reading").onclick = async () => {
    if (saving) return;
    saving = true;
    try {
      await account();
      const group = player.getVideoPreparation?.();
      if (!matches()) throw Error("The text or voice changed. Save only the matching prepared reading.");
      if (!group || !assets.scope) throw Error("Start this reading and confirm your account before saving.");
      if (!group.done || group.error || group.session.records.some((r) => r.state !== "ready")) throw Error("Finish preparing complete audio before saving it offline.");
      if (group.ownerScope && group.ownerScope !== assets.scope) throw Error("This reading belongs to the previous account.");
      const confirmedScope = assets.scope;
      if (!group.ownerScope) {
        for (const record of group.session.records) {
          const response = await transport.rawFetch(`/api/readings/${record.id}`);
          if (!response.ok || assets.scope !== confirmedScope) throw Error("The saved audio account could not be confirmed. No new speech was started.");
        }
        group.ownerScope = confirmedScope;
      }
      if (!matches() || assets.scope !== confirmedScope) throw Error("The reading or account changed. No new speech was started.");
      const parts = structuredClone(group.parts), records = structuredClone(group.session.records);
      selected = { version: 1, generation: crypto.randomUUID(), id: group.key, scope: assets.scope, groupId: group.id, key: group.key, parts, voice: group.session.voice, text: getText(), options: snapshot(), records, statuses: structuredClone(group.statuses), position: player.audio.currentTime || 0, updated: Date.now() };
      group.localSave = true;
      assets.manifestReady = false;
      const initial = { ...selected };
      delete initial.groupId;
      await assets.store.save("readings", initial.id, initial);
      await list();
      const savingScope = assets.scope;
      await assets.enable(records.filter((r) => r.id).map((r) => r.id), { readingId: initial.id, generation: initial.generation });
      if (assets.scope !== savingScope || !selected) throw Error("The account changed.");
      localStorage.setItem(lastScopeKey, assets.scope);
      try {
        persistentStorage = await navigator.storage?.persist?.() === true;
      } catch {
        persistentStorage = false;
      }
      await shell();
      saving = false;
      await persist();
      await list();
      update();
    } catch (e) {
      message(e.message);
    } finally {
      saving = false;
      await persist();
      await list().catch(() => {
      });
      update();
    }
  };
  $("retry-device-reading").onclick = async () => {
    try {
      await account();
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
  window.addEventListener("online", () => void account());
  window.addEventListener("pagehide", () => void persist());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void persist();
  });
  window.addEventListener("storage", (event) => {
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
      if (selected?.id === data.id) {
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
