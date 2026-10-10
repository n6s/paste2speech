import {joinCaptions} from './playlist-plan.js';

// Shared export assembly. On staging, already verified local sections supply
// both audio and captions; existing deployments retain their network path.
export async function loadPreparedMedia(records,{assets,signal,fetcher=fetch,update=()=>{}}={}){
 const blobs=[],tracks=[],durations=[];
 for(let i=0;i<records.length;i++){
  signal?.throwIfAborted();const record=records[i];if(record.state!=='ready')throw Error('Finish preparing every audio part first.');
  update(`Loading audio part ${i+1} of ${records.length}…`);
  if(assets){const part=await assets.part(record,{signal});blobs.push(part.blob);tracks.push(part.vtt);durations.push(part.duration);}
  else{
   const get=async path=>{const response=await fetcher(path,{signal});if(!response.ok)throw Error(`Could not load prepared audio (${response.status}).`);return response;};
   blobs.push(await(await get(`/api/readings/${record.id}/download/mp3`)).blob());tracks.push(await(await get(`/api/readings/${record.id}/download/vtt`)).text());durations.push(record.duration);
  }
 }
 const blob=new Blob(blobs,{type:'audio/mpeg'});return {blob,vtt:joinCaptions(tracks,durations),duration:durations.reduce((n,d)=>n+d,0)};
}
