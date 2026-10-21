import {setupDeviceAudio} from './device-audio-ui.js';
import {inputActionCopy} from './input-copy.js';
import {clipboardPayload} from './clipboard-payload.js';
import {setupSectionProgress} from './section-progress.js';
import {setupPasteDiagnostics} from './paste-diagnostics.js';
import {setupSummary} from './summary-ui.js';
import {setupDocumentImport} from './document-import.js';
import {setupStagingReaderLayout} from './staging-reader-layout.js';
import {setupProcessingIndicator,showProcessing,hideProcessing,audioWaitMessage} from './processing-indicator.js';
import {discardLegacyPositions} from './reader-reload.js';
import {setupDomainMoveNotice} from './domain-move.js';
setupDomainMoveNotice();
import {setupExtensionHandoff} from './extension-handoff.js';
import {SPEED_PRESETS, presetRate, preparedChunkCount, playbackTimeline} from './playback-controls.js';
import {WAVENET_VOICES} from './wavenet-voices.js';
import {setupVoicePreviews} from './voice-previews.js';
import {cloudFetch, setupCloudReader} from './cloud-reader.js';
import { PERSISTENT_AUDIO, WORKSTATION, KOKORO_ENABLED, CLOUD_READER, STAGING_READER_LAYOUT, INPUT_QUEUE_UI,INPUT_QUEUE_REFINEMENTS, OCR_PICKER_AUTOSCAN, MSE_STAGING, MSE_ENABLED, FULL_AUDIO_PREFETCH, SECTION_PROGRESS, VIDEO_DOWNLOAD, LONG_READINGS, DOCUMENT_IMPORT, SUMMARY_ENABLED, UNIFIED_CREDITS, RELEASE, BUILD_COMMIT } from './config.js';
import {setupVideoDownload} from './video-ui.js';
import {setupInputQueue} from './input-queue-ui.js';
import { LocalKokoro } from './local-kokoro.js';
import { event, setupFeedback } from './public-features.js';
import { clipboardMarkdown } from './paste.js?v=20260917-answer-labels-1';
import { cleanText, chunkText, readingCharacters, defaults } from './text.js?v=20260917-answer-labels-1';
import { Player } from './player.js';
import { StagingPlayer } from './staging-player.js';
import { ProgressivePlayer } from './progressive-player.js';
import { AudioPlayer } from './audio-player.js?v=20260917-answer-labels-1';
if(CLOUD_READER)discardLegacyPositions();
const $ = id => document.getElementById(id);
const sectionProgress=SECTION_PROGRESS?setupSectionProgress():null;
if(STAGING_READER_LAYOUT){setupStagingReaderLayout();setupProcessingIndicator();}
let summaryMode=null;
let pasteDiagnostics=null;
const extensionRecommendation = document.querySelector('.extension-recommendation');
if (extensionRecommendation) {
  const tooltip = $('extension-tooltip');
  const show = () => { tooltip.hidden = false; };
  const hide = () => { tooltip.hidden = true; };
  extensionRecommendation.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'touch') show();
  });
  extensionRecommendation.addEventListener('pointerleave', () => {
    if (!extensionRecommendation.contains(document.activeElement)) hide();
  });
  extensionRecommendation.addEventListener('focusin', show);
  extensionRecommendation.addEventListener('focusout', hide);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
  });
}

