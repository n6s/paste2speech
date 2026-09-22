import test from 'node:test';
import assert from 'node:assert/strict';
import {newJob,prepareJob,publicStatus,validateInput,canRetryAuthorization} from '../cloudflare/prepared/job.js';
import {accessToken,synthesize,readBounded} from '../cloudflare/prepared/google.js';
const frame=()=>{const b=new Uint8Array(192);b.set([255,243,132,196]);return b;};
const input={voice:'en-US-Wavenet-F',chunks:['At 9:30 a.m.','She writes: "A—B."','123.45','Last.'],mode:'live'};
function setup(){
  const job=newJob(input,'owner','test',0),saved=[],objects=new Map(),calls=[];
  const options={save:async j=>saved.push(structuredClone(j)),isCancelled:()=>job.state==='cancelled',now:()=>1000,
    store:{put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?new Response(objects.get(k)):null},
    speech:async(text,voice,index)=>{assert.equal(saved.at(-1).parts[index].state,'submitting');calls.push({text,voice,index});return frame();}};
  return {job,options,saved,objects,calls};
}
test('prepared reading records attempts before speech and preserves literal text and sample clock',async()=>{
  const {job,options,calls,objects}=setup();await prepareJob(job,options);
  assert.equal(job.state,'ready');assert.deepEqual(calls.map(c=>c.text),input.chunks);
  assert.equal(job.attempts,4);assert.equal(job.submittedCharacters,input.chunks.join('').length);
  assert.deepEqual(publicStatus(job).starts,[0,.024,.048,.072]);assert.equal(publicStatus(job).duration,.096);
  assert.equal(objects.get('test/reading.mp3').length,768);
  assert.match(objects.get('test/reading.vtt'),/She writes: "A—B\."/);
  assert.equal(publicStatus(job).owner,undefined);assert.equal(publicStatus(job).chunks,undefined);
  await prepareJob(job,options);assert.equal(calls.length,4,'ready jobs never regenerate');
});
test('concurrent synthesis never exceeds three and retains order despite out-of-order results',async()=>{
  const {job,options}=setup();let active=0,maximum=0;
  options.speech=async(t,v,i)=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,(3-i)*2));active--;return frame();};
  await prepareJob(job,options);assert.equal(maximum,3);assert.equal(job.state,'ready');
  assert.deepEqual(publicStatus(job).starts,[0,.024,.048,.072]);
});
test('interrupted and failed attempts are never retried automatically',async()=>{
  const {job,options,calls}=setup();job.parts[0].state='submitting';job.attempts=1;
  await prepareJob(job,options);assert.equal(job.state,'failed');assert.equal(calls.length,0);assert.equal(job.costIncomplete,true);
  await prepareJob(job,options);assert.equal(calls.length,0);
  const b=setup();b.options.speech=async()=>{throw Error('sensitive provider response');};
  await prepareJob(b.job,b.options);assert.equal(b.job.attempts,3);assert.equal(b.job.state,'failed');
  assert.ok(!b.job.error.includes('sensitive'));assert.ok(!b.objects.has('test/reading.mp3'));
});
test('explicit authorization retry is allowed once only when no paid call was attempted',()=>{
 const {job}=setup();job.state='failed';assert.equal(canRetryAuthorization(job),true);
 job.attempts=1;assert.equal(canRetryAuthorization(job),false);
 job.attempts=0;job.authorizationRestarts=1;assert.equal(canRetryAuthorization(job),false);
});
test('failed durable write prevents paid calls; cancellation stops subsequent batches',async()=>{
  const a=setup();a.options.save=async()=>{throw Error('disk');};
  await assert.rejects(prepareJob(a.job,a.options));assert.equal(a.calls.length,0);
  const b=setup();const speech=b.options.speech;b.options.speech=async(...args)=>{const data=await speech(...args);b.job.state='cancelled';return data;};
  await prepareJob(b.job,b.options);assert.equal(b.job.state,'cancelled');assert.equal(b.calls.length,3);
  assert.ok(!b.objects.has('test/reading.mp3'));
  assert.equal(b.saved.at(-1).parts.filter(p=>p.state==='ready').length,3,'persist successful in-flight sections before settlement');
});
test('input bounds are UTF-8 aware and do not rewrite the text',()=>{
  assert.deepEqual(validateInput(input).chunks,input.chunks);
  for(const chunks of [[],[''],['字'.repeat(1667)],Array(10001).fill('a')])assert.throws(()=>validateInput({...input,chunks}));
});
test('Google payload is plain original text without explicit pronunciation, pauses or speed',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return Response.json({audioContent:btoa(String.fromCharCode(...frame()))});};
  assert.deepEqual(await synthesize(input.chunks[1],input.voice,'test-token',{fetcher}),frame());
  assert.equal(calls[0].options.redirect,'manual','never forward authorization to a redirect target');
  assert.deepEqual(JSON.parse(calls[0].options.body),{input:{text:input.chunks[1]},voice:{languageCode:'en-US',name:input.voice},audioConfig:{audioEncoding:'MP3',sampleRateHertz:24000}});
  let attempts=0;await assert.rejects(synthesize('text',input.voice,'test',{fetcher:async()=>{attempts++;return new Response('private failure details',{status:503});}}),/No automatic retry/);
  assert.equal(attempts,1);
});
test('bounded provider reads reject oversized responses',async()=>{
  await assert.rejects(readBounded(new Response('12345'),4),/too large/);
});
test('Worker OAuth signs a verifiable fixed-endpoint JWT without exposing credentials on failure',async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const key=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey))));
  const account=JSON.stringify({type:'service_account',client_email:'synthetic@example.invalid',private_key:`-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`,token_uri:'https://untrusted.invalid'});
  const fetcher=async(url,options)=>{
    assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.equal(options.redirect,'manual');
    const [a,b,c]=options.body.get('assertion').split('.');
    const decode=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
    const payload=JSON.parse(new TextDecoder().decode(decode(b)));
    assert.equal(payload.aud,url);assert.equal(payload.exp-payload.iat,3600);
    assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,decode(c),new TextEncoder().encode(`${a}.${b}`)));
    return Response.json({access_token:'synthetic-token',token_type:'Bearer'});
  };
  assert.equal(await accessToken(account,{fetcher}),'synthetic-token');
  await assert.rejects(accessToken('sensitive invalid secret'),e=>!e.message.includes('sensitive'));
});

