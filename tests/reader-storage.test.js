import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJob,saveJob} from '../cloudflare/prepared/storage.js';
test('durable pages support 10,000 sentence states and clean old pages on expiry',async()=>{
 const data=new Map();const store={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>{assert.ok(JSON.stringify(v).length<128*1024);data.set(k,structuredClone(v));},delete:async k=>data.delete(k),setAlarm:async()=>{},transaction:async f=>f(store)};
 const job={id:'test',chunks:Array(10000).fill('a.'),parts:Array.from({length:10000},()=>({state:'ready',samples:576,bytes:192}))};
 await saveJob(store,job,1);const loaded=await loadJob(store);assert.deepEqual(loaded.chunks,job.chunks);assert.deepEqual(loaded.parts,job.parts);
 await saveJob(store,{...loaded,chunks:[],parts:[],state:'expired'});assert.equal(data.size,1);
 data.set('job',{...job,state:'ready'});assert.deepEqual(await loadJob(store),{...job,state:'ready'});
});
