import test from 'node:test';
import assert from 'node:assert/strict';
import {presetRate, preparedChunkCount, playbackTimeline, explicitEndSeek} from '../public/playback-controls.js';
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

test('timeline scales verified source time without changing position or playback state',()=>{
 const p={duration:3600,complete:true,starts:[0,1800],audio:{currentTime:1800},state:'paused',wantPlay:false};
 for(const [rate,label] of [[1,'30:00 / 1:00:00'],[2,'15:00 / 30:00'],[.5,'1:00:00 / 2:00:00']])assert.equal(playbackTimeline(p,{rate}).label,label);
 assert.equal(playbackTimeline(p,{rate:2,selected:0}).label,'0:00 / 30:00');
 assert.equal(p.audio.currentTime,1800);assert.equal(p.wantPlay,false);assert.equal(p.state,'paused');
 assert.equal(playbackTimeline({...p,complete:false},{rate:2}).label,'15:00 / —');
 assert.match(playbackTimeline({...p,complete:false},{rate:2}).detail,/30:00 audio prepared.*unknown/);
 assert.equal(playbackTimeline(p,{natural:false}).label,'— / —');
 assert.equal(playbackTimeline({duration:0,starts:[]},{rate:2}).label,'— / —');
});

test('seek to a prepared prefix boundary cannot retire unfinished source',()=>{
  const player={state:'playing',starting:false,chunks:['one','two','three'],starts:[0,2],duration:4,audio:{paused:false,ended:false}};
  assert.equal(explicitEndSeek(player,1,1),false);
  player.starts.push(4);player.duration=6;
  assert.equal(explicitEndSeek(player,2,2),true);
  player.state='paused';assert.equal(explicitEndSeek(player,2,2),false);
  player.state='playing';player.starting=true;assert.equal(explicitEndSeek(player,2,2),false);
  player.starting=false;player.audio.paused=true;assert.equal(explicitEndSeek(player,2,2),false);
  assert.equal(explicitEndSeek({...player,audio:null},2,2,{browser:true}),true);
});
