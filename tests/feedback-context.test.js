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

test('cleanup diagnostics copy only the supported booleans',()=>{
 const cleanup={markdown:false,citations:true,urls:false,code:true,tables:false,emoji:true,joinLines:false,reading:'PRIVATE'};
 const result=feedbackContext({navigator:{},environment:'test',release:'test',engine:'browser',voice:'Default',playback:'idle',cleanup});
 assert.deepEqual(result.cleanup,{markdown:false,citations:true,urls:false,code:true,tables:false,emoji:true,joinLines:false});
 cleanup.joinLines=true;
 assert.equal(result.cleanup.joinLines,false);
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
