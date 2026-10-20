import test from 'node:test';
import assert from 'node:assert/strict';
import {removalReason,RetentionClock,READING_LIFETIME} from '../public/reading-retention.js';
test('never-started and partially listened expire from fixed creation, not activity',()=>{
 for(const position of [0,1800]){const r={id:'book',createdAt:1000,updated:1000+READING_LIFETIME,position};assert.equal(removalReason(r,{now:1000+READING_LIFETIME-1}),null);assert.equal(removalReason(r,{now:1000+READING_LIFETIME}),'expired');}
});
test('finished stays current beyond expiry, leaves when another reading is selected',()=>{
 const r={id:'book',createdAt:1000,finishedAt:2000};assert.equal(removalReason(r,{now:1e12,currentId:'book'}),null);assert.equal(removalReason(r,{now:2001,currentId:'newsletter'}),'finished');
});
test('unknown legacy creation and final-section cursor alone never authorize cleanup',()=>{
 assert.equal(removalReason({id:'book',nativeIndex:99},{now:1e12}),null);assert.equal(removalReason({id:'book',createdAt:1000,nativeIndex:99},{now:2000}),null);
});
test('offline clock rollback cannot renew an observed lifetime or active elapsed time',()=>{
 let wall=1000,elapsed=0;const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const c=new RetentionClock({wall:()=>wall,elapsed:()=>elapsed,storage});wall=0;elapsed=READING_LIFETIME;assert.equal(c.now(),1000+READING_LIFETIME);const reloaded=new RetentionClock({wall:()=>wall,elapsed:()=>0,storage});assert.equal(reloaded.now(),1000+READING_LIFETIME);
});

// Pending intents have the same original-added clock even before speech starts.
import {ReadingQueue} from '../public/reading-queue.js';
test('queued intent keeps original added time through edits, ordering and playback observation',()=>{
 const queue=new ReadingQueue(),item=queue.reserve({title:'Newsletter'}),added=item.createdAt;queue.resolve(item.id,'Complete text.');queue.move(item.id,1);queue.observe('playing');queue.stop();assert.ok(Number.isFinite(added));assert.equal(item.createdAt,added);
});
