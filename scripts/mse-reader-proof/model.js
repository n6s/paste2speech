import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
import {publicStatus} from '../../cloudflare/prepared/job.js';
export const SCENARIOS=['normal','out-of-order','stalled','failure','long'];
export function options(input){
  if(!input||Object.keys(input).some(k=>!['voice','concurrency','scenario'].includes(k)) ||
     typeof input.voice!=='string' || !Object.hasOwn(fixtures,input.voice) || ![1,3].includes(input.concurrency) || !SCENARIOS.includes(input.scenario))throw Error('Choose a cached test option');
  return input;
}
export function texts(input){return Array.from({length:input.scenario==='long'?64:8},(_,i)=>fixtures[input.voice][i%8].text);}
export function delayFor(job,index){
  if(job.scenario==='long')return 8000;
  if(job.scenario==='stalled'&&index===1)return 15000;
  if(job.scenario==='out-of-order')return [2800,1500,400][index%3];
  return fixtures[job.voice][index%8].delayMs;
}
export function status(job){
  const s=publicStatus(job);
  return {...s,delivery:'mse',concurrency:job.concurrency,scenario:job.scenario,
    sections:job.parts.slice(0,s.completed).map((p,index)=>({index,samples:p.samples,bytes:p.bytes,start:s.starts[index]}))};
}
