// No providers: approved public inclusion, unauthenticated/unapproved rejection and billing UI.
import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';import assert from'node:assert/strict';import{PUBLIC_READER_FEATURES}from'../cloudflare/reader/reader-features.js';
import{summaryDocumentResponse}from'../cloudflare/reader/summary-document-route.js';
try{
 execFileSync('npm',['run','build:reader:public'],{stdio:'inherit'});
 const app=readFileSync('work/production-reader/site/app.js','utf8');assert.match(app,/\/api\/summary\/documents/);assert.match(app,/generationPending/);assert.match(app,/\/api\/translation\/documents/);assert.ok(readFileSync('work/production-reader/site/math-speech-worker.js').length>0);
 let calls=0;const response=await summaryDocumentResponse(new Request('https://public.test/api/summary/documents',{method:'POST'}),{READER_MODE:'production-public',SUMMARY_DOCUMENT_SCHEMA:'1'},null,{provider:()=>{calls++;throw Error('No provider permitted');}});assert.equal(response.status,404);assert.equal(calls,0);
 const flags=JSON.parse(readFileSync('cloudflare/reader/wrangler.public.jsonc')).vars;assert.equal(flags.READER_FEATURES_VERSION,PUBLIC_READER_FEATURES);const anonymous=await summaryDocumentResponse(new Request('https://public.test/api/summary/documents',{method:'POST'}),flags,null,{provider:()=>calls++});assert.equal(anonymous.status,403);assert.equal(calls,0);
 execFileSync('node',['cloudflare/reader/check-public-browser.mjs'],{stdio:'inherit'});
 console.log('PASS Summary public boundary: reviewed document feature present, unauthenticated/unreviewed server rejects before provider, public billing assertions retained.');
}finally{
 // Browser gates below expect the historical trial build; never rebuild it
 // concurrently with readers of that directory.
 execFileSync('npm',['run','build:reader:production'],{stdio:'inherit'});
}
