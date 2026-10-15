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
    let saved;
    if (state.tabId) try { saved = await api.tabs.get(state.tabId); } catch {}
    if (saved && (!allowed(saved.url) || saved.incognito)) saved = undefined;
    // Existing host access exposes only reader URLs; no tabs/all-sites permission.
    const matching = (await api.tabs.query({url: origin + '/*'})).filter(tab => allowed(tab.url) && !tab.incognito);
    const pinned = matching.filter(tab => tab.pinned);
    let tab = pinned.find(tab => tab.id === saved?.id) || pinned[0] || saved || matching.find(tab => tab.active) || matching[0];
    if (!tab) tab = await api.tabs.create({url: origin + '/', active: true});
    state.tabId = tab.id; await write(state);
    // Activating never changes the URL, pin, or reader text. Explicit delivery does.
    if (focus) { await api.tabs.update(tab.id, {active: true}); await api.windows.update(tab.windowId, {focused: true}); }
    return tab;
  }
  async function deliver(state) {
    if (!state.pending) return;
    const send = () => api.tabs.sendMessage(state.tabId, {type: 'deliver', version: 1, ...state.pending}, {frameId: 0});
    try {
      try { await send(); }
      catch {
        // A reader already open before extension installation/reload may lack a
        // live relay. Attach only our reader bridge; never reload its user text.
        const tab = await api.tabs.get(state.tabId);
        if (!allowed(tab.url) || tab.incognito || tab.status === 'loading') throw new Error('Reader not ready');
        await api.scripting.executeScript({target: {tabId: tab.id, frameIds: [0]}, files: ['content.js']});
        await send();
      }
      state.status = 'Waiting for the reader to accept your selection…';
    } catch { state.status = 'Waiting for PasteToSpeech. Finish signing in if needed, or open the extension to retry.'; }
    await write(state);
  }
  return {
    send: text => serial(async () => {
      const state = await read();
      const error = typeof text !== 'string' || !text.trim() ? 'Select some readable text first.' : text.length > MAX_TEXT ? 'This selection is too large for the extension. Copy and paste it into PasteToSpeech instead.' : '';
      if (error) { state.status = error; await write(state); return {error}; }
      // An adopted reader may retain acceptance metadata after extension session
      // storage resets. Seed from time so a new handoff outranks old counters.
      const created = now();
      const pending = {id: uuid(), text, created, sequence: Math.max(state.sequence || 0, created) + 1};
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
