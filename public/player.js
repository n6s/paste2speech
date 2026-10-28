export class Player {
  constructor(synth, Utterance, onChange = () => {}, {trackStart=false}={}) {
    Object.assign(this, { synth, Utterance, onChange, trackStart, starting:false, state: 'idle', chunks: [], index: 0, offset: 0, generation: 0 });
  }
  emit(message = '') { this.onChange(this, message); }
  cancel() { this.starting=false;this.generation++; clearTimeout(this.timer); this.synth.cancel(); this.utterance = null; }
  start(chunks, settings, startIndex = 0) {
    this.cancel(); this.chunks = chunks; this.settings = settings; this.index = Math.max(0, Math.min(chunks.length - 1, Math.trunc(startIndex) || 0)); this.offset = 0;
    this.state = chunks.length ? 'playing' : 'idle';
    if (chunks.length) this.speak(); else this.emit('Paste some readable text first.');
  }
  restore(chunks,settings,{index=0,offset=0}={}) {
    this.cancel();this.chunks=[...chunks];this.settings=settings;
    this.index=Math.max(0,Math.min(chunks.length-1,Math.trunc(index)||0));
    this.offset=Math.max(0,Math.min(chunks[this.index]?.length||0,Math.trunc(offset)||0));
    this.state=chunks.length?'paused':'idle';this.emit();
  }
  speak({continuation=false}={}) {
    const generation = ++this.generation;
    const utterance = new this.Utterance(this.chunks[this.index].slice(this.offset));
    this.utterance = utterance; // Keep a strong reference while speaking.
    utterance.rate = this.settings.rate;
    if (this.settings.voice) { utterance.voice = this.settings.voice; utterance.lang = this.settings.voice.lang; }
    if(this.trackStart&&!continuation)this.starting=true;
    const base = this.offset;
    const valid = () => generation === this.generation && this.state === 'playing';
    if(this.trackStart)utterance.onstart=()=>{if(valid()){this.starting=false;this.emit();}};
    utterance.onboundary = event => { if (valid() && event.name === 'word'){this.offset = base + event.charIndex;if(this.starting){this.starting=false;this.emit();}} };
    utterance.onend = () => {
      if (!valid()) return;
      clearTimeout(this.timer); this.starting=false;this.offset = 0; this.index++;
      if (this.index < this.chunks.length) this.speak({continuation:true});
      else { this.starting=false;this.state = 'done'; this.utterance = null; this.emit(); }
    };
    utterance.onerror = event => { if (valid()) this.fail(event.error === 'not-allowed' ? 'Press Play to start' : `Speech stopped (${event.error || 'voice error'}). Tap Play to retry this part, or choose another voice.`); };
    // Never silently skip a chunk if the engine stalls or emits no end event.
    this.timer = setTimeout(() => { if (valid()) this.fail('The voice stopped responding. Tap Play to retry this part.'); }, Math.max(30000, utterance.text.length * 250 / utterance.rate));
    this.emit();
    try { if (this.synth.paused) this.synth.resume(); this.synth.speak(utterance); } catch { this.fail('This voice could not start. Choose another voice and tap Play.'); }
  }
  fail(message) { this.cancel(); this.state = 'paused'; this.emit(message); }
  pause() { if (this.state !== 'playing') return; this.cancel(); this.state = 'paused'; this.emit(); }
  resume(settings) { if (this.state !== 'paused') return; this.settings = settings; this.state = 'playing'; this.speak(); }
  seekSection(index) {
    if (!this.chunks.length || this.state === 'idle' || !Number.isFinite(index)) return;
    const playing = this.state === 'playing';
    this.cancel();
    this.index = Math.max(0, Math.min(this.chunks.length - 1, Math.trunc(index)));
    this.offset = 0;
    this.state = playing ? 'playing' : 'paused';
    if (playing) this.speak(); else this.emit();
  }
  stop() { this.cancel(); this.state = 'idle'; this.index = 0; this.offset = 0; this.emit(); }
}
