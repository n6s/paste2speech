import {validateInput} from '../prepared/job.js';
import fixtures from '../../scripts/wavenet-worker-proof/fixture.json' with {type:'json'};
export const scenarios=['normal','out-of-order','stalled','failure','long'];
export const mseStaging=env=>env.MSE_STAGING==='1'&&env.PRIVATE_READER==='1'&&env.READER_MODE==='staging';
export const mseProduction=env=>env.PROGRESSIVE_READER==='1'&&env.READER_MODE==='production-trial'&&env.PRIVATE_READER==='0'&&env.LOCAL_READER==='0';
export const progressiveReader=env=>mseStaging(env)||mseProduction(env);
export const fixtureChunks=(voice,scenario='normal')=>Array.from({length:scenario==='long'?64:8},(_,i)=>fixtures[voice][i%8].text);
export function stagingInput(raw,env){
 if(raw?.delivery!==undefined){
  if(!mseProduction(env)||raw.mseOptions||!['mse','complete'].includes(raw.delivery)||['cached','scenario','concurrency'].some(k=>k in raw))throw Error('Playback options are unavailable');
  if(env.MSE_NEW_READINGS==='0'&&raw.delivery==='mse')throw Error('New progressive readings are paused');
  return {...validateInput(raw),mseOptions:{delivery:raw.delivery,concurrency:3,cached:false,scenario:'normal'}};
 }
 if(!raw?.mseOptions)return validateInput(raw);
 if(!mseStaging(env))throw Error('Progressive staging controls are unavailable');
 const o=raw.mseOptions;
 if(Object.keys(o).some(k=>!['delivery','concurrency','cached','scenario'].includes(k))||!['mse','complete'].includes(o.delivery)||![1,3].includes(o.concurrency)||typeof o.cached!=='boolean'||!scenarios.includes(o.scenario)||(!o.cached&&o.scenario!=='normal'))throw Error('Invalid staging playback options');
 if(!Object.hasOwn(fixtures,raw.voice))throw Error('Invalid voice');
 const input=validateInput({...raw,chunks:o.cached?fixtureChunks(raw.voice,o.scenario):raw.chunks});
 if(o.cached&&JSON.stringify(raw.chunks)!==JSON.stringify(input.chunks))throw Error('Load the matching cached sample first');
 if(env.MSE_NEW_READINGS==='0'&&o.delivery==='mse')throw Error('New progressive readings are paused');
 return {...input,mseOptions:{delivery:o.delivery,concurrency:o.concurrency,cached:o.cached,scenario:o.scenario}};
}
export function fixtureDelay(job,index,normal){
 const scenario=job.mseOptions?.scenario;
 if(scenario==='long')return 8000;
 if(scenario==='stalled'&&index===1)return 15000;
 if(scenario==='out-of-order')return [2800,1500,400][index%3];
 return normal;
}
