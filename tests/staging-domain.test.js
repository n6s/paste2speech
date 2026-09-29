import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['cloudflare/reader/worker.js'],bundle:true,write:false,format:'esm',platform:'node'});
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
import {legacyStagingResponse} from '../cloudflare/reader/legacy-domain.js';

test('staging move refuses unauthenticated access on both hostnames',async()=>{
 const env={READER_MODE:'staging',READER_ORIGIN:'https://staging.pastetospeech.com',ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUD:'aud'};
 for(const host of ['staging.pastetospeech.com','speak-staging.rogerpbrown.com']){
  const response=await worker.fetch(new Request('https://'+host+'/'),env,{});
  assert.equal(response.status,403);assert.equal(response.headers.get('location'),null);
 }
});
test('authenticated staging move never forwards tokens or replays API work',()=>{
 for(const [path,target] of [['/','/'],['/?testing=1&token=secret','/?testing=1'],['/pricing','/pricing'],['/signin?token=secret#secret','/api/billing'],['/api/billing/signin#secret','/api/billing'],['//evil.invalid/?next=secret','/']]){
  const response=legacyStagingResponse(new Request('https://speak-staging.rogerpbrown.com'+path));
  assert.equal(response.status,301);assert.equal(response.headers.get('location'),'https://staging.pastetospeech.com'+target+'#');assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
 }
 for(const [path,method] of [['/api/readings','POST'],['/api/billing/status','GET'],['/api/billing/login/confirm','POST'],['/','DELETE']]){
  const response=legacyStagingResponse(new Request('https://speak-staging.rogerpbrown.com'+path,{method}));
  assert.equal(response.status,410);assert.equal(response.headers.get('location'),null);
 }
});
