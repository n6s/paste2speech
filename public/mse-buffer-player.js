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
    this.fetcher=fetcher;this.audio=audio;this.onChange=onChange;this.events=[];this.serial=0;this.state='idle';this.next=0;this.rate=1;this.wantPlay=false;this.playSequence=0;
    this.capability={mediaSource:!!globalThis.MediaSource,mp3:!!globalThis.MediaSource?.isTypeSupported('audio/mpeg')};
    for(const name of ['loadstart','loadedmetadata','progress','loadeddata','canplay','playing','pause','waiting','stalled','seeking','seeked','ended','error','ratechange'])audio.addEventListener(name,()=>{
      this.log(name);
      if(name==='error'&&this.job&&audio.error)this.mediaFailed();
      if(name==='loadeddata'&&this.mode==='mse'){this.capability.decoded=true;this.log('decode-verified');}
      if(name==='playing')this.syncNativePlaying();
      if(name==='playing'&&this.job&&this.wantPlay&&!audio.paused&&!this.fatal&&!this.mediaRecovery){this.state='playing';clearTimeout(this.connectionBoundaryTimer);this.connectionBoundaryTimer=null;}
      // OS/audio-route pauses bypass our Pause button. Retire playback intent so
      // controls offer Resume and later buffer/status events cannot restart audio.
      // Source setup is preparing; queued pauses after resume see paused=false.
      if(name==='pause')this.syncNativePause();
      if(name==='waiting'&&this.wantPlay){
        if(this.connectionInterrupted&&!this.hasPlayableAudio())this.pauseForConnection();
        else if((this.preparationBlocked()||this.status?.state==='credit-paused')&&this.next===this.status.completed&&this.audio.currentTime >= (this.ranges().at(-1)?.[1]||0)-.25){this.preparationAtBoundary=!!this.preparationBlocked();this.wantPlay=false;this.audio.pause();this.state='paused';}
        else {this.state='buffering';if(this.connectionInterrupted)this.checkConnectionBoundary();}
      }
      if(name==='ended'&&this.job&&audio.ended&&this.finalized){this.state='done';this.wantPlay=false;}
      this.emit();
    });
    audio.addEventListener('timeupdate',()=>{if(this.preparationBlocked()&&this.wantPlay&&this.next===this.status.completed&&audio.currentTime>=this.status.duration-1/24000){this.preparationAtBoundary=true;this.wantPlay=false;audio.pause();this.state='paused';}this.emit();});
    const reconcile=()=>{if(globalThis.document?.hidden||!this.job)return;this.syncNativePause();if(this.wantPlay&&this.audio.readyState<3&&!this.audio.paused)this.state='buffering';this.emit();if(this.connectionInterrupted&&!this.fatal&&!this.mediaRecovery)void this.pump();};window.addEventListener('focus',reconcile);globalThis.document?.addEventListener('visibilitychange',reconcile);
    window.addEventListener('online',()=>{if(this.job&&this.connectionInterrupted&&!this.fatal&&!this.mediaRecovery)void this.pump();});
  }
  syncNativePause(){
    if(!this.job||!this.audio.paused||this.audio.ended||!this.wantPlay||!['playing','buffering'].includes(this.state))return false;
    this.mediaPause={kind:'native',serial:this.serial,job:this.job,src:this.audio.src||'',currentSrc:this.audio.currentSrc||''};
    this.playSequence++;this.wantPlay=false;this.state='paused';
    clearTimeout(this.connectionBoundaryTimer);this.connectionBoundaryTimer=null;
    this.log('playback-interrupted');return true;
  }
  syncNativePlaying(){
    const interrupted=this.mediaPause;
    // A real playing element can be resumed by the browser after audio focus
    // returns. Reconcile only the native interruption of this exact resource;
    // explicit Pause, a new job/source, and stale paused-element events cannot opt in.
    if(!interrupted||!this.job||this.state!=='paused'||this.audio.paused||this.audio.ended||this.audio.error||this.fatal||this.mediaRecovery||this.connectionPaused||this.connectionInterrupted)return false;
    if(interrupted.serial!==this.serial||interrupted.job!==this.job||interrupted.src!==(this.audio.src||'')||interrupted.currentSrc&&this.audio.currentSrc&&interrupted.currentSrc!==this.audio.currentSrc)return false;
    if(interrupted.kind==='user'){this.audio.pause();this.log('explicit-pause-preserved');return false;}
    this.mediaPause=null;this.playSequence++;this.wantPlay=true;
    this.log('playback-resumed-externally');return true;
  }
  ranges(){return Array.from({length:this.audio.buffered.length},(_,i)=>[this.audio.buffered.start(i),this.audio.buffered.end(i)]);}
  log(type,extra={}){
    this.events.push({ms:Math.round(performance.now()-(this.started||performance.now())),type,time:this.audio.currentTime,duration:Number.isFinite(this.audio.duration)?this.audio.duration:null,ranges:this.ranges(),...extra});
    if(this.events.length>12000)this.events.shift();
  }
  emit(){
    this.index=Math.max(0,(this.status?.starts||[]).findLastIndex(t=>t<=(this.mediaRecovery?.time??this.pendingTime??this.audio.currentTime)+1/24000));
    const media=navigator.mediaSession;
    if(this.job&&this.mediaActive&&media){
      media.playbackState=this.wantPlay?'playing':'paused';
      try{const duration=this.status?.duration;if(duration>0)media.setPositionState({duration,playbackRate:this.rate,position:Math.min(duration,this.audio.currentTime)});}catch{}
    }
    this.onChange(this);
  }
  claim(){
    const media=navigator.mediaSession;if(!media)return;this.mediaActive=true;
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
        if(retry&&error.retry!==false&&this.job)this.connectionLost();
        if(!retry||error.retry===false||attempt===3){error.reconnect=retry&&error.retry!==false;throw error;}
        this.log('read-retry',{path,attempt:attempt+1});await sleep(500*2**attempt,signal);
      }
    }
  }
  async start(input,mode='mse',initialIndex=0){
    this.invalidate();this.pendingIndex=initialIndex||null;const serial=this.serial;
    this.controller=new AbortController();this.started=performance.now();this.events=[];this.capability={mediaSource:!!globalThis.MediaSource,mp3:!!globalThis.MediaSource?.isTypeSupported('audio/mpeg')};this.next=0;this.status=null;this.finalized=false;this.windowSeek=null;this.quotaBlockedAt=null;this.mode=mode;this.texts=[];this.error='';this.fatal=false;this.pumping=false;this.wantPlay=true;this.state='preparing';
    this.log('capability',this.capability);this.emit();
    try{
      if(mode==='mse'&&!this.capability.mp3)throw Error('MP3 Media Source Extensions are unavailable. Select the full-preparation comparison.');
      const created=await this.request('/api/readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},false);
      if(serial!==this.serial){void this.fetcher(new URL(`/api/readings/${created.id}`,location.href),{method:'DELETE',keepalive:true}).catch(()=>{});return;}
      this.job=created.id;this.texts=input.chunks;this.claim();
      if(mode==='mse'){
        if(!await this.openSource(serial))return;
      }
      this.setRate(this.rate);void this.pump(serial);
    }catch(error){if(serial===this.serial)this.fail(error);}
  }
  async openSource(serial){
    const source=new MediaSource();this.source=source;this.objectURL=URL.createObjectURL(source);
    const opened=event(source,'sourceopen',this.controller.signal);
    this.audio.src=this.objectURL;this.audio.load();await opened;
    if(serial!==this.serial)return false;
    this.buffer=source.addSourceBuffer('audio/mpeg');this.buffer.mode='sequence';this.capability.sourceBuffer=true;
    this.log('source-created',{mode:this.buffer.mode});return true;
  }
  mediaFailed(){
    const {code,message}=this.audio.error;
    const error=Error(code===2?'Playback connection was interrupted. Tap Resume to reconnect using saved audio.':`Media decoding error ${code}: ${message||''}`);
    if(code===2){
      this.mediaRecovery={time:this.mediaRecovery?.time??this.pendingTime??this.audio.currentTime};error.reconnect=true;
      // Retire the old resource/pump before Resume rebuilds it. Keep the paid job.
      this.serial++;this.controller?.abort(error);this.pumping=false;this.recovering=null;
    }else this.mediaRecovery=null;
    this.fail(error);
  }
  async recoverMedia(){
    if(this.recovering)return this.recovering;
    if(!this.job||!this.mediaRecovery)return;
    const time=this.mediaRecovery.time;
    this.serial++;this.controller?.abort();const serial=this.serial;
    this.controller=new AbortController();this.mediaPause=null;this.playSequence++;this.wantPlay=true;this.preparationAtBoundary=false;this.audio.pause();
    this.audio.removeAttribute('src');this.audio.load();
    if(this.objectURL)URL.revokeObjectURL(this.objectURL);
    this.objectURL=null;this.source=null;this.buffer=null;this.mediaRecovery=null;
    this.mode=this.status?.state==='ready'?'full':this.mode;
    this.next=0;this.finalized=false;this.windowSeek=null;this.quotaBlockedAt=null;this.fatal=false;this.pumping=false;this.error='';
    this.pendingIndex=Math.max(0,(this.status?.starts||[]).findLastIndex(t=>t<=time));this.pendingTime=time;
    this.state='preparing';this.log('media-reconnect',{target:time,mode:this.mode});this.emit();
    const recovery=(async()=>{
      try{
        if(this.mode==='mse'&&!await this.openSource(serial))return;
        if(serial===this.serial)void this.pump(serial);
      }catch(error){if(serial===this.serial)this.fail(error);}
    })();
    this.recovering=recovery;
    try{await recovery;}finally{if(this.recovering===recovery)this.recovering=null;}
  }
  async bufferOperation(operation,signal){
    const local=new AbortController();
    const finished=event(this.buffer,'updateend',AbortSignal.any([signal,local.signal]));
    try{operation();}catch(error){local.abort(error);await finished.catch(()=>{});throw error;}
    await finished;
  }
  async trimBuffer(signal,force=false){
    if(this.pendingTime!=null)return false;
    const end=Math.max(0,this.audio.currentTime-(force?1:this.bufferBehind));
    if(!this.ranges().some(([start])=>start<end-.05))return false;
    await this.bufferOperation(()=>this.buffer.remove(0,end),signal);
    this.log('buffer-trim',{end,force});return true;
  }
  async resetBufferWindow(target,status,signal){
    if(this.ranges().length)await this.bufferOperation(()=>this.buffer.remove(0,Infinity),signal);
    if(this.windowSeek)return; // A newer seek takes priority.
    this.buffer.timestampOffset=status.sections[target.index].start;
    this.next=target.index;this.pendingIndex=target.index;this.pendingTime=target.time;
    this.finalized=false;this.quotaBlockedAt=null;
    this.log('buffer-window-seek',{target:target.time,index:target.index});
  }
  hasPlayableAudio(){return this.ranges().some(([start,end])=>start<=this.audio.currentTime+.05&&end>this.audio.currentTime+.1);}
  checkConnectionBoundary(){
    if(this.connectionBoundaryTimer)return;
    const serial=this.serial,time=this.audio.currentTime;
    // Buffered MP3 ranges can extend past the decoder's playable boundary. A
    // sustained native wait, not that range alone, decides when to offer Resume.
    this.connectionBoundaryTimer=setTimeout(()=>{
      this.connectionBoundaryTimer=null;
      if(serial===this.serial&&this.connectionInterrupted&&this.wantPlay&&this.state==='buffering'&&this.audio.readyState<3&&this.audio.currentTime<=time+.05){this.pauseForConnection();this.emit();}
    },500);
  }
  pauseForConnection(){
    this.autoResumeAfterConnection ||= this.wantPlay;this.mediaPause=null;
    clearTimeout(this.connectionBoundaryTimer);this.connectionBoundaryTimer=null;
    this.playSequence++;this.wantPlay=false;this.connectionPaused=true;this.audio.pause();this.state='disconnected';
    this.error='Connection interrupted. Buffered audio has ended. Playback will resume when the saved audio is available.';
  }
  connectionLost(){
    this.connectionInterrupted=true;
    if(this.wantPlay&&!this.hasPlayableAudio())this.pauseForConnection();
    else this.error=this.wantPlay?'Connection interrupted. Playing buffered audio while preparation checks retry.':'Connection interrupted. Your place is saved; reconnect, then tap Resume.';
    if(this.wantPlay&&this.state==='buffering')this.checkConnectionBoundary();
    this.emit();
  }
  resumeSavedAudio(){
    // A failed metadata check must not hold verified local audio hostage. Keep
    // the connectivity warning, and only restore intent retired by our own wait.
    if(!this.connectionPaused||!this.autoResumeAfterConnection||this.pendingIndex!=null||!this.hasPlayableAudio())return;
    this.connectionPaused=false;this.autoResumeAfterConnection=false;this.wantPlay=true;this.state='buffering';
    this.error='Connection interrupted. Playing saved audio while preparation checks retry.';
    void this.play();
  }
  connectionRestored(){
    if(!this.connectionInterrupted)return;
    this.connectionInterrupted=false;clearTimeout(this.connectionBoundaryTimer);this.connectionBoundaryTimer=null;
    if(this.connectionPaused&&this.autoResumeAfterConnection){this.connectionPaused=false;this.autoResumeAfterConnection=false;this.wantPlay=true;this.state='buffering';this.error='';if(this.mode==='mse'&&this.hasPlayableAudio())void this.play();}
    else if(this.connectionPaused){this.state='paused';this.error='Connection restored. Tap Resume to continue from your saved place.';}
    else this.error='';
  }
  completedAudioURL(){return `/api/readings/${this.job}/audio`;}
  async pump(serial=this.serial){
    if(this.pumping||this.fatal||!this.job)return;
    clearTimeout(this.readRetryTimer);this.readRetryTimer=null;
    this.pumping=true;const signal=this.controller.signal;
    try{
      while(serial===this.serial&&!signal.aborted){
        const status=await this.request(`/api/readings/${this.job}`);
        if(serial!==this.serial)return;
        this.status=status;
        if(status.connectionUnavailable)this.connectionLost();
        if(status.state==='credit-paused'){
          this.error=status.error;
          if(!status.completed||this.mode==='full'){this.wantPlay=false;this.audio.pause();}
          if(!this.wantPlay)this.state='paused';
        }
        this.log('status',{state:status.state,completed:status.completed,total:status.total,starts:status.starts});
        if(this.preparationBlocked()){this.error=(status.error||'Later audio preparation stopped.')+' Available audio is kept. Playback can continue until the missing section; Resume there checks recovery.';}
        else if(['failed','cancelled','expired'].includes(status.state)){
          const message=(status.error||'Preparation interrupted').trim();
          throw Error(status.canResumePreparation?`${message}${/[.!?]$/.test(message)?'':'.'} Tap Resume to check the saved parts.`:'Preparation failed. Partial audio is not a complete reading.');
        }
        if(this.mode==='mse'){
          if(this.boundedBuffer){
            if(this.pendingIndex!=null && status.sections[this.pendingIndex] && this.pendingIndex!==this.next &&
                !this.ranges().some(([a,b])=>a<=status.starts[this.pendingIndex]&&b>status.starts[this.pendingIndex])){
              this.windowSeek??={index:this.pendingIndex,time:this.pendingTime??status.starts[this.pendingIndex]};
            }
            if(this.windowSeek){
              const target=this.windowSeek;this.windowSeek=null;
              await this.resetBufferWindow(target,status,signal);
              if(this.windowSeek)continue;
            }
            await this.trimBuffer(signal);
          }
          while(this.next<status.sections.length){
            const section=status.sections[this.next];
            if(this.boundedBuffer && (this.windowSeek || section.start>(this.pendingTime??this.audio.currentTime)+this.bufferAhead ||
                this.quotaBlockedAt!=null && this.audio.currentTime<this.quotaBlockedAt+1))break;
            const bytes=await this.request(`/api/readings/${this.job}/sections/${this.next}`,{binary:true});
            if(serial!==this.serial)return;
            const info=inspectMp3(new Uint8Array(bytes));
            if(info.samples!==section.samples||info.bytes!==section.bytes)throw Error('Section does not match its declared timeline');
            try{
              await this.bufferOperation(()=>this.buffer.appendBuffer(bytes),signal);
              this.quotaBlockedAt=null;
            }catch(error){
              if(!this.boundedBuffer || error.name!=='QuotaExceededError')throw error;
              this.log('buffer-pressure',{index:this.next});
              this.bufferAhead=Math.max(2,this.bufferAhead/2);
              const trimmed=await this.trimBuffer(signal,true);
              if(trimmed){
                try{await this.bufferOperation(()=>this.buffer.appendBuffer(bytes),signal);this.quotaBlockedAt=null;}
                catch(retry){if(retry.name!=='QuotaExceededError')throw retry;this.quotaBlockedAt=this.audio.currentTime;break;}
              }else if(!this.ranges().some(([a,b])=>b>a)){
                // Even one section cannot fit. Preserve the same job and hand
                // buffering to native completed-file playback, without synthesis.
                this.log('buffer-pressure-file-fallback');this.useCompletedFile();return;
              }else{this.quotaBlockedAt=this.audio.currentTime;break;}
            }
            if(serial!==this.serial||signal.aborted)return;
            this.log('append',{index:this.next,start:section.start,samples:info.samples,bufferTimestampOffset:this.buffer.timestampOffset});
            this.next++;this.emit();
            if(this.next===1)this.log('first-buffer-ready');
            if(this.wantPlay&&this.pendingIndex==null&&this.audio.paused&&this.hasPlayableAudio()&&!this.syncNativePause())void this.play();
          }
          if(this.windowSeek)continue;
          if(status.connectionUnavailable)this.resumeSavedAudio();else this.connectionRestored();
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
          this.connectionRestored();
          const url=await this.completedAudioURL();if(serial!==this.serial)return;
          this.audio.src=url;this.audio.load();
          if(this.objectURL)URL.revokeObjectURL(this.objectURL);this.objectURL=null;this.source=null;this.buffer=null;this.setRate(this.rate);this.finalized=true;
          this.log('complete-file-loaded');if(this.wantPlay&&this.pendingIndex==null)void this.play();this.emit();return;
        }
        this.emit();
        if(status.state==='credit-paused'&&(this.mode==='full'||this.next===status.completed))return;
        await sleep(300,signal);
      }
    }catch(error){if(serial===this.serial){
      if(error.reconnect&&!signal.aborted){
        this.connectionLost();
        this.readRetryTimer=setTimeout(()=>{this.readRetryTimer=null;if(serial===this.serial&&!signal.aborted)void this.pump(serial);},3000);
      }else this.fail(error);
    }}
    finally{if(serial===this.serial){this.pumping=false;if(this.windowSeek&&!signal.aborted)void this.pump();}}
  }
  preparationBlocked(){return this.mode==='mse'&&this.status?.state==='failed'&&this.status.canResumePreparation&&this.status.canContinuePreparedAudio===true&&this.status.completed>0&&this.status.sections?.length>0;}
  fail(error){
    clearTimeout(this.readRetryTimer);this.readRetryTimer=null;
    this.error=error.name==='QuotaExceededError'?'This browser could not buffer the audio. The completed recording remains available.':error.message;
    this.mediaPause=null;this.playSequence++;this.fatal=!error.reconnect;if(this.fatal)this.controller?.abort(error);this.state=error.reconnect?'disconnected':'failed';this.wantPlay=false;this.audio.pause();this.log('failure',{message:this.error,reconnect:!!error.reconnect});this.emit();
  }
  async play(){
    this.mediaPause=null;const serial=this.serial,sequence=++this.playSequence;this.wantPlay=true;
    try{await this.audio.play();if(serial===this.serial&&sequence===this.playSequence&&this.wantPlay&&!this.connectionInterrupted&&this.status?.state!=='credit-paused'&&!this.preparationBlocked())this.error='';}
    catch(error){if(serial===this.serial&&sequence===this.playSequence&&this.wantPlay){this.wantPlay=false;this.state='ready';this.error=error.name==='NotAllowedError'?'Press Play to start':'Audio could not start. Press Play to retry.';this.log('play-blocked',{name:error.name});this.emit();}}
  }
  pause(){this.autoResumeAfterConnection=false;this.mediaPause={kind:'user',serial:this.serial,job:this.job,src:this.audio.src||'',currentSrc:this.audio.currentSrc||''};this.playSequence++;this.wantPlay=false;this.audio.pause();if(this.job)this.state='paused';this.emit();}
  resume(){
    this.mediaPause=null;
    if(this.mediaRecovery)return this.recoverMedia();
    if(!this.job||this.fatal)return;
    this.wantPlay=true;this.connectionPaused=false;
    if(this.audio.ended&&this.finalized){if(this.boundedBuffer&&!this.ranges().some(([a,b])=>a===0&&b>0)){this.seek(0);return;}this.audio.currentTime=0;}
    if(this.state==='disconnected'){this.error='';void this.pump();}
    if((this.next||this.finalized)&&(!this.connectionInterrupted||this.hasPlayableAudio()))void this.play();else{this.state='preparing';this.emit();}
  }
  seek(value){
    const time=Number(value);if(!Number.isFinite(time)||!this.job||this.fatal)return false;
    if(this.mediaRecovery){
      if(time<0||time>=(this.status?.duration||0))return false;
      this.mediaRecovery.time=time;this.pendingTime=time;this.pendingIndex=Math.max(0,this.status.starts.findLastIndex(t=>t<=time));this.emit();return true;
    }
    if(time>=0&&time<(this.status?.duration||0)-.25)this.preparationAtBoundary=false;
    const range=this.mode==='full'&&this.finalized&&time>=0&&time<this.audio.duration||this.ranges().find(([a,b])=>time>=a&&time<b);
    if(!range && this.boundedBuffer && this.mode==='mse' && time>=0 && time<(this.status?.duration||0)){
      const index=this.status.starts.findLastIndex(t=>t<=time);
      this.windowSeek={time,index};this.pendingIndex=index;this.pendingTime=time;this.finalized=false;
      this.state=this.wantPlay?'buffering':'paused';this.log('seek-refill',{target:time});this.emit();void this.pump();return true;
    }
    if(!range){this.log('seek-unavailable',{target:time});return false;}
    this.audio.currentTime=time;this.log('seek-request',{target:time});this.emit();return true;
  }
  setRate(value){this.rate=Math.max(.5,Math.min(2,Number(value)||1));this.audio.playbackRate=this.rate;this.audio.defaultPlaybackRate=this.rate;this.audio.preservesPitch=true;this.emit();}
  invalidate({preserveReady=false,preservePreparation=false}={}){
    this.autoResumeAfterConnection=false;
    clearTimeout(this.readRetryTimer);this.readRetryTimer=null;clearTimeout(this.connectionBoundaryTimer);this.connectionBoundaryTimer=null;this.connectionInterrupted=false;this.connectionPaused=false;
    this.mediaPause=null;this.serial++;this.playSequence++;this.controller?.abort();this.wantPlay=false;this.mediaRecovery=null;this.recovering=null;this.mediaActive=false;this.audio.pause();
    const id=this.job,keep=preservePreparation||preserveReady&&this.status?.state==='ready';this.job=null;this.audio.removeAttribute('src');this.audio.load();
    if(this.objectURL)URL.revokeObjectURL(this.objectURL);
    this.objectURL=null;this.source=null;this.buffer=null;this.status=null;this.texts=[];this.next=0;this.windowSeek=null;this.quotaBlockedAt=null;this.state='idle';this.error='';this.pumping=false;this.fatal=false;this.finalized=false;
    if(id&&!keep)void this.fetcher(new URL(`/api/readings/${id}`,location.href),{method:'DELETE',keepalive:true}).catch(()=>{});
    if(navigator.mediaSession){for(const name of ['play','pause','stop','seekto','seekforward','seekbackward'])try{navigator.mediaSession.setActionHandler(name,null);}catch{}navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';}
    this.emit();
  }
  diagnostics(){return {userAgent:navigator.userAgent,capability:this.capability,mode:this.mode,state:this.state,status:this.status,events:this.events};}
}