let saved = {};
try { saved = JSON.parse(localStorage.getItem('paste2speech.settings')) || {}; } catch {}
const options = { ...defaults, math:false };
for (const key of Object.keys(options)) if (typeof saved[key] === 'boolean') options[key] = saved[key];
if(!DOCUMENT_IMPORT)options.math=false;
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
let previewedText;
let chunks = [];
let paragraphStarts = [];
let sentenceElements = new Map();
let sectionBefore = [], sectionAfter = [];
let readingWindowStart = 0;
const READING_WINDOW = 160;
const READING_WINDOW_THRESHOLD = 1000;
let stagingSampleText='';
let videoDownload;
let deviceAudio;
let preferBrowserReading = saved.engine === "browser";
let documentImport;
let inputQueue,intakeContext,nextFileIntent;
const intakeContexts=new Map();
let voicePreviews;
const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const browserPlayer = supported ? new Player(window.speechSynthesis, window.SpeechSynthesisUtterance, render,{trackStart:STAGING_READER_LAYOUT}) : null;
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
let deviceInputChunks,devicePreparedChunks,deviceSourceMatches=false;
function matchesPreparedDeviceReading(){
 if(!isGoogle()||$('text').value!==previewedText||settings().voice!==workstationPlayer.settings?.voice)return false;
 const prepared=workstationPlayer.chunks;
 if(deviceInputChunks!==chunks||devicePreparedChunks!==prepared){deviceInputChunks=chunks;devicePreparedChunks=prepared;deviceSourceMatches=prepared===chunks||prepared.length===chunks.length&&prepared.every((text,index)=>text===chunks[index]);}
 return deviceSourceMatches;
}
function canPlay() { if(deviceAudio?.opening)return false; if(pasteDiagnostics?.active)return false; if(documentImport?.busy&&!intakeContext?.background)return false; if(videoDownload?.preparingAudio)return false; return isWorkstation() ? (CLOUD_READER || workstationVoices.length > 0) : isKokoro() ? localEnabled : supported; }
function changeEngine() {
  if(PERSISTENT_AUDIO){deviceAudio?.capture();void deviceAudio?.flush();}
  if(player===workstationPlayer&&player.getVideoPreparation?.()?.error?.creditPaused)player.pause();else if(PERSISTENT_AUDIO&&player===workstationPlayer){player.pause();player.invalidate({preservePreparation:true});}else player?.stop();
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
  const diagnosticStarted=pasteDiagnostics?.mark('preview-editor', $('text').value);
  summaryMode?.sourceChanged();
  previewedText = $('text').value;
  cleaned = cleanText(previewedText, options);
  if(diagnosticStarted!=null)pasteDiagnostics.record('cleanup-complete',cleaned,{elapsedMs:Math.round(performance.now()-diagnosticStarted)});
  chunks = [];
  paragraphStarts = [];
  sectionBefore = [];
  sectionAfter = [];
  for (const paragraph of cleaned.split(/\n\s*\n/).filter(Boolean)) {
    paragraphStarts.push(chunks.length);
    let cursor = 0;
    for (const chunk of (MSE_STAGING&&cleaned===stagingSampleText?[paragraph]:chunkText(paragraph))) {
      const offset = paragraph.indexOf(chunk, cursor);
      sectionBefore.push(paragraph.slice(cursor, offset));
      cursor = offset + chunk.length;
      chunks.push(chunk);
      sectionAfter.push('');
    }
    if (chunks.length) sectionAfter[chunks.length - 1] = paragraph.slice(cursor);
  }
  renderReadingWindow(0);
  if (!cleaned) $('preview').textContent = 'Your cleaned text will appear here.';
  const characters = readingCharacters($('text').value, chunks);
  $('character-savings').hidden = !characters.before;
  $('character-savings').textContent = characters.before ? `${characters.before.toLocaleString()} original characters → ${characters.submitted.toLocaleString()} to read${characters.saved ? ` · ${characters.saved.toLocaleString()} saved` : ''}` : '';
  if(CLOUD_READER)window.dispatchEvent(new Event('reading-cost-change'));
  $('count').textContent = cleaned ? `${cleaned.split(/\s+/).length.toLocaleString()} words` : '';
  $('play').disabled = !canPlay() || !cleaned;
  videoDownload?.update();
  if(diagnosticStarted!=null)pasteDiagnostics.record('preview-complete',$('preview').textContent,{elapsedMs:Math.round(performance.now()-diagnosticStarted),sections:chunks.length,editorUnchanged:$('text').value===previewedText});
}
function renderReadingWindow(target) {
  const pane = $('preview');
  const paged = chunks.length > READING_WINDOW_THRESHOLD;
  readingWindowStart = paged ? Math.floor(Math.max(0, Math.min(chunks.length - 1, target)) / READING_WINDOW) * READING_WINDOW : 0;
  const end = paged ? Math.min(chunks.length, readingWindowStart + READING_WINDOW) : chunks.length;
  sentenceElements = new Map();
  pane.replaceChildren();
  if (paged) {
    const controls = document.createElement('div');
    controls.className = 'reading-window';
    const notice = document.createElement('div');
    notice.textContent = `Showing sections ${(readingWindowStart + 1).toLocaleString()}–${end.toLocaleString()} of ${chunks.length.toLocaleString()}. The complete text is available in Edit.`;
    controls.append(notice);
    for (const [label, next] of [['Earlier sections', readingWindowStart - READING_WINDOW], ['Later sections', end]]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label; button.disabled = next < 0 || next >= chunks.length;
      button.onclick = () => { renderReadingWindow(next); markReadingPosition(player); pane.scrollTop = 0; };
      controls.append(button);
    }
    const label = document.createElement('label'); label.textContent = ' Go to section ';
    const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = String(chunks.length); input.value = String(readingWindowStart + 1); input.style.width = '7em';
    label.append(input); controls.append(label);
    const jump = document.createElement('button'); jump.type = 'button'; jump.textContent = 'Show';
    jump.onclick = () => { if (input.checkValidity()) { renderReadingWindow(Number(input.value) - 1); markReadingPosition(player); pane.scrollTop = 0; } };
    controls.append(jump); pane.append(controls);
  }
  const starts = new Set(paragraphStarts);
  let group;
  for (let index = readingWindowStart; index < end; index++) {
    if (!group || starts.has(index)) {
      if (group) pane.append('\n\n');
      group = document.createElement('p'); group.className = 'reading-paragraph'; pane.append(group);
    }
    group.append(sectionBefore[index]);
    const button = document.createElement('span'); button.className = 'sentence'; button.textContent = chunks[index];
    button.dataset.sectionIndex = String(index); button.setAttribute('role', 'button'); button.tabIndex = canPlay() ? 0 : -1;
    button.setAttribute('aria-disabled', String(!canPlay())); button.setAttribute('aria-label', `Read from section ${index + 1}: ${chunks[index]}`);
    const activate = () => { if (canPlay()) { if (['idle','done'].includes(player?.state)) countNextPlayback=true; player?.start(chunks, settings(), index); } };
    button.addEventListener('click', activate);
    button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) activate(); } });
    sentenceElements.set(index, button); group.append(button, sectionAfter[index]);
  }
}
function markReadingPosition(p) {
  const active = p && ['playing', 'paused', 'preparing', 'buffering', 'ready', 'failed', 'disconnected'].includes(p.state);
  if (active && $('follow-reading').checked && chunks.length > READING_WINDOW_THRESHOLD && !sentenceElements.has(p.index)) renderReadingWindow(p.index);
  for (const [index, button] of sentenceElements) {
    if (active && p.index === index) {
      const changed = !button.hasAttribute('aria-current'); button.setAttribute('aria-current', 'true');
      if (changed) followParagraph(button);
    } else button.removeAttribute('aria-current');
  }
}
function setMode(mode) {
  const reading = mode === 'read';
  const summarizing=mode==='summary';
  summaryMode?.setVisible(summarizing);
  if (!reading) closeReadingSize();
  $('edit-view').hidden = reading||summarizing;
  $('read-view').hidden = !reading;
  $('edit-mode').setAttribute('aria-pressed', String(!reading&&!summarizing));
  $('read-mode').setAttribute('aria-pressed', String(reading));
  if (reading) followParagraph($('preview').querySelector('[aria-current=true]'));
}
$('edit-mode').addEventListener('click', () => setMode('edit'));
function readAndPlay({retentionChecked=false}={}) {
  if(PERSISTENT_AUDIO&&deviceAudio?.needsPlaybackGuard()&&!retentionChecked){void deviceAudio.beforePlay().then(allowed=>{if(allowed)readAndPlay({retentionChecked:true});});return true;}
  inputQueue?.model.resume();
  voicePreviews?.stop();
  $('text').blur();
  setMode('read');
  if (!player || !canPlay() || !cleaned || ['playing', 'preparing', 'buffering'].includes(player.state)) return false;
  if (['paused', 'ready', 'failed', 'disconnected'].includes(player.state)) player.resume(settings());
  else { countNextPlayback=true; player.start(chunks, settings()); }
  if(STAGING_READER_LAYOUT&&player!==browserPlayer&&audioWaitMessage(player))render(player,player.error||'');
  return true;
}
$('credit-resume').onclick=()=>{window.dispatchEvent(new Event('speech-credit-change'));if(videoDownload?.creditPaused&&!workstationPlayer.getVideoPreparation?.()?.error)void videoDownload.resume();else void player?.resume(settings());};
$('credit-browser').onclick=()=>{preferBrowserReading=true;$('engine').value='browser';changeEngine();void deviceAudio?.engineChanged();};
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
  markReadingPosition(player);
  followParagraph($('preview').querySelector('[aria-current=true]'));
});
$('reading-size').addEventListener('input', () => {
  applyReadingSize();
  save();
  followParagraph($('preview').querySelector('[aria-current=true]'));
});
function render(p, message) {
  deviceAudio?.update();
  if(MSE_STAGING&&p===workstationPlayer){const events=p.events||[];$('mse-diagnostics').textContent=JSON.stringify({job:p.id,state:p.state,mode:p.mode,prepared:p.starts.length,appended:p.next,duration:p.duration,time:p.audio.currentTime,sourceLoads:events.filter(e=>e.type==='loadstart').length,firstPlayingMs:events.find(e=>e.type==='playing')?.ms,endOfStream:events.find(e=>e.type==='end-of-stream'),rawEnd:events.find(e=>e.type==='before-end-of-stream'),error:p.error,failure:p.status?.failure||null},null,2);}
  if (p !== player) return;
  const waiting=STAGING_READER_LAYOUT?audioWaitMessage(p,{browser:p===browserPlayer,creditPaused:videoDownload?.creditPaused}):'';
  if(STAGING_READER_LAYOUT){if(waiting)showProcessing('audio',p,waiting);else hideProcessing('audio');}
  if (CLOUD_READER && ['playing','preparing','buffering'].includes(p.state)) voicePreviews?.stop();
  if(p.state!==previousState){
    if(p.state==='preparing') preparationStarted=performance.now();
    if(!CLOUD_READER && p.state==='ready' && previousState==='preparing') event('kokoro_ready','kokoro','none',performance.now()-preparationStarted);
    if(!CLOUD_READER && p.state==='failed') event('kokoro_failure','kokoro','generation');
    if(p.state==='playing' && countNextPlayback){event('playback_start',isGoogle()?'google':isKokoro()?'kokoro':'browser');countNextPlayback=false;}
    inputQueue?.model.observe(p.state);
    previousState=p.state;
  }
  const blocked = (message || p.error) === 'Press Play to start';
  const wasBlocked = $('play').classList.contains('autoplay-blocked');
  $('play').classList.toggle('autoplay-blocked', blocked);
  if (blocked && !wasBlocked) $('play').focus({preventScroll: true});
  $('credit-actions').hidden = !isGoogle() || !(p.getVideoPreparation?.()?.error?.creditPaused || videoDownload?.creditPaused);
  $('status').textContent = message || waiting || ({ idle: 'Ready when you are', preparing: 'Preparing audio…', buffering: 'Waiting for the next audio section…', ready: 'Audio ready · tap Play.', failed: 'Preparation failed · tap Play to retry.', playing: 'Reading aloud', paused: 'Paused · your place is saved', done: 'All read. Take a breath.' }[p.state]);
  if(!CLOUD_READER) $('position').textContent = p.chunks.length && p.state !== 'idle' ? `${Math.min(p.index + 1, p.chunks.length)} / ${p.chunks.length}` : '';
  if(!CLOUD_READER){$('progress').max = p.chunks.length || 1; $('progress').value = p.state === 'idle' ? 0 : p.index;}
  $('play').textContent = ['paused', 'failed', 'disconnected'].includes(p.state) ? '▶ Resume' : p.state === 'done' ? '↺ Replay' : '▶ Play';
  $('play').disabled = !!waiting || ['playing', 'preparing', 'buffering'].includes(p.state) || !cleaned || !canPlay();
  $('pause').disabled = !waiting && !['playing', 'preparing', 'buffering'].includes(p.state);
  $('stop').disabled = p.state === 'idle';
  $('recording-controls').hidden = !isWorkstation();
  $('playback-note').textContent = isWorkstation()
    ? `${isGoogle()&&settings().delivery!=='mse'?'Playback starts after the full reading is prepared.':'Playback starts as audio arrives.'} Pause keeps preparation running; Stop cancels unfinished preparation. ${MSE_ENABLED?'Wait until you hear speech before locking your screen. ':''}Keep this page open for lock-screen controls. ${PERSISTENT_AUDIO?'Server recordings expire after 24 hours; saved device copies remain until removed.':'Temporary recordings expire after 24 hours.'} Resume reuses saved audio; Clear or a new reading may generate audio and use credit again.`
    : (CLOUD_READER ? 'Browser voices are free and need the page visible. Your device speech service may use the internet.' : 'On-device Kokoro prepares the whole reading first. Browser voices need the page visible. Reloading discards the reading.');
  if(sectionProgress&&isWorkstation())$('playback-note').textContent=STAGING_READER_LAYOUT?'Pause keeps preparation running; Stop cancels unfinished preparation. Start playback before locking your screen and keep this tab open. Clear or a new reading may use speech credit.':'Pause keeps preparation running; Stop cancels unfinished preparation. Start playback before locking your screen and keep this tab open. Recordings expire after 24 hours. Clear or a new reading may use speech credit.';
  if(STAGING_READER_LAYOUT&&!isWorkstation())$('playback-note').textContent='Browser voices are free and need the page visible.';
  $('recording-progress').textContent = isWorkstation() && p.id ? (p.complete ? 'Recording ready to download · original speed' : `${p.starts.length} of ${p.chunks.length} sections prepared`) : '';
  if(sectionProgress)$('recording-progress').hidden=true;
  if($('offline-progress')&&!sectionProgress){
    const info=isWorkstation()&&p.id?p.offlineInfo:null;
    $('offline-progress').hidden=!info;
    if(info)$('offline-progress').textContent=info.ready?'Ready for offline listening in this tab. Keep this page open; reloading clears downloaded audio.':info.error||`Downloading for offline listening: ${info.downloaded} / ${info.total} sections. Keep this page open; downloads may pause when your device suspends the browser.`;
  }
  if(isGoogle() && p.id && !CLOUD_READER) $('recording-progress').textContent += ` · list-price estimate $${(p.providerCost||0).toFixed(5)}${p.costIncomplete?' (incomplete)':''}`;
  if(isDeepInfra() && p.id) $('recording-progress').textContent += ` · provider-reported estimate $${(p.providerCost||0).toFixed(5)}${p.costIncomplete?' (incomplete)':''}`;
  for (const [id,kind] of [['download-audio','mp3'],['download-captions','vtt']]) {
    if (!$(id)) continue;
    const href = isWorkstation() && p.download?.(kind);
    $(id).hidden = !href || (kind==='vtt' && !$('include-captions').checked);
    if(href)$(id).href=href;else $(id).removeAttribute('href');
  }
  if(CLOUD_READER){
    const available=navigableSections(p);
    const index=Math.max(0,Math.min(p.chunks.length-1,p.index||0));
    const seek=$('seek');
    seek.disabled=!available;
    seek.max=Math.max(0,available-1);
    if(seek.dataset.dragging!=='true')seek.value=Math.min(index,Math.max(0,available-1));
    const total=p.state==='idle'?0:p.chunks.length||(sectionProgress&&p.state==='preparing'?chunks.length:0);
    seek.setAttribute('aria-valuetext',`Section ${available?Number(seek.value)+1:0} of ${total}`);
    const selected=seek.dataset.dragging==='true'?Number(seek.value):index;
    if(STAGING_READER_LAYOUT){const timing=playbackTimeline(p,{rate:settings().rate,natural:isWorkstation(),selected:seek.dataset.dragging==='true'?selected:null});seek.setAttribute('aria-valuetext',timing.label+' · '+timing.detail+` · Section ${available?Number(seek.value)+1:0} of ${total}`);$('seek-time').textContent=timing.label;$('seek-time').title=timing.detail;$('seek-time').setAttribute('aria-label',timing.label+' · '+timing.detail);let note=$('timeline-note');if(!note){note=document.createElement('span');note.id='timeline-note';note.className='hint';$('seek-time').after(note);}note.textContent=timing.detail;}else $('seek-time').textContent=`${total&&(!sectionProgress||available)?selected+1:0} / ${total}`;
    const playbackIndex=sectionProgress&&p===workstationPlayer&&p.starts.length?Math.max(0,p.starts.findLastIndex(t=>t<=(p.audio?.currentTime||0)+1/24000)):index;
    sectionProgress?.({total,available,index:playbackIndex,natural:isWorkstation(),retained:p.retainedSections||[],info:p.id?p.offlineInfo:null,offline:navigator.onLine===false});
    $('previous-section').disabled=!available||index===0;
    $('next-section').disabled=!available||index>=available-1;
  }
  if(!CLOUD_READER) $('previous-section').disabled = (CLOUD_READER&&!isWorkstation()) || !p.chunks.length || p.index===0;
  if(!CLOUD_READER) $('next-section').disabled = (CLOUD_READER&&!isWorkstation()) || !p.chunks.length || p.index>=p.chunks.length-1;
  markReadingPosition(p);
}
for (const [key, label] of Object.entries({ markdown: 'Markdown formatting', citations: 'ChatGPT references', urls: 'Web addresses', code: 'Code blocks', tables: 'Tables', emoji: 'Emoji', joinLines: 'Join wrapped lines', math:'Skip math notation' })) {
  if(key==='math'&&!DOCUMENT_IMPORT)continue;
  const wrapper = document.createElement('label'); const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = options[key]; input.id = `clean-${key}`;if(key==='math'){input.title='Skip balanced LaTeX delimiters and math environments in playback. Original document exports are kept.';}
  input.addEventListener('change', () => { resetReading(key==='math'); options[key] = input.checked; save(); preview(); });
  const compactLabel={markdown:'Markdown',citations:'References',urls:'Links',code:'Code',tables:'Tables',emoji:'Emoji',joinLines:'Join lines',math:'Skip math'}[key];if(STAGING_READER_LAYOUT)input.setAttribute('aria-label',label);wrapper.append(input,STAGING_READER_LAYOUT?compactLabel:label);$('options').append(wrapper);
  if(key==='math'){const note=document.createElement('p');note.id='math-cleanup-note';note.className='hint';note.textContent='Skips balanced LaTeX delimiters and math environments. Plain symbols, code, and unmatched formulas are kept. Original document exports are unchanged.';input.setAttribute('aria-describedby',note.id);(STAGING_READER_LAYOUT?$('cleanup-info-details')||$('options'):$('options')).append(note);}
}
function updateVoiceSummary() {
  const voice = $('voice').selectedOptions[0]?.textContent.split(' · ')[0] || 'Device default';
  const summary = `${isGoogle()?(CLOUD_READER?'Natural · ':'Google · '):isDeepInfra()?'DeepInfra · ':''}${voice}${CLOUD_READER?'':` · ${$('rate').value}×`}`;
  $('voice-settings-summary').textContent = summary;
  $('voice-settings-summary').title = summary;
}
function loadVoices() {
  $('voice').replaceChildren();
  if (isKokoro()) {
    const availableVoices = isGoogle() ? (CLOUD_READER ? WAVENET_VOICES : [{id:'en-US-Wavenet-F',name:'US female · WaveNet F'},{id:'en-GB-Wavenet-F',name:'UK female · WaveNet F'}]) : isWorkstation() ? workstationVoices.filter(v=>!isDeepInfra() || ['af_heart','bf_emma'].includes(v.id)) : localVoices;
    if(CLOUD_READER && isGoogle()){
      for(const groupName of ['US English','UK English']){
        const group=document.createElement('optgroup');group.label=groupName;
        for(const voice of availableVoices.filter(v=>v.group===groupName))group.append(new Option(voice.name,voice.id));
        $('voice').append(group);
      }
    }else for (const voice of availableVoices) $('voice').add(new Option(voice.name, voice.id));
    $('voice').value = availableVoices.some(v => v.id === selectedVoice) ? selectedVoice : availableVoices[0]?.id || '';
    workstationVoice = $('voice').value;
    $('voice-note').textContent = isGoogle() ? (LONG_READINGS?'WaveNet · text is sent to Google Cloud. Long readings are prepared in parts automatically. Default pronunciation and pauses.':'WaveNet · text is sent to Google Cloud. Up to 20,000 characters per reading. Default pronunciation and pauses.') + (MSE_ENABLED ? ' Playback starts as audio arrives where supported.' : ' Full preparation before playback.') : !isWorkstation() ? 'Experimental · generated on this device. Kokoro loads automatically after the first download. Preparation may be slow on phones.' : isDeepInfra() ? 'Private test · text is sent to DeepInfra and uses the project’s prepaid credit. Up to 20,000 characters per reading; shared pronunciation and pause rules are applied.' : 'Generated privately on your workstation. English voices; no cloud speech service.';
    if(STAGING_READER_LAYOUT&&isGoogle())$('voice-note').textContent=$('voice-note').textContent.replace('text is sent to Google Cloud. ','');
  } else {
    voices = supported ? speechSynthesis.getVoices() : [];
    $('voice').add(new Option('Device default', ''));
    for (const voice of voices) $('voice').add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · on-device' : ' · network possible'}`, voice.voiceURI));
    $('voice').value = voices.some(v => v.voiceURI === selectedVoice) ? selectedVoice : '';
    $('voice-note').textContent = voices.length ? 'Voice availability depends on your device. On-device voices are labeled.' : 'No voice list yet. Play can still try the device default.';
  }
  updateVoiceSummary();
}
$('engine').addEventListener('change',()=>{preferBrowserReading=$('engine').value==='browser';changeEngine();void deviceAudio?.engineChanged();});
$('text').addEventListener('input', () => {
  // Some mobile keyboards emit many input events without changing the value.
  // Keep the existing reading and DOM until there is an actual source edit.
  if ($('text').value === previewedText) {
    pasteDiagnostics?.record('input-unchanged-editor', $('text').value);
    return;
  }
  resetReading(); preview();
});
if(RELEASE==='private-reader'&&MSE_STAGING)pasteDiagnostics=setupPasteDiagnostics({queueUI:INPUT_QUEUE_UI,queueRefinements:INPUT_QUEUE_REFINEMENTS,target:$('text'),preview:$('preview'),getOptions:()=>options,build:BUILD_COMMIT,onStateChange(){player?.pause();$('play').disabled=!canPlay()||!cleaned;}});
// Both native rich paste and the foreground Paste button use the editor's
// native insertion/undo path. Clipboard conversion stays in the shared importer.
function insertEditorText(text,range){
  const input=$('text');input.focus({preventScroll:true});
  if(range)input.setSelectionRange(range.start,range.end,range.direction);
  let inserted=false;
  try{inserted=document.execCommand('insertText',false,text);}catch{}
  if(!inserted){input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));}
}
let pasteSelection;
function rememberPasteSelection(){
  const input=$('text');
  if(document.activeElement===input||pasteSelection?.value!==input.value)pasteSelection={value:input.value,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection};
}
if($('paste')){
  for(const name of ['focus','select','keyup','input'])$('text').addEventListener(name,rememberPasteSelection);
  document.addEventListener('selectionchange',()=>{if(document.activeElement===$('text'))rememberPasteSelection();});
  $('text').addEventListener('keydown',rememberPasteSelection);
  $('paste').addEventListener('pointerdown',rememberPasteSelection);
}
function disablePasteButtons(value){$('paste-play').disabled=value;if($('paste'))$('paste').disabled=value;}
$('text').addEventListener('paste', event => {
  if ($('text').readOnly) return;
  let markdown;
  try { markdown = clipboardMarkdown(event.clipboardData?.getData('text/html'), event.clipboardData?.getData('text/plain')); } catch { return; }
  pasteDiagnostics?.record('paste-event-html-import',markdown);
  if (!markdown) return;
  event.preventDefault();
  insertEditorText(markdown);
});
// Read first: denied, empty, or unreadable clipboards must not erase a reading.
let pasteRequest = 0, activePasteRequest = 0;
let pdfRequest = 0, activePdfController;
$('text').addEventListener('input',()=>{pasteRequest++;inputQueue?.model.stop();if(intakeContext?.intent==='play')intakeContext.intent='editor';});
$('text').addEventListener('paste',event=>{summaryMode?.clearSource();pasteRequest++;if(!documentImport?.busy&&Array.from(event.clipboardData?.types||[]).some(type=>type==='text/plain'||type==='text/html'))documentImport?.clear();},{capture:true});
async function pasteFromClipboard({replace=false}={}){
  if(documentImport?.busy||$('text').readOnly)return;
  rememberPasteSelection();
  const range=replace?null:{...pasteSelection};
  const request = ++pasteRequest;activePasteRequest=request;
  const previousText = $('text').value;
  disablePasteButtons(true);
  $('paste-status').hidden = true;
  documentImport?.cancelClipboardRead();
  try {
    pasteDiagnostics?.record('paste-button-start',$('text').value);
    const payload = await clipboardPayload(navigator.clipboard, (stage,text,details)=>pasteDiagnostics?.record(stage,text,details),{guardImages:OCR_PICKER_AUTOSCAN});
    pasteDiagnostics?.record('paste-button-payload',payload.text);
    if (request !== pasteRequest || $('text').value !== previousText || documentImport?.busy || $('text').readOnly) return;
    if(payload.image){
      if(!documentImport)throw Error('image-unavailable');
      if(INPUT_QUEUE_UI)beginInputIntake(replace?'play':'editor',payload.image.name,'clipboard');
      await documentImport.openImage(payload.image,replace?'clear_paste_play':'paste_button');
      return;
    }
    const text=payload.text;
    if (!text.trim()||replace&&!cleanText(text,options).trim()) throw new Error('empty');
    documentImport?.clear();
    summaryMode?.clearSource();
    if(replace){
      if(PERSISTENT_AUDIO)await deviceAudio?.replace();else inputQueue?.model.stop();resetReading();$('text').value=text;pasteDiagnostics?.record('paste-button-editor-assigned',$('text').value);preview();if(PERSISTENT_AUDIO)await deviceAudio?.registerCurrentMetadata();if(request===pasteRequest)readAndPlay();
    }else{
      setMode('edit');insertEditorText(text,range);rememberPasteSelection();pasteDiagnostics?.record('paste-button-editor-assigned',$('text').value);
    }
    if(payload.hasImage){
      $('paste-status').textContent=UNIFIED_CREDITS?'Pasted the text. The clipboard also contains an image; use Open file to open the image’s text-scanning options. No scanning was started.':documentImport?'Pasted the text. The clipboard also contains an image; use Open file to open the image’s OCR options separately. No OCR was started.':'Pasted the text. The clipboard also contains an image, but image OCR is unavailable here.';
      $('paste-status').hidden=false;
    }
    if (!cleaned) {
      $('paste-status').textContent = 'Pasted, but nothing remains after cleanup. Adjust cleanup options to read it.';
      $('paste-status').hidden = false;
    }
  } catch (error) {
    if (request !== pasteRequest) return;
    if(range&&$('text').value===previousText)$('text').setSelectionRange(range.start,range.end,range.direction);
    $('paste-status').textContent = error.message === 'empty'
      ? 'Chrome did not provide text or an image to paste. Your text and playback are unchanged. For text, switch to Edit, then long-press the text box and choose Paste on Android, or use your keyboard’s Paste command. For a saved screenshot, use Open file.'
      : error.message==='multiple-images' ? 'The clipboard contains multiple images. Paste one image at a time, or use Open file. Your current text is unchanged.'
      : error.message==='image-unavailable' ? (UNIFIED_CREDITS?'Image text scanning is unavailable here. Your current text is unchanged.':'Image OCR is unavailable here. Your current text is unchanged.')
      : ['NotAllowedError','SecurityError'].includes(error.name)
        ? 'Chrome blocked clipboard access. Your text and playback are unchanged. Allow clipboard access if Chrome asks, or switch to Edit and use Android’s long-press Paste in the text box (keyboard Paste on desktop). For a saved screenshot, use Open file.'
        : 'Chrome could not read the clipboard. Your text and playback are unchanged. Switch to Edit and use Android’s long-press Paste in the text box, or your keyboard’s Paste command on desktop. For a saved screenshot, use Open file.';
    $('paste-status').hidden = false;
    if(STAGING_READER_LAYOUT&&documentImport?.showClipboardProblem){documentImport.showClipboardProblem(['empty','clipboard-image-unavailable'].includes(error.message)?'missing':error.message==='multiple-images'?'multiple':['NotAllowedError','SecurityError'].includes(error.name)?'denied':error.name==='NotSupportedError'?'unavailable':'failed');$('paste-status').hidden=true;}
  } finally {
    if(activePasteRequest===request){activePasteRequest=0;disablePasteButtons(!!documentImport?.busy||$('text').readOnly);}
  }
}
$('paste')?.addEventListener('click',()=>void pasteFromClipboard());
$('paste-play').addEventListener('click',()=>void pasteFromClipboard({replace:true}));
$('clear').addEventListener('click', () => { inputQueue?.clear();if(INPUT_QUEUE_UI)for(const context of intakeContexts.values())context.cancelled=true;summaryMode?.clearSource(); documentImport?.clear(); if(!PERSISTENT_AUDIO)workstationPlayer.longReadings?.clearSavedReadings(); pasteRequest++; $('paste-status').hidden = true; resetReading(); $('text').value = ''; preview(); setMode('edit'); $('text').focus(); });
$('rate').addEventListener('input', () => { $('rate-value').textContent = `${$('rate').value}×`; updateVoiceSummary(); if (isWorkstation()) workstationPlayer.setRate(settings().rate); else if (['playing', 'preparing', 'buffering'].includes(player?.state)) player.pause(); localKokoro.resetMetrics(); render(player); save(); });
$('voice').addEventListener('change', () => { if(PERSISTENT_AUDIO&&isGoogle())deviceAudio?.voiceChanging();deviceAudio?.capture();void deviceAudio?.flush();selectedVoice = $('voice').value; if (isKokoro()) workstationVoice = selectedVoice; else browserVoice = selectedVoice; updateVoiceSummary(); if(FULL_AUDIO_PREFETCH&&player===workstationPlayer&&player.settings?.voice!==selectedVoice)player.invalidate({preservePreparation:PERSISTENT_AUDIO}); if (['playing', 'preparing', 'buffering'].includes(player?.state)) player.pause(); localKokoro.resetMetrics(); render(player); save();if(PERSISTENT_AUDIO&&isGoogle()===false)void deviceAudio?.engineChanged({voiceChanged:true}); });
function navigableSections(p){return !p||p.state==='idle'?0:p===browserPlayer?p.chunks.length:preparedChunkCount(p);}
function seekSection(index){
  const available=navigableSections(player);
  if(!available)return;
  const target=Math.max(0,Math.min(available-1,index));
  if(player===browserPlayer)player.seekSection(target);else player.seekTo(player.starts[target]);
}
$('previous-section').addEventListener('click',()=>CLOUD_READER?seekSection(player.index-1):workstationPlayer.move(-1));
$('next-section').addEventListener('click',()=>CLOUD_READER?seekSection(player.index+1):workstationPlayer.move(1));
$('include-captions')?.addEventListener('change',()=>render(player));
$('play').addEventListener('click',()=>{inputQueue?.model.stop();readAndPlay();});
$('pause').addEventListener('click',()=>{inputQueue?.model.stop();player?.pause();});
$('stop').addEventListener('click',()=>{inputQueue?.model.stop();if(INPUT_QUEUE_UI){pasteRequest++;for(const context of intakeContexts.values())if(context.intent==='play')context.intent='editor';}player?.stop();});
window.addEventListener('pagehide', () => { if (player === browserPlayer) player?.pause(); });
// Chrome may restore form values after startup without firing input. Reconcile
// after returning to the page, preserving live audio and tab-saved preparation.
let restorationFrame;
function reconcileRestoredText() {
  if (restorationFrame !== undefined) return;
  restorationFrame = requestAnimationFrame(() => {
    restorationFrame = undefined;
    if ($('text').value === previewedText) return;
    preview();
    if (player) render(player);
  });
}
window.addEventListener('pageshow', reconcileRestoredText);
window.addEventListener('focus', reconcileRestoredText);
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconcileRestoredText(); });

