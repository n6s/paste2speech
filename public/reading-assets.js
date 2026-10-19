import {checkAudioResponse} from './prepared-response.js';
import {inspectMp3,captions} from '../cloudflare/prepared/mp3.js';

const waitFor=(promise,signal)=>{
 if(!signal)return promise;
 if(signal.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
  promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
};

// One bounded, tab-local copy of verified source audio. Decoder buffers and
// exports consume this store; no synthesis/credit endpoint is used here.
export class ReadingAssets {
 constructor(fetcher,{concurrency=3,maxBytes=64*1024*1024,onChange=()=>{}}={}){
  this.fetcher=fetcher;this.concurrency=concurrency;this.maxBytes=maxBytes;this.onChange=onChange;
  this.jobs=new Map();this.queue=[];this.active=0;this.bytes=0;this.reserved=0;
  this.online=()=>{for(const job of this.jobs.values()){clearTimeout(job.retry);job.retry=null;this.prefetch(job);}};globalThis.window?.addEventListener('online',this.online);
 }
 register(id,chunks,voice){
  if(this.jobs.has(id)){const existing=this.jobs.get(id);if(existing.voice!==voice||JSON.stringify(existing.chunks)!==JSON.stringify(chunks))throw Error('Saved audio identity does not match the current text and voice.');return existing;}
  const job={id,chunks:[...chunks],voice,data:new Map(),pending:new Map(),controller:new AbortController(),status:null,urls:new Map()};
  this.jobs.set(id,job);return job;
 }
 observe(id,status){
  const job=this.jobs.get(id);if(!job)return;
  const sections=status.sections||[];
  if(sections.length>job.chunks.length||sections.some((s,i)=>s.index!==i||!Number.isSafeInteger(s.bytes)||s.bytes<=0||!Number.isSafeInteger(s.samples)||s.samples<=0||!Number.isFinite(s.start))){
   job.error='Audio timing could not be verified. Offline listening is not ready.';job.invalid=true;this.onChange();return;
  }
  for(const [index,entry] of job.data){const section=sections[index];if(!section||section.bytes!==entry.bytes||section.samples!==entry.samples||section.sha256&&section.sha256!==entry.sha256){this.evict(id,index);}}
  let expected=0;
  if(sections.some((section,index)=>{const valid=Math.abs(section.start-expected)<1/24000&&Math.abs((status.starts?.[index]??NaN)-expected)<1/24000;expected+=section.samples/24000;return !valid;})||sections.length&&Math.abs(status.duration-expected)>1/24000){job.invalid=true;job.error='Audio timing could not be verified. Offline listening is not ready.';this.onChange();return;}
  job.status=status;job.terminal=['failed','cancelled','expired'].includes(status.state);
  if(!job.terminal&&!job.invalid)this.prefetch(job);this.onChange();
 }
 prefetch(job){
  if(job.controller.signal.aborted||job.terminal||job.invalid||job.accessBlocked||job.storageBlocked)return;
  if([...this.jobs.values()].reduce((n,j)=>n+(j.status?.sections||[]).reduce((a,s)=>a+s.bytes,0),0)>this.maxBytes){job.storageBlocked=true;job.error='This reading is too large to keep in this tab. Playback can continue, but offline listening is not ready.';this.onChange();return;}
  for(const section of job.status?.sections||[])if(!job.data.has(section.index)&&!job.pending.has(section.index)){
   void this.section(job.id,section.index).catch(error=>{
    if(job.controller.signal.aborted)return;
    if(error.storageLimit){job.storageBlocked=true;job.error='This reading is too large to keep in this tab. Playback can continue, but offline listening is not ready.';}
    else if(error.authRequired||error.audioUnavailable){job.accessBlocked=true;job.error=error.message;}
    else if(error.invalidAudio){job.invalid=true;job.error='Downloaded audio could not be verified. Offline listening is not ready.';}
    else{job.error='Download interrupted. Saved audio is kept; downloading will retry when connected.';if(!job.retry)job.retry=setTimeout(()=>{job.retry=null;this.prefetch(job);},3000);}
    this.onChange();
   });
  }
 }
 drain(){
  while(this.active<this.concurrency&&this.queue.length){
   const task=this.queue.shift();this.active++;
   task.run().then(task.resolve,task.reject).finally(()=>{this.active--;this.drain();});
  }
 }
 async section(id,index,{signal}={}){
  signal?.throwIfAborted();
  const job=this.jobs.get(id),meta=job?.status?.sections[index];
  if(!job||!meta||job.controller.signal.aborted)throw Error('Saved audio section is unavailable.');
  if(job.data.has(index)){if(meta.sha256&&job.data.get(index).sha256!==meta.sha256)this.evict(id,index);else return job.data.get(index).blob;}
  let pending=job.pending.get(index);
  if(!pending){
   pending=new Promise((resolve,reject)=>{this.queue.push({resolve,reject,run:async()=>{
    if(job.controller.signal.aborted)throw job.controller.signal.reason;
    const retain=this.bytes+this.reserved+meta.bytes<=this.maxBytes;
    if(!retain){job.storageBlocked=true;job.error='This reading is too large to keep in this tab. Playback can continue, but offline listening is not ready.';this.onChange();}
    if(retain)this.reserved+=meta.bytes;
    try{
     const response=await this.fetcher(`/api/readings/${id}/sections/${index}`,{signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(10000)])});
     await checkAudioResponse(response);
     const bytes=new Uint8Array(await response.arrayBuffer());let info;
     try{info=inspectMp3(bytes);}catch(error){error.invalidAudio=true;throw error;}
     const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
     if(info.bytes!==meta.bytes||info.samples!==meta.samples||meta.sha256&&meta.sha256!==digest){const error=Error('Downloaded section does not match its declared audio.');error.invalidAudio=true;throw error;}
     if(job.controller.signal.aborted)throw job.controller.signal.reason;
     const blob=new Blob([bytes],{type:'audio/mpeg'});
     if(retain){job.accessBlocked=false;job.data.set(index,{blob,bytes:info.bytes,samples:info.samples,sha256:digest});this.bytes+=info.bytes;if(!job.invalid&&!job.terminal)job.error='';this.revoke(job);this.onChange();}
     return blob;
    }finally{if(retain)this.reserved-=meta.bytes;}
   }});});
   job.pending.set(index,pending);pending.finally(()=>{if(job.pending.get(index)===pending)job.pending.delete(index);}).catch(()=>{});this.drain();
  }
  const blob=await waitFor(pending,signal);if(meta.sha256&&job.data.get(index)?.sha256!==meta.sha256){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==meta.sha256){const error=Error('Downloaded section does not match its verified digest.');error.invalidAudio=true;throw error;}}return blob;
 }
 complete(id){
  const job=this.jobs.get(id),status=job?.status;
  return !!job&&!job.invalid&&!job.terminal&&!job.storageBlocked&&status?.state==='ready'&&status.total===job.chunks.length&&status.completed===status.total&&status.sections.length===status.total&&status.starts?.length===status.total&&status.sections.every((s,i)=>job.data.get(i)?.samples===s.samples&&job.data.get(i)?.bytes===s.bytes&&(!s.sha256||job.data.get(i)?.sha256===s.sha256));
 }
 info(ids,total){
  const jobs=ids.map(id=>this.jobs.get(id)),downloaded=jobs.reduce((n,j)=>n+(j?.data.size||0),0);
  return {ready:ids.length>0&&jobs.every(j=>j&&this.complete(j.id))&&downloaded===total,downloaded,total,bytes:this.bytes,error:jobs.find(j=>j?.error)?.error||'',retention:'this tab'};
 }
 async part(record,{signal}={}){
  const job=this.jobs.get(record.id);if(!job?.status||job.status.state!=='ready')throw Error('Finish preparing this audio part first.');
  const blobs=await Promise.all(job.status.sections.map(s=>this.section(record.id,s.index,{signal})));
  if(job.invalid||job.terminal)throw Error(job.error||'The complete recording could not be verified.');
  return {blob:new Blob(blobs,{type:'audio/mpeg'}),vtt:captions(job.chunks,job.status),duration:job.status.duration};
 }
 async audioURL(records,{signal}={}){
  const parts=await Promise.all(records.map(r=>this.part(r,{signal})));return URL.createObjectURL(new Blob(parts.map(p=>p.blob),{type:'audio/mpeg'}));
 }
 url(id,kind){
  const job=this.jobs.get(id);if(!this.complete(id))return null;
  if(!job.urls.has(kind)){const blob=kind==='vtt'?new Blob([captions(job.chunks,job.status)],{type:'text/vtt'}):new Blob(job.status.sections.map(s=>job.data.get(s.index).blob),{type:'audio/mpeg'});job.urls.set(kind,URL.createObjectURL(blob));}
  return job.urls.get(kind);
 }
 revoke(job){for(const url of job.urls.values())URL.revokeObjectURL(url);job.urls.clear();}
 evict(id,index){const job=this.jobs.get(id),entry=job?.data.get(index);if(!entry)return;job.data.delete(index);this.bytes-=entry.bytes;this.revoke(job);this.onChange();}
 cancel(id){const job=this.jobs.get(id);if(!job)return;job.controller.abort();clearTimeout(job.retry);this.revoke(job);for(const entry of job.data.values())this.bytes-=entry.bytes;job.data.clear();this.jobs.delete(id);this.onChange();}
 clear(){for(const id of [...this.jobs.keys()])this.cancel(id);}
 dispose(){this.clear();globalThis.window?.removeEventListener('online',this.online);}
}
