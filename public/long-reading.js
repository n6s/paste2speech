import {splitReadingChunks,joinCaptions} from './playlist-plan.js';
import {PlaylistSession} from './playlist-session.js';
import {ReadingAssets} from './reading-assets.js';
import {loadPreparedMedia} from './prepared-media.js';

// A tab-local logical reading presents bounded durable jobs as one timeline to
// the existing player. Paid creation stays in PlaylistSession, once per part.
export class LongReadingTransport {
  constructor(fetcher, {rawFetch=(...args)=>fetch(...args), fullAudio=false,limit=()=>Number(document.getElementById('video-split-limit')?.value)||20000}={}) {
    this.upstream=fetcher || globalThis.fetch.bind(globalThis);this.rawFetch=rawFetch;this.limit=limit;this.groups=new Map();this.assets=fullAudio?new ReadingAssets((url,options)=>this.upstream(new URL(url,location.href),options)):null;
  }
  clearSavedReadings() {
    // Clear is synchronous: a reload must not retain IDs awaiting network cleanup.
    this.assets?.clear();
    for(const group of this.groups.values())group.forgotten=true;
    for(let i=sessionStorage.length-1;i>=0;i--){
      const key=sessionStorage.key(i);
      if(key?.startsWith('paste2speech.video.'))sessionStorage.removeItem(key);
    }
  }
  async fetch(url, options={}) {
    const path=new URL(url,location.href).pathname;
    if(path==='/api/readings' && options.method==='POST') {
      const input=JSON.parse(options.body);
      if(input.mseOptions?.cached){const response=await this.upstream(url,options);if(response.ok){const {id}=await response.clone().json();this.assets?.register(id,input.chunks,input.voice);}return response;}
      const parts=splitReadingChunks(input.chunks,input.paragraphStarts,this.limit());

      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({parts,voice:input.voice}))))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const key='paste2speech.video.'+hash;let records=[];
      try{records=JSON.parse(sessionStorage.getItem(key)||'[]');}catch{}
      const id=crypto.randomUUID(),group={id,key,parts,statuses:[],done:false,error:null,cancelled:false};
      group.session=new PlaylistSession(parts,input.voice,{records,fetcher:this.rawFetch,preflight:true,retryStatus:true,
        connectionChanged:error=>{if(!group.cancelled)group.connectionError=error;},
        createOptions:parts.length===1?(input.mseOptions?{mseOptions:input.mseOptions}:{delivery:input.delivery||'complete'}):{delivery:'complete'},
        save:records=>{if(!group.cancelled&&!group.forgotten)sessionStorage.setItem(key,JSON.stringify(records));},
        statusChanged:(index,status)=>{group.statuses[index]=status;if(this.assets){const id=group.session.records[index].id;this.assets.register(id,group.parts[index].chunks,input.voice);this.assets.observe(id,status);}}});
      group.session.assets=this.assets;
      this.groups.set(id,group);
      this.prepare(group);
      return Response.json({id});
    }
    const match=path.match(/^\/api\/readings\/([^/]+)(.*)$/),group=match&&this.groups.get(match[1]);
    if(!group){
      if(this.assets&&match){
        const id=match[1],suffix=match[2],section=suffix.match(/^\/sections\/(\d+)$/);
        if(options.method==='DELETE')this.assets.cancel(id);
        if(section&&this.assets.jobs.get(id)?.status?.sections[Number(section[1])])return this.sectionResponse(id,Number(section[1]),options);
        if(!suffix&&this.assets.complete(id))return Response.json(this.assets.jobs.get(id).status);
        const response=await this.upstream(url,options);if(!suffix&&response.ok)this.assets.observe(id,await response.clone().json());return response;
      }
      return this.upstream(url,options);
    }
    if(options.method==='DELETE') {
      group.cancelled=true;group.session.stop();
      for(const record of group.session.records)if(record.id)this.assets?.cancel(record.id);
      if(!group.forgotten)sessionStorage.removeItem(group.key);
      group.forgotten=true;
      await group.finished;
      for(const record of group.session.records)if(record.id) {
        const response=await this.rawFetch(`/api/readings/${record.id}`,{method:'DELETE',signal:AbortSignal.timeout(15000)});
        if(!response.ok&&response.status!==404)return response;
      }
      if(group.audioURL)URL.revokeObjectURL(group.audioURL);
      if(group.captionURL)URL.revokeObjectURL(group.captionURL);
      return new Response(null,{status:204});
    }
    if(!match[2])return Response.json(this.status(group));
    const section=match[2].match(/^\/sections\/(\d+)$/);
    if(section) {
      let index=Number(section[1]);
      for(let p=0;p<group.parts.length;p++) {
        if(index<group.parts[p].chunks.length) {
          const record=group.session.records[p];
          if(!record.id)return Response.json({detail:'Section not ready'},{status:409});
          return this.sectionResponse(record.id,index,options);
        }
        index-=group.parts[p].chunks.length;
      }
    }
    return Response.json({detail:'Unknown logical reading endpoint'},{status:404});
  }
  async sectionResponse(id,index,options){
    if(!this.assets)return this.upstream(new URL(`/api/readings/${id}/sections/${index}`,location.href),options);
    try{return new Response(await this.assets.section(id,index,{signal:options.signal}),{headers:{'Content-Type':'audio/mpeg'}});}
    catch(error){if(error.invalidAudio)error.retry=false;throw error;}
  }
  offlineInfo(id,total){
    if(!this.assets)return null;
    const group=this.groups.get(id),ids=group?group.session.records.filter(r=>r.id).map(r=>r.id):id?[id]:[];
    return this.assets.info(ids,total);
  }
  prepare(group) {
    group.error=null;group.connectionError=null;group.done=false;
    group.finished=group.session.prepare().then(()=>{group.done=true;},error=>{group.error=error;group.done=true;}).finally(()=>window.dispatchEvent(new Event('speech-credit-change')));
  }
  async resume(id,{confirmRetry=()=>false}={}) {
    const group=this.groups.get(id);
    if(!group||group.cancelled)throw Error('This reading is no longer available.');
    if(group.connectionError)group.session.wakeStatusRetry?.();
    if(group.resuming)return group.resuming;
    group.resuming=(async()=>{
      await group.finished;
      if(group.cancelled)throw Error('This reading was cleared.');
      if(!group.error)return {resumed:true,replacedFrom:null};
      const index=group.session.active||0,record=group.session.records[index];
      let replacedFrom=null;
      if(record.id && !['refused','credit-paused'].includes(record.state)) {
        // A failed GET or lost POST acknowledgement never authorizes new speech.
        const status=await group.session.status(record.id);
        if(group.cancelled)throw Error('This reading was cleared.');
        if(status.state==='failed') {
          const characters=group.parts[index].chunks.reduce((n,text)=>n+[...text].length,0);
          if(!await confirmRetry({part:index+1,characters}))return {resumed:false};
          if(group.cancelled)throw Error('This reading was cleared.');
          // Preserve the old ID for audit; only this confirmed terminal part is replaced.
          group.session.records[index]={previousAttempts:[...(record.previousAttempts||[]),record.id],previousCost:(record.previousCost||0)+(status.providerCost||0),previousCostIncomplete:!!(record.previousCostIncomplete||status.costIncomplete)};
          group.session.persist();
          group.statuses.length=index;
          replacedFrom=group.parts.slice(0,index).reduce((n,part)=>n+part.chunks.length,0);
        }else if(['cancelled','expired'].includes(status.state)) {
          throw Error('This part is no longer available. Completed parts have not been regenerated.');
        }
      }
      if(group.cancelled)throw Error('This reading was cleared.');
      this.prepare(group);
      return {resumed:true,replacedFrom};
    })();
    try{return await group.resuming;}finally{group.resuming=null;}
  }
  status(group) {
    const starts=[],sections=[];let samples=0;
    for(let p=0;p<group.parts.length;p++) {
      const status=group.statuses[p];if(!status)break;
      for(const section of status.sections||[]) {
        const index=sections.length;starts.push(samples/24000);
        sections.push({...section,index,start:samples/24000});samples+=section.samples;
      }
      if(status.state!=='ready')break;
    }
    const total=group.parts.reduce((n,p)=>n+p.chunks.length,0);
    const state=group.cancelled?'cancelled':group.error?.creditPaused?'credit-paused':group.error?'failed':group.done&&sections.length===total?'ready':'preparing';
    return {id:group.id,state,starts,sections,total,completed:sections.length,duration:samples/24000,error:group.error?.message||'',connectionUnavailable:!!group.connectionError,canResumePreparation:!!group.error&&!group.cancelled,
      providerCost:group.statuses.reduce((n,s)=>n+(s?.providerCost||0),0)+group.session.records.reduce((n,r)=>n+(r.previousCost||0),0),costIncomplete:group.statuses.some(s=>s?.costIncomplete)||group.session.records.some(r=>r.previousCostIncomplete)};
  }
  async downloadURL(id,kind) {
    const group=this.groups.get(id);
    if(!group||group.cancelled||this.status(group).state!=='ready')throw Error('The full reading is not ready.');
    if(this.assets){
      if(kind==='mp3')return this.audioURL(id);
      if(kind!=='vtt')throw Error('Unsupported download format.');
      if(!group.captionURL){const {vtt}=await loadPreparedMedia(group.session.records,{assets:this.assets});group.captionURL=URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));}
      return group.captionURL;
    }
    if(group.parts.length===1)return `/api/readings/${group.session.records[0].id}/download/${kind}`;
    if(kind==='mp3')return this.audioURL(id);
    if(kind!=='vtt')throw Error('Unsupported download format.');
    if(!group.captionURL) {
      const files=[];
      for(const record of group.session.records) {
        const response=await this.rawFetch(`/api/readings/${record.id}/download/vtt`,{signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw Error('Could not load the complete captions.');
        files.push(await response.text());
      }
      if(group.cancelled)throw Error('Reading was cleared.');
      group.captionURL=URL.createObjectURL(new Blob([joinCaptions(files,group.session.records.map(r=>r.duration))],{type:'text/vtt'}));
    }
    return group.captionURL;
  }
  async audioURL(id) {
    const group=this.groups.get(id);if(!group)return this.assets?.complete(id)?this.assets.url(id,'mp3'):`/api/readings/${id}/audio`;
    if(this.status(group).state!=='ready')throw Error('The full reading is not ready.');
    if(this.assets){
      if(!group.audioURL)group.audioURL=await this.assets.audioURL(group.session.records);
      return group.audioURL;
    }
    if(group.parts.length===1)return `/api/readings/${group.session.records[0].id}/audio`;
    if(!group.audioURL) {
      const blobs=[];
      for(const record of group.session.records) {
        const response=await this.rawFetch(`/api/readings/${record.id}/download/mp3`,{signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw Error('Could not load the complete reading.');
        blobs.push(await response.blob());
      }
      if(group.cancelled)throw Error('Reading was cleared.');
      group.audioURL=URL.createObjectURL(new Blob(blobs,{type:'audio/mpeg'}));
    }
    return group.audioURL;
  }
}
