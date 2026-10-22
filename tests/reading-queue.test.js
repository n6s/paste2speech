import test from 'node:test';import assert from 'node:assert/strict';import {ReadingQueue}from'../public/reading-queue.js';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){const started=[],removed=[];const queue=new ReadingQueue({start:item=>started.push(item),removed:item=>removed.push(item.id)});return{queue,started,removed};}
test('reservations preserve action order when file processing completes out of order',async()=>{const{queue,started}=fixture();const a=queue.reserve({title:'A'}),b=queue.reserve({title:'B'});queue.resolve(b.id,'B ready');queue.observe('playing');queue.observe('done');await tick();assert.equal(started.length,0);queue.resolve(a.id,'A ready');await tick();assert.equal(started[0].title,'A');queue.observe('playing');queue.observe('done');await tick();assert.equal(started[1].title,'B');});
test('next inserts immediately after current, append stays last; no preparation at enqueue',async()=>{const{queue,started}=fixture();const a=queue.reserve({title:'Last'}),b=queue.reserve({title:'Next',placement:'next'});queue.resolve(a.id,'a');queue.resolve(b.id,'b');await tick();assert.equal(started.length,0);assert.deepEqual(queue.items.map(x=>x.title),['Next','Last']);});
test('queued voice and cleanup snapshots do not follow later option changes',()=>{const{queue}=fixture(),snapshot={engine:'google',voice:'en-US-Wavenet-H',rate:1.5,cleanup:{markdown:true}};const a=queue.reserve({snapshot});snapshot.voice='other';snapshot.cleanup.markdown=false;assert.equal(a.snapshot.voice,'en-US-Wavenet-H');assert.equal(a.snapshot.cleanup.markdown,true);});
test('pause, errors and Stop do not advance or retry; explicit next restarts progression',async()=>{const{queue,started}=fixture(),a=queue.reserve();queue.resolve(a.id,'ready');for(const state of['playing','paused','failed','disconnected'])queue.observe(state);await tick();assert.equal(started.length,0);queue.stop();queue.observe('done');await tick();assert.equal(started.length,0);queue.advance();await tick();assert.equal(started.length,1);});
test('remove and Clear cancel pending destinations and late results cannot reappear',async()=>{const{queue,started,removed}=fixture(),a=queue.reserve(),b=queue.reserve();queue.remove(a.id);assert.equal(queue.resolve(a.id,'late'),false);queue.clear();assert.equal(queue.resolve(b.id,'late'),false);queue.observe('done');await tick();assert.deepEqual(removed,[a.id,b.id]);assert.equal(started.length,0);});
test('reorder/remove operate on identity and retain pending processing order',()=>{const{queue}=fixture(),a=queue.reserve({title:'A'}),b=queue.reserve({title:'B'});queue.move(b.id,-1);assert.equal(queue.items[0].id,b.id);queue.remove(b.id);assert.equal(queue.items[0].id,a.id);});
test('a failed queued item blocks progression until a user removes it; no automatic retry',async()=>{const{queue,started}=fixture(),a=queue.reserve(),b=queue.reserve();queue.fail(a.id,'Scan failed');queue.resolve(b.id,'B');queue.observe('done');await tick();assert.equal(started.length,0);queue.remove(a.id);await tick();assert.equal(started.length,1);});
test('a start failure is retained once and never automatically retried',async()=>{let attempts=0;const queue=new ReadingQueue({start:()=>{attempts++;throw Error('Unavailable voice');}}),a=queue.reserve();queue.resolve(a.id,'A');queue.advance();await tick();await tick();assert.equal(attempts,1);assert.equal(queue.items[0].state,'error');assert.equal(queue.halted,true);});
test('Clear or Stop during a pending handoff prevents a late start and keeps Stop item retry explicit',async()=>{for(const clear of[false,true]){let release,paid=0;const queue=new ReadingQueue({start:async(item,current)=>{await new Promise(r=>release=r);if(!current())return false;paid++;return true;}}),item=queue.reserve();queue.resolve(item.id,'A');queue.advance();await tick();clear?queue.clear():queue.stop();release();await tick();assert.equal(paid,0);assert.equal(queue.items.length,clear?0:1);}});

test('successful metadata handoff is consumption rather than cancellation',()=>{
 const removed=[];const queue=new ReadingQueue({removed:(item,reason)=>removed.push([item.id,reason.consumed])});
 const first=queue.reserve({title:'First'}),second=queue.reserve({title:'Second'});
 queue.removePending(first.id,{consumed:true});queue.removePending(second.id);
 assert.deepEqual(removed,[[first.id,true],[second.id,false]]);assert.equal(queue.items.length,0);
});

test('a visited queued reading can start at its selected logical position',async()=>{
 const started=[],queue=new ReadingQueue({start:item=>started.push(item.id)});
 queue.items=[{id:'visited',state:'ready',queuedReplay:true}];queue.playlist={selected:()=> 'visited',next:()=>undefined,entries:()=>queue.items};
 queue.advance();await tick();assert.deepEqual(started,['visited']);assert.equal(queue.items.length,0);
});
