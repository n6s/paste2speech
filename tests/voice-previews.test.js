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

import {WAVENET_VOICES,WAVENET_VOICE_IDS} from '../public/wavenet-voices.js';
import {validateInput} from '../cloudflare/prepared/job.js';
import {synthesize} from '../cloudflare/prepared/google.js';
import {readFile} from 'node:fs/promises';

test('All twelve catalog voices admit and synthesize using their exact identity',async()=>{
 const expected=['F','D','A','B','C','E','G','H','I','J'].map(v=>`en-US-Wavenet-${v}`).concat(['en-GB-Wavenet-F','en-GB-Wavenet-D']);
 assert.deepEqual(WAVENET_VOICE_IDS,expected);assert.equal(new Set(WAVENET_VOICES.map(v=>v.name)).size,12);
 const bytes=await readFile('tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3');
 for(const voice of expected){
  assert.equal(validateInput({voice,chunks:['Hello.']}).voice,voice);
  let calls=0;
  const result=await synthesize('Hello.',voice,'fixture-token',{fetcher:async(url,options)=>{
   calls++;const request=JSON.parse(options.body);assert.deepEqual(request.voice,{languageCode:voice.slice(0,5),name:voice});
   return Response.json({audioContent:bytes.toString('base64')});
  }});
  assert.equal(calls,1);assert.deepEqual(Buffer.from(result),bytes);
 }
 assert.throws(()=>validateInput({voice:'en-AU-Wavenet-A',chunks:['Hello.']}));
 await assert.rejects(synthesize('Hello.','en-US-Wavenet-Z','fixture-token'),/Unsupported/);
});
