// Protocol v1: probe -> ready, load -> accepted. Duplicate requests are acknowledged
// without replaying. Only the extension bridge on this reader page uses it.
export function setupExtensionHandoff({host = window, accept}) {
  let sequence = 0, lastId, loadedId;
  try { const saved = JSON.parse(host.sessionStorage?.getItem('pastetospeech.extension.accepted') || 'null');
    if (saved && Number.isSafeInteger(saved.sequence)) { sequence = saved.sequence; lastId = saved.id; }
  } catch {}
  host.addEventListener('message', event => {
    const m = event.data;
    if (event.source !== host || event.origin !== host.location.origin || m?.bridge !== 'pastetospeech-extension' || m.version !== 1 || typeof m.channel !== 'string') return;
    const reply = type => host.postMessage({bridge: 'pastetospeech-reader', version: 1, channel: m.channel, type, id: m.id}, host.location.origin);
    if (m.type === 'probe') { reply('ready'); return; }
    if (m.type !== 'load' || typeof m.id !== 'string' || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 2_000_000 || !Number.isSafeInteger(m.sequence) || m.sequence < 1 || !Number.isFinite(m.created) || Date.now() - m.created >= 600_000) return;
    if (m.id === lastId) {
      // Restore text after a reload, but never repeat the automatic speech request.
      if (loadedId !== m.id) { accept(m.text, {autoplay: false}); loadedId = m.id; }
      reply('accepted'); return;
    }
    if (m.sequence <= sequence) return;
    accept(m.text, {autoplay: true});
    sequence = m.sequence; lastId = m.id; loadedId = m.id;
    // Metadata only: a reload after a lost acknowledgment must not generate twice.
    try { host.sessionStorage?.setItem('pastetospeech.extension.accepted', JSON.stringify({sequence, id: lastId})); } catch {}
    reply('accepted');
  });
}
