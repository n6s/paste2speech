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
  if(path==='/api/reader')return Response.json({account:{balance:1000000}});
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

test('credit refusal pauses with paid sections intact and top-up retries the same ID exactly once',async()=>{
 storage.clear();let credit=100;const posts=[],jobs=new Map();
 const rawFetch=async(url,options={})=>{
  const path=new URL(url,location).pathname;
  if(path==='/api/reader')return Response.json({account:{balance:posts.length?credit:200}});
  if(path==='/api/billing/session')return Response.json({});
  if(path==='/api/readings'){
   const id=options.headers['Idempotency-Key'];posts.push(id);
   if(!jobs.has(id)){
    if(credit<100)return Response.json({detail:'Not enough credit'},{status:402});
    credit-=100;jobs.set(id,{id,state:'ready',completed:1,total:1,duration:1,starts:[0],sections:[{index:0,start:0,samples:24000,bytes:100}]});
   }
   return Response.json({id});
  }
  const job=jobs.get(path.split('/').at(-1));return job?Response.json(job):new Response('',{status:404});
 };
 const transport=new LongReadingTransport(null,{limit:()=>100,rawFetch});
 const input={voice:'en-US-Wavenet-D',chunks:['A'.repeat(100),'B'.repeat(100)]};
 const created=await (await transport.fetch('/api/readings',{method:'POST',body:JSON.stringify(input)})).json();
 const group=transport.groups.get(created.id);await group.finished;
 assert.equal(transport.status(group).state,'credit-paused');assert.equal(transport.status(group).completed,1);
 assert.match(group.error.message,/insufficient speech credit/);const ids=group.session.records.map(r=>r.id);
 await transport.resume(group.id);await group.finished;assert.equal(group.session.records[1].id,ids[1]);assert.equal(jobs.size,1);
 // Reload reuses the refused ID, rather than polling a nonexistent job.
 credit=100;
 const fresh=new LongReadingTransport(null,{limit:()=>100,rawFetch});
 const reloaded=await (await fresh.fetch('/api/readings',{method:'POST',body:JSON.stringify(input)})).json();
 const resumed=fresh.groups.get(reloaded.id);await resumed.finished;
 assert.equal(fresh.status(resumed).state,'ready');assert.equal(credit,0);assert.equal(jobs.size,2);
 assert.deepEqual(resumed.session.records.map(r=>r.id),ids);assert.equal(posts.filter(id=>id===ids[0]).length,1);
});

