import {inspectMp3} from '../cloudflare/prepared/mp3.js';
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(signal.reason);
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  function abort(){clearTimeout(timer);reject(signal.reason);}signal.addEventListener('abort',abort,{once:true});
});
const event=(target,name,signal)=>new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(signal.reason);
  function clear(){target.removeEventListener(name,ok);target.removeEventListener('error',bad);signal.removeEventListener('abort',bad);}
  function ok(){clear();resolve();}function bad(){clear();reject(signal.reason||Error(`Media ${name} failed`));}
  target.addEventListener(name,ok,{once:true});target.addEventListener('error',bad,{once:true});signal.addEventListener('abort',bad,{once:true});
});
export class MsePlayer {
  constructor(audio,onChange=()=>{},fetcher=globalThis.fetch.bind(globalThis)){
    this.fetcher=fetcher;this.audio=audio;this.onChange=onChange;this.events=[];this.serial=0;this.state='idle';this.next=0;this.rate=1;this.wantPlay=false;
    this.capability={mediaSource:!!globalThis.MediaSource,mp3:!!globalThis.MediaSource?.isTypeSupported('audio/mpeg')};
    for(const name of ['loadstart','loadedmetadata','progress','loadeddata','canplay','playing','pause','waiting','stalled','seeking','seeked','ended','error','ratechange'])audio.addEventListener(name,()=>{
      this.log(name);
      if(name==='error'&&this.job)this.fail(Error(`Media decoding error ${audio.error?.code}: ${audio.error?.message||''}`));
      if(name==='loadeddata'&&this.mode==='mse'){this.capability.decoded=true;this.log('decode-verified');}
      if(name==='playing')this.state='playing';
      if(name==='waiting'&&this.wantPlay)this.state='buffering';
      if(name==='ended'&&this.finalized){this.state='done';this.wantPlay=false;}
      this.emit();
    });
    audio.addEventListener('timeupdate',()=>this.emit());
  }
  ranges(){return Array.from({length:this.audio.buffered.length},(_,i)=>[this.audio.buffered.start(i),this.audio.buffered.end(i)]);}
  log(type,extra={}){
    this.events.push({ms:Math.round(performance.now()-(this.started||performance.now())),type,time:this.audio.currentTime,duration:Number.isFinite(this.audio.duration)?this.audio.duration:null,ranges:this.ranges(),...extra});
    if(this.events.length>12000)this.events.shift();
  }
  emit(){
    this.index=Math.max(0,(this.status?.starts||[]).findLastIndex(t=>t<=this.audio.currentTime+1/24000));
    const media=navigator.mediaSession;
    if(this.job&&media){
      media.playbackState=this.wantPlay?'playing':'paused';
      try{const duration=this.status?.duration;if(duration>0)media.setPositionState({duration,playbackRate:this.rate,position:Math.min(duration,this.audio.currentTime)});}catch{}
    }
    this.onChange(this);
  }
  claim(){
    const media=navigator.mediaSession;if(!media)return;
    media.metadata=new MediaMetadata({title:'Reading',artist:'WaveNet'});
    const actions={play:()=>this.resume(),pause:()=>this.pause(),stop:()=>this.stop(),seekto:e=>this.seek(e.seekTime),seekbackward:e=>this.seek(this.audio.currentTime-(e.seekOffset||10)),seekforward:e=>this.seek(this.audio.currentTime+(e.seekOffset||10))};
    for(const [name,fn] of Object.entries(actions))try{media.setActionHandler(name,fn);}catch{}
  }
  async request(path,init={},retry=true){
    const signal=this.controller.signal;
    for(let attempt=0;;attempt++){
      try{
        const response=await this.fetcher(new URL(path,location.href),{...init,signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
        if(!response.ok){const detail=await response.json().catch(()=>null);const error=Error(detail?.detail||`Request ${response.status}`);error.retry=response.status>=500||response.status===409;throw error;}
        // Consume inside the retry boundary; an interrupted body is a read failure too.
        const value=init.binary?await response.arrayBuffer():response.status===204?null:await response.json();
        return value;
      }catch(error){
        if(signal.aborted)throw signal.reason;
        if(!retry||error.retry===false||attempt===3){error.reconnect=retry&&error.retry!==false;throw error;}
        this.log('read-retry',{path,attempt:attempt+1});await sleep(500*2**attempt,signal);
      }
    }
  }
  async start(input,mode='mse',initialIndex=0){
    this.invalidate();this.pendingIndex=initialIndex||null;const serial=this.serial;
    this.controller=new AbortController();this.started=performance.now();this.events=[];this.capability={mediaSource:!!globalThis.MediaSource,mp3:!!globalThis.MediaSource?.isTypeSupported('audio/mpeg')};this.next=0;this.status=null;this.finalized=false;this.mode=mode;this.texts=[];this.error='';this.fatal=false;this.pumping=false;this.wantPlay=true;this.state='preparing';
    this.log('capability',this.capability);this.emit();
    try{
      if(mode==='mse'&&!this.capability.mp3)throw Error('MP3 Media Source Extensions are unavailable. Select the full-preparation comparison.');
      const created=await this.request('/api/readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},false);
      if(serial!==this.serial){void this.fetcher(new URL(`/api/readings/${created.id}`,location.href),{method:'DELETE',keepalive:true}).catch(()=>{});return;}
      this.job=created.id;this.texts=input.chunks;this.claim();
      if(mode==='mse'){
        this.source=new MediaSource();this.objectURL=URL.createObjectURL(this.source);
        const opened=event(this.source,'sourceopen',this.controller.signal);
        this.audio.src=this.objectURL;this.audio.load();await opened;
        this.buffer=this.source.addSourceBuffer('audio/mpeg');this.buffer.mode='sequence';this.capability.sourceBuffer=true;
        this.log('source-created',{mode:this.buffer.mode});
      }
      this.setRate(this.rate);void this.pump(serial);
    }catch(error){if(serial===this.serial)this.fail(error);}
  }
  completedAudioURL(){return `/api/readings/${this.job}/audio`;}
  async pump(serial=this.serial){
    if(this.pumping||this.fatal||!this.job)return;
    this.pumping=true;const signal=this.controller.signal;
    try{
      while(serial===this.serial&&!signal.aborted){
        const status=await this.request(`/api/readings/${this.job}`);
        if(serial!==this.serial)return;
        this.status=status;this.log('status',{state:status.state,completed:status.completed,total:status.total,starts:status.starts});
        if(status.state==='failed')throw Error('Preparation failed. Partial audio is not a complete reading.');
        if(this.mode==='mse'){
          while(this.next<status.sections.length){
            const section=status.sections[this.next];
            const bytes=await this.request(`/api/readings/${this.job}/sections/${this.next}`,{binary:true});
            if(serial!==this.serial)return;
            const info=inspectMp3(new Uint8Array(bytes));
            if(info.samples!==section.samples||info.bytes!==section.bytes)throw Error('Section does not match its declared timeline');
            const appended=event(this.buffer,'updateend',signal);
            try{this.buffer.appendBuffer(bytes);}catch(error){this.controller.abort(error);await appended.catch(()=>{});throw error;}
            await appended;
            this.log('append',{index:this.next,start:section.start,samples:info.samples,bufferTimestampOffset:this.buffer.timestampOffset});
            this.next++;this.emit();
            if(this.next===1){this.log('first-buffer-ready');if(this.wantPlay&&this.pendingIndex==null)void this.play();}
          }
          if(status.state==='ready'&&this.next===status.total){
            this.log('before-end-of-stream',{expectedDuration:status.duration,bufferedEnd:this.ranges().at(-1)?.[1]});
            const bufferedEnd=this.ranges().at(-1)?.[1];
            if(!Number.isFinite(bufferedEnd)||Math.abs(bufferedEnd-status.duration)>1/24000)
              throw Error(`Browser timeline differs from the MP3 frame count (${bufferedEnd} versus ${status.duration} seconds). Save test results; no duration correction was applied.`);
            this.source.duration=status.duration;
            // Setting duration may itself update SourceBuffer state in some engines.
            if(this.buffer.updating)await event(this.buffer,'updateend',signal);
            this.source.endOfStream();this.finalized=true;
            this.log('end-of-stream',{expectedDuration:status.duration});this.emit();return;
          }
        }else if(status.state==='ready'){
          const url=await this.completedAudioURL();if(serial!==this.serial)return;
          this.audio.src=url;this.audio.load();
          if(this.objectURL)URL.revokeObjectURL(this.objectURL);this.objectURL=null;this.source=null;this.buffer=null;this.setRate(this.rate);this.finalized=true;
          this.log('complete-file-loaded');if(this.wantPlay&&this.pendingIndex==null)void this.play();this.emit();return;
        }
        this.emit();await sleep(300,signal);
      }
    }catch(error){if(serial===this.serial)this.fail(error);}
    finally{if(serial===this.serial)this.pumping=false;}
  }
  fail(error){
    this.error=error.name==='QuotaExceededError'?'Browser media buffer is full; this test does not evict audio.':error.message;
    this.fatal=!error.reconnect;if(this.fatal)this.controller?.abort(error);this.state=error.reconnect?'disconnected':'failed';this.wantPlay=false;this.audio.pause();this.log('failure',{message:this.error,reconnect:!!error.reconnect});this.emit();
  }
  async play(){
    const serial=this.serial;this.wantPlay=true;
    try{await this.audio.play();if(serial===this.serial)this.error='';}
    catch(error){if(serial===this.serial&&this.wantPlay){this.wantPlay=false;this.state='ready';this.error='Audio ready — tap Resume to play.';this.log('play-blocked',{name:error.name});this.emit();}}
  }
  pause(){this.wantPlay=false;this.audio.pause();if(this.job)this.state='paused';this.emit();}
  resume(){
    if(!this.job||this.fatal)return;
    this.wantPlay=true;
    if(this.audio.ended&&this.finalized)this.audio.currentTime=0;
    if(this.state==='disconnected'){this.error='';void this.pump();}
    if(this.next||this.finalized)void this.play();else{this.state='preparing';this.emit();}
  }
  seek(value){
    const time=Number(value);if(!Number.isFinite(time)||!this.job||this.fatal)return false;
    const range=this.mode==='full'&&this.finalized&&time>=0&&time<this.audio.duration||this.ranges().find(([a,b])=>time>=a&&time<b);
    if(!range){this.log('seek-unavailable',{target:time});return false;}
    this.audio.currentTime=time;this.log('seek-request',{target:time});this.emit();return true;
  }
  setRate(value){this.rate=Math.max(.5,Math.min(2,Number(value)||1));this.audio.playbackRate=this.rate;this.audio.defaultPlaybackRate=this.rate;this.audio.preservesPitch=true;this.emit();}
  invalidate(){
    this.serial++;this.controller?.abort();this.wantPlay=false;this.audio.pause();
    const id=this.job;this.job=null;this.audio.removeAttribute('src');this.audio.load();
    if(this.objectURL)URL.revokeObjectURL(this.objectURL);
    this.objectURL=null;this.source=null;this.buffer=null;this.status=null;this.texts=[];this.next=0;this.state='idle';this.error='';this.pumping=false;this.fatal=false;this.finalized=false;
    if(id)void this.fetcher(new URL(`/api/readings/${id}`,location.href),{method:'DELETE',keepalive:true}).catch(()=>{});
    if(navigator.mediaSession){for(const name of ['play','pause','stop','seekto','seekforward','seekbackward'])try{navigator.mediaSession.setActionHandler(name,null);}catch{}navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';}
    this.emit();
  }
  diagnostics(){return {userAgent:navigator.userAgent,capability:this.capability,mode:this.mode,state:this.state,status:this.status,events:this.events};}
}
