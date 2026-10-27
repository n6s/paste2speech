import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scheduleGates,gateClass,executeGate,gateEnvironment} from '../scripts/reader-fresh-gates.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('bounded scheduler serializes heavy work and shared artifacts, with unknown suites heavy',async()=>{
 assert.equal(gateClass('node',['tests/new-media-browser.mjs']),'heavy');
 let heavy=0,total=0,max=0;const locks=new Set(),seen=[];
 const gates=[{name:'a'},{name:'b',resourceClass:'heavy'},{name:'c',resourceClass:'light',resources:['same']},{name:'d',resourceClass:'light',resources:['same']}];
 await scheduleGates(gates,{run:async g=>{total++;max=Math.max(max,total);if((g.resourceClass||'heavy')==='heavy')assert.equal(++heavy,1);for(const r of g.resources||[]){assert(!locks.has(r));locks.add(r);}await delay(15);for(const r of g.resources||[])locks.delete(r);if((g.resourceClass||'heavy')==='heavy')heavy--;total--;seen.push(g.name);}});
 assert.equal(max,2);assert.equal(seen.length,4);assert.equal(total,0);
});
test('first failure cancels and drains active siblings, never starts queued work',async()=>{
 const seen=[],done=[];await assert.rejects(scheduleGates([{name:'bad',resourceClass:'heavy'},{name:'active',resourceClass:'light'},{name:'queued'}],{run:async(g,signal)=>{seen.push(g.name);if(g.name==='bad'){await delay(10);throw Error('original failure');}await new Promise(resolve=>signal.addEventListener('abort',()=>setTimeout(resolve,15),{once:true}));done.push(g.name);}}),/original failure/);
 assert.deepEqual(seen,['bad','active']);assert.deepEqual(done,['active']);
});
test('owned subprocess failures, timeout and cancellation propagate after teardown',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reader-fresh-'));try{
  const gate=code=>({command:process.execPath,args:['-e',code],options:{}});
  await assert.rejects(executeGate(gate('process.exit(7)'),undefined,{logFile:join(dir,'fail')}),/Gate failed \(7\)/);
  await assert.rejects(executeGate(gate('setInterval(()=>{},1000)'),undefined,{logFile:join(dir,'timeout'),timeoutMs:60}),/exceeded/);
  const controller=new AbortController(),pidFile=join(dir,'pid');
  const running=executeGate(gate(`require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`),controller.signal,{logFile:join(dir,'cancel')});
  while(!existsSync(pidFile))await delay(10);const pid=Number(readFileSync(pidFile));controller.abort(Error('test canceled'));await assert.rejects(running,/test canceled/);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  assert.match(gateEnvironment({NODE_OPTIONS:'--no-warnings'}).NODE_OPTIONS,/--no-warnings .*reader-gate-lifecycle/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('cancellation releases an isolated Chrome and HTTP fixture',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reader-browser-teardown-'));try{
 const ready=join(dir,'ready');const controller=new AbortController();
 const running=executeGate({command:process.execPath,args:['tests/fixtures/reader-gate-teardown.mjs',ready],options:{env:gateEnvironment()}},controller.signal,{logFile:join(dir,'browser.log'),timeoutMs:20000});
 // If startup fails, propagate instead of waiting forever for the marker.
 let failure;running.catch(error=>{failure=error;});const deadline=Date.now()+15000;
 while(!existsSync(ready)&&!failure&&Date.now()<deadline)await delay(20);
 if(failure)throw failure;assert(existsSync(ready),'fixture reached ready state');
 const {port}=JSON.parse(readFileSync(ready));assert.equal((await fetch('http://127.0.0.1:'+port)).status,200);
 controller.abort(Error('fixture cancellation'));await assert.rejects(running,/fixture cancellation/);
 await assert.rejects(fetch('http://127.0.0.1:'+port));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
