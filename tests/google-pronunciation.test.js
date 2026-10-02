import test from 'node:test';
import assert from 'node:assert/strict';
import {googleSpeechText,synthesize} from '../cloudflare/prepared/google.js';

const original='email vendor → shipping vendor → identity data → convincing story → human';
const spoken='email vendor, then shipping vendor, then identity data, then convincing story, then human';
test('Google speaks prose chains as then without changing the source',async()=>{
 assert.equal(googleSpeechText(original),spoken);
 let request;
 await synthesize(original,'en-US-Wavenet-F','fixture',{fetcher:async(url,options)=>{
  request=JSON.parse(options.body);return Response.json({audioContent:'AA=='});
 }});
 assert.equal(request.input.text,spoken);
 assert.equal(request.voice.name,'en-US-Wavenet-F');
 assert.equal(original,'email vendor → shipping vendor → identity data → convincing story → human');
 assert.equal(googleSpeechText(`Heading\n${original}.\nNext paragraph.`),`Heading\n${spoken}.\nNext paragraph.`);
});
test('Google preserves ambiguous arrows, clocks, links and technical notation',()=>{
 for(const text of ['email vendor → human','3:00 → 5:00 PM → 6:00 PM',
  'https://example.com → shipping vendor → human','x → y → z',
  'input data → f(x) → output data','input_data → process → output',
  '`email vendor → shipping vendor → human`','email vendor→shipping vendor→human',
  'A → shipping vendor → human','email vendor -> shipping vendor -> human']){
  assert.equal(googleSpeechText(text),text,text);
 }
});
test('Rewrites never expand a valid chunk beyond the Google byte limit',async()=>{
 const chain='email vendor → shipping vendor → human';
 const text='z'.repeat(5000-Buffer.byteLength(chain)-1)+'\n'+chain;
 assert.equal(Buffer.byteLength(text),5000);
 assert.equal(googleSpeechText(text),text);
 let calls=0;
 await assert.rejects(synthesize(text+'z','en-US-Wavenet-F','fixture',{fetcher:async()=>{calls++;}}),/Unsupported/);
 assert.equal(calls,0);
});
