import {setupExtensionHandoff} from './extension-handoff.js';
import {SPEED_PRESETS, presetRate, preparedChunkCount} from './playback-controls.js';
import {cloudFetch, setupCloudReader} from './cloud-reader.js';
import { WORKSTATION, KOKORO_ENABLED, CLOUD_READER, MSE_STAGING, MSE_ENABLED, VIDEO_DOWNLOAD, LONG_READINGS } from './config.js';
import {setupVideoDownload} from './video-ui.js';
import { LocalKokoro } from './local-kokoro.js';
import { event, setupFeedback } from './public-features.js';
import { clipboardMarkdown } from './paste.js?v=20260917-answer-labels-1';
import { cleanText, chunkText, readingCharacters, defaults } from './text.js?v=20260917-answer-labels-1';
import { Player } from './player.js';
import { StagingPlayer } from './staging-player.js';
import { ProgressivePlayer } from './progressive-player.js';
import { AudioPlayer } from './audio-player.js?v=20260917-answer-labels-1';
const $ = id => document.getElementById(id);
let saved = {};
try { saved = JSON.parse(localStorage.getItem('paste2speech.settings')) || {}; } catch {}
const options = { ...defaults };
for (const key of Object.keys(defaults)) if (typeof saved[key] === 'boolean') options[key] = saved[key];
$('rate').value = CLOUD_READER ? presetRate(saved.rate) : Number.isFinite(saved.rate) ? Math.min(2, Math.max(.5, saved.rate)) : 1;
$('follow-reading').checked = saved.followReading === true;
$('reading-size').value = Number.isFinite(saved.readingSize) ? Math.min(32, Math.max(14, Math.round(saved.readingSize))) : 20;
function applyReadingSize() {
  const size = Number($('reading-size').value);
  $('preview').style.setProperty('--reading-font-size', `${size}px`);
  $('reading-size-value').textContent = `${size} px`;
  $('reading-size').setAttribute('aria-valuetext', `${size} pixels`);
}
applyReadingSize();
function closeReadingSize() {
  $('reading-size-panel').hidden = true;
  $('reading-size-toggle').setAttribute('aria-expanded', 'false');
}
$('reading-size-toggle').addEventListener('click', () => {
  const opening = $('reading-size-panel').hidden;
  $('reading-size-panel').hidden = !opening;
  $('reading-size-toggle').setAttribute('aria-expanded', String(opening));
  if (opening) $('reading-size').focus({ preventScroll: true });
});
document.addEventListener('click', event => {
  if (!$('reading-size-control').contains(event.target)) closeReadingSize();
});
document.addEventListener('focusin', event => {
  if (!$('reading-size-control').contains(event.target)) closeReadingSize();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('reading-size-panel').hidden) {
    event.preventDefault();
    closeReadingSize();
    $('reading-size-toggle').focus({ preventScroll: true });
  }
});
let selectedVoice = typeof saved.voice === 'string' ? saved.voice : '';
let voices = [];
let cleaned = '';
let chunks = [];
let paragraphStarts = [];
let sentenceElements = [];
let stagingSampleText='';
let videoDownload;
const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const browserPlayer = supported ? new Player(window.speechSynthesis, window.SpeechSynthesisUtterance, render) : null;
const localKokoro = new LocalKokoro(message => { $('download-status').textContent = message; });
const workstationPlayer = new (MSE_ENABLED?StagingPlayer:ProgressivePlayer)(render, CLOUD_READER ? {fetcher:cloudFetch} : {});
const localPlayer = new AudioPlayer(render, {provider: (text, settings, signal) => localKokoro.request(text,settings,signal)});
localPlayer.getSettings = settings;
workstationPlayer.getSettings = settings;
let player = browserPlayer;
let localEnabled = false;
let localAllowed = saved.kokoroEnabled === true || (saved.kokoroEnabled === undefined && saved.engine === 'kokoro' && saved.engineSchema === 2);
let syncLocalSetup = () => {};
let workstationVoices = [];
const names=[['af_heart','Heart · American English'],['af_bella','Bella · American English'],['am_michael','Michael · American English'],['am_fenrir','Fenrir · American English'],['bf_emma','Emma · British English'],['bm_george','George · British English']];
const localVoices=names.map(([id,name])=>({id,name}));

