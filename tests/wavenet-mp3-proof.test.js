import test from 'node:test';
import assert from 'node:assert/strict';
import {assemble,inspectMp3,captions} from '../scripts/wavenet-mp3-proof/assemble.mjs';
function frame(){const b=new Uint8Array(192);b.set([255,243,132,196]);return b;}
test('frame timeline retains all samples across section boundaries',()=>{
  const a=frame(), b=new Uint8Array([...frame(),...frame()]);
  assert.equal(inspectMp3(b).samples,1152);
  assert.deepEqual(assemble([a,b]).starts,[0,.024]);
  assert.equal(assemble([a,b]).duration,.072);
  assert.deepEqual(a,frame(),'assembly must not mutate original audio');
});
test('reject unsupported metadata, reservoir references, truncated and changing frames',()=>{
  const reservoir=frame();reservoir[4]=1;
  const xing=frame();xing.set(new TextEncoder().encode('Xing'),13);
  const vbri=frame();vbri.set(new TextEncoder().encode('VBRI'),36);
  const rate=frame();rate[2]=128;
  const stereo=frame();stereo[3]=0;
  const padded=frame();padded[2]|=2;
  const badSecond=new Uint8Array([...frame(),...rate]);
  for(const b of [new Uint8Array(),frame().slice(0,191),reservoir,xing,vbri,rate,stereo,padded,badSecond,
    new Uint8Array([...new TextEncoder().encode('ID3'),...frame()])])assert.throws(()=>inspectMp3(b));
});
test('VTT shares frame timeline and safely retains original visible text',()=>{
  const result=captions(['Time: 9:30 a.m.','<map> & "bag"'],{starts:[0,1.25],duration:2.5});
  assert.match(result,/00:00:00.000 --> 00:00:01.250/);
  assert.match(result,/00:00:01.250 --> 00:00:02.500/);
  assert.ok(result.includes('&lt;map&gt; &amp; "bag"'));
  assert.throws(()=>captions(['one'],{starts:[],duration:1}));
});
