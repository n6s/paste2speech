import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ReadingAssets} from '../public/reading-assets.js';
import {loadPreparedMedia} from '../public/prepared-media.js';
import {inspectMp3,captions} from '../cloudflare/prepared/mp3.js';
const chunks=['First section.','Second section.','Third section.'];
const bytes=await Promise.all([0,1,2].map(i=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));
let duration=0;const sections=bytes.map((b,index)=>{const info=inspectMp3(b),section={index,start:duration,samples:info.samples,bytes:info.bytes};duration+=info.samples/24000;return section;});
const status={state:'ready',total:3,completed:3,sections,starts:sections.map(s=>s.start),duration};
const ready=async assets=>{for(let i=0;i<100&&!assets.complete('paid');i++)await new Promise(r=>setTimeout(r,5));assert.equal(assets.complete('paid'),true);};

test('full prefetch and repeated export share each verified GET, with bounded concurrency',async()=>{
 const requests=[],gates=[];let active=0,peak=0;
 const assets=new ReadingAssets(async path=>{
  assert.match(path,/^\/api\/readings\/paid\/sections\/[012]$/);requests.push(path);peak=Math.max(peak,++active);
  await new Promise(resolve=>gates.push(resolve));active--;return new Response(bytes[Number(path.split('/').at(-1))]);
 },{concurrency:2});
 try{
  assets.register('paid',chunks,'F');assets.observe('paid',status);
  assert.equal(assets.info(['paid'],3).ready,false);assert.equal(requests.length,2);
  const controller=new AbortController(),waiting=assets.section('paid',0,{signal:controller.signal});controller.abort();await assert.rejects(waiting,{name:'AbortError'});
  gates[0]();gates[1]();while(gates.length<3)await new Promise(r=>setTimeout(r,0));gates[2]();await ready(assets);
  assert.equal(peak,2);assert.equal(new Set(requests).size,3);assert.equal(requests.length,3);
  for(let n=0;n<2;n++){
   const result=await loadPreparedMedia([{id:'paid',state:'ready',duration}],{assets,fetcher:()=>{throw Error('Export must use local audio');}});
   assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),Buffer.concat(bytes));assert.equal(result.vtt,captions(chunks,status));assert.equal(result.duration,duration);
  }
  assert.equal(requests.length,3);assert.equal(assets.info(['paid'],3).ready,true);
 }finally{assets.dispose();}
});

test('tab retention cap prevents false readiness while allowing requested playback retrieval',async()=>{
 let reads=0;const assets=new ReadingAssets(async()=>{reads++;return new Response(bytes[0]);},{maxBytes:100});
 try{assets.register('paid',chunks,'F');assets.observe('paid',status);assert.equal(reads,0);assert.equal(assets.info(['paid'],3).ready,false);assert.match(assets.info(['paid'],3).error,/too large/);
  assert.equal((await assets.section('paid',0)).size,bytes[0].length);assert.equal(reads,1);assert.equal(assets.bytes,0);
 }finally{assets.dispose();}
});

test('corrupt bytes and inconsistent timelines never become offline ready',async()=>{
 const assets=new ReadingAssets(async()=>new Response('not MP3'));
 try{assets.register('paid',chunks,'F');assets.observe('paid',status);await assert.rejects(assets.section('paid',0));await new Promise(r=>setTimeout(r,0));assert.equal(assets.info(['paid'],3).ready,false);assert.match(assets.info(['paid'],3).error,/verified/);
  assets.observe('paid',{...status,starts:[0,999,1000]});assert.equal(assets.complete('paid'),false);
 }finally{assets.dispose();}
});

test('cancel ignores late downloaded bytes and retires source/voice data',async()=>{
 const release=[];const assets=new ReadingAssets(async()=>{await new Promise(r=>release.push(r));return new Response(bytes[0]);});
 assets.register('paid',chunks,'F');assets.observe('paid',status);const pending=assets.section('paid',0);assets.cancel('paid');release.forEach(r=>r());await assert.rejects(pending);await new Promise(r=>setTimeout(r,0));assert.equal(assets.bytes,0);assert.equal(assets.jobs.has('paid'),false);assets.dispose();
});

test('eviction and a fresh tab invalidate readiness without synthesis',async()=>{
 let reads=0;const assets=new ReadingAssets(async path=>{reads++;return new Response(bytes[Number(path.split('/').at(-1))]);});
 try{assets.register('paid',chunks,'F');assets.observe('paid',status);await ready(assets);const oldURL=assets.url('paid','mp3');assert.ok(oldURL.startsWith('blob:'));
  assets.evict('paid',1);assert.equal(assets.complete('paid'),false);assert.equal(assets.url('paid','mp3'),null);await assert.rejects(fetch(oldURL));assert.equal(reads,3);
  const fresh=new ReadingAssets(()=>{throw Error('No automatic requests on reload');});assert.equal(fresh.info(['paid'],3).ready,false);fresh.dispose();
 }finally{assets.dispose();}
});