let previousState = 'idle';
let preparationStarted = 0;
let countNextPlayback = false;
let browserVoice = selectedVoice;
let workstationVoice = typeof saved.workstationVoice === 'string' ? saved.workstationVoice : CLOUD_READER ? 'en-US-Wavenet-F' : 'af_heart';
function isGoogle() { return $('engine').value === 'google'; }
function isDeepInfra() { return $('engine').value === 'deepinfra'; }
function isWorkstation() { return ['workstation','deepinfra','google'].includes($('engine').value); }
function isKokoro() { return $('engine').value !== 'browser'; }
function canPlay() { if(videoDownload?.preparingAudio)return false; return isWorkstation() ? (CLOUD_READER || workstationVoices.length > 0) : isKokoro() ? localEnabled : supported; }
function changeEngine() {
  player?.stop();
  workstationPlayer.release();
  localPlayer.release();
  if (localKokoro.pending) localKokoro.cancel();
  localPlayer.invalidate();localKokoro.resetMetrics();
  player = isWorkstation() ? workstationPlayer : isKokoro() ? localPlayer : browserPlayer;
  selectedVoice = isKokoro() ? workstationVoice : browserVoice;
  loadVoices(); save(); preview();
  if (player) render(player);
  syncLocalSetup();
}
async function discoverWorkstation() {
  try {
    const response = await fetch(new URL('api/voices', location.href), {signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (!Array.isArray(data.voices) || !data.voices.length) throw new Error('no voices');
    workstationVoices = data.voices;
    $('engine').querySelector('[value=workstation]').disabled = false;
    $('engine').querySelector('[value=deepinfra]').disabled = false;
    $('engine').querySelector('[value=google]').disabled = false;
    $('engine').querySelector('[value=workstation]').textContent = 'Workstation - Kokoro';
    if ((['workstation','deepinfra','google'].includes(saved.engine) || (saved.engine === 'kokoro' && !saved.engineSchema)) && (!player || player.state === 'idle')) { $('engine').value = ['deepinfra','google'].includes(saved.engine)?saved.engine:'workstation'; changeEngine(); }
  } catch {
    $('engine').querySelector('[value=workstation]').textContent = 'Workstation - Kokoro · unavailable';
  }
}
function settings() { return { provider:isGoogle()?'google':isDeepInfra()?'deepinfra':'workstation', delivery:isGoogle()?(MSE_ENABLED?(MSE_STAGING?$('mse-delivery').value:(workstationPlayer.capability.mp3?'mse':'complete')):'complete'):'progressive', ...(MSE_STAGING?{cached:$('mse-cached').checked,scenario:$('mse-scenario').value,concurrency:Number($('mse-concurrency').value)}:{}), paragraphStarts: [...paragraphStarts], rate: Number($('rate').value), voice: isKokoro() ? $('voice').value : voices.find(v => v.voiceURI === $('voice').value) }; }
function save() { try { localStorage.setItem('paste2speech.settings', JSON.stringify({ ...options, engineSchema: 2, kokoroEnabled: localAllowed, useGPU: localKokoro.useGPU===true, rate: settings().rate, voice: browserVoice, workstationVoice, engine: $('engine').value, followReading: $('follow-reading').checked, readingSize: Number($('reading-size').value) })); } catch {} }
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
    for (const chunk of (MSE_STAGING&&cleaned===stagingSampleText?[paragraph]:chunkText(paragraph))) {
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
      const activate = () => { if (canPlay()) { if (['idle','done'].includes(player?.state)) countNextPlayback=true; player?.start(chunks, settings(), start); } };
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
  const characters = readingCharacters($('text').value, chunks);
  $('character-savings').hidden = !characters.before;
  $('character-savings').textContent = characters.before ? `${characters.before.toLocaleString()} original characters → ${characters.submitted.toLocaleString()} to read${characters.saved ? ` · ${characters.saved.toLocaleString()} saved` : ''}` : '';
  $('count').textContent = cleaned ? `${cleaned.split(/\s+/).length.toLocaleString()} words` : '';
  $('play').disabled = !canPlay() || !cleaned;
  videoDownload?.update();
}
function setMode(mode) {
  const reading = mode === 'read';
  if (!reading) closeReadingSize();
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
  if (!player || !canPlay() || !cleaned || ['playing', 'preparing', 'buffering'].includes(player.state)) return;
  if (['paused', 'ready', 'failed', 'disconnected'].includes(player.state)) player.resume(settings());
  else { countNextPlayback=true; player.start(chunks, settings()); }
}
$('read-mode').addEventListener('click', () => { $('text').blur(); setMode('read'); });
function followParagraph(button) {
  const pane = $('preview');
  if ($('read-view').hidden || !button) return;
  // Grow to fit the whole active chunk at the reader's chosen font size. Keep
  // larger/manual heights and avoid shrinking between chunks during playback.
  const fragments = [...button.getClientRects()];
  if (!fragments.length) return;
  const style = getComputedStyle(pane);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const needed = Math.ceil(fragments.at(-1).bottom - fragments[0].top + padding + borders + 4);
  if (needed > pane.getBoundingClientRect().height) pane.style.height = `${needed}px`;
  if (!$('follow-reading').checked) return;
  // Scroll inside the pane only; growth never changes the font size.
  const bounds = pane.getBoundingClientRect();
  const rects = [...button.getClientRects()];
  if (!rects.length) return;
  const paragraph = {top: rects[0].top, bottom: rects.at(-1).bottom};
  paragraph.height = paragraph.bottom - paragraph.top;
  const top = bounds.top + pane.clientTop + parseFloat(style.paddingTop);
  const bottom = bounds.top + pane.clientTop + pane.clientHeight - parseFloat(style.paddingBottom);
  if (paragraph.height > pane.clientHeight || paragraph.top < top) {
    pane.scrollTop += paragraph.top - top;
  } else if (paragraph.bottom > bottom) {
    pane.scrollTop += paragraph.bottom - bottom;
  }
}
let previewResizeFrame;
new ResizeObserver(() => {
  cancelAnimationFrame(previewResizeFrame);
  previewResizeFrame = requestAnimationFrame(() => followParagraph($('preview').querySelector('[aria-current=true]')));
}).observe($('preview'));
document.fonts?.ready.then(() => followParagraph($('preview').querySelector('[aria-current=true]')));
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
  if(MSE_STAGING&&p===workstationPlayer){const events=p.events||[];$('mse-diagnostics').textContent=JSON.stringify({job:p.id,state:p.state,mode:p.mode,prepared:p.starts.length,appended:p.next,duration:p.duration,time:p.audio.currentTime,sourceLoads:events.filter(e=>e.type==='loadstart').length,firstPlayingMs:events.find(e=>e.type==='playing')?.ms,endOfStream:events.find(e=>e.type==='end-of-stream'),rawEnd:events.find(e=>e.type==='before-end-of-stream'),error:p.error},null,2);}
  if (p !== player) return;
  if(p.state!==previousState){
    if(p.state==='preparing') preparationStarted=performance.now();
    if(!CLOUD_READER && p.state==='ready' && previousState==='preparing') event('kokoro_ready','kokoro','none',performance.now()-preparationStarted);
    if(!CLOUD_READER && p.state==='failed') event('kokoro_failure','kokoro','generation');
    if(p.state==='playing' && countNextPlayback){event('playback_start',isGoogle()?'google':isKokoro()?'kokoro':'browser');countNextPlayback=false;}
    previousState=p.state;
  }
  const blocked = message === 'Press Play to start';
  $('play').classList.toggle('autoplay-blocked', blocked);
  if (blocked) $('play').focus({preventScroll: true});
  $('status').textContent = message || ({ idle: 'Ready when you are', preparing: 'Preparing audio…', buffering: 'Waiting for the next audio section…', ready: 'Audio ready · tap Play.', failed: 'Preparation failed · tap Play to retry.', playing: 'Reading aloud', paused: 'Paused · your place is saved', done: 'All read. Take a breath.' }[p.state]);
  $('position').textContent = p.chunks.length && p.state !== 'idle' ? `${Math.min(p.index + 1, p.chunks.length)} / ${p.chunks.length}` : '';
  $('progress').max = p.chunks.length || 1; $('progress').value = p.state === 'idle' ? 0 : p.index;
  $('play').textContent = ['paused', 'failed', 'disconnected'].includes(p.state) ? '▶ Resume' : p.state === 'done' ? '↺ Replay' : '▶ Play';
  $('play').disabled = ['playing', 'preparing', 'buffering'].includes(p.state) || !cleaned || !canPlay();
  $('pause').disabled = !['playing', 'preparing', 'buffering'].includes(p.state);
  $('stop').disabled = p.state === 'idle';
  $('recording-controls').hidden = !isWorkstation();
  $('playback-note').textContent = isWorkstation()
    ? `${isGoogle()&&settings().delivery!=='mse'?'Playback starts after the full reading is prepared.':'Playback starts as audio arrives.'} Pause keeps preparation running; Stop cancels unfinished preparation. ${MSE_ENABLED?'Wait until you hear speech before locking your screen. ':''}Keep this page open for lock-screen controls. Temporary recordings expire after 24 hours; Clear removes this recording.`
    : (CLOUD_READER ? 'Browser voices are free and need the page visible. Your device speech service may use the internet.' : 'On-device Kokoro prepares the whole reading first. Browser voices need the page visible. Reloading discards the reading.');
  $('recording-progress').textContent = isWorkstation() && p.id ? (p.complete ? 'Recording ready to download · original speed' : `${p.starts.length} of ${p.chunks.length} sections prepared`) : '';
  if(isGoogle() && p.id && !CLOUD_READER) $('recording-progress').textContent += ` · list-price estimate $${(p.providerCost||0).toFixed(5)}${p.costIncomplete?' (incomplete)':''}`;
  if(isDeepInfra() && p.id) $('recording-progress').textContent += ` · provider-reported estimate $${(p.providerCost||0).toFixed(5)}${p.costIncomplete?' (incomplete)':''}`;
  for (const [id,kind] of [['download-audio','mp3'],['download-captions','vtt']]) {
    if (!$(id)) continue;
    const href = isWorkstation() && p.download?.(kind);
    $(id).hidden = !href || (kind==='vtt' && !$('include-captions').checked);
    if(href)$(id).href=href;else $(id).removeAttribute('href');
  }
  if(CLOUD_READER){
    const available=preparedChunkCount(p);
    const index=Math.max(0,Math.min(p.chunks.length-1,p.index||0));
    const seek=$('seek');
    seek.disabled=!isGoogle()||!available;
    seek.max=Math.max(0,available-1);
    if(seek.dataset.dragging!=='true')seek.value=Math.min(index,Math.max(0,available-1));
    seek.setAttribute('aria-valuetext',`Section ${available?Number(seek.value)+1:0} of ${p.chunks.length}`);
    $('seek-time').textContent=`${p.chunks.length?index+1:0} / ${p.chunks.length}`;
  }
  $('previous-section').disabled = (CLOUD_READER&&!isWorkstation()) || !p.chunks.length || p.index===0;
  $('next-section').disabled = (CLOUD_READER&&!isWorkstation()) || !p.chunks.length || p.index>=p.chunks.length-1;
  const active = ['playing', 'paused', 'preparing', 'buffering', 'ready', 'failed', 'disconnected'].includes(p.state);
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
function updateVoiceSummary() {
  const voice = $('voice').selectedOptions[0]?.textContent.split(' · ')[0] || 'Device default';
  const summary = `${isGoogle()?'Google · ':isDeepInfra()?'DeepInfra · ':''}${voice}${CLOUD_READER?'':` · ${$('rate').value}×`}`;
  $('voice-settings-summary').textContent = summary;
  $('voice-settings-summary').title = summary;
}
function loadVoices() {
  $('voice').replaceChildren();
  if (isKokoro()) {
    const availableVoices = isGoogle() ? [{id:'en-US-Wavenet-F',name:'US female · WaveNet F'},{id:'en-US-Wavenet-D',name:'US male · WaveNet D'},{id:'en-GB-Wavenet-F',name:'UK female · WaveNet F'},{id:'en-GB-Wavenet-D',name:'UK male · WaveNet D'}].filter(v=>CLOUD_READER||v.id.endsWith('-F')) : isWorkstation() ? workstationVoices.filter(v=>!isDeepInfra() || ['af_heart','bf_emma'].includes(v.id)) : localVoices;
    for (const voice of availableVoices) $('voice').add(new Option(voice.name, voice.id));
    $('voice').value = availableVoices.some(v => v.id === selectedVoice) ? selectedVoice : availableVoices[0]?.id || '';
    workstationVoice = $('voice').value;
    $('voice-note').textContent = isGoogle() ? (LONG_READINGS?'WaveNet · text is sent to Google Cloud. Long readings are prepared in parts automatically. Default pronunciation and pauses.':'WaveNet · text is sent to Google Cloud. Up to 20,000 characters per reading. Default pronunciation and pauses.') + (MSE_ENABLED ? ' Playback starts as audio arrives where supported.' : ' Full preparation before playback.') : !isWorkstation() ? 'Experimental · generated on this device. Kokoro loads automatically after the first download. Preparation may be slow on phones.' : isDeepInfra() ? 'Private test · text is sent to DeepInfra and uses the project’s prepaid credit. Up to 20,000 characters per reading; shared pronunciation and pause rules are applied.' : 'Generated privately on your workstation. English voices; no cloud speech service.';
  } else {
    voices = supported ? speechSynthesis.getVoices() : [];
    $('voice').add(new Option('Device default', ''));
    for (const voice of voices) $('voice').add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · on-device' : ' · network possible'}`, voice.voiceURI));
    $('voice').value = voices.some(v => v.voiceURI === selectedVoice) ? selectedVoice : '';
    $('voice-note').textContent = voices.length ? 'Voice availability depends on your device. On-device voices are labeled.' : 'No voice list yet. Play can still try the device default.';
  }
  updateVoiceSummary();
}
$('engine').addEventListener('change', changeEngine);
$('text').addEventListener('input', () => { resetReading(); preview(); });
$('text').addEventListener('paste', event => {
  let markdown;
  try { markdown = clipboardMarkdown(event.clipboardData?.getData('text/html')); } catch { return; }
  if (!markdown) return;
  event.preventDefault();
  // Native insertion preserves the browser's undo history when available.
  let inserted = false;
  try { inserted = document.execCommand('insertText', false, markdown); } catch {}
  if (!inserted) {
    const input = $('text');
    input.setRangeText(markdown, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }
});
// Read first: denied, empty, or unreadable clipboards must not erase a reading.
let pasteRequest = 0;
let pdfRequest = 0, activePdfController;
async function clipboardText() {
  if (navigator.clipboard?.read) {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        try {
          const markdown = clipboardMarkdown(await (await item.getType('text/html')).text());
          if (markdown?.trim()) return markdown;
        } catch { /* Try the plain-text representation of this item. */ }
      }
      if (item.types.includes('text/plain')) {
        const text = await (await item.getType('text/plain')).text();
        if (text.trim()) return text;
      }
    }
    return '';
  }
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  throw new Error('Clipboard access unavailable');
}
$('paste-play').addEventListener('click', async () => {
  const request = ++pasteRequest;
  const previousText = $('text').value;
  $('paste-play').disabled = true;
  $('paste-status').hidden = true;
  try {
    const text = await clipboardText();
    if (request !== pasteRequest || $('text').value !== previousText) return;
    if (!text.trim()) throw new Error('empty');
    resetReading();
    $('text').value = text;
    preview();
    readAndPlay();
    if (!cleaned) {
      $('paste-status').textContent = 'Pasted, but nothing remains after cleanup. Adjust cleanup options to read it.';
      $('paste-status').hidden = false;
    }
  } catch (error) {
    if (request !== pasteRequest) return;
    $('paste-status').textContent = error.message === 'empty'
      ? 'The clipboard has no text to read. Your current text is unchanged.'
      : 'Clipboard access was unavailable. Paste into Edit, then press Play. Your current text is unchanged.';
    $('paste-status').hidden = false;
  } finally {
    $('paste-play').disabled = false;
  }
});
$('clear').addEventListener('click', () => { workstationPlayer.longReadings?.clearSavedReadings(); pasteRequest++; $('paste-status').hidden = true; resetReading(); $('text').value = ''; preview(); setMode('edit'); $('text').focus(); });
$('rate').addEventListener('input', () => { $('rate-value').textContent = `${$('rate').value}×`; updateVoiceSummary(); if (isWorkstation()) workstationPlayer.setRate(settings().rate); else if (['playing', 'preparing', 'buffering'].includes(player?.state)) player.pause(); localKokoro.resetMetrics(); save(); });
$('voice').addEventListener('change', () => { selectedVoice = $('voice').value; if (isKokoro()) workstationVoice = selectedVoice; else browserVoice = selectedVoice; updateVoiceSummary(); if (['playing', 'preparing', 'buffering'].includes(player?.state)) player.pause(); localKokoro.resetMetrics(); save(); });
$('previous-section').addEventListener('click',()=>workstationPlayer.move(-1));
$('next-section').addEventListener('click',()=>workstationPlayer.move(1));
$('include-captions')?.addEventListener('change',()=>render(player));
$('play').addEventListener('click', readAndPlay);
$('pause').addEventListener('click', () => player?.pause());
$('stop').addEventListener('click', () => player?.stop());
window.addEventListener('pagehide', () => { if (player === browserPlayer) player?.pause(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && isKokoro()) { player?.sync(); if(isWorkstation())void workstationPlayer.refresh(); } });
function resetReading() { browserPlayer?.stop(); workstationPlayer.invalidate(); localPlayer.invalidate(); localKokoro.resetMetrics(); }
if(CLOUD_READER){
  const button=$('speed-preset');
  const updateSpeed=()=>{button.textContent=`${$('rate').value}×`;button.setAttribute('aria-label',`Playback speed: ${$('rate').value}×. Activate to change speed.`);};
  button.addEventListener('click',()=>{
    $('rate').value=SPEED_PRESETS[(SPEED_PRESETS.indexOf(Number($('rate').value))+1)%SPEED_PRESETS.length];
    if(isWorkstation())workstationPlayer.setRate(settings().rate);
    else if(player?.state==='playing'){player.pause();player.resume(settings());}
    updateSpeed();save();
  });
  updateSpeed();save();
}
$('rate-value').textContent = `${$('rate').value}×`;
if (supported) { speechSynthesis.addEventListener('voiceschanged', loadVoices); loadVoices(); }
else $('status').textContent = 'Speech is unavailable in this browser. Try Chrome on your Pixel.';
updateVoiceSummary();
preview();

if (!CLOUD_READER) {
  $('engine').options[1].textContent=KOKORO_ENABLED?'On-device Kokoro · experimental':'Kokoro · temporarily unavailable';
  $('engine').options[1].disabled=!KOKORO_ENABLED;
  $('local-download').hidden=!KOKORO_ENABLED;
{
  let downloadController, setupBusy=false, setupFailed=false;
  $('gpu-experiment').hidden=!WORKSTATION;
  $('use-gpu').checked=WORKSTATION && saved.useGPU===true;
  localKokoro.useGPU=$('use-gpu').checked;
  function setupControls() {
    $('local-download').hidden=!KOKORO_ENABLED || $('engine').value!=='kokoro';
    $('download-model').hidden=setupBusy || (localAllowed && !setupFailed);
    $('download-model').textContent=setupFailed?'Retry setup':'Download Kokoro';
    $('cancel-download').hidden=!setupBusy;
    for(const id of ['compare-gpu','use-gpu','remove-model'])$(id).disabled=setupBusy;
    $('remove-model').hidden=!localAllowed;
    $('download-info').hidden=localAllowed;
    if(!localAllowed && !setupBusy)$('download-status').textContent='Download once to get started. After that, Kokoro loads automatically when selected.';
  }
  async function loadLocal() {
    if(setupBusy || localEnabled || !localAllowed || $('engine').value!=='kokoro')return;
    setupBusy=true;setupFailed=false;downloadController=new AbortController();setupControls();
    $('download-status').textContent='Getting Kokoro ready… Saved downloads are reused when available.';
    try {
      await localKokoro.run('load',{voice:workstationVoice},downloadController.signal);
      localEnabled=true;
    }catch(error){
      setupFailed=true;localEnabled=false;
      $('download-status').textContent=error.name==='AbortError'?'Setup cancelled. Retry when you’re ready.':error.message;
      if(error.name!=='AbortError')event('kokoro_failure','kokoro','download');
    }finally{setupBusy=false;setupControls();preview();}
  }
  syncLocalSetup=()=>{setupControls();if(localAllowed && !setupBusy && !localEnabled)void loadLocal();};
  $('use-gpu').addEventListener('change',()=>{
    localPlayer.invalidate();localKokoro.cancel();localKokoro.resetMetrics();localEnabled=false;setupFailed=false;
    localKokoro.useGPU=$('use-gpu').checked;save();preview();syncLocalSetup();
  });
  $('compare-gpu').addEventListener('click',async()=>{
    localPlayer.invalidate();localKokoro.cancel();localKokoro.resetMetrics();localEnabled=false;localAllowed=true;setupFailed=false;save();preview();
    setupBusy=true;downloadController=new AbortController();setupControls();
    $('gpu-results').textContent='Comparing the same short sentence. Downloads and model loading are timed separately.';
    let completed=false;
    try {
      const {results}=await localKokoro.run('benchmark',{},downloadController.signal);
      $('gpu-results').textContent=results.map(r=>r.status==='ok'?`${r.backend.toUpperCase()} · ${r.dtype}: load ${(r.loadMs/1000).toFixed(1)}s, first ${(r.firstMs/1000).toFixed(1)}s, repeat ${(r.repeatMs/1000).toFixed(1)}s`:`${r.dtype}: unavailable or failed`).join('\n');
      completed=true;
    }catch(error){$('gpu-results').textContent=error.name==='AbortError'?'Comparison cancelled.':error.message;setupFailed=true;}
    finally {
      localKokoro.cancel();setupBusy=false;setupControls();preview();
      if(completed)await loadLocal();
      else $('download-status').textContent='Comparison stopped. Retry setup when you’re ready to read.';
    }
  });
  $('download-model').addEventListener('click',()=>{localAllowed=true;save();void loadLocal();});
  $('cancel-download').addEventListener('click',()=>downloadController?.abort());
  $('remove-model').addEventListener('click',async()=>{
    localPlayer.invalidate();await localKokoro.removeDownloads();localKokoro.resetMetrics();localEnabled=false;localAllowed=false;setupFailed=false;
    save();setupControls();preview();$('download-status').textContent='Downloads removed. Download Kokoro again to use it on this device.';
  });
  if(localAllowed && saved.engine==='kokoro'){$('engine').value='kokoro';changeEngine();}
  else setupControls();
  setupFeedback(()=>player?.state||'idle',()=>({...options}),()=>$('engine').value==='kokoro'?localKokoro.processingMetrics():undefined);
}
}
if (CLOUD_READER) {
  setupCloudReader({player:workstationPlayer, getEngine:()=> $('engine').value});
  if(saved.engine==='google'){$('engine').value='google';changeEngine();}
  setupFeedback(()=>player?.state||'idle',()=>({...options}));
}
if (WORKSTATION) {
  const usageLink=document.createElement('a');usageLink.href=new URL('api/billing',location.href).href;
  usageLink.textContent='Speech usage & test purchases';usageLink.target='_blank';usageLink.rel='noopener';
  const usageParagraph=document.createElement('p');usageParagraph.className='hint';usageParagraph.append(usageLink);
  $('recording-controls').append(usageParagraph);
  const googleOption=new Option('Google - WaveNet · private test','google');googleOption.disabled=true;$('engine').append(googleOption);
  const hostedOption=new Option('DeepInfra - Kokoro · private test','deepinfra');hostedOption.disabled=true;$('engine').append(hostedOption);
  const option = new Option('Workstation - Kokoro · checking…', 'workstation');
  option.disabled = true; $('engine').add(option);
  discoverWorkstation();
}

$('pdf-file').addEventListener('change', async () => {
  const file = $('pdf-file').files[0];
  if (!file) return;
  if (!LONG_READINGS && file.size > 20 * 1024 * 1024) {
    $('pdf-status').textContent = 'Choose a PDF smaller than 20 MB.';
    $('pdf-file').value = '';
    return;
  }
  const request = ++pdfRequest;
  player?.stop();
  $('pdf-file').disabled = true;
  $('text').readOnly = true;
  $('paste-play').disabled = true;
  $('clear').disabled = true;
  $('pdf-status').textContent = `Reading ${file.name}…`;
  const pdfController = new AbortController();
  activePdfController = pdfController;
  const pdfTimer = LONG_READINGS ? null : setTimeout(()=>pdfController.abort(),40000);
  $('cancel-pdf').hidden=false;$('cancel-pdf').onclick=()=>pdfController.abort();
  try {
    const {extractPdf}=await import('./pdf.js');
    const data=await extractPdf(file, pdfController.signal, {maxCharacters: LONG_READINGS ? Infinity : 1000000});
    if (request !== pdfRequest) return;
    resetReading();
    $('text').value = data.text;
    preview();
    setMode('edit');
    $('pdf-status').textContent = `Loaded ${file.name} · ${data.pages} pages.${data.emptyPages ? ` ${data.emptyPages} pages had no readable text and were skipped.` : ''} Review the imported text, then choose Read to listen. Columns and tables may read out of order.`;
  } catch (error) {
    if (request !== pdfRequest) return;
    $('pdf-status').textContent = error.name === 'TimeoutError' ? 'PDF import timed out. Try a smaller PDF.' : (error instanceof TypeError ? 'Could not read this PDF on this device. Try another file.' : error.message);
  } finally {
    clearTimeout(pdfTimer);
    if (request !== pdfRequest) return;
    activePdfController = undefined;
    $('cancel-pdf').hidden=true;
    $('pdf-file').disabled = false;
    $('pdf-file').value = '';
    $('text').readOnly = false;
    $('paste-play').disabled = false;
    $('clear').disabled = false;
  }
});

if (WORKSTATION) {
  const link = document.createElement('a');
  link.href = new URL('api/audition', location.href);
  link.textContent = 'Audition hosted voices';
  const paragraph = document.createElement('p');
  paragraph.append(link);
  document.querySelector('footer').append(paragraph);
}

if(MSE_ENABLED){
 const supported=workstationPlayer.capability.mp3;
 if(MSE_STAGING&&!supported){$('mse-delivery').value='complete';$('mse-delivery').querySelector('[value=mse]').disabled=true;}
 $('playback-options').hidden=!MSE_STAGING;
 $('mse-support').textContent=supported?'Progressive playback is available.':'This browser uses full preparation because MP3 progressive playback is unavailable.';
 $('mse-fallback').onclick=()=>workstationPlayer.useCompletedFile();
}
if(MSE_STAGING){
 $('staging-checks').hidden=false;
 window.__stagingReader=workstationPlayer;
 $('mse-sample').onclick=async()=>{
  const response=await fetch('/api/staging/fixtures');if(!response.ok){$('status').textContent='Staging samples are unavailable.';return;}
  const data=await response.json(),voice=settings().voice;
  const sections=data.voices[voice];if(!sections){$('status').textContent='Select a WaveNet voice first.';return;}
  resetReading();stagingSampleText=Array.from({length:$('mse-cached').checked&&$('mse-scenario').value==='long'?8:1},()=>sections).flat().join('\n\n');
  $('text').value=stagingSampleText;preview();$('status').textContent='Sample loaded. Press Play to start.';
 };
 $('mse-cached').onchange=()=>{if(!$('mse-cached').checked)$('mse-scenario').value='normal';};
 $('mse-results').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(workstationPlayer.diagnostics(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`staging-playback-${workstationPlayer.id||'idle'}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}

if (VIDEO_DOWNLOAD) videoDownload = setupVideoDownload({getText:()=>cleaned, getVoice:()=>$('voice').value, getPrepared:()=>workstationPlayer, isGoogle, onChange:()=>{if(player)render(player);}});

// Logical readings have tab-local IDs. Join their existing exports on demand.
for (const [id,kind] of [['download-audio','mp3'],['download-captions','vtt']]) {
 const link=$(id);if(!link)continue;
 link.addEventListener('click',async event=>{
  const active=player;
  if(!active?.getVideoPreparation?.())return;
  event.preventDefault();
  const job=active.id;
  try {
   $('recording-progress').textContent='Preparing your download…';
   const href=await active.longReadings.downloadURL(job,kind);
   if(player!==active||active.id!==job)return;
   link.href=href;
   const download=document.createElement('a');download.href=href;download.download=`reading.${kind}`;download.click();
   $('recording-progress').textContent='Recording ready to download · original speed';
  }catch(error){$('recording-progress').textContent=error.message;}
 });
}

if (CLOUD_READER) setupExtensionHandoff({accept(text, {autoplay}) {
  pasteRequest++;
  pdfRequest++;
  activePdfController?.abort(); activePdfController = undefined;
  $('cancel-pdf').hidden = true;
  $('pdf-file').disabled = false; $('pdf-file').value = '';
  $('text').readOnly = false;
  $('paste-play').disabled = false; $('clear').disabled = false;
  $('pdf-status').textContent = '';
  $('paste-status').hidden = true;
  resetReading();
  $('text').value = text;
  preview();
  setMode('read');
  if (autoplay) readAndPlay();
  else if (cleaned) { $('status').textContent = 'Text restored. Press Play to start'; $('play').focus({preventScroll: true}); }
  if (!cleaned) {
    $('paste-status').textContent = 'Text received, but nothing remains after cleanup. Adjust cleanup options to read it.';
    $('paste-status').hidden = false;
  }
}});
