import test from 'node:test';
import assert from 'node:assert/strict';
import {gpuPrecision,validAudio} from '../browser/gpu-policy.js';
const gpu=half=>({requestAdapter:async()=>({features:new Set(half?['shader-f16']:[])})});
test('GPU precision respects device support and explicit comparisons',async()=>{
 assert.equal(await gpuPrecision(gpu(true)),'fp16');
 assert.equal(await gpuPrecision(gpu(false)),'fp32');
 assert.equal(await gpuPrecision(gpu(true),'fp32'),'fp32');
 await assert.rejects(gpuPrecision(gpu(false),'fp16'));
 await assert.rejects(gpuPrecision(undefined));
 await assert.rejects(gpuPrecision({requestAdapter:async()=>null}));
});
test('GPU probe rejects empty and silent output',()=>{
 assert.equal(validAudio(new ArrayBuffer(0)),false);
 assert.equal(validAudio(new Int16Array(3000).buffer),false);
 const pcm=new Int16Array(3000);pcm[100]=200;
 assert.equal(validAudio(pcm.buffer),true);
});
