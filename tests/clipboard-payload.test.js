import test from 'node:test';import assert from 'node:assert/strict';import {clipboardPayload} from '../public/clipboard-payload.js';
const item=(type,bytes)=>({types:[type],getType:async mime=>new Blob([bytes],{type:mime})});
test('clipboard payload reads once and returns PNG/JPEG/WebP files without provider work',async()=>{
 for(const mime of ['image/png','image/jpeg','image/webp']){let reads=0;const result=await clipboardPayload({read:async()=>{reads++;return [item(mime,new Uint8Array([1,2,3]))];}});assert.equal(reads,1);assert.equal(result.image.type,mime);assert.equal(result.image.size,3);assert.equal(result.text,'');}
});
test('mixed clipboard prefers text without fetching image bytes, regardless of item order',async()=>{
 const image={types:['image/png'],getType(){throw Error('image bytes must not be fetched for mixed text');}};
 for(const items of [[image,item('text/plain','Text stays')],[item('text/plain','Text stays'),image]])assert.deepEqual(await clipboardPayload({read:async()=>items}),{text:'Text stays',image:null,hasImage:true});
});
test('empty clipboard, text fallback, multiple images and denied reads remain distinct',async()=>{
 assert.deepEqual(await clipboardPayload({read:async()=>[]}),{text:'',image:null,hasImage:false});assert.equal((await clipboardPayload({readText:async()=>'Fallback'})).text,'Fallback');
 await assert.rejects(clipboardPayload({read:async()=>[item('image/png','a'),item('image/jpeg','b')]}),/multiple-images/);await assert.rejects(clipboardPayload({read:async()=>{throw Error('denied');}}),/denied/);await assert.rejects(clipboardPayload({}),/unavailable/);
});
test('plain clipboard representation is read once and a failed plain-only read stays an error',async()=>{
 let reads=0;const plain={types:['text/plain'],getType:async()=>{reads++;return new Blob(['Keep source']);}};
 assert.equal((await clipboardPayload({read:async()=>[plain]})).text,'Keep source');assert.equal(reads,1);
 await assert.rejects(clipboardPayload({read:async()=>[{types:['text/plain'],getType:async()=>{throw Error('denied representation');}}]}),/denied representation/);
});
test('separate HTML/plain clipboard items reuse the companion plain read during fallback',async()=>{
 let plainReads=0,htmlReads=0;
 const html={types:['text/html'],getType:async()=>{htmlReads++;return new Blob(['<p>Text</p>']);}};
 const plain={types:['text/plain'],getType:async()=>{plainReads++;return new Blob(['Keep companion source']);}};
 // Without a DOM the inert HTML converter declines conversion; plain fallback
 // must reuse the read made while examining the preceding HTML item.
 assert.equal((await clipboardPayload({read:async()=>[html,plain]})).text,'Keep companion source');
 assert.equal(plainReads,1);assert.equal(htmlReads,1);
});

test('rich unavailable, failed or unusable reads fall back to plain text once',async()=>{
 for(const mode of ['absent','unsupported','failed','empty','blank','unknown','representation']){
  const calls=[];
  const clipboard={readText:async()=>{calls.push('readText');return 'Plain fallback.';}};
  if(mode!=='absent')clipboard.read=async()=>{
   calls.push('read');
   if(mode==='unsupported')throw new DOMException('Unsupported','NotSupportedError');
   if(mode==='failed')throw new DOMException('Unavailable','DataError');
   if(mode==='representation')return [{types:['text/plain'],getType:async()=>{throw new DOMException('Missing','NotFoundError');}}];
   return mode==='blank'?[item('text/plain','  ')]:mode==='unknown'?[item('application/x-custom','bytes')]:[];
  };
  assert.equal((await clipboardPayload(clipboard)).text,'Plain fallback.');
  assert.deepEqual(calls,mode==='absent'?['readText']:['read','readText'],mode);
 }
});
test('explicit denials and cancellation stop without attempting another clipboard read',async()=>{
 for(const name of ['NotAllowedError','SecurityError','AbortError'])for(const stage of ['read','plain','html','companion']){
  let fallback=0;
  const fail=async()=>{throw new DOMException('Private failure',name);};
  const denied={types:[stage==='html'?'text/html':'text/plain'],getType:fail};
  const clipboard={read:stage==='read'?fail:async()=>stage==='companion'?[item('text/html','<p>Text</p>'),denied]:[denied],readText:async()=>{fallback++;return 'Must not read';}};
  await assert.rejects(clipboardPayload(clipboard),error=>error.name===name);
  assert.equal(fallback,0,stage+' '+name);
 }
});
test('rich text and image success need no readText; multiple images keep their error',async()=>{
 let fallback=0;
 const readText=async()=>{fallback++;throw Error('Unexpected fallback');};
 assert.equal((await clipboardPayload({read:async()=>[item('text/plain','Rich text')],readText})).text,'Rich text');
 assert.equal((await clipboardPayload({read:async()=>[item('image/png','bytes')],readText})).image.type,'image/png');
 await assert.rejects(clipboardPayload({read:async()=>[item('image/png','a'),item('image/jpeg','b')],readText}),/multiple-images/);
 assert.equal(fallback,0);
});
test('a failed or empty plain fallback remains unsuccessful without retries',async()=>{
 for(const result of ['empty','denied','failed']){
  const calls=[];
  const promise=clipboardPayload({read:async()=>{calls.push('read');return [];},readText:async()=>{calls.push('readText');if(result==='denied')throw new DOMException('Blocked','NotAllowedError');if(result==='failed')throw Error('Unavailable');return '';}});
  if(result==='empty')assert.equal((await promise).text,'');else await assert.rejects(promise);
  assert.deepEqual(calls,['read','readText']);
 }
});
