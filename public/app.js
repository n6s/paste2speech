import { cleanText, chunkText, defaults } from './text.js';
import { Player } from './player.js';
import { AudioPlayer } from './audio-player.js';
const $ = id => document.getElementById(id);
let saved = {};
try { saved = JSON.parse(localStorage.getItem('paste2speech.settings')) || {}; } catch {}
const options = { ...defaults };
for (const key of Object.keys(defaults)) if (typeof saved[key] === 'boolean') options[key] = saved[key];
$('rate').value = Number.isFinite(saved.rate) ? Math.min(2, Math.max(.5, saved.rate)) : 1;
let selectedVoice = typeof saved.voice === 'string' ? saved.voice : '';
let voices = [];
let cleaned = '';
let chunks = [];
let paragraphStarts = [];
const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const browserPlayer = supported ? new Player(window.speechSynthesis, window.SpeechSynthesisUtterance, render) : null;
const workstationPlayer = new AudioPlayer(render);
let player = browserPlayer;
let workstationVoices = [];
let browserVoice = selectedVoice;
let workstationVoice = typeof saved.workstationVoice === 'string' ? saved.workstationVoice : 'af_heart';
function isWorkstation() { return $('engine').value === 'kokoro'; }
function canPlay() { return isWorkstation() || supported; }
function changeEngine() {
  player?.stop();
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
function settings() { return { rate: Number($('rate').value), voice: isWorkstation() ? $('voice').value : voices.find(v => v.voiceURI === $('voice').value) }; }
function save() { try { localStorage.setItem('paste2speech.settings', JSON.stringify({ ...options, rate: settings().rate, voice: browserVoice, workstationVoice, engine: $('engine').value })); } catch {} }
function preview() {
  cleaned = cleanText($('text').value, options);
  chunks = [];
  paragraphStarts = [];
  $('preview').replaceChildren();
  for (const [index, paragraph] of cleaned.split(/\n\s*\n/).filter(Boolean).entries()) {
    const start = chunks.length;
    paragraphStarts.push(start);
    chunks.push(...chunkText(paragraph));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'paragraph';
    button.textContent = paragraph;
    button.disabled = !canPlay();
    button.setAttribute('aria-label', `Read from paragraph ${index + 1}: ${paragraph}`);
    button.addEventListener('click', () => player?.start(chunks, settings(), start));
    $('preview').append(button);
  }
  if (!cleaned) $('preview').textContent = 'Your cleaned text will appear here.';
  $('count').textContent = cleaned ? `· ${cleaned.split(/\s+/).length.toLocaleString()} words` : '';
  $('play').disabled = !canPlay() || !cleaned;
}
function render(p, message) {
  $('status').textContent = message || ({ idle: 'Ready when you are', playing: 'Reading aloud', paused: 'Paused · your place is saved', done: 'All read. Take a breath.' }[p.state]);
  $('position').textContent = p.chunks.length && p.state !== 'idle' ? `${Math.min(p.index + 1, p.chunks.length)} / ${p.chunks.length}` : '';
  $('progress').max = p.chunks.length || 1; $('progress').value = p.state === 'idle' ? 0 : p.index;
  $('play').textContent = p.state === 'paused' ? '▶ Resume' : p.state === 'done' ? '↺ Replay' : '▶ Play';
  $('play').disabled = p.state === 'playing' || !cleaned;
  $('pause').disabled = p.state !== 'playing';
  $('stop').disabled = p.state === 'idle';
  const active = ['playing', 'paused'].includes(p.state);
  for (const [index, button] of [...$('preview').children].entries()) {
    const current = active && p.index >= paragraphStarts[index] && p.index < (paragraphStarts[index + 1] ?? chunks.length);
    if (current) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  $('current').textContent = ['playing', 'paused'].includes(p.state) ? p.chunks[p.index] : '';
}
for (const [key, label] of Object.entries({ markdown: 'Markdown formatting', citations: 'ChatGPT references', urls: 'Web addresses', code: 'Code blocks', tables: 'Tables', emoji: 'Emoji' })) {
  const wrapper = document.createElement('label'); const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = options[key]; input.id = `clean-${key}`;
  input.addEventListener('change', () => { player?.stop(); options[key] = input.checked; save(); preview(); });
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
$('text').addEventListener('input', () => { player?.stop(); preview(); });
$('clear').addEventListener('click', () => { player?.stop(); $('text').value = ''; preview(); $('text').focus(); });
$('rate').addEventListener('input', () => { $('rate-value').textContent = `${$('rate').value}×`; if (player?.state === 'playing') player.pause(); save(); });
$('voice').addEventListener('change', () => { selectedVoice = $('voice').value; if (isWorkstation()) workstationVoice = selectedVoice; else browserVoice = selectedVoice; if (player?.state === 'playing') player.pause(); save(); });
$('play').addEventListener('click', () => { if (!player) return; if (player.state === 'paused') player.resume(settings()); else player.start(chunks, settings()); });
$('pause').addEventListener('click', () => player?.pause());
$('stop').addEventListener('click', () => player?.stop());
window.addEventListener('pagehide', () => player?.pause());
$('rate-value').textContent = `${$('rate').value}×`;
if (supported) { speechSynthesis.addEventListener('voiceschanged', loadVoices); loadVoices(); }
else $('status').textContent = 'Speech is unavailable in this browser. Try Chrome on your Pixel.';
preview();

discoverWorkstation();
