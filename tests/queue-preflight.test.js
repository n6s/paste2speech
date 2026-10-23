import test from 'node:test';import assert from 'node:assert/strict';import{checkQueuedAccount}from'../public/queue-preflight.js';import{ReadingQueue}from'../public/reading-queue.js';
test('queue preflight preserves safe network/auth/HTML failure outcomes and never changes scope',async()=>{
 const snapshot={engine:'google',scope:'original-owner'};
 await assert.rejects(checkQueuedAccount(snapshot,async()=>{throw TypeError('Failed to fetch');}),/Text kept.*No speech was started/);
 for(const status of [401,403])await assert.rejects(checkQueuedAccount(snapshot,async()=>Response.json({},{status})),/Sign in.*No speech was started/);
 await assert.rejects(checkQueuedAccount(snapshot,async()=>Response.json({},{status:503})),/account could not be confirmed/);
 await assert.rejects(checkQueuedAccount(snapshot,async()=>new Response('<html>sign in</html>')),/unreadable response/);
 await assert.rejects(checkQueuedAccount(snapshot,async()=>Response.json({consentScope:'different-owner'})),/account changed/);
 await checkQueuedAccount(snapshot,async(_url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return Response.json({consentScope:'original-owner'});});
 await checkQueuedAccount({engine:'browser'},async()=>{throw Error('Browser speech cannot require account fetch');});
});
test('failed retained queue text retries only explicitly and deduplicates concurrent starts',async()=>{
 let calls=0,release;const queue=new ReadingQueue({start:async()=>{calls++;if(calls===1)throw TypeError('Failed to fetch');await new Promise(r=>release=r);return true;}}),item=queue.reserve();queue.resolve(item.id,'Retained complete text.');queue.advance();await new Promise(r=>setImmediate(r));assert.equal(item.state,'error');assert.equal(item.text,'Retained complete text.');queue.advance();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 assert.equal(queue.retry(item.id),true);await new Promise(r=>setImmediate(r));assert.equal(queue.retry(item.id),false);assert.equal(calls,2);release();await new Promise(r=>setImmediate(r));assert.equal(queue.items.length,0);
 const empty=queue.reserve();queue.fail(empty.id,'No decoded text');assert.equal(queue.retry(empty.id),false);
});
