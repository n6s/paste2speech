import test from 'node:test';
import assert from 'node:assert/strict';
import {LongReadingTransport} from '../public/long-reading.js';
globalThis.location=new URL('https://reader.test');
globalThis.window=new EventTarget();
const storage=new Map();globalThis.sessionStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
async function fixture({failure='failed'}={}){
 storage.clear();
 const posts=[],jobs=new Map();let fail=failure;
 const transport=new LongReadingTransport(null,{limit:()=>100,rawFetch:async(url,options={})=>{
  const path=new URL(url,location).pathname;
  if(path==='/api/billing/session')return Response.json({});
  if(path==='/api/readings'){
   const input=JSON.parse(options.body),id=options.headers['Idempotency-Key'];
   posts.push({id,text:input.chunks[0]});jobs.set(id,{index:input.chunks[0][0]==='A'?0:1});return Response.json({id});
  }
  const id=path.split('/').at(-1),job=jobs.get(id);assert.ok(job);
  if(job.index===1&&fail==='expired')return new Response('',{status:404});
  if(job.index===1&&fail==='network')return new Response('',{status:503});
  const failed=job.index===1&&fail==='failed';
  return Response.json({id,state:failed?'failed':'ready',completed:failed?0:1,total:1,duration:1,starts:failed?[]:[0],sections:failed?[]:[{index:0,start:0,samples:24000,bytes:100}],providerCost:failed ? .001 : .002,costIncomplete:failed,error:failed?'interrupted':''});
 }});
 const created=await (await transport.fetch('/api/readings',{method:'POST',body:JSON.stringify({voice:'en-US-Wavenet-D',chunks:['A'.repeat(100),'B'.repeat(100)]})})).json();
 const group=transport.groups.get(created.id);await group.finished;assert.ok(group.error);
 return {transport,group,posts,setFailure:value=>{fail=value;}};
}
test('Resume rechecks the same IDs after a network failure and never buys replacement speech',async()=>{
 const f=await fixture({failure:'network'});const ids=f.posts.map(p=>p.id);f.setFailure(null);
 let confirmations=0;const result=await f.transport.resume(f.group.id,{confirmRetry:()=>{confirmations++;return true;}});await f.group.finished;
 assert.equal(result.resumed,true);assert.equal(result.replacedFrom,null);assert.equal(confirmations,0);assert.deepEqual(f.posts.map(p=>p.id),ids);assert.equal(f.transport.status(f.group).state,'ready');
});
test('Resume replaces only a confirmed failed part, keeping completed parts and original attempt ID',async()=>{
 const f=await fixture(),old=f.posts[1].id;
 const result=await f.transport.resume(f.group.id,{confirmRetry:info=>{assert.deepEqual(info,{part:2,characters:100});f.setFailure(null);return true;}});await f.group.finished;
 assert.equal(result.replacedFrom,1);assert.deepEqual(f.posts.map(p=>p.text[0]),['A','B','B']);assert.equal(f.group.session.records[0].id,f.posts[0].id);
 assert.deepEqual(f.group.session.records[1].previousAttempts,[old]);assert.notEqual(f.group.session.records[1].id,old);assert.equal(f.transport.status(f.group).state,'ready');
 assert.equal(f.transport.status(f.group).providerCost,.005);assert.equal(f.transport.status(f.group).costIncomplete,true);
});
test('declining replacement and uncertain status preserve every job ID',async()=>{
 const f=await fixture(),ids=f.posts.map(p=>p.id);
 assert.equal((await f.transport.resume(f.group.id,{confirmRetry:()=>false})).resumed,false);
 assert.deepEqual(f.posts.map(p=>p.id),ids);assert.ok(f.group.error);
 f.setFailure('network');await assert.rejects(f.transport.resume(f.group.id,{confirmRetry:()=>{throw Error('Must not confirm uncertain status');}}),/Cannot check/);
 assert.deepEqual(f.posts.map(p=>p.id),ids);
});
test('repeated Resume clicks share one confirmation and one replacement',async()=>{
 const f=await fixture();let answer,confirmations=0;
 const confirmRetry=()=>{confirmations++;return new Promise(resolve=>{answer=resolve;});};
 const a=f.transport.resume(f.group.id,{confirmRetry}),b=f.transport.resume(f.group.id,{confirmRetry});
 while(!answer)await new Promise(resolve=>setTimeout(resolve,0));f.setFailure(null);answer(true);
 await Promise.all([a,b]);await f.group.finished;assert.equal(confirmations,1);assert.equal(f.posts.length,3);
});
test('clearing during confirmation prevents any new preparation',async()=>{
 const f=await fixture();let answer;
 const pending=f.transport.resume(f.group.id,{confirmRetry:()=>new Promise(resolve=>{answer=resolve;})});
 while(!answer)await new Promise(resolve=>setTimeout(resolve,0));f.group.cancelled=true;f.group.session.stop();answer(true);
 await assert.rejects(pending,/cleared/);assert.equal(f.posts.length,2);
});

test('expired or missing parts never trigger paid replacements',async()=>{
 const f=await fixture({failure:'network'});f.setFailure('expired');
 await assert.rejects(f.transport.resume(f.group.id,{confirmRetry:()=>{throw Error('Must not regenerate missing audio');}}),/Cannot check/);
 assert.equal(f.posts.length,2);
});
test('saved part IDs survive recreating the transport and are reused on Resume',async()=>{
 const f=await fixture();const transport=new LongReadingTransport(null,{rawFetch:f.transport.rawFetch,limit:()=>100});
 const response=await transport.fetch('/api/readings',{method:'POST',body:JSON.stringify({voice:'en-US-Wavenet-D',chunks:['A'.repeat(100),'B'.repeat(100)]})});
 const group=transport.groups.get((await response.json()).id);await group.finished;
 assert.equal(f.posts.length,2);assert.ok(group.error);
 await transport.resume(group.id,{confirmRetry:()=>{f.setFailure(null);return true;}});await group.finished;
 assert.equal(f.posts.length,3);assert.equal(group.session.records[0].id,f.posts[0].id);
 assert.equal(transport.status(group).state,'ready');
});

test('Clear forgets saved parts before network cleanup and late saves cannot resurrect them',async()=>{
 const f=await fixture();storage.set('unrelated','keep');
 f.transport.clearSavedReadings();f.group.session.persist();
 assert.deepEqual([...storage.keys()],['unrelated']);
 f.setFailure(null);
 const fresh=new LongReadingTransport(null,{rawFetch:f.transport.rawFetch,limit:()=>100});
 const response=await fresh.fetch('/api/readings',{method:'POST',body:JSON.stringify({voice:'en-US-Wavenet-D',chunks:['A'.repeat(100),'B'.repeat(100)]})});
 await fresh.groups.get((await response.json()).id).finished;
 assert.equal(f.posts.length,4);assert.notEqual(f.posts[0].id,f.posts[2].id);
});
test('Clear after reload forgets records even without an active logical reading',async()=>{
 await fixture();const fresh=new LongReadingTransport();fresh.clearSavedReadings();assert.equal(storage.size,0);
});
