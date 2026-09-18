import test from 'node:test';
import assert from 'node:assert/strict';
import {feedbackContext} from '../public/feedback-context.js';
test('feedback includes only coarse device diagnostics and bounded voice labels',()=>{
 const base={environment:'test',release:'abc123',engine:'workstation',voice:'Heart',playback:'playing'};
 for(const [userAgent,browser,device] of [['Mozilla Chrome/140.0 Safari/537.36','Chrome','desktop'],['Mozilla Android Mobile Chrome/140.0','Chrome','mobile'],['Mozilla iPhone Version/18 Safari/605','Safari','mobile'],['Mozilla Chrome/140 Edg/140','Edge','desktop']]){
  const result=feedbackContext({...base,navigator:{userAgent}});
  assert.deepEqual(result,{...base,browser,device});assert.ok(!JSON.stringify(result).includes(userAgent));
 }
 assert.equal(feedbackContext({...base,navigator:{userAgent:'Safari/605',platform:'MacIntel',maxTouchPoints:5}}).device,'mobile');
 assert.equal(feedbackContext({...base,voice:'x'.repeat(200),navigator:{}}).voice.length,120);
});
