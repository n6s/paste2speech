// One serialized owner for tab state and pending selections. No text is logged.
export const TTL = 10 * 60 * 1000;
export const MAX_TEXT = 2_000_000;
export function createController(api, origin, {now = Date.now, uuid = () => crypto.randomUUID()} = {}) {
  let chain = Promise.resolve();
  const serial = fn => { const result = chain.then(fn); chain = result.catch(() => {}); return result; };
  const allowed = url => { try { const u = new URL(url); return u.origin === origin && u.pathname === '/'; } catch { return false; } };
  async function read() {
    const {handoff = {status: 'Select text, then choose Read with PasteToSpeech.'}} = await api.storage.session.get('handoff');
    if (handoff.pending && now() - handoff.pending.created >= TTL) {
      delete handoff.pending; handoff.status = 'Selection expired. Select the text and send it again.';
      await write(handoff);
    }
    return handoff;
  }
  const write = state => api.storage.session.set({handoff: state});
  async function tabFor(state, focus = false) {
    let tab;
    if (state.tabId) try { tab = await api.tabs.get(state.tabId); } catch {}
    if (!tab || !allowed(tab.url)) {
      tab = await api.tabs.create({url: origin + '/', active: true}); state.tabId = tab.id; await write(state);
    }
    if (focus) { await api.tabs.update(tab.id, {active: true}); await api.windows.update(tab.windowId, {focused: true}); }
    return tab;
  }
  async function deliver(state) {
    if (!state.pending) return;
    try {
      // The content script acknowledges receipt immediately; page acceptance is separate.
      await api.tabs.sendMessage(state.tabId, {type: 'deliver', version: 1, ...state.pending}, {frameId: 0});
      state.status = 'Waiting for the reader to accept your selection…';
    } catch { state.status = 'Waiting for PasteToSpeech. Finish signing in if needed, or open the extension to retry.'; }
    await write(state);
  }
  return {
    send: text => serial(async () => {
      const state = await read();
      const error = typeof text !== 'string' || !text.trim() ? 'Select some readable text first.' : text.length > MAX_TEXT ? 'This selection is too large for the extension. Copy and paste it into PasteToSpeech instead.' : '';
      if (error) { state.status = error; await write(state); return {error}; }
      const pending = {id: uuid(), text, created: now(), sequence: (state.sequence || 0) + 1};
      state.sequence = pending.sequence; state.pending = pending;
      state.status = 'Opening PasteToSpeech…';
      // Save before browser operations so a failed open does not lose the selection.
      await write(state);
      await tabFor(state, true); await write(state); await deliver(state);
      return {ok: true};
    }),
    message: (message, sender) => serial(async () => {
      const state = await read();
      if (sender.tab) {
        if (sender.tab.id !== state.tabId || sender.frameId !== 0 || !allowed(sender.url)) return {error: 'Unrecognized reader.'};
        if (message.type === 'ready') await deliver(state);
        if (message.type === 'accepted' && message.id === state.pending?.id) {
          delete state.pending; state.status = 'Text delivered. Playback controls are in PasteToSpeech.'; await write(state);
        }
        return {ok: true};
      }
      if (sender.url !== api.runtime.getURL('popup.html')) return {error: 'Unrecognized extension page.'};
      if (message.type === 'open' || message.type === 'retry') {
        await tabFor(state, true); await write(state); await deliver(state);
      }
      return {status: state.status, pending: !!state.pending};
    }),
    removed: tabId => serial(async () => {
      const state = await read();
      if (state.tabId === tabId) { delete state.tabId; delete state.pending; state.status = 'Reader closed. Select text to start another reading.'; await write(state); }
    }),
    expire: () => serial(read),
  };
}
