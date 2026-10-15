import test from 'node:test';
import assert from 'node:assert/strict';
import {jobFixture} from './helpers/ocr-job-fixture.js';

test('duplicate fingerprint reuses only complete same-account pinned-model output without new holds or dispatch',async()=>{
 const f=await jobFixture(2);await f.start();await f.accept();await f.job.alarm();assert.equal(f.calls,1);
 const before=await f.job.ledger.balance('a');const again=await jobFixture(2,{shared:f});again.bytes=f.bytes;const quote=await again.start();assert.equal(quote.prior.id,f.id);assert.equal(quote.prior.state,'ready');assert.equal(quote.prior.durable,true);
 const result=await f.request('/result',undefined,'GET');assert.equal(result.status,200);const body=await result.json();assert.equal(body.p2s_ocr.creditsUsed,0);assert.equal(body.p2s_ocr.cached,true);assert.equal(again.calls,0);assert.deepEqual(await again.job.ledger.balance('a'),before);
 assert.equal((await f.job.fetch(new Request('https://internal/result',{headers:{'X-Ocr-Owner':'foreign'}}))).status,503);
 await again.request('/cancel',{});const different=await jobFixture(3,{shared:f});const miss=await different.start();assert.equal(miss.prior,undefined);assert.equal(different.calls,0);
});

test('cached results reject expired, missing and incompatible processing/representation versions without redispatch',async()=>{
 const f=await jobFixture(2);await f.start();await f.accept();await f.job.alarm();const row=await f.row(),object=f.objects.get(row.cache_key);const original=Buffer.from(object.bytes);
 const manifest=JSON.parse(object.bytes);manifest.version='future-processing-options-v2';object.bytes=Buffer.from(JSON.stringify(manifest));assert.equal((await f.request('/result',undefined,'GET')).status,503);object.bytes=original;
 f.objects.delete(row.cache_key);assert.equal((await f.request('/result',undefined,'GET')).status,503);f.objects.set(row.cache_key,object);
 f.clock+=86400001;assert.equal((await f.request('/result',undefined,'GET')).status,410);assert.equal(f.calls,1);
 assert.equal((await f.row()).state,'ready');
});
