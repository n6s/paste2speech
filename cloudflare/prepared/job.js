import {inspectMp3, captions} from './mp3.js';
export const MAX_BYTES=32*1024*1024;
export const VOICES=['en-US-Wavenet-F','en-GB-Wavenet-F'];
export function canRetryAuthorization(job){return job.mode==='live'&&job.state==='failed'&&job.attempts===0&&!(job.authorizationRestarts>=1);}
export function validateInput(input){
  if(!input || !VOICES.includes(input.voice) || !Array.isArray(input.chunks) || !input.chunks.length || input.chunks.length>32 ||
     input.chunks.some(t=>typeof t!=='string'||!t.trim()||new TextEncoder().encode(t).length>5000) ||
     input.chunks.reduce((n,t)=>n+t.length,0)>20000)throw Error('Reading exceeds the private preparation limit');
  return {voice:input.voice,chunks:[...input.chunks]};
}
export function newJob(input,owner,id,now=Date.now()){
  const {voice,chunks}=validateInput(input);
  return {id,owner,voice,chunks,mode:input.mode,state:'preparing',created:now,expires:now+86400000,
    submittedCharacters:0,attempts:0,costIncomplete:false,parts:chunks.map(()=>({state:'pending'}))};
}
export function publicStatus(job){
  let samples=0;const starts=[];
  for(const part of job.parts){if(part.state!=='ready')break;starts.push(samples/24000);samples+=part.samples;}
  return {id:job.id,state:job.state,starts,duration:samples/24000,completed:starts.length,total:job.chunks.length,
    providerCost:job.mode==='live'?job.submittedCharacters*4e-6:0,submittedCharacters:job.submittedCharacters,
    attempts:job.attempts,costIncomplete:job.costIncomplete,error:job.error||'',readyMs:job.readyMs,
    speechRules:'google-default',delivery:'complete',mode:job.mode};
}
// Persistent markers precede calls. An interrupted paid attempt is never resent.
export async function prepareJob(job,{save,speech,store,isCancelled,beforeBatch=async()=>{},now=Date.now}){
  if(job.state!=='preparing')return;
  const fail=async message=>{job.state='failed';job.error=message;job.costIncomplete=true;await save(job);};
  if(job.parts.some(p=>p.state==='submitting')){
    await fail('Preparation was interrupted during a speech request. No automatic retry; charges may be incomplete.');return;
  }
  try {
    for(let base=0;base<job.parts.length;base+=3){
      if(isCancelled())return;
      const indices=job.parts.map((p,i)=>i>=base&&i<base+3&&p.state==='pending'?i:-1).filter(i=>i>=0);
      await beforeBatch();if(isCancelled())return;
      for(const index of indices){job.parts[index]={state:'submitting'};job.submittedCharacters+=[...job.chunks[index]].length;job.attempts++;}
      await save(job);if(isCancelled())return;
      const results=await Promise.allSettled(indices.map(async index=>{
        const bytes=await speech(job.chunks[index],job.voice,index);
        const info=inspectMp3(bytes);
        await store.put(`${job.id}/part-${index}`,bytes);
        return {index,state:'ready',samples:info.samples,bytes:info.bytes};
      }));
      let failed=false;
      for(const result of results){if(result.status==='fulfilled'){const {index,...info}=result.value;job.parts[index]=info;}else failed=true;}
      // Successful in-flight work remains chargeable after Stop. Persist it
      // before cancellation can release the unused reservation.
      if(isCancelled()){await save(job);return;}
      if(failed){await fail('Speech preparation failed. No automatic retry; submitted sections may be billable.');return;}
      if(job.parts.reduce((n,p)=>n+(p.bytes||0),0)>MAX_BYTES){await fail('Recording exceeds the private audio limit.');return;}
      await save(job);
    }
    if(isCancelled())return;
    const total=job.parts.reduce((n,p)=>n+p.bytes,0);
    const flat=new Uint8Array(total);let offset=0;
    // This bounded pilot buffers at most 32 MiB. No audio decoding or encoding.
    for(let i=0;i<job.parts.length;i++){
      const part=await store.get(`${job.id}/part-${i}`);if(!part)throw Error('Missing stored section');
      const bytes=new Uint8Array(await part.arrayBuffer());flat.set(bytes,offset);offset+=bytes.length;
    }
    const timeline=publicStatus(job);
    await store.put(`${job.id}/reading.mp3`,flat,{httpMetadata:{contentType:'audio/mpeg'}});
    await store.put(`${job.id}/reading.vtt`,captions(job.chunks,timeline),{httpMetadata:{contentType:'text/vtt'}});
    if(isCancelled())return;
    job.state='ready';job.bytes=total;job.readyMs=now()-job.created;await save(job);
  }catch{if(!isCancelled())await fail('Preparation or storage failed. No automatic retry.');}
}
