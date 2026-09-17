import { cleanText, chunkText, defaults } from './text.js?v=20260917-prose-structure-1';
import { Player } from './player.js';
import { AudioPlayer } from './audio-player.js?v=20260917-prose-structure-1';
const $ = id => document.getElementById(id);
let saved = {};
try { saved = JSON.parse(localStorage.getItem('paste2speech.settings')) || {}; } catch {}
const options = { ...defaults };
for (const key of Object.keys(defaults)) if (typeof saved[key] === 'boolean') options[key] = saved[key];
$('rate').value = Number.isFinite(saved.rate) ? Math.min(2, Math.max(.5, saved.rate)) : 1;
$('follow-reading').checked = saved.followReading === true;
$('reading-size').value = Number.isFinite(saved.readingSize) ? Math.min(32, Math.max(14, Math.round(saved.readingSize))) : 20;
function applyReadingSize() {
  const size = Number($('reading-size').value);
  $('preview').style.setProperty('--reading-font-size', `${size}px`);
  $('reading-size-value').textContent = `${size} px`;
  $('reading-size').setAttribute('aria-valuetext', `${size} pixels`);
}
applyReadingSize();
let selectedVoice = typeof saved.voice === 'string' ? saved.voice : '';
let voices = [];
let cleaned = '';
let chunks = [];
let paragraphStarts = [];
let sentenceElements = [];
const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const browserPlayer = supported ? new Player(window.speechSynthesis, window.SpeechSynthesisUtterance, render) : null;
const workstationPlayer = new AudioPlayer(render);
workstationPlayer.getSettings = settings;
let player = browserPlayer;
let workstationVoices = [];
let browserVoice = selectedVoice;
let workstationVoice = typeof saved.workstationVoice === 'string' ? saved.workstationVoice : 'af_heart';
function isWorkstation() { return $('engine').value === 'kokoro'; }
function canPlay() { return isWorkstation() || supported; }
function changeEngine() {
  player?.stop();
  workstationPlayer.release();
  player = isWorkstation() ? workstationPlayer : browserPlayer;
  selectedVoice = isWorkstation() ? workstationVoice : browserVoice;
  loadVoices(); save(); preview();
  if (player) render(player);
}
async function discoverWorkstation() {
  try {
    const response = await fetch(new URL('api/voices', location.href), {signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (!Array.isArray(data.voices) || !data.voices.length) throw new Error('no voices');
    workstationVoices = data.voices;
    $('engine').options[1].disabled = false;
    $('engine').options[1].textContent = 'Workstation · Kokoro';
    if (saved.engine === 'kokoro' && (!player || player.state === 'idle')) { $('engine').value = 'kokoro'; changeEngine(); }
  } catch {
    $('engine').options[1].textContent = 'Workstation · unavailable';
  }
}
function settings() { return { paragraphStarts: [...paragraphStarts], rate: Number($('rate').value), voice: isWorkstation() ? $('voice').value : voices.find(v => v.voiceURI === $('voice').value) }; }
function save() { try { localStorage.setItem('paste2speech.settings', JSON.stringify({ ...options, rate: settings().rate, voice: browserVoice, workstationVoice, engine: $('engine').value, followReading: $('follow-reading').checked, readingSize: Number($('reading-size').value) })); } catch {} }
function preview() {
  cleaned = cleanText($('text').value, options);
  chunks = [];
  paragraphStarts = [];
  sentenceElements = [];
  $('preview').replaceChildren();
  for (const paragraph of cleaned.split(/\n\s*\n/).filter(Boolean)) {
    if (sentenceElements.length) $('preview').append('\n\n');
    const group = document.createElement('p');
    group.className = 'reading-paragraph';
    paragraphStarts.push(chunks.length);
    let cursor = 0;
    for (const chunk of chunkText(paragraph)) {
      const start = chunks.length;
      const offset = paragraph.indexOf(chunk, cursor);
      group.append(paragraph.slice(cursor, offset));
      cursor = offset + chunk.length;
      chunks.push(chunk);
      const button = document.createElement('span');
      button.className = 'sentence';
      button.textContent = chunk;
      button.setAttribute('role', 'button');
      button.tabIndex = canPlay() ? 0 : -1;
      button.setAttribute('aria-disabled', String(!canPlay()));
      button.setAttribute('aria-label', `Read from section ${start + 1}: ${chunk}`);
      const activate = () => { if (canPlay()) player?.start(chunks, settings(), start); };
      button.addEventListener('click', activate);
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!event.repeat) activate();
        }
      });
      sentenceElements.push(button);
      group.append(button);
    }
    group.append(paragraph.slice(cursor));
    $('preview').append(group);
  }
  if (!cleaned) $('preview').textContent = 'Your cleaned text will appear here.';
  $('count').textContent = cleaned ? `${cleaned.split(/\s+/).length.toLocaleString()} words` : '';
  $('play').disabled = !canPlay() || !cleaned;
}
function setMode(mode) {
  const reading = mode === 'read';
  $('edit-view').hidden = reading;
  $('read-view').hidden = !reading;
  $('edit-mode').setAttribute('aria-pressed', String(!reading));
  $('read-mode').setAttribute('aria-pressed', String(reading));
  if (reading) followParagraph($('preview').querySelector('[aria-current=true]'));
}
$('edit-mode').addEventListener('click', () => setMode('edit'));
function readAndPlay() {
  $('text').blur();
  setMode('read');
  if (!player || !canPlay() || !cleaned || ['playing', 'preparing'].includes(player.state)) return;
  if (['paused', 'ready', 'failed'].includes(player.state)) player.resume(settings());
  else player.start(chunks, settings());
}
$('read-mode').addEventListener('click', readAndPlay);
function followParagraph(button) {
  const pane = $('preview');
  if (!$('follow-reading').checked || $('read-view').hidden || !button) return;
  // Scroll only the preview, so playback controls and the page stay put.
  const bounds = pane.getBoundingClientRect();
  const rects = [...button.getClientRects()];
  if (!rects.length) return;
  const paragraph = {top: rects[0].top, bottom: rects.at(-1).bottom};
  paragraph.height = paragraph.bottom - paragraph.top;
  const top = bounds.top + pane.clientTop;
  const bottom = top + pane.clientHeight;
  if (paragraph.height > pane.clientHeight || paragraph.top < top) {
    pane.scrollTop += paragraph.top - top;
  } else if (paragraph.bottom > bottom) {
    pane.scrollTop += paragraph.bottom - bottom;
  }
}
$('follow-reading').addEventListener('change', () => {
  save();
  followParagraph($('preview').querySelector('[aria-current=true]'));
});
$('reading-size').addEventListener('input', () => {
  applyReadingSize();
  save();
  followParagraph($('preview').querySelector('[aria-current=true]'));
});
function render(p, message) {
  if (p !== player) return;
  $('status').textContent = message || ({ idle: 'Ready when you are', preparing: 'Preparing audio…', ready: 'Audio ready · tap Play.', failed: 'Preparation failed · tap Play to retry.', playing: 'Reading aloud', paused: 'Paused · your place is saved', done: 'All read. Take a breath.' }[p.state]);
  $('position').textContent = p.chunks.length && p.state !== 'idle' ? `${Math.min(p.index + 1, p.chunks.length)} / ${p.chunks.length}` : '';
  $('progress').max = p.chunks.length || 1; $('progress').value = p.state === 'idle' ? 0 : p.index;
  $('play').textContent = ['paused', 'failed'].includes(p.state) ? '▶ Resume' : p.state === 'done' ? '↺ Replay' : '▶ Play';
  $('play').disabled = ['playing', 'preparing'].includes(p.state) || !cleaned;
  $('pause').disabled = !['playing', 'preparing'].includes(p.state);
  $('stop').disabled = p.state === 'idle';
  const active = ['playing', 'paused', 'preparing', 'ready', 'failed'].includes(p.state);
  for (const [index, button] of sentenceElements.entries()) {
    const current = active && p.index === index;
    if (current) {
      const changed = !button.hasAttribute('aria-current');
      button.setAttribute('aria-current', 'true');
      if (changed) followParagraph(button);
    }
    else button.removeAttribute('aria-current');
  }
}
for (const [key, label] of Object.entries({ markdown: 'Markdown formatting', citations: 'ChatGPT references', urls: 'Web addresses', code: 'Code blocks', tables: 'Tables', emoji: 'Emoji', joinLines: 'Join wrapped lines' })) {
  const wrapper = document.createElement('label'); const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = options[key]; input.id = `clean-${key}`;
  input.addEventListener('change', () => { resetReading(); options[key] = input.checked; save(); preview(); });
  wrapper.append(input, label); $('options').append(wrapper);
}
function loadVoices() {
  $('voice').replaceChildren();
  if (isWorkstation()) {
    for (const voice of workstationVoices) $('voice').add(new Option(voice.name, voice.id));
    $('voice').value = workstationVoices.some(v => v.id === selectedVoice) ? selectedVoice : 'af_heart';
    workstationVoice = $('voice').value;
    $('voice-note').textContent = 'Generated privately on your workstation. English voices; no cloud speech service.';
  } else {
    voices = supported ? speechSynthesis.getVoices() : [];
    $('voice').add(new Option('Device default', ''));
    for (const voice of voices) $('voice').add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · on-device' : ' · network possible'}`, voice.voiceURI));
    $('voice').value = voices.some(v => v.voiceURI === selectedVoice) ? selectedVoice : '';
    $('voice-note').textContent = voices.length ? 'Voice availability depends on your device. On-device voices are labeled.' : 'No voice list yet. Play can still try the device default.';
  }
}
$('engine').addEventListener('change', changeEngine);
$('text').addEventListener('input', () => { resetReading(); preview(); });
$('clear').addEventListener('click', () => { resetReading(); $('text').value = ''; preview(); setMode('edit'); $('text').focus(); });
$('rate').addEventListener('input', () => { $('rate-value').textContent = `${$('rate').value}×`; if (['playing', 'preparing'].includes(player?.state)) player.pause(); save(); });
$('voice').addEventListener('change', () => { selectedVoice = $('voice').value; if (isWorkstation()) workstationVoice = selectedVoice; else browserVoice = selectedVoice; if (['playing', 'preparing'].includes(player?.state)) player.pause(); save(); });
$('play').addEventListener('click', readAndPlay);
$('pause').addEventListener('click', () => player?.pause());
$('stop').addEventListener('click', () => player?.stop());
window.addEventListener('pagehide', () => { if (player === browserPlayer) player?.pause(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && player === workstationPlayer) workstationPlayer.sync(); });
function resetReading() { browserPlayer?.stop(); workstationPlayer.invalidate(); }
$('rate-value').textContent = `${$('rate').value}×`;
if (supported) { speechSynthesis.addEventListener('voiceschanged', loadVoices); loadVoices(); }
else $('status').textContent = 'Speech is unavailable in this browser. Try Chrome on your Pixel.';
preview();