for (const limit of [100, 20000]) test(`whole-reading shortage starts no parts (limit ${limit}); repeated top-up recovery debits once`, async()=>{
 storage.clear();let balance=1,posts=0;const jobs=new Map();
 const rawFetch=async(url,options={})=>{
  const path=new URL(url,location).pathname;
  if(path==='/api/reader')return Response.json({account:{balance}});
  if(path==='/api/billing/session')return Response.json({});
  if(path==='/api/readings'){
   posts++;const id=options.headers['Idempotency-Key'],input=JSON.parse(options.body);
   if(!jobs.has(id)){
    const cost=input.chunks.reduce((n,t)=>n+[...t].length,0);assert.ok(balance>=cost);balance-=cost;
    jobs.set(id,{id,state:'ready',completed:input.chunks.length,total:input.chunks.length,starts:input.chunks.map((_,i)=>i),duration:input.chunks.length,sections:input.chunks.map((_,index)=>({index,start:index,samples:24000,bytes:100}))});
   }
   return Response.json({id});
  }
  return Response.json(jobs.get(path.split('/').at(-1)));
 };
 const transport=new LongReadingTransport(null,{limit:()=>limit,rawFetch});
 const input={voice:'en-US-Wavenet-D',delivery:'mse',chunks:['A'.repeat(100),'😀'.repeat(50)]};
 const created=await(await transport.fetch('/api/readings',{method:'POST',body:JSON.stringify(input)})).json(),group=transport.groups.get(created.id);
 await group.finished;assert.equal(posts,0);assert.equal(balance,1);assert.equal(group.error.needed,150);assert.equal(group.error.available,1);
 await Promise.all([transport.resume(group.id),transport.resume(group.id)]);await group.finished;assert.equal(posts,0);
 balance=150;await Promise.all([transport.resume(group.id),transport.resume(group.id)]);await group.finished;
 assert.equal(transport.status(group).state,'ready');assert.equal(balance,0);const expected=limit===100?2:1;assert.equal(posts,expected);
 await transport.resume(group.id);await group.finished;assert.equal(posts,expected);
 const fresh=new LongReadingTransport(null,{limit:()=>limit,rawFetch});const reloaded=await(await fresh.fetch('/api/readings',{method:'POST',body:JSON.stringify(input)})).json();await fresh.groups.get(reloaded.id).finished;
 assert.equal(posts,expected);assert.equal(balance,0);
});
test('clearing while the fresh balance check is pending starts no speech',async()=>{
 storage.clear();let reply,posts=0;
 const transport=new LongReadingTransport(null,{limit:()=>100,rawFetch:async url=>{
  if(url==='/api/reader')return new Promise(r=>{reply=r;});if(url==='/api/readings')posts++;
  return Response.json({});
 }});
 const created=await(await transport.fetch('/api/readings',{method:'POST',body:JSON.stringify({voice:'en-US-Wavenet-D',chunks:['A'.repeat(100),'B'.repeat(100)]})})).json(),group=transport.groups.get(created.id);
 while(!reply)await new Promise(r=>setTimeout(r,0));group.cancelled=true;group.session.stop();reply(Response.json({account:{balance:1000}}));await group.finished;
 assert.equal(posts,0);assert.equal(storage.size,0);
});
test('an interrupted credit lookup is recoverable without admitting any part',async()=>{
 storage.clear();let unavailable=true,posts=0;
 const transport=new LongReadingTransport(null,{limit:()=>20000,rawFetch:async(url,options={})=>{
  if(url==='/api/reader')return unavailable?new Response('',{status:503}):Response.json({account:{balance:5}});
  if(url==='/api/billing/session')return Response.json({});
  if(url==='/api/readings'){posts++;return Response.json({id:options.headers['Idempotency-Key']});}
  return Response.json({state:'ready',completed:1,total:1,starts:[0],duration:1,sections:[{index:0,start:0,samples:24000,bytes:100}]});
 }});
 const created=await(await transport.fetch('/api/readings',{method:'POST',body:JSON.stringify({voice:'en-US-Wavenet-D',chunks:['hello']})})).json(),group=transport.groups.get(created.id);
 await group.finished;assert.equal(posts,0);assert.match(group.error.message,/Could not check/);
 unavailable=false;await transport.resume(group.id);await group.finished;assert.equal(posts,1);assert.equal(transport.status(group).state,'ready');
});

test('saved cursor is identity-bound and cannot replace lost paid references',async()=>{
 storage.clear();const transport=new LongReadingTransport(null,{limit:()=>100});
 const input={voice:'en-US-Wavenet-F',chunks:['A'.repeat(100),'B'.repeat(100)]};
 const {key}=await transport.plan(input);
 storage.set(key,JSON.stringify([{id:'paid-a'},{id:'paid-b'}]));
 storage.set('paste2speech.position.'+key,JSON.stringify({version:1,index:1,offset:.75,updated:Date.now()}));
 const cursor=await transport.savedPosition(input);assert.equal(cursor.index,1);assert.equal(cursor.offset,.75);assert.equal(cursor.unavailable,false);
 assert.equal(await transport.savedPosition({...input,voice:'en-US-Wavenet-D'}),null);
 assert.equal(await transport.savedPosition({...input,chunks:['different']}),null);
 transport.limit=()=>20000;assert.equal(await transport.savedPosition(input),null);transport.limit=()=>100;
 storage.delete(key);assert.equal((await transport.savedPosition(input)).unavailable,true);
 transport.clearSavedReadings();assert.equal(await transport.savedPosition(input),null);
});
