import test from 'node:test';
import assert from 'node:assert/strict';
import {presetRate, preparedChunkCount} from '../public/playback-controls.js';
test('speed migration chooses nearest preset and lower speed on ties',()=>{
  assert.equal(presetRate(undefined),1);assert.equal(presetRate(1.1),1);
  assert.equal(presetRate(1.125),1);assert.equal(presetRate(1.9),2);
});
test('chunk availability excludes unknown and incomplete audio',()=>{
  const p={chunks:['a','b','c'],starts:[0,4],duration:8};
  assert.equal(preparedChunkCount(p),2);
  assert.equal(preparedChunkCount({...p,starts:[0,4,8]}),2);
  assert.equal(preparedChunkCount({...p,mode:'full',finalized:false}),0);
  assert.equal(preparedChunkCount({...p,starts:[],duration:0}),0);
});
