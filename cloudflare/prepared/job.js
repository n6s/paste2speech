import {inspectMp3, captions} from './mp3.js';
export const MAX_BYTES=32*1024*1024;
import {WAVENET_VOICE_IDS} from '../../public/wavenet-voices.js';
export const VOICES=WAVENET_VOICE_IDS;
export function canRetryAuthorization(job){return job.mode==='live'&&job.state==='failed'&&job.attempts===0&&!(job.authorizationRestarts>=1);}
export function validateInput(input){
  if(!input || !VOICES.includes(input.voice) || !Array.isArray(input.chunks) || !input.chunks.length || input.chunks.length>10000 ||
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
    speechRules:'google-default',delivery:job.mseOptions?.delivery||'complete',mode:job.mode,
    ...(job.mseOptions?{sections:job.parts.slice(0,starts.length).map((p,index)=>({index,start:starts[index],samples:p.samples,bytes:p.bytes}))}:{})};
}
// Persistent markers precede calls. An interrupted paid attempt is never resent.
export async function prepareJob(job,{save,speech,store,isCancelled,beforeBatch=async()=>{},maxBatches=Infinity,now=Date.now,concurrency=3,publishEach=false,stagingLive=false}){
  if(job.state!=='preparing')return;
  if(![1,3].includes(concurrency))throw Error('Unsupported concurrency');
  if(job.mode==='live'&&!stagingLive&&(concurrency!==3||publishEach))throw Error('Experimental scheduling is cached-only');
  const fail=async message=>{job.state='failed';job.error=message;job.costIncomplete=true;await save(job);};
  if(job.parts.some(p=>p.state==='submitting')){
    await fail('Preparation was interrupted during a speech request. No automatic retry; charges may be incomplete.');return;
  }
  try {
    let batches=0;
    for(let base=0;base<job.parts.length;base+=concurrency){
      if(isCancelled())return;
      const indices=job.parts.map((p,i)=>i>=base&&i<base+concurrency&&p.state==='pending'?i:-1).filter(i=>i>=0);
      if(!indices.length)continue;
      if(batches++>=maxBatches)return;
      await beforeBatch();if(isCancelled())return;
      for(const index of indices){job.parts[index]={state:'submitting'};job.submittedCharacters+=[...job.chunks[index]].length;job.attempts++;}
      await save(job);if(isCancelled())return;
      const results=await Promise.allSettled(indices.map(async index=>{
        const bytes=await speech(job.chunks[index],job.voice,index);
        const info=inspectMp3(bytes);
        await store.put(`${job.id}/part-${index}`,bytes);
        const part={state:'ready',samples:info.samples,bytes:info.bytes};
        if(publishEach){job.parts[index]=part;await save(job);}
        return {index,...part};
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
    // Assemble in bounded groups, persisting progress between alarms. Final read
    // combines at most 100 blocks within the 32 MiB output limit.
    const blockSize=100,blocks=Math.ceil(job.parts.length/blockSize);
    let block=job.assembledBlocks||0,assembled=0;
    while(block<blocks){
      if(assembled++>=maxBatches)return;
      const start=block*blockSize,end=Math.min(start+blockSize,job.parts.length);
      const bytes=new Uint8Array(job.parts.slice(start,end).reduce((n,p)=>n+p.bytes,0));let offset=0;
      // Bounded parallel reads avoid serial storage round trips after synthesis.
      // Promise.all preserves sentence order; this never makes speech requests.
      for(let i=start;i<end;i+=6){
        const batch=await Promise.all(Array.from({length:Math.min(6,end-i)},async(_,n)=>{
          const part=await store.get(`${job.id}/part-${i+n}`);if(!part)throw Error('Missing stored section');
          return new Uint8Array(await part.arrayBuffer());
        }));
        for(const data of batch){bytes.set(data,offset);offset+=data.length;}
      }
      await store.put(`${job.id}/block-${block}`,bytes);
      job.assembledBlocks=++block;await save(job);if(isCancelled())return;
    }
    const flat=new Uint8Array(total);let offset=0;
    for(let i=0;i<blocks;i++){
      const block=await store.get(`${job.id}/block-${i}`);if(!block)throw Error('Missing assembled block');
      const bytes=new Uint8Array(await block.arrayBuffer());flat.set(bytes,offset);offset+=bytes.length;
    }
    const timeline=publicStatus(job);
    await store.put(`${job.id}/reading.mp3`,flat,{httpMetadata:{contentType:'audio/mpeg'}});
    await store.put(`${job.id}/reading.vtt`,captions(job.chunks,timeline),{httpMetadata:{contentType:'text/vtt'}});
    if(isCancelled())return;
    job.state='ready';job.bytes=total;job.readyMs=now()-job.created;await save(job);
  }catch{if(!isCancelled())await fail('Preparation or storage failed. No automatic retry.');}
}
