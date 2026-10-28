// No providers: build-time exclusion, server early rejection and public billing UI.
import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';import assert from'node:assert/strict';import{summaryDocumentResponse}from'../cloudflare/reader/summary-document-route.js';
try{
 execFileSync('npm',['run','build:reader:public'],{stdio:'inherit'});
 const app=readFileSync('work/production-reader/site/app.js','utf8');assert.doesNotMatch(app,/\/api\/summary\/documents|summary-pending-partial|generationPending/);
 let calls=0;const response=await summaryDocumentResponse(new Request('https://public.test/api/summary/documents',{method:'POST'}),{READER_MODE:'production-public',SUMMARY_DOCUMENT_SCHEMA:'1'},null,{provider:()=>{calls++;throw Error('No provider permitted');}});assert.equal(response.status,404);assert.equal(calls,0);
 execFileSync('node',['cloudflare/reader/check-public-browser.mjs'],{stdio:'inherit'});
 console.log('PASS Summary public boundary: document feature absent, server rejects before provider, public billing assertions retained.');
}finally{
 // Browser gates below expect the historical trial build; never rebuild it
 // concurrently with readers of that directory.
 execFileSync('npm',['run','build:reader:production'],{stdio:'inherit'});
}
