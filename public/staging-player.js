import {MSE_FIXTURE_VERSION,MSE_STAGING,LONG_READINGS} from './config.js';
import {LongReadingTransport} from './long-reading.js';
import {MsePlayer} from './mse-buffer-player.js';
export class StagingPlayer extends MsePlayer {
 constructor(onChange,{audio=new Audio(),fetcher}={}){
  const transport=LONG_READINGS?new LongReadingTransport(fetcher):null;
  super(audio,p=>{onChange(p,p.error||'');const button=document.getElementById('mse-fallback');if(button)button.hidden=!p.job||p.mode!=='mse';},transport?transport.fetch.bind(transport):fetcher);
  this.longReadings=transport;this.boundedBuffer=LONG_READINGS;this.bufferAhead=90;this.bufferBehind=20;
 }
 diagnostics(){return {...super.diagnostics(),fixtureVersion:this.settings?.cached?MSE_FIXTURE_VERSION:null,simulated:!!this.settings?.cached,configuration:this.settings?{voice:this.settings.voice,concurrency:this.settings.concurrency,cached:this.settings.cached,scenario:this.settings.scenario}:null};}
 get id(){return this.job;}get chunks(){return this.texts||[];}get starts(){return this.status?.starts||[];}
 get duration(){return this.status?.duration||0;}get complete(){return this.status?.state==='ready';}
 get providerCost(){return this.status?.providerCost||0;}get costIncomplete(){return !!this.status?.costIncomplete;}
 matches(chunks,settings){return !!this.job&&settings.voice===this.settings?.voice&&JSON.stringify(chunks)===JSON.stringify(this.chunks)&&settings.cached===this.settings?.cached&&settings.scenario===this.settings?.scenario;}
 async start(chunks,settings,index=0){
  if(this.matches(chunks,settings)){
   this.setRate(settings.rate);this.wantPlay=true;this.pendingIndex=index;this.applyPending();return;
  }
  this.settings={...settings};this.pendingIndex=null;
  this.rate=settings.rate;const delivery=settings.delivery==='mse'&&this.capability.mp3?'mse':'complete';
  await super.start({chunks,voice:settings.voice,provider:'google',...(LONG_READINGS?{paragraphStarts:settings.paragraphStarts}:{}),...(MSE_STAGING?{mseOptions:{delivery,concurrency:settings.concurrency||3,cached:!!settings.cached,scenario:settings.scenario||'normal'}}:{delivery})},delivery==='mse'?'mse':'full',index);
 }
 emit(){
  if(this.pendingIndex!=null&&this.status?.starts[this.pendingIndex]!=null&&this.audio){
   const section=this.status.sections?.[this.pendingIndex];
   const offset=section?Math.min(this.resumeSectionOffset||0,Math.max(0,section.samples/24000-1/24000)):this.resumeSectionOffset||0;
   const target=this.resumeSectionOffset!=null?this.status.starts[this.pendingIndex]+offset:this.pendingTime??this.status.starts[this.pendingIndex];
   if((this.mode==='full'&&this.finalized&&this.audio.readyState>=1)||this.ranges().some(([a,b])=>a<=target&&b>target)){
    this.pendingIndex=null;this.pendingTime=null;this.resumeSectionOffset=null;this.audio.currentTime=target;
    if(this.wantPlay)void this.play();
   }
  }
  super.emit();
 }
 applyPending(){if(this.boundedBuffer&&this.pendingIndex!=null&&this.starts[this.pendingIndex]!=null)this.seek(this.pendingTime??this.starts[this.pendingIndex]);this.emit();}
 async resume(settings=this.settings){
  if(settings&&!this.matches(this.chunks,settings))return this.start(this.chunks,settings,this.index);
  if(settings)this.setRate(settings.rate);
  const group=this.getVideoPreparation();
  if(group?.error){
   if(this.resuming)return;
   this.resuming=true;
   // Credit pauses leave the pump alive while paid audio drains. Retire that
   // loop before starting recovery, without discarding the audio source.
   if(group.error.creditPaused){this.serial++;this.controller.abort();}
   const serial=this.serial,time=this.audio.currentTime,index=this.index;
   const sectionOffset=time-(this.starts[index]||0);
   try{
    const result=await this.longReadings.resume(this.job,{confirmRetry:({part,characters})=>window.confirm(`Retry part ${part}? This will generate up to ${characters.toLocaleString()} characters again and may use credit for speech already generated in that interrupted part. Completed parts will be reused.`)});
    if(serial!==this.serial||!result.resumed)return;
    this.controller=new AbortController();this.fatal=false;this.error='';this.pumping=false;this.finalized=false;
    if(result.replacedFrom!=null&&this.mode==='mse'){
     const cutoff=this.starts[result.replacedFrom]??this.status.duration;
     if(this.buffer.updating)await this.bufferOperation(()=>{},this.controller.signal);
     if(serial!==this.serial)return;
     if(this.ranges().some(([,end])=>end>cutoff))await this.bufferOperation(()=>this.buffer.remove(cutoff,Infinity),this.controller.signal);
     if(serial!==this.serial)return;
     if(this.next>=result.replacedFrom)this.buffer.timestampOffset=cutoff;
     this.next=Math.min(this.next,result.replacedFrom);
     if(index>=result.replacedFrom){this.pendingIndex=index;this.resumeSectionOffset=sectionOffset;this.pendingTime=null;}
     this.status=this.longReadings.status(group);
    }
    this.state='disconnected';
   }catch(error){if(serial===this.serial)this.fail(error);return;}
   finally{this.resuming=false;}
  }
  super.resume();
 }
 sync(){this.emit();}refresh(){if(!this.finalized&&!this.fatal)return this.pump();return Promise.resolve();}
 seekTo(time){return this.seek(time);}
 move(delta){if(!this.chunks.length)return;this.pendingIndex=Math.max(0,Math.min(this.chunks.length-1,this.index+delta));this.applyPending();}
 stop(){if(this.complete&&this.finalized){this.pause();this.seek(0);this.state='idle';this.emit();}else this.invalidate();}
 invalidate(){this.pendingIndex=null;this.pendingTime=null;this.resumeSectionOffset=null;return super.invalidate();}
 release(){if(navigator.mediaSession){for(const name of ['play','pause','stop','seekto','seekforward','seekbackward'])try{navigator.mediaSession.setActionHandler(name,null);}catch{}navigator.mediaSession.playbackState='none';}}
 download(kind){if(this.complete&&this.getVideoPreparation())return '#';return this.complete&&this.job?new URL(`/api/readings/${this.job}/download/${kind}`,location.href).href:null;}
 getVideoPreparation(){return this.longReadings?.groups.get(this.job);}
 completedAudioURL(){return this.longReadings?.audioURL(this.job)||super.completedAudioURL();}
 useCompletedFile(){
  if(!this.job)return;
  const time=this.audio.currentTime,wantPlay=this.wantPlay;this.controller.abort();this.serial++;this.controller=new AbortController();
  this.audio.pause();this.pumping=false;this.fatal=false;this.error='';this.mode='full';this.finalized=false;this.wantPlay=wantPlay;this.state=wantPlay?'preparing':'paused';
  this.pendingIndex=Math.max(0,this.starts.findLastIndex(t=>t<=time));this.pendingTime=time;
  this.log('explicit-full-file-fallback');void this.pump();
 }
}
