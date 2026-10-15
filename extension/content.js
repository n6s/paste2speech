// Runs only in the configured reader's top frame. It never runs on source pages.
(() => {
  if (window !== window.top || location.pathname !== '/') return;
  // Programmatic recovery and manifest injection may meet on a loading tab.
  if (globalThis.__pastetospeechBridgeRuntime === chrome.runtime) return;
  globalThis.__pastetospeechBridgeRuntime = chrome.runtime;
  const channel = crypto.randomUUID();
  let pending, ready = false;
  const post = data => window.postMessage({bridge: 'pastetospeech-extension', version: 1, channel, ...data}, location.origin);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'deliver' || message.version !== 1) return;
    if (typeof message.text !== 'string' || !message.text.trim() || !Number.isSafeInteger(message.sequence)) return;
    if (!pending || message.sequence >= pending.sequence) pending = message;
    if (ready) post({...pending, type: 'load'});
    respond({received: true});
  });
  window.addEventListener('message', event => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.bridge !== 'pastetospeech-reader' || m.version !== 1 || m.channel !== channel) return;
    if (m.type === 'ready') {
      ready = true;
      void chrome.runtime.sendMessage({type: 'ready'}).catch(() => {});
    } else if (m.type === 'accepted' && pending?.id === m.id) {
      pending = undefined;
      void chrome.runtime.sendMessage({type: 'accepted', id: m.id}).catch(() => {});
    }
  });
  const timer = setInterval(() => {
    if (pending && Date.now() - pending.created >= 600_000) pending = undefined;
    if (!ready || pending) post({type: 'probe'});
  }, 2000);
  window.addEventListener('pagehide', () => clearInterval(timer), {once: true});
  post({type: 'probe'});
})();