test('revoked reservation stops the next batch without submitting more text',async()=>{
 const {job,options,calls}=setup();let batches=0;options.beforeBatch=async()=>{if(++batches===2)throw Error('credit unavailable');};
 await prepareJob(job,options);assert.equal(calls.length,3);assert.equal(job.state,'failed');assert.equal(job.parts.filter(p=>p.state==='ready').length,3);
});
test('long files can exceed proof size while the final assembly remains bounded',async()=>{
 const audio=new Uint8Array(3*1024*1024);for(let offset=0;offset<audio.length;offset+=192)audio.set(frame(),offset);
 const a=setup();a.options.speech=async()=>audio;await prepareJob(a.job,a.options);
 assert.equal(a.job.state,'ready');assert.equal(a.objects.get('test/reading.mp3').length,12*1024*1024);
 const b=setup();b.job.chunks=Array(12).fill('Section');b.job.parts=b.job.chunks.map(()=>({state:'pending'}));b.options.speech=async()=>audio;
 await prepareJob(b.job,b.options);assert.equal(b.job.state,'failed');assert.ok(!b.objects.has('test/reading.mp3'));assert.match(b.job.error,/audio limit/);
});

test('sentence jobs resume in bounded batches beyond 32 sections without duplicate speech',async()=>{
 const {options,calls,objects}=setup();const job=newJob({...input,chunks:Array.from({length:205},(_,i)=>`Sentence ${i}.`)},'owner','long',0);
 options.isCancelled=()=>false;options.save=async()=>{};
 options.speech=async(text,voice,index)=>{calls.push(index);return frame();};
 let turns=0;while(job.state==='preparing'&&turns++<100)await prepareJob(job,{...options,maxBatches:1});
 assert.equal(job.state,'ready');assert.equal(calls.length,205);assert.equal(new Set(calls).size,205);
 assert.equal(job.assembledBlocks,3);assert.equal(publicStatus(job).starts.length,205);
 assert.equal(objects.get('long/reading.mp3').length,205*192);
});
