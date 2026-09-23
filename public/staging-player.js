import {MSE_FIXTURE_VERSION} from './config.js';
import {MsePlayer} from './mse-buffer-player.js';
export class StagingPlayer extends MsePlayer {
 constructor(onChange,{audio=new Audio(),fetcher}={}){
  super(audio,p=>{onChange(p,p.error||'');const button=document.getElementById('mse-fallback');if(button)button.hidden=!p.job||p.mode!=='mse';},fetcher);
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
  await super.start({chunks,voice:settings.voice,provider:'google',mseOptions:{delivery,concurrency:settings.concurrency||3,cached:!!settings.cached,scenario:settings.scenario||'normal'}},delivery==='mse'?'mse':'full',index);
 }
 emit(){
  if(this.pendingIndex!=null&&this.status?.starts[this.pendingIndex]!=null&&this.audio){
   const target=this.pendingTime??this.status.starts[this.pendingIndex];
   if((this.mode==='full'&&this.finalized&&this.audio.readyState>=1)||this.ranges().some(([a,b])=>a<=target&&b>target)){
    this.pendingIndex=null;this.pendingTime=null;this.audio.currentTime=target;
    if(this.wantPlay)void this.play();
   }
  }
  super.emit();
 }
 applyPending(){this.emit();}
 resume(settings=this.settings){
  if(settings&&!this.matches(this.chunks,settings))return this.start(this.chunks,settings,this.index);
  if(settings)this.setRate(settings.rate);super.resume();
 }
 sync(){this.emit();}refresh(){if(!this.finalized&&!this.fatal)return this.pump();return Promise.resolve();}
 seekTo(time){return this.seek(time);}
 move(delta){if(!this.chunks.length)return;this.pendingIndex=Math.max(0,Math.min(this.chunks.length-1,this.index+delta));this.applyPending();}
 stop(){if(this.complete&&this.finalized){this.pause();this.audio.currentTime=0;this.state='idle';this.emit();}else this.invalidate();}
 invalidate(){this.pendingIndex=null;this.pendingTime=null;return super.invalidate();}
 release(){if(navigator.mediaSession){for(const name of ['play','pause','stop','seekto','seekforward','seekbackward'])try{navigator.mediaSession.setActionHandler(name,null);}catch{}navigator.mediaSession.playbackState='none';}}
 download(kind){return this.complete&&this.job?new URL(`/api/readings/${this.job}/download/${kind}`,location.href).href:null;}
 useCompletedFile(){
  if(!this.job)return;
  const time=this.audio.currentTime,wantPlay=this.wantPlay;this.controller.abort();this.serial++;this.controller=new AbortController();
  this.audio.pause();this.pumping=false;this.fatal=false;this.error='';this.mode='full';this.finalized=false;this.wantPlay=wantPlay;this.state=wantPlay?'preparing':'paused';
  this.pendingIndex=Math.max(0,this.starts.findLastIndex(t=>t<=time));this.pendingTime=time;
  this.log('explicit-full-file-fallback');void this.pump();
 }
}
