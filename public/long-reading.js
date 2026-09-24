import {splitReadingChunks,joinCaptions} from './playlist-plan.js';
import {PlaylistSession} from './playlist-session.js';

// A tab-local logical reading presents bounded durable jobs as one timeline to
// the existing player. Paid creation stays in PlaylistSession, once per part.
export class LongReadingTransport {
  constructor(fetcher, {rawFetch=(...args)=>fetch(...args), limit=()=>Number(document.getElementById('video-split-limit')?.value)||20000}={}) {
    this.upstream=fetcher || globalThis.fetch.bind(globalThis);this.rawFetch=rawFetch;this.limit=limit;this.groups=new Map();
  }
  async fetch(url, options={}) {
    const path=new URL(url,location.href).pathname;
    if(path==='/api/readings' && options.method==='POST') {
      const input=JSON.parse(options.body);
      if(input.mseOptions?.cached)return this.upstream(url,options);
      const parts=splitReadingChunks(input.chunks,input.paragraphStarts,this.limit());
      if(parts.length<2)return this.upstream(url,options);
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({parts,voice:input.voice}))))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const key='paste2speech.video.'+hash;let records=[];
      try{records=JSON.parse(sessionStorage.getItem(key)||'[]');}catch{}
      const id=crypto.randomUUID(),group={id,key,parts,statuses:[],done:false,error:null,cancelled:false};
      group.session=new PlaylistSession(parts,input.voice,{records,fetcher:this.rawFetch,
        save:records=>sessionStorage.setItem(key,JSON.stringify(records)),
        statusChanged:(index,status)=>{group.statuses[index]=status;}});
      this.groups.set(id,group);
      group.finished=group.session.prepare().then(()=>{group.done=true;},error=>{group.error=error;group.done=true;}).finally(()=>window.dispatchEvent(new Event('speech-credit-change')));
      return Response.json({id});
    }
    const match=path.match(/^\/api\/readings\/([^/]+)(.*)$/),group=match&&this.groups.get(match[1]);
    if(!group)return this.upstream(url,options);
    if(options.method==='DELETE') {
      group.cancelled=true;group.session.stop();await group.finished;
      for(const record of group.session.records)if(record.id) {
        const response=await this.rawFetch(`/api/readings/${record.id}`,{method:'DELETE',signal:AbortSignal.timeout(15000)});
        if(!response.ok&&response.status!==404)return response;
      }
      if(group.audioURL)URL.revokeObjectURL(group.audioURL);
      if(group.captionURL)URL.revokeObjectURL(group.captionURL);
      sessionStorage.removeItem(group.key);return new Response(null,{status:204});
    }
    if(!match[2])return Response.json(this.status(group));
    const section=match[2].match(/^\/sections\/(\d+)$/);
    if(section) {
      let index=Number(section[1]);
      for(let p=0;p<group.parts.length;p++) {
        if(index<group.parts[p].chunks.length) {
          const record=group.session.records[p];
          if(!record.id)return Response.json({detail:'Section not ready'},{status:409});
          return this.upstream(new URL(`/api/readings/${record.id}/sections/${index}`,location.href),options);
        }
        index-=group.parts[p].chunks.length;
      }
    }
    return Response.json({detail:'Unknown logical reading endpoint'},{status:404});
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
    const state=group.cancelled?'cancelled':group.error?'failed':group.done&&sections.length===total?'ready':'preparing';
    return {id:group.id,state,starts,sections,total,completed:sections.length,duration:samples/24000,error:group.error?.message||'',
      providerCost:group.statuses.reduce((n,s)=>n+(s?.providerCost||0),0),costIncomplete:group.statuses.some(s=>s?.costIncomplete)};
  }
  async downloadURL(id,kind) {
    const group=this.groups.get(id);
    if(!group||group.cancelled||this.status(group).state!=='ready')throw Error('The full reading is not ready.');
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
    const group=this.groups.get(id);if(!group)return `/api/readings/${id}/audio`;
    if(this.status(group).state!=='ready')throw Error('The full reading is not ready.');
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
