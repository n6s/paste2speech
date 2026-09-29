async function update(type = 'status') {
  try {
    const result = await chrome.runtime.sendMessage({type});
    document.getElementById('status').textContent = result.error || result.status;
    document.getElementById('retry').hidden = !result.pending;
  } catch { document.getElementById('status').textContent = 'Extension unavailable. Reload it and try again.'; }
}
document.getElementById('open').onclick = () => update('open');
document.getElementById('retry').onclick = () => update('retry');
void update();

chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.handoff) void update(); });