document.addEventListener('visibilitychange', () => { if (!document.hidden && isKokoro()) { player?.sync(); if(isWorkstation())void workstationPlayer.refresh(); } });
function resetReading(preserveReady=false) { if(workstationPlayer.longReadings)workstationPlayer.longReadings.nextLogicalReading=null; deviceAudio?.capture();void deviceAudio?.flush();browserPlayer?.stop(); workstationPlayer.invalidate({preserveReady,preservePreparation:PERSISTENT_AUDIO}); localPlayer.invalidate(); localKokoro.resetMetrics(); }
if(CLOUD_READER){
  const seek=$('seek');
  seek.addEventListener('input',()=>{seek.dataset.dragging='true';render(player);});
  seek.addEventListener('change',()=>{const target=Number(seek.value);delete seek.dataset.dragging;seekSection(target);render(player);});
  seek.addEventListener('pointercancel',()=>{delete seek.dataset.dragging;render(player);});
  const button=$('speed-preset');
  const updateSpeed=()=>{button.textContent=`${$('rate').value}×`;button.setAttribute('aria-label',`Playback speed: ${$('rate').value}×. Activate to change speed.`);};
  button.addEventListener('click',()=>{
    $('rate').value=SPEED_PRESETS[(SPEED_PRESETS.indexOf(Number($('rate').value))+1)%SPEED_PRESETS.length];
    if(isWorkstation())workstationPlayer.setRate(settings().rate);
    else if(player?.state==='playing'){player.pause();player.resume(settings());}
    updateSpeed();render(player);save();
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
  setupCloudReader({getEngine:()=> $('engine').value,getCostCharacters:()=>chunks.reduce((n,t)=>n+[...t].length,0)});
  if(saved.engine==='google'){$('engine').value='google';changeEngine();}
  voicePreviews=setupVoicePreviews({pauseReading:()=>{if(['playing','preparing','buffering'].includes(player?.state))player.pause();}});
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

if(DOCUMENT_IMPORT)documentImport=setupDocumentImport({input:$('pdf-file'),pasteTarget:$('text'),status:$('pdf-status'),cancel:$('cancel-pdf'),getText:()=>$('text').value,
 intake:INPUT_QUEUE_UI?{
  capture(file,route){if(!intakeContext?.awaitingFile||!['picker','file_upload','clear_paste_play','paste_button','queue_next','queue_last'].includes(route))beginInputIntake('editor',file?.name||'File','file');const context=intakeContext;if(file){context.awaitingFile=false;context.title=file.name;const item=inputQueue.model.items.find(item=>item.id===context.queueId);if(item){item.title=file.name;inputQueue.announce(item);inputQueue.model.changed();}}return context;},
  alive:context=>!context.cancelled&&(!context.background||inputQueue.model.has(context.queueId)),
  fail(context,message){if(context?.background&&!context.cancelled)inputQueue.model.fail(context.queueId,message);},
  cancel(context){if(!context)return;context.cancelled=true;if(context.background)inputQueue.model.remove(context.queueId);}
 }:undefined,
 async accept(data,context){if(context?.cancelled)return;if(context?.background){inputQueue.model.resolve(context.queueId,data.text);if(intakeContext===context)intakeContext=null;return;}if(context?.intent==='play'&&!cleanText(data.text,context.snapshot.cleanup).trim()){inputQueue?.error('Nothing remains after cleanup. Your previous reading is kept.');return;}if(context?.intent==='play'&&PERSISTENT_AUDIO)await deviceAudio?.replace();if(context?.cancelled)return;summaryMode?.clearSource();resetReading();$('text').value=data.text;preview();setMode('edit');if(context?.intent==='play')requestAnimationFrame(async()=>{if(!context.cancelled&&$('text').value===data.text&&!documentImport.busy){applyInputSnapshot(context.snapshot);if(PERSISTENT_AUDIO)await deviceAudio?.registerCurrentMetadata();if(!context.cancelled&&$('text').value===data.text)readAndPlay();}});},
 pauseReading(){if(!intakeContext?.background&&['playing','preparing','buffering'].includes(player?.state))player.pause();},
 onBusy(value){if(!intakeContext?.background){summaryMode?.setBusy(value);if(value)pasteRequest++;$('text').readOnly=value;}disablePasteButtons(value);$('clear').disabled=false;if(!value&&!intakeContext?.background)preview();if(player)render(player);}
});
function inputSnapshot(){return {engine:$('engine').value,voice:$('voice').value,rate:Number($('rate').value),cleanup:{...options},scope:documentImport?.scope||null,libraryScope:deviceAudio?.scope||null};}
function applyInputSnapshot(snapshot){
 if(snapshot.engine==='browser'&&snapshot.voice&&!speechSynthesis.getVoices().some(voice=>voice.voiceURI===snapshot.voice))throw Error('The queued browser voice is unavailable. Remove this item or select an available voice for a new item.');
 Object.assign(options,snapshot.cleanup);for(const [key,value]of Object.entries(options))if($('clean-'+key))$('clean-'+key).checked=value;
 $('engine').value=snapshot.engine;$('rate').value=String(snapshot.rate);$('rate-value').textContent=snapshot.rate+'×';
 if(snapshot.engine==='browser')browserVoice=snapshot.voice;else workstationVoice=snapshot.voice;
 changeEngine();$('voice').value=snapshot.voice;selectedVoice=snapshot.voice;updateVoiceSummary();save();
}
function beginInputIntake(intent,title='Choosing file…',source='file',existingItem=null){
 const background=['next','last'].includes(intent);if(!background)inputQueue?.model.stop();const item=background?(existingItem||inputQueue.reserve(intent,title,source)):null;
 const context={key:item?'queue-'+item.id:'editor-'+crypto.randomUUID(),queueId:item?.id,background,intent,title,snapshot:item?.snapshot||inputSnapshot(),awaitingFile:true,cancelled:false};
 intakeContexts.set(context.key,context);intakeContext=context;return context;
}
async function readQueuedClipboard(intent){
 let item;try{item=inputQueue.reserve(intent,'Clipboard text');const payload=await clipboardPayload(navigator.clipboard,undefined,{guardImages:OCR_PICKER_AUTOSCAN});if(!inputQueue.model.has(item.id))return;
  if(payload.image){if(documentImport.busy)throw Error('Finish or cancel the current file upload, then add this image again.');beginInputIntake(intent,payload.image.name,'clipboard',item);await documentImport.openImage(payload.image,'queue_'+intent);return;}
  if(!payload.text.trim())throw Error('The clipboard did not provide text. Your editor and playback are unchanged.');
  item.title=payload.text.trim().split(/\r?\n/)[0].replace(/[#*_`]/g,'').slice(0,72)||'Clipboard text';inputQueue.model.resolve(item.id,payload.text);inputQueue.announce(item);
 }catch(error){if(item)inputQueue.model.fail(item.id,error.message||'Clipboard access failed. Your editor and playback are unchanged.');inputQueue.error(error.message||'Clipboard access failed.');}
}
if(INPUT_QUEUE_UI){
 inputQueue=setupInputQueue({changed:()=>deviceAudio?.queueChanged(),refined:INPUT_QUEUE_REFINEMENTS,persistent:PERSISTENT_AUDIO,snapshot:inputSnapshot,readClipboard:readQueuedClipboard,openFile(intent){nextFileIntent=intent;$('document-choose-file').click();},
  async start(item,current){if(PERSISTENT_AUDIO&&deviceAudio?.expiredIntent(item)){inputQueue.model.remove(item.id);inputQueue.model.advance();return false;}if(item.snapshot.libraryScope&&item.snapshot.libraryScope!==deviceAudio?.scope)throw Error('The account changed after this item was queued. Re-add it for the current profile. No speech was started.');await deviceAudio?.flush();if(item.snapshot.engine==='google'){if(!item.snapshot.scope)throw Error('Account checks were still loading when this item was added. Add it again after checking your account.');const response=await fetch('/api/ocr/jobs/config');if(!response.ok)throw Error('The account could not be confirmed. No speech was started.');const config=await response.json();if(!current())return false;if(config.consentScope!==item.snapshot.scope)throw Error('The account changed after this item was queued. Add it again for the current account. No speech was started.');}if(!current())return false;if(!cleanText(item.text,item.snapshot.cleanup).trim())throw Error('Nothing remains after this item’s cleanup settings.');applyInputSnapshot(item.snapshot);summaryMode?.clearSource();resetReading();$('text').value=item.text;preview();if(PERSISTENT_AUDIO&&deviceAudio){if(!await deviceAudio.beforePlay()||!current())return false;deviceAudio.setAddedAt(item.createdAt,item.id);await deviceAudio.registerCurrentMetadata({id:item.id,createdAt:item.createdAt,valid:current});if(!current())return false;workstationPlayer.longReadings.nextAddedAt=item.createdAt;}if(!readAndPlay({retentionChecked:true}))throw Error('This item cannot start yet. No automatic retry was made.');return true;},
  cancelItem(item){for(const [key,context]of intakeContexts)if(context.queueId===item.id){context.cancelled=true;documentImport.cancelDestination?.(context);intakeContexts.delete(key);}},
  clearAll(){for(const context of intakeContexts.values())context.cancelled=true;intakeContexts.clear();intakeContext=null;}
 });
 $('document-choose-file').addEventListener('click',()=>{beginInputIntake(nextFileIntent||'editor');nextFileIntent=null;},{capture:true});
}

if($('paste')&&$('document-paste-hint'))$('document-paste-hint').textContent=inputActionCopy({refined:INPUT_QUEUE_REFINEMENTS,queue:INPUT_QUEUE_UI,unified:UNIFIED_CREDITS,fileLabel:$('document-choose-file')?.textContent||'Choose file'}).documentHint;
if(!DOCUMENT_IMPORT)$('pdf-file').addEventListener('change', async () => {
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
  disablePasteButtons(true);
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
    summaryMode?.clearSource();
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
    disablePasteButtons(false);
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
  summaryMode?.clearSource();$('text').value=stagingSampleText;preview();$('status').textContent='Sample loaded. Press Play to start.';
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
  disablePasteButtons(false); $('clear').disabled = false;
  $('pdf-status').textContent = '';
  $('paste-status').hidden = true;
  resetReading();
  summaryMode?.clearSource();
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

if(SUMMARY_ENABLED)summaryMode=setupSummary({getText:()=>$('text').value,setText(text){resetReading();$('text').value=text;preview();setMode('edit');$('text').focus();},setMode});

if(PERSISTENT_AUDIO)deviceAudio=setupDeviceAudio({getPlayer:()=>workstationPlayer,getActive:()=>player,getEngine:()=>$('engine').value,getChunks:()=>chunks,getText:()=>$('text').value,
 matches:matchesPreparedDeviceReading,refresh:()=>{if(player)render(player);},getQueue:()=>inputQueue?.model,renderQueue:()=>inputQueue?.render(),playSaved:()=>readAndPlay(),
 snapshot:()=>({engine:$('engine').value,paragraphStarts:[...paragraphStarts],cleanup:{...options},voice:$('voice').value,rate:Number($('rate').value)}),
 async apply(record){
  const browserOverride=preferBrowserReading&&(record.engine||'google')==='google';
  const engine=browserOverride?'browser':record.engine||'google';
  let voice=browserOverride?($('engine').value==='browser'?$('voice').value:browserVoice):(record.voice||'');
  const voiceUnavailable=engine==='browser'&&!!voice&&!speechSynthesis.getVoices().some(item=>item.voiceURI===voice);
  if(voiceUnavailable)voice='';

  inputQueue?.model.stop();workstationPlayer.invalidate({preserveReady:true,preservePreparation:true});$('engine').value=engine;changeEngine();
  Object.assign(options,record.options?.cleanup);for(const key of Object.keys(options)){const input=$('clean-'+key);if(input)input.checked=options[key];}
  $('voice').value=voice;if(engine==='browser')browserVoice=voice;else workstationVoice=voice;selectedVoice=voice;$('rate').value=record.options?.rate||1;summaryMode?.clearSource();$('text').value=record.text;preview();setMode('read');save();
  if(engine==='browser'){
    let index=record.nativeIndex,offset=record.nativeOffset;
    if(browserOverride&&index==null){
      let base=0;const starts=[];
      for(const status of record.statuses||[]){for(const start of status?.starts||[])starts.push(base+start);base+=status?.duration||0;}
      index=Math.max(0,starts.findLastIndex(start=>start<=(record.position||0)));offset=0;
    }
    browserPlayer.restore(record.chunks||chunks,settings(),{index,offset});
  }
  if(voiceUnavailable)$("voice-settings").open=true;
  return {engine,voice,voiceUnavailable};
 },
 async loadQueued(item){
  const model=inputQueue?.model;if(!model?.has(item.id))return;if(deviceAudio.expiredIntent(item)){model.remove(item.id);throw Error("That reading expired after 24 hours. Add it again if you want to listen.");}if(item.snapshot.libraryScope&&item.snapshot.libraryScope!==deviceAudio.scope)throw Error('The account changed; re-add this reading for the current profile.');model.stop();applyInputSnapshot(item.snapshot);resetReading();$('text').value=item.text;preview();setMode('read');await deviceAudio.rememberCurrent({createdAt:item.createdAt,id:item.id});save();
 },
 async regenerate(record){
  workstationPlayer.longReadings.localRestore=null;sessionStorage.removeItem(record.key);resetReading();$('text').value=record.text;preview();readAndPlay();
 }
});
