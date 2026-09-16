// Browser audio playback for workstation-generated speech. Only one chunk ahead is buffered.
export class AudioPlayer {
  constructor(onChange = () => {}, { Context = globalThis.AudioContext || globalThis.webkitAudioContext, fetcher = globalThis.fetch.bind(globalThis) } = {}) {
    Object.assign(this, { onChange, Context, fetcher, state: 'idle', chunks: [], index: 0, generation: 0, offset: 0, pending: new Map() });
  }
  emit(message = '') { this.onChange(this, message); }
  unlock() {
    this.context ||= new this.Context();
    // Called directly from the tap handler so mobile audio can be unlocked.
    return this.context.resume();
  }
  cancel() {
    this.generation++;
    if (this.source) { this.source.onended = null; this.source.stop(); this.source = null; }
    for (const entry of this.pending.values()) entry.controller.abort();
    this.pending.clear();
    this.buffer = null;
  }
  start(chunks, settings, startIndex = 0) {
    this.cancel(); this.chunks = chunks; this.settings = settings;
    this.index = Math.max(0, Math.min(chunks.length - 1, startIndex)); this.offset = 0;
    this.state = chunks.length ? 'playing' : 'idle';
    if (!chunks.length) return this.emit('Paste some readable text first.');
    const generation = this.generation;
    this.unlock().then(() => { if (generation === this.generation && this.state === 'playing') this.speak(); })
      .catch(() => { if (generation === this.generation) this.fail('Audio could not start. Tap Play to try again.'); });
    this.emit('Preparing workstation voice…');
  }
  getAudio(index) {
    if (!this.pending.has(index)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const request = () => this.fetcher(new URL('api/speech', globalThis.location?.href || 'http://localhost/'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ text: this.chunks[index], voice: this.settings.voice, speed: this.settings.rate }),
      });
      const fetchWithRetry = async () => {
        // A seek can arrive while the cancelled request is finishing on the workstation.
        for (let attempt = 0; ; attempt++) {
          const response = await request();
          if (response.status !== 503 || attempt >= 5) return response;
          await new Promise((resolve, reject) => {
            const abort = () => { clearTimeout(delay); reject(new DOMException('Aborted', 'AbortError')); };
            const delay = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 700);
            if (controller.signal.aborted) abort();
            else controller.signal.addEventListener('abort', abort, {once:true});
          });
        }
      };
      const promise = fetchWithRetry().then(async response => {
        if (!response.ok) throw new Error(response.status === 503 ? 'The workstation is busy. Tap Play to retry.' : 'Workstation speech is unavailable. Retry or choose Browser voices.');
        return this.context.decodeAudioData(await response.arrayBuffer());
      }).catch(error => { throw new Error(error.name === 'AbortError' ? 'Speech took too long. Tap Play to retry.' : error.message); })
        .finally(() => clearTimeout(timer));
      promise.catch(() => {}); // A failed prefetch is reported only if that chunk is reached.
      this.pending.set(index, { controller, promise });
    }
    return this.pending.get(index).promise;
  }
  async speak() {
    const generation = this.generation;
    this.emit('Preparing workstation voice…');
    try {
      const buffer = this.buffer || await this.getAudio(this.index);
      if (generation !== this.generation || this.state !== 'playing') return;
      this.buffer = buffer;
      const source = this.context.createBufferSource();
      source.buffer = buffer; source.connect(this.context.destination);
      this.source = source; this.startedAt = this.context.currentTime;
      source.onended = () => {
        if (generation !== this.generation || this.state !== 'playing') return;
        this.source = null; this.buffer = null; this.offset = 0;
        this.pending.delete(this.index++);
        if (this.index < this.chunks.length) this.speak();
        else { this.state = 'done'; this.emit(); }
      };
      source.start(0, Math.min(this.offset, buffer.duration));
      this.emit();
      if (this.index + 1 < this.chunks.length) this.getAudio(this.index + 1);
    } catch (error) { if (generation === this.generation && this.state === 'playing') this.fail(error.message); }
  }
  pause() {
    if (this.state !== 'playing') return;
    this.generation++; // Invalidate an in-flight speak() without discarding its buffered result.
    if (this.source) {
      this.offset += this.context.currentTime - this.startedAt;
      this.source.onended = null; this.source.stop(); this.source = null;
    }
    this.state = 'paused'; this.emit();
  }
  resume(settings) {
    if (this.state !== 'paused') return;
    if (settings.voice !== this.settings.voice || settings.rate !== this.settings.rate) { this.cancel(); this.offset = 0; }
    this.settings = settings; this.state = 'playing';
    const generation = this.generation;
    this.unlock().then(() => { if (generation === this.generation && this.state === 'playing') this.speak(); })
      .catch(() => { if (generation === this.generation) this.fail('Audio could not resume. Tap Play to retry.'); });
  }
  fail(message) { this.cancel(); this.offset = 0; this.state = 'paused'; this.emit(message); }
  stop() { this.cancel(); this.index = 0; this.offset = 0; this.state = 'idle'; this.emit(); }
}
