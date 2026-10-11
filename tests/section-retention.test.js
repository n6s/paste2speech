import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LongReadingTransport} from '../public/long-reading.js';
import {inspectMp3} from '../cloudflare/prepared/mp3.js';
const chunks=['First.','Second.','Third.'];
const bytes=await Promise.all([0,1,2].map(i=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));
let duration=0;const sections=bytes.map((b,index)=>{const m=inspectMp3(b),s={index,start:duration,samples:m.samples,bytes:m.bytes};duration+=m.samples/24000;return s;});
const status={state:'ready',total:3,completed:3,sections,starts:sections.map(s=>s.start),duration};
test('logical retained positions preserve unstarted multipart gaps and follow verified-byte eviction',async()=>{
 const oldLocation=globalThis.location;globalThis.location=new URL('https://reader.test/');
 const calls=[],transport=new LongReadingTransport(async url=>{const path=new URL(url).pathname;calls.push(path);return new Response(bytes[Number(path.split('/').at(-1))]);},{fullAudio:true});
 try{
  for(const id of ['first','last']){transport.assets.register(id,chunks,'F');transport.assets.observe(id,status);await Promise.all([0,1,2].map(i=>transport.assets.section(id,i)));}
  transport.groups.set('logical',{parts:[{chunks},{chunks:['Unstarted one.','Unstarted two.']},{chunks}],session:{records:[{id:'first'},{},{id:'last'}]}});
  assert.deepEqual(transport.retainedSections('logical'),[0,1,2,5,6,7]);assert.equal(transport.offlineInfo('logical',8).ready,false);
  transport.assets.evict('first',1);transport.assets.evict('last',2);
  assert.deepEqual(transport.retainedSections('logical'),[0,2,5,6]);assert.equal(transport.offlineInfo('logical',8).downloaded,4);assert.equal(calls.length,6);
  transport.assets.observe('last',{...status,starts:[0,999,1000]});assert.deepEqual(transport.retainedSections('logical'),[0,2]);
  transport.assets.clear();assert.deepEqual(transport.retainedSections('logical'),[]);assert.deepEqual(transport.retainedSections('missing'),[]);
 }finally{transport.assets.dispose();if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;}
});
