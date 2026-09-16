import { cleanText, chunkText, defaults } from './text.js';
import { Player } from './player.js';
const $ = id => document.getElementById(id);
let saved = {};
try { saved = JSON.parse(localStorage.getItem('paste2speech.settings')) || {}; } catch {}
const options = { ...defaults };
for (const key of Object.keys(defaults)) if (typeof saved[key] === 'boolean') options[key] = saved[key];
$('rate').value = Number.isFinite(saved.rate) ? Math.min(2, Math.max(.5, saved.rate)) : 1;
let selectedVoice = typeof saved.voice === 'string' ? saved.voice : '';
let voices = [];
let cleaned = '';
const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const player = supported ? new Player(window.speechSynthesis, window.SpeechSynthesisUtterance, render) : null;
function settings() { return { rate: Number($('rate').value), voice: voices.find(v => v.voiceURI === $('voice').value) }; }
function save() { try { localStorage.setItem('paste2speech.settings', JSON.stringify({ ...options, rate: settings().rate, voice: selectedVoice })); } catch {} }
function preview() {
  cleaned = cleanText($('text').value, options);
  $('preview').textContent = cleaned || 'Your cleaned text will appear here.';
  $('count').textContent = cleaned ? `· ${cleaned.split(/\s+/).length.toLocaleString()} words` : '';
  $('play').disabled = !supported || !cleaned;
}
function render(p, message) {
  $('status').textContent = message || ({ idle: 'Ready when you are', playing: 'Reading aloud', paused: 'Paused · your place is saved', done: 'All read. Take a breath.' }[p.state]);
  $('position').textContent = p.chunks.length && p.state !== 'idle' ? `${Math.min(p.index + 1, p.chunks.length)} / ${p.chunks.length}` : '';
  $('progress').max = p.chunks.length || 1; $('progress').value = p.state === 'idle' ? 0 : p.index;
  $('play').textContent = p.state === 'paused' ? '▶ Resume' : p.state === 'done' ? '↺ Replay' : '▶ Play';
  $('play').disabled = p.state === 'playing' || !cleaned;
  $('pause').disabled = p.state !== 'playing';
  $('stop').disabled = p.state === 'idle';
  $('current').textContent = ['playing', 'paused'].includes(p.state) ? p.chunks[p.index] : '';
}
for (const [key, label] of Object.entries({ markdown: 'Markdown formatting', citations: 'ChatGPT references', urls: 'Web addresses', code: 'Code blocks', tables: 'Tables', emoji: 'Emoji' })) {
  const wrapper = document.createElement('label'); const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = options[key]; input.id = `clean-${key}`;
  input.addEventListener('change', () => { player?.stop(); options[key] = input.checked; save(); preview(); });
  wrapper.append(input, label); $('options').append(wrapper);
}
function loadVoices() {
  voices = speechSynthesis.getVoices();
  $('voice').replaceChildren(new Option('Device default', ''));
  for (const voice of voices) $('voice').add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · on-device' : ' · network possible'}`, voice.voiceURI));
  $('voice').value = voices.some(v => v.voiceURI === selectedVoice) ? selectedVoice : '';
  $('voice-note').textContent = voices.length ? 'Voice availability depends on your device. On-device voices are labeled.' : 'No voice list yet. Play can still try the device default.';
}
$('text').addEventListener('input', () => { player?.stop(); preview(); });
$('clear').addEventListener('click', () => { player?.stop(); $('text').value = ''; preview(); $('text').focus(); });
$('rate').addEventListener('input', () => { $('rate-value').textContent = `${$('rate').value}×`; if (player?.state === 'playing') player.pause(); save(); });
$('voice').addEventListener('change', () => { selectedVoice = $('voice').value; if (player?.state === 'playing') player.pause(); save(); });
$('play').addEventListener('click', () => { if (!player) return; if (player.state === 'paused') player.resume(settings()); else player.start(chunkText(cleaned), settings()); });
$('pause').addEventListener('click', () => player?.pause());
$('stop').addEventListener('click', () => player?.stop());
window.addEventListener('pagehide', () => player?.pause());
$('rate-value').textContent = `${$('rate').value}×`;
if (supported) { speechSynthesis.addEventListener('voiceschanged', loadVoices); loadVoices(); }
else $('status').textContent = 'Speech is unavailable in this browser. Try Chrome on your Pixel.';
preview();
