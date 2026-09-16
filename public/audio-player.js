// Prepared audio stays in memory; the browser owns continuous media playback.
export const MAX_PCM_BYTES = 256 * 1024 * 1024;
export function parseWav(bytes) {
  const view = new DataView(bytes);
  const tag = offset => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Invalid workstation audio.');
  let format, pcm;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > bytes.byteLength) throw new Error('Incomplete workstation audio.');
    if (tag(offset) === 'fmt ' && size >= 16) {
      format = Array.from(new Uint8Array(bytes, start, 16));
      if (view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 || view.getUint32(start + 4, true) !== 24000 || view.getUint32(start + 8, true) !== 48000 || view.getUint16(start + 12, true) !== 2 || view.getUint16(start + 14, true) !== 16) throw new Error('Unsupported workstation audio format.');
    }
    if (tag(offset) === 'data') pcm = new Uint8Array(bytes, start, size);
    offset = start + size + (size % 2);
  }
  if (!format || !pcm?.length || pcm.length % 2) throw new Error('Invalid workstation audio data.');
  return { format, pcm };
}
export function assembleWav(parts, size) {
  const header = new ArrayBuffer(44), view = new DataView(header);
  const tag = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, size + 36, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, size, true);
  return new Blob([header, ...parts], {type: 'audio/wav'});
}
export class AudioPlayer {
  constructor(onChange = () => {}, { audio = new Audio(), fetcher = globalThis.fetch.bind(globalThis), urls = URL, media = globalThis.navigator?.mediaSession, maxBytes = MAX_PCM_BYTES } = {}) {
    Object.assign(this, {onChange, audio, fetcher, urls, media, maxBytes, state: 'idle', chunks: [], index: 0, generation: 0, parts: [], starts: [], bytes: 0});
    audio.preload = 'auto';
    audio.addEventListener('timeupdate', () => this.sync());
    audio.addEventListener('play', () => { if (this.url) { this.state = 'playing'; this.emit(); } });
    audio.addEventListener('pause', () => { if (this.state === 'playing' && !audio.ended) { this.state = 'paused'; this.sync(); } });
    audio.addEventListener('ended', () => { if (this.url) { this.index = this.chunks.length; this.state = 'done'; this.emit(); } });
    audio.addEventListener('error', () => { if (this.url) { this.state = 'paused'; this.emit('Audio could not play. Tap Play to retry.'); } });
  }
  emit(message = '') {
    this.onChange(this, message);
    if (!this.media || !this.claimed) return;
    this.media.playbackState = this.state === 'playing' ? 'playing' : ['paused', 'ready'].includes(this.state) ? 'paused' : 'none';
    try {
      if (this.url && this.duration > 0) this.media.setPositionState({duration: this.duration, playbackRate: 1, position: Math.min(this.duration, Math.max(0, this.audio.currentTime))});
      else this.media.setPositionState();
    } catch {}
  }
  claim() {
    if (!this.media) return;
    this.claimed = true;
    if (globalThis.MediaMetadata) this.media.metadata = new MediaMetadata({title: 'Paste to Speech'});
    for (const [action, handler] of Object.entries({play: () => this.resume(this.getSettings?.() || this.settings), pause: () => this.pause(), stop: () => this.stop(), seekbackward: () => this.seekBy(-15), seekforward: () => this.seekBy(15), seekto: event => this.seekTo(event.seekTime)})) {
      try { this.media.setActionHandler(action, handler); } catch {}
    }
  }
  release() {
    if (!this.claimed) return;
    this.media.playbackState = 'none'; this.media.metadata = null;
    try { this.media.setPositionState(); } catch {}
    for (const action of ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto']) { try { this.media.setActionHandler(action, null); } catch {} }
    this.claimed = false;
  }
  sync() {
    if (!this.url || this.state === 'idle' || this.state === 'done') return;
    this.index = Math.max(0, this.starts.findLastIndex(start => start <= this.audio.currentTime));
    this.emit();
  }
  seekTo(time) { if (this.url && Number.isFinite(time)) { this.audio.currentTime = Math.max(0, Math.min(this.duration, time)); this.sync(); } }
  seekBy(seconds) { this.seekTo(this.audio.currentTime + seconds); }
  interrupt() { this.generation++; this.controller?.abort(); this.controller = null; this.audio.pause(); }
  invalidate() {
    this.stop();
    if (this.url) this.urls.revokeObjectURL(this.url);
    this.url = null; this.audio.removeAttribute('src'); this.audio.load();
    this.parts = []; this.starts = []; this.bytes = 0; this.format = null; this.duration = 0; this.chunks = [];
    this.release();
  }
  start(chunks, settings, startIndex = 0) {
    const same = this.settings?.voice === settings.voice && this.settings?.rate === settings.rate && chunks.length === this.chunks.length && chunks.every((text, i) => text === this.chunks[i]);
    if (!same) this.invalidate(); else this.interrupt();
    this.chunks = [...chunks]; this.settings = {...settings};
    this.index = Math.max(0, Math.min(chunks.length - 1, Math.trunc(startIndex) || 0));
    if (!chunks.length) { this.state = 'idle'; return this.emit('Paste some readable text first.'); }
    this.claim();
    if (this.url) { this.audio.currentTime = this.starts[this.index]; this.play(); }
    else this.prepare();
  }
  async request(text, signal) {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(new URL('api/speech', globalThis.location?.href || 'http://localhost/'), {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal,
        body: JSON.stringify({text, voice: this.settings.voice, speed: this.settings.rate}),
      });
      if (response.status === 503 && attempt < 5) {
        await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 700);
          if (signal.aborted) abort(); else signal.addEventListener('abort', abort, {once: true});
        });
        continue;
      }
      if (!response.ok) throw new Error('Workstation speech is unavailable. Tap Play to retry.');
      return parseWav(await response.arrayBuffer());
    }
  }
  async prepare() {
    const generation = this.generation;
    this.state = 'preparing';
    try {
      while (this.parts.length < this.chunks.length) {
        this.emit(`Preparing audio · ${this.parts.length} of ${this.chunks.length} parts`);
        const controller = new AbortController(); this.controller = controller;
        const timer = setTimeout(() => controller.abort(), 60000);
        let part;
        try { part = await this.request(this.chunks[this.parts.length], controller.signal); }
        finally { clearTimeout(timer); }
        if (generation !== this.generation) return;
        if (this.bytes + part.pcm.length > this.maxBytes) throw new Error('This reading exceeds the audio limit. Split it into smaller readings.');
        if (this.format && this.format.join() !== part.format.join()) throw new Error('Workstation audio formats do not match.');
        this.format = part.format; this.starts.push(this.bytes / 48000);
        this.parts.push(part.pcm); this.bytes += part.pcm.length;
      }
      if (generation !== this.generation) return;
      this.duration = this.bytes / 48000;
      this.url = this.urls.createObjectURL(assembleWav(this.parts, this.bytes)); this.parts = [];
      this.audio.src = this.url; this.audio.currentTime = this.starts[this.index];
      this.state = 'ready'; this.emit('Audio ready · tap Play.'); this.play();
    } catch (error) {
      if (generation !== this.generation) return;
      this.state = 'failed'; this.emit(error.name === 'AbortError' ? 'Speech took too long. Tap Play to retry.' : error.message);
    }
  }
  async play() {
    const generation = this.generation;
    try { await this.audio.play(); }
    catch { if (generation === this.generation) { this.state = 'ready'; this.emit('Audio ready · tap Play.'); } }
  }
  pause() {
    if (this.state === 'preparing') { this.interrupt(); this.state = 'paused'; this.emit(); }
    else if (this.state === 'playing') { this.audio.pause(); this.state = 'paused'; this.sync(); }
  }
  resume(settings) {
    if (this.state === 'playing' || this.state === 'preparing') return;
    if (settings.voice !== this.settings?.voice || settings.rate !== this.settings?.rate) return this.start(this.chunks, settings, Math.min(this.index, this.chunks.length - 1));
    this.claim();
    if (this.url) { if (this.state === 'done') this.audio.currentTime = 0; this.play(); }
    else { this.generation++; this.prepare(); }
  }
  stop() { this.interrupt(); this.state = 'idle'; this.index = 0; if (this.url) this.audio.currentTime = 0; this.emit(); }
}
