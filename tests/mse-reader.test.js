import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newJob,prepareJob} from '../cloudflare/prepared/job.js';
import {options,texts,delayFor,status} from '../scripts/mse-reader-proof/model.js';
const frame=new Uint8Array(await readFile(new URL('./fixtures/wavenet/en-US-Wavenet-F-00.mp3',import.meta.url)));
const input={voice:'en-US-Wavenet-F',concurrency:3,scenario:'normal'};
function setup(concurrency=3){
 const job={...newJob({voice:input.voice,chunks:['a','b','c','d'],mode:'cached'},'owner','test'),concurrency};
 const objects=new Map(),saved=[];
 const deps={concurrency,publishEach:true,save:async j=>saved.push(structuredClone(j)),isCancelled:()=>job.state==='cancelled',
   speech:async()=>frame,store:{put:async(k,v)=>objects.set(k,v),get:async k=>new Response(objects.get(k))}};
 return {job,deps,objects,saved};
}
test('publish first section before slow peers and expose only consecutive ready sections',async()=>{
 const {job,deps,saved}=setup();let release;const blocked=new Promise(r=>release=r);let first;const observed=new Promise(r=>first=r);
 deps.speech=async(t,v,i)=>{if(i===1)await blocked;return frame;};
 deps.save=async j=>{saved.push(structuredClone(j));if(j.parts[0].state==='ready'&&j.parts[2].state==='ready')first();};
 const preparing=prepareJob(job,deps);await observed;
 assert.equal(job.state,'preparing');assert.equal(status(job).completed,1);assert.equal(saved.at(-1).parts[1].state,'submitting');
 release();await preparing;assert.equal(job.state,'ready');assert.equal(status(job).sections.length,4);
});
test('one and three in flight preserve identical audio and caption timing',async()=>{
 const results=[];
 for(const concurrency of [1,3]){
  const s=setup(concurrency);let active=0,max=0;
  s.deps.speech=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return frame;};
  await prepareJob(s.job,s.deps);assert.equal(max,concurrency);results.push(s);
 }
 assert.deepEqual(results[0].objects.get('test/reading.mp3'),results[1].objects.get('test/reading.mp3'));
 assert.equal(results[0].objects.get('test/reading.vtt'),results[1].objects.get('test/reading.vtt'));
 assert.deepEqual(status(results[0].job).sections,status(results[1].job).sections);
});
test('cancel and failure retain successful sections without publishing a completed export',async()=>{
 const s=setup();s.deps.speech=async(t,v,i)=>{if(i===1)throw Error('fixture failure');return frame;};
 await prepareJob(s.job,s.deps);assert.equal(s.job.state,'failed');assert.equal(s.objects.has('test/reading.mp3'),false);
 const c=setup();c.deps.speech=async()=>{c.job.state='cancelled';return frame;};await prepareJob(c.job,c.deps);
 assert.equal(c.job.state,'cancelled');assert.equal(c.saved.at(-1).parts.filter(p=>p.state==='ready').length,3);
});
test('experimental options reject live generation, arbitrary text and unbounded inputs',async()=>{
 assert.equal(texts(input).length,8);assert.equal(texts({...input,scenario:'long'}).length,64);
 for(const invalid of [{...input,voice:[input.voice]},{...input,mode:'live'},{...input,chunks:['private']},{...input,concurrency:50},{...input,scenario:'other'}])assert.throws(()=>options(invalid));
 const s=setup();s.job.mode='live';await assert.rejects(prepareJob(s.job,s.deps),/cached-only/);
 assert.equal(delayFor({...input,scenario:'stalled'},1),15000);
});
