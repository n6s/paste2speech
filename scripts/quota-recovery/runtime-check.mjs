import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const source=`
import {PreparedReading} from './cloudflare/prepared/durable.js';
export class TestReading extends PreparedReading {
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/seed'){const job=await request.json();await this.ctx.storage.put('job',job);this.loaded=false;return Response.json({ok:true});}
  if(path==='/tick'){
   const body=await request.json();const original=Date.now;Date.now=()=>body.now;
   try{await this.alarm();return Response.json({job:await this.ctx.storage.get('job'),recovery:await this.ctx.storage.get('recovery'),alarm:await this.ctx.storage.getAlarm()});}finally{Date.now=original;}
  }
  return super.fetch(request);
 }
}
export default {fetch(request,env){return env.JOBS.get(env.JOBS.idFromName(request.headers.get('x-job')||'one')).fetch(request);}};
`;
const bundled=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser'});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-21',durableObjects:{JOBS:{className:'TestReading',useSQLite:true}},r2Buckets:['AUDIO'],bindings:{},log:new (await import('miniflare')).Log((await import('miniflare')).LogLevel.ERROR)}));
try{
 const base=Date.now(),id='00000000-0000-4000-8000-000000000001';
 const call=async(job,path,body)=>{const response=await mf.dispatchFetch('https://local'+path,{method:'POST',headers:{'x-job':job,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 // An already-cleaned cancelled job reaches expiry: R2 must never receive [].
 await call('cancelled','/seed',{id,state:'cancelled',owner:'owner',created:base-86400000,expires:base,chunks:[],parts:[],cleanupOffset:2});
 let result=await call('cancelled','/tick',{now:base+1});assert.equal(result.job.state,'expired');assert.equal(result.job.owner,'');assert.equal(result.recovery,undefined);
 // Real R2 and transactional storage: cleanup crosses the 100-object batch boundary.
 const bucket=await mf.getR2Bucket('AUDIO');
 try{await bucket.delete([]);console.log('Legacy empty R2 delete accepted by local runtime.');}catch(error){console.log('Legacy empty R2 delete rejected:',error.message);}
 for(let i=0;i<103;i++)await bucket.put(id+'/part-'+i,'fixture');
 await call('long','/seed',{id,state:'ready',owner:'owner',created:base-86400000,expires:base,chunks:Array(103).fill('fixture'),parts:Array(103).fill({state:'ready',samples:576})});
 result=await call('long','/tick',{now:base+1});assert.equal(result.job.cleanupOffset,100);assert.equal(result.recovery,undefined);
 result=await call('long','/tick',{now:base+2000});assert.equal(result.job.state,'expired');assert.equal((await bucket.list({prefix:id+'/'})).objects.length,0);
 // Missing storage page is bounded across 48 simulated hours, with real DO state.
 await call('corrupt','/seed',{id,state:'ready',owner:'owner',storageVersion:2,pageCount:1});
 let now=base;for(const delay of [60000,300000,900000,3600000]){result=await call('corrupt','/tick',{now});assert.equal(result.recovery.next,now+delay);now+=delay;}
 result=await call('corrupt','/tick',{now});assert.equal(result.recovery.attempts,5);assert.equal(result.recovery.next,null);
 result=await call('corrupt','/tick',{now:now+48*3600000});assert.equal(result.recovery.attempts,5);
 const retired=await call('corrupt','/maintenance',{action:'retire'});assert.equal(retired.done,true);
 console.log('Real Cloudflare runtime checks passed: expiry, completed cleanup, multi-batch R2 cleanup, corrupt pages, bounded retries, 48-hour clock, retirement.');
}finally{await mf.dispose();}
