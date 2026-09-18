import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalKokoro} from '../public/local-kokoro.js';
import {validProcessing} from '../shared/processing-metrics.js';
test('worker timings accumulate and cancellation remains reportable without reading content',async()=>{
 const old={Worker:globalThis.Worker,location:globalThis.location,document:globalThis.document};
 let worker;
 globalThis.location={href:'https://example.test/'};globalThis.document={hidden:false};
 globalThis.Worker=class {constructor(){worker=this;}postMessage(message){this.message=message;}terminate(){}};
 try {
  const kokoro=new LocalKokoro();kokoro.useGPU=true;
  const pending=kokoro.run('synthesize',{text:'private reading'});
  worker.onmessage({data:{id:worker.message.id,pcm:new ArrayBuffer(4800),metrics:{status:'ok',backend:'cpu',dtype:'q8',fallback:true,loadMs:10,probeMs:0,generateMs:100,audioMs:100,characters:15}}});
  await pending;
  const snapshot=kokoro.processingMetrics();assert.ok(validProcessing(snapshot));assert.equal(snapshot.engine,'kokoro');assert.equal(snapshot.scope,'current-selection');assert.equal(snapshot.chunks,1);assert.equal(snapshot.generationMs,100);assert.equal(snapshot.operation.status,'ok');assert.ok(!JSON.stringify(snapshot).includes('private reading'));
  const abort=new AbortController();const next=kokoro.run('synthesize',{text:'another reading'},abort.signal);abort.abort();await assert.rejects(next,{name:'AbortError'});
  assert.equal(kokoro.processingMetrics().operation.status,'cancelled');assert.equal(kokoro.processingMetrics().chunks,1);assert.equal(snapshot.operation.status,'ok');
  const failed=kokoro.run('load');worker.onerror();await assert.rejects(failed);assert.equal(kokoro.processingMetrics().operation.status,'failed');assert.ok(validProcessing(kokoro.processingMetrics()));
  kokoro.resetMetrics();const cleared=kokoro.processingMetrics();assert.equal(cleared.chunks,0);assert.equal(cleared.last,undefined);assert.equal(cleared.operation,undefined);assert.equal(cleared.comparison,undefined);
 }finally{for(const [key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
