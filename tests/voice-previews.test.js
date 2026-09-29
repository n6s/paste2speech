import test from 'node:test';
import assert from 'node:assert/strict';
import {naturalVoiceGuidance} from '../public/cloud-reader.js';

test('Natural voice guidance distinguishes account states without changing billing',()=>{
 assert.match(naturalVoiceGuidance({account:null}).message,/Sign in/);
 assert.match(naturalVoiceGuidance({account:{balance:0,verified:false},accessAllowed:false}).message,/Verify your email/);
 assert.equal(naturalVoiceGuidance({account:{balance:0,verified:true},eligible:false,accessAllowed:true}).link,'View speech packs');
 assert.match(naturalVoiceGuidance({account:{balance:12345,verified:true},eligible:true,accessAllowed:true}).message,/12,345 characters/);
 assert.match(naturalVoiceGuidance({account:{balance:0,shortfall:true}}).message,/needs attention/);
 assert.match(naturalVoiceGuidance({account:{balance:100,verified:true},accessAllowed:false}).message,/unavailable/);
});
