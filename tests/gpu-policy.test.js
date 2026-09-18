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

test('FP16 model or probe failure retries FP32 before choosing CPU',async()=>{
 const {prepareGPU}=await import('../browser/gpu-policy.js');
 for(const failure of ['model load','synthesis probe']) {
  const attempts=[];
  const ready=await prepareGPU(gpu(true),async dtype=>{
   attempts.push(dtype);if(dtype==='fp16')throw Error(failure);
  },async()=>attempts.push('dispose'));
  assert.equal(ready,true);assert.deepEqual(attempts,['fp16','dispose','fp32']);
 }
});
test('GPU fallback exhausts supported precisions and avoids unsupported FP16',async()=>{
 const {prepareGPU}=await import('../browser/gpu-policy.js');
 const attempts=[];
 assert.equal(await prepareGPU(gpu(true),async dtype=>{attempts.push(dtype);throw Error('model failed');},async()=>attempts.push('dispose')),false);
 assert.deepEqual(attempts,['fp16','dispose','fp32','dispose']);
 const single=[];
 assert.equal(await prepareGPU(gpu(false),async dtype=>single.push(dtype),async()=>{}),true);
 assert.deepEqual(single,['fp32']);
 assert.equal(await prepareGPU(undefined,async()=>assert.fail('No GPU should be loaded'),async()=>{}),false);
});