discoverWorkstation();

$('pdf-file').addEventListener('change', async () => {
  const file = $('pdf-file').files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    $('pdf-status').textContent = 'Choose a PDF smaller than 20 MB.';
    $('pdf-file').value = '';
    return;
  }
  player?.stop();
  $('pdf-file').disabled = true;
  $('text').readOnly = true;
  $('clear').disabled = true;
  $('pdf-status').textContent = `Reading ${file.name}…`;
  try {
    const response = await fetch(new URL('api/pdf-text', location.href), {
      method: 'POST', headers: {'Content-Type': 'application/pdf'},
      body: file, signal: AbortSignal.timeout(40000),
    });
    if (response.status === 404 || response.status === 405) throw new Error('PDF import needs the workstation service. Open the Tailscale reader URL.');
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not read this PDF.');
    resetReading();
    $('text').value = data.text;
    preview();
    setMode('edit');
    $('pdf-status').textContent = `Loaded ${file.name} · ${data.pages} pages.${data.emptyPages ? ` ${data.emptyPages} pages had no readable text and were skipped.` : ''} Review the imported text, then choose Read to listen. Columns and tables may read out of order.`;
  } catch (error) {
    $('pdf-status').textContent = error.name === 'TimeoutError' ? 'PDF import timed out. Try a smaller PDF.' : (error instanceof TypeError ? 'Could not reach the workstation. Check your connection and try again.' : error.message);
  } finally {
    $('pdf-file').disabled = false;
    $('pdf-file').value = '';
    $('text').readOnly = false;
    $('clear').disabled = false;
  }
});
