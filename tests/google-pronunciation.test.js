import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText,chunkText,defaults} from '../public/text.js';
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

const insulin='insulin resistance / hyperglycemia → increased urinary magnesium losses → poorer magnesium status → impaired insulin signaling';
const insulinSpoken='insulin resistance / hyperglycemia, then increased urinary magnesium losses, then poorer magnesium status, then impaired insulin signaling';
for(const emoji of [false,true])test(`Spaced prose slash reaches US WaveNet F as then with emoji cleanup ${emoji}`,async()=>{
 const cleaned=cleanText(insulin,{...defaults,emoji}),chunks=chunkText(cleaned),requests=[];
 assert.equal(cleaned,insulinSpoken);assert.deepEqual(chunks,[insulinSpoken]);
 for(const chunk of chunks)await synthesize(chunk,'en-US-Wavenet-F','mock-only',{fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json({audioContent:'AA=='});}});
 assert.equal(requests.length,1);assert.equal(requests[0].input.text,insulinSpoken);assert.equal(requests[0].voice.name,'en-US-Wavenet-F');assert.equal(requests[0].input.text.includes('→'),false);
});
test('Spaced slash extension preserves paths, formulas, clocks, retained code and table rows',()=>{
 for(const text of ['input data/path → process data → output data','https://example.com / data → process data → output data',
  'input data / f(x) → process data → output data','x / y → process data → output data','10 / 2 → process data → output data',
  '3:00 / 5:00 PM → later time → ending time','input data / → process data → output data','input data / x → process data → output data',
  '`'+insulin+'`','insulin_resistance / hyperglycemia → process_data → output_data'])assert.equal(googleSpeechText(text),text,text);
 const retained=cleanText('```text\ninsulin_resistance / hyperglycemia → process_data → output_data\n```',{...defaults,code:false,emoji:true});
 assert.equal(googleSpeechText(retained),retained);
 const table='| Cause | Effect |\n| --- | --- |\n| insulin resistance / hyperglycemia | increased urinary magnesium losses → poorer magnesium status → impaired insulin signaling |';
 assert.equal(cleanText(table,{...defaults,emoji:true}),'');
 const kept=cleanText(table,{...defaults,tables:false,emoji:true});assert.equal(googleSpeechText(kept),kept);
 assert.equal(googleSpeechText(insulin+'\ninput data/path → process data → output data'),insulinSpoken+'\ninput data/path → process data → output data');
});
