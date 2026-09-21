// Playback and highlighting share the recording's original-speed clock.
// Complete delivery waits for the finished, seekable MP3 before loading audio;
// progressive delivery remains available for the workstation path.
export class ProgressivePlayer {
  constructor(onChange = () => {}, {audio = new Audio(), fetcher = globalThis.fetch.bind(globalThis), media = globalThis.navigator?.mediaSession, pollMs = 1000} = {}) {
    Object.assign(this, {onChange, audio, fetcher, media, pollMs, state:'idle', chunks:[], starts:[], index:0, generation:0, duration:0, complete:false, playSequence:0});
    audio.preload = 'auto';
    audio.addEventListener('timeupdate', () => this.sync());
    audio.addEventListener('playing', () => { if(this.id && this.wantPlay){this.state='playing';this.emit();} });
    audio.addEventListener('pause', () => { if(this.id && this.wantPlay && audio.paused && !audio.ended && this.state==='playing'){this.wantPlay=false;this.state='paused';this.emit();} });
    audio.addEventListener('waiting', () => {if(this.id && this.wantPlay){this.state='buffering';this.emit();}});
    audio.addEventListener('ended', () => {
      if(!this.id)return;
      if(this.complete){this.state='done';this.index=this.chunks.length;this.wantPlay=false;this.emit();}
      else {this.state='buffering';this.emit();void this.refresh();}
    });
    audio.addEventListener('error', () => {if(this.id){this.wantPlay=false;this.state='failed';this.emit('Playback was interrupted. Press Resume to reconnect.');}});
    for(const name of ['loadedmetadata','progress','canplay','seeked'])audio.addEventListener(name,()=>this.applyPending());
  }
  endpoint(suffix='') {return new URL(`api/readings${suffix}`,globalThis.location?.href || 'http://localhost/');}
  get completeDelivery() {return this.settings?.delivery==='complete';}
  emit(message='') {
    this.onChange(this,message);
    if(!this.claimed || !this.media)return;
    this.media.playbackState=['playing','buffering'].includes(this.state)?'playing':['paused','ready','preparing'].includes(this.state)?'paused':'none';
    try {
      if(this.duration>0)this.media.setPositionState({duration:this.duration,playbackRate:this.audio.playbackRate,position:Math.max(0,Math.min(this.duration,this.audio.currentTime || 0))});
      else this.media.setPositionState();
    }catch{}
  }
  claim() {
    if(!this.media)return;
    this.claimed=true;
    if(globalThis.MediaMetadata)this.media.metadata=new MediaMetadata({title:'Paste to Speech',artist:'Kokoro'});
    const actions={play:()=>this.resume(this.getSettings?.() || this.settings),pause:()=>this.pause(),stop:()=>this.stop(),
      previoustrack:()=>this.move(-1),nexttrack:()=>this.move(1),seekbackward:()=>this.move(-1),seekforward:()=>this.move(1),seekto:e=>this.seekTo(e.seekTime)};
    for(const [name,handler] of Object.entries(actions)){try{this.media.setActionHandler(name,handler);}catch{}}
  }
  release() {
    if(!this.claimed)return;
    for(const name of ['play','pause','stop','previoustrack','nexttrack','seekbackward','seekforward','seekto']){try{this.media.setActionHandler(name,null);}catch{}}
    this.media.playbackState='none';this.media.metadata=null;try{this.media.setPositionState();}catch{}
    this.claimed=false;
  }
  setRate(rate) {
    this.audio.playbackRate=Math.max(.5,Math.min(2,Number(rate)||1));
    this.audio.defaultPlaybackRate=this.audio.playbackRate;
    this.audio.preservesPitch=true;
    if(this.settings)this.settings.rate=this.audio.playbackRate;
    this.emit();
  }
  matches(chunks,settings) {
    return this.id && !this.serverFailed && (settings.provider||'workstation')===(this.settings?.provider||'workstation') && settings.voice===this.settings?.voice &&
      JSON.stringify(settings.paragraphStarts||[])===JSON.stringify(this.settings?.paragraphStarts||[]) &&
      chunks.length===this.chunks.length && chunks.every((text,i)=>text===this.chunks[i]);
  }
  async start(chunks,settings,startIndex=0) {
    const reuse=this.matches(chunks,settings);
    const deleted = !reuse ? this.invalidate() : null;
    this.chunks=[...chunks];this.settings={...settings,paragraphStarts:[...(settings.paragraphStarts||[])]};
    if(!chunks.length){this.state='idle';this.emit('Paste some readable text first.');return;}
    this.state='preparing';this.playSequence++;this.audio.pause();
    this.pendingTime=null;this.pendingIndex=Math.max(0,Math.min(chunks.length-1,Math.trunc(startIndex)||0));this.index=this.pendingIndex;
    this.wantPlay=true;this.claim();this.setRate(settings.rate);
    if(reuse){this.applyPending();if(this.pendingIndex!==null){this.state='preparing';this.emit();}return;}
    this.state='preparing';this.emit(this.completeDelivery?'Preparing the full reading…':'Preparing the first section…');
    const generation=this.generation;
    this.createController=new AbortController();
    try {
      await deleted;
      if(generation!==this.generation)return;
      const response=await this.fetcher(this.endpoint(),{method:'POST',headers:{'Content-Type':'application/json'},signal:this.createController.signal,
        body:JSON.stringify({chunks:this.chunks,voice:settings.voice,provider:settings.provider||'workstation',paragraphStarts:settings.paragraphStarts||[]})});
      const data=await response.json();
      if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Could not prepare this reading.');
      if(generation!==this.generation){void this.deleteJob(data.id);return;}
      this.id=data.id;this.url=this.endpoint(`/${this.id}/audio`).href;
      if(!this.completeDelivery){this.audio.src=this.url;this.audio.load();}
      this.setRate(settings.rate);
      void this.refresh();
    }catch(error){if(generation===this.generation){this.wantPlay=false;this.state='failed';this.emit(error.name==='AbortError'?'Preparation cancelled.':error.message);}}
  }
  async refresh() {
    if(!this.id || this.polling)return;
    clearTimeout(this.timer);
    const generation=this.generation,id=this.id;
    this.polling=true;
    try {
      const response=await this.fetcher(this.endpoint(`/${id}`),{signal:AbortSignal.timeout(10000)});
      const data=await response.json();
      if(generation!==this.generation)return;
      if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Could not check recording progress.');
      this.starts=data.starts;this.duration=data.duration;this.providerCost=data.providerCost;this.costIncomplete=data.costIncomplete;this.complete=data.state==='ready';
      if(['failed','cancelled'].includes(data.state)){
        this.serverFailed=true;this.wantPlay=false;this.audio.pause();this.state='failed';this.emit(data.error || 'Preparation stopped. Press Play to retry.');return;
      }
      if(this.completeDelivery && this.complete && !this.seekableFile){
        this.seekableFile=true;this.audio.src=this.url+'?complete=1';this.audio.load();this.setRate(this.settings.rate);
      }
      this.applyPending();
      if(this.audio.ended && this.complete && this.pendingIndex===null){this.state='done';this.index=this.chunks.length;this.wantPlay=false;}
      this.sync();
      if(this.completeDelivery && !this.complete && this.wantPlay)this.emit(`Preparing the full reading · ${this.starts.length} of ${this.chunks.length} sections`);
    }catch(error){if(generation===this.generation)this.emit(error.message+(this.completeDelivery && !this.complete?' Checking preparation again shortly.':' Playback can continue with audio already received.'));}
    finally {
      this.polling=false;
      if(this.id && !this.complete && !this.serverFailed)this.timer=setTimeout(()=>void this.refresh(),this.pollMs);
    }
  }
  applyPending() {
    if(this.completeDelivery && (!this.complete || this.audio.readyState<1))return;
    if(this.pendingIndex===null || this.pendingIndex===undefined || this.starts[this.pendingIndex]===undefined)return;
    const target=this.pendingTime ?? this.starts[this.pendingIndex];
    // Buffered seeks are immediate; generated but unbuffered seeks use the native stream.
    const ranges=this.audio.buffered;
    let available=false;
    for(let i=0;i<(ranges?.length||0);i++)if(ranges.start(i)<=target && ranges.end(i)>target)available=true;
    if(!available && this.complete){
      // A live response has no length for range seeking. Once complete, reopen
      // the identical bytes with Content-Length/Range support before this seek.
      if(!this.seekableFile){this.seekableFile=true;this.audio.src=this.url+'?complete=1';this.audio.load();}
      if(this.audio.readyState<1)return;
    }
    // Chrome can seek forward through an arriving MP3 even when its reported
    // buffered ranges stop growing while paused. Let native seeking consume
    // the stream once this section exists, rather than waiting for all sections.
    if(!available && this.audio.readyState<1)return;
    this.audio.currentTime=target;this.index=this.pendingIndex;this.pendingIndex=null;this.pendingTime=null;
    if(this.wantPlay)void this.play();else{this.state='paused';this.emit();}
  }
  sync() {
    if(!this.id || this.state==='idle' || this.state==='done')return;
    if(this.pendingIndex===null)this.index=Math.max(0,this.starts.findLastIndex(start=>start<=this.audio.currentTime + 1/24000));
    this.emit();
  }
  async play() {
    if(this.completeDelivery && !this.complete){this.wantPlay=true;this.state='preparing';this.emit('Preparing the full reading…');return;}
    const generation=this.generation, sequence=++this.playSequence;
    this.wantPlay=true;
    try{await this.audio.play();}
    catch{if(generation===this.generation && sequence===this.playSequence){this.wantPlay=false;this.state='ready';this.emit('Audio ready · tap Play.');}}
  }
  pause() {this.playSequence++;this.wantPlay=false;this.audio.pause();if(this.id || this.state==='preparing'){this.state='paused';this.emit();}}
  resume(settings) {
    if(!this.matches(this.chunks,settings))return this.start(this.chunks,settings,Math.min(this.index,this.chunks.length-1));
    this.claim();this.setRate(settings.rate);this.wantPlay=true;
    if(this.state==='done')return this.start(this.chunks,settings,0);
    if(this.audio.error){this.pendingIndex=Math.min(this.index,this.chunks.length-1);this.audio.src=this.url+(this.seekableFile?'?complete=1':'');this.audio.load();}
    if(this.pendingIndex!==null){this.state='preparing';this.applyPending();this.emit();void this.refresh();}
    else void this.play();
  }
  seekTo(time) {
    if(!this.id || !Number.isFinite(time) || !this.starts.length)return;
    const target=Math.max(0,Math.min(this.duration-.001,time));
    this.pendingIndex=Math.max(0,this.starts.findLastIndex(start=>start<=target));
    this.index=this.pendingIndex;this.pendingTime=target;
    if(this.wantPlay)this.state='preparing';
    this.playSequence++;this.audio.pause();this.applyPending();this.emit();
  }
  move(delta) {
    if(!this.chunks.length)return;
    const index=Math.max(0,Math.min(this.chunks.length-1,this.index+delta));
    this.wantPlay=this.wantPlay || this.state==='done';
    if(this.wantPlay)this.state='preparing';
    this.playSequence++;this.audio.pause();this.pendingTime=null;this.pendingIndex=index;this.index=index;
    this.applyPending();this.emit();
  }
  stop() {
    if(!this.complete){const chunks=this.chunks,settings=this.settings;this.invalidate();this.chunks=chunks;this.settings=settings;return;}
    this.wantPlay=false;this.audio.pause();this.pendingIndex=null;this.audio.currentTime=0;this.index=0;this.state='idle';this.emit();
  }
  async deleteJob(id) {if(id)try{await this.fetcher(this.endpoint(`/${id}`),{method:'DELETE',keepalive:true});}catch{}}
  invalidate() {
    this.generation++;clearTimeout(this.timer);this.createController?.abort();this.wantPlay=false;
    this.audio.pause();const deleted=this.id?this.deleteJob(this.id):(this.deleting||Promise.resolve());this.deleting=deleted;this.id=null;this.url=null;this.audio.removeAttribute('src');this.audio.load();
    this.pendingIndex=null;this.starts=[];this.chunks=[];this.duration=0;this.index=0;this.providerCost=0;this.costIncomplete=false;this.complete=false;this.seekableFile=false;this.serverFailed=false;this.state='idle';
    this.release();this.emit();return deleted;
  }
  download(kind) {return this.complete && this.id?this.endpoint(`/${this.id}/download/${kind}`).href:null;}
}
