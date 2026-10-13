import test from 'node:test';
import assert from 'node:assert/strict';
import {providerRejection,safeProviderRequestId} from '../cloudflare/reader/ocr-provider-diagnostics.js';
const reject=(body,status=400,headers={})=>providerRejection(Response.json(body,{status,headers}));
test('provider rejection persists only bounded allowlisted classification, never arbitrary vendor text',async()=>{
 for(const [code,category] of [['file_download_error','source_fetch_error'],['invalid_image','document_rejected'],['validation_error','request_rejected'],['authentication_error','authentication_error'],['rate_limit_exceeded','rate_limited'],['internal_server_error','provider_unavailable']]){
  const value=await reject({error:{code,message:'https://secret.test/file/token private filename.jpg Bearer key'}},400,{'x-request-id':'req_123:ok'});
  assert.equal(value.error.category,category);assert.equal(value.error.classificationSource,'provider_code');assert.equal(value.requestId,'req_123:ok');assert.ok(!JSON.stringify(value).includes('secret.test'));assert.ok(!JSON.stringify(value).includes('filename'));
 }
 const generic=await reject({error:{type:'invalid_request_error',message:'Failed to fetch document'}});assert.equal(generic.error.category,'source_fetch_error');assert.equal(generic.error.code,'invalid_request_error');assert.equal(generic.error.classificationSource,'message_pattern');
 const value=await reject({error:{code:'https://private.test/token',message:'Unable to download https://private.test/capability'}});
 assert.equal(value.error.code,null);assert.equal(value.error.category,'source_fetch_error');assert.equal(value.error.classificationSource,'message_pattern');assert.ok(!JSON.stringify(value).includes('private.test'));
});
test('missing/unusable provider detail remains unknown, body read has byte and time bounds',async()=>{
 for(const [status,category] of [[400,'bad_request_unspecified'],[401,'authentication_error'],[429,'rate_limited'],[500,'provider_unavailable']])assert.equal((await reject({},status)).error.category,category);
 assert.equal((await providerRejection(new Response('x'.repeat(4097),{status:400}))).error.bodyState,'oversized');
 assert.equal((await providerRejection(new Response('private non-JSON',{status:400}))).error.bodyState,'unreadable');
 assert.equal((await reject(null)).error.bodyState,'unreadable');
 let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});const started=Date.now();
 assert.equal((await providerRejection(new Response(body,{status:400}),{timeoutMs:5})).error.bodyState,'timeout');assert.ok(Date.now()-started<1000);assert.equal(cancelled,true);
});
test('provider request IDs reject URLs, credentials, control characters and unbounded text',async()=>{
 for(const id of ['https://private.test/token','Bearer key','x\nsecret','x'.repeat(101),'synthetic-key-only','prefix-capability-suffix'])assert.equal(safeProviderRequestId(id,['synthetic-key-only','capability']),null);
 assert.equal(safeProviderRequestId('request-123'),'request-123');
 const value=await providerRejection(Response.json({}, {status:400,headers:{'x-request-id':'synthetic-key-only'}}),{secrets:['synthetic-key-only']});assert.equal(value.requestId,null);
});
