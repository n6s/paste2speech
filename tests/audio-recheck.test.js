import test from 'node:test';
import assert from 'node:assert/strict';
import {PersistentReadingAssets} from '../public/persistent-reading-assets.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function fixture(){
 const meta={index:0,start:0,bytes:3,samples:24000,sha256:'verified'},entry={...meta,blob:new Blob(['mp3'])};
 const status={state:'ready',total:1,completed:1,duration:1,starts:[0],sections:[meta]},record={id:'job',voice:'F',chunks:['words'],status};
 let reads=0,updates=0;
 const store={get:async()=>record,section:async()=>{reads++;return entry;},close(){}};
 const assets=new PersistentReadingAssets(()=>{throw Error('No network permitted');},{storeFactory:()=>store,onChange:()=>updates++});
 assets.writesEnabled=false;assets.setScope('owner');assets.allow('job');assets.shellReady=assets.manifestReady=true;assets.verify=async value=>value;
 const job=assets.register('job',['words'],'F');await job.hydrating;updates=0;reads=0;
 return{assets,job,store,meta,entry,record,reads:()=>reads,updates:()=>updates};
}
test('unchanged rechecks are atomic, share one operation and publish no intermediate rail changes',async()=>{
 const f=await fixture(),gate=deferred(),original=f.store.section;f.store.section=async(...args)=>{await gate.promise;return original(...args);};
 const first=f.assets.recheck(),second=f.assets.recheck();assert.equal(first,second);await Promise.resolve();assert.equal(f.assets.complete('job'),true);assert.equal(f.job.data.size,1);gate.resolve();await first;assert.equal(f.reads(),1);assert.equal(f.updates(),0);assert.equal(f.assets.complete('job'),true);f.assets.dispose();
});
for(const mode of ['missing','corrupt'])test(`${mode} disk audio withdraws readiness only after verification; no network or paid retry`,async()=>{
 const f=await fixture(),gate=deferred();f.store.section=async()=>{await gate.promise;return mode==='missing'?null:f.entry;};if(mode==='corrupt')f.assets.verify=async()=>{throw Error('Corrupt fixture');};
 const check=f.assets.recheck();await Promise.resolve();assert.equal(f.assets.complete('job'),true);gate.resolve();await check;assert.equal(f.assets.complete('job'),false);assert.equal(f.job.data.size,0);assert.equal(f.updates(),1);if(mode==='corrupt')assert.match(f.job.storageError,/could not be verified/);f.assets.dispose();
});
for(const mode of ['account','deletion'])test(`pending verification cannot republish after ${mode} invalidation`,async()=>{
 const f=await fixture(),gate=deferred(),begun=deferred();f.store.section=async()=>{begun.resolve();await gate.promise;return f.entry;};const check=f.assets.recheck();await begun.promise;
 if(mode==='account')f.assets.setScope('other');else{f.assets.beginRemoval(['job']);f.assets.forgetLocal(['job']);}const updates=f.updates();gate.resolve();await check;assert.equal(f.updates(),updates);assert.equal(f.assets.saved('job'),false);assert.equal(f.assets.manifestReady,false);f.assets.dispose();
});
test('foreground verified writes are preserved while an older missing-disk snapshot is pending',async()=>{
 const f=await fixture(),gate=deferred(),begun=deferred();f.store.section=async()=>{begun.resolve();await gate.promise;return null;};const check=f.assets.recheck();await begun.promise;const newer={...f.job.data.get(0)};f.job.data.set(0,newer);gate.resolve();await check;assert.equal(f.job.data.get(0),newer);assert.equal(f.assets.complete('job'),true);f.assets.dispose();
});
test('concurrent status replacement retires an outdated verification snapshot',async()=>{
 const f=await fixture(),gate=deferred(),begun=deferred();f.store.section=async()=>{begun.resolve();await gate.promise;return f.entry;};const check=f.assets.recheck();await begun.promise;f.job.status={...f.job.status,state:'preparing'};f.job.data.clear();gate.resolve();await check;assert.equal(f.job.data.size,0);f.assets.dispose();
});
