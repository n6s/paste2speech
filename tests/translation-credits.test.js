import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {jobFixture} from './helpers/ocr-job-fixture.js';import {TranslationCredits} from '../cloudflare/reader/translation-credits.js';import {liveTranslationResponse} from '../cloudflare/reader/translation.js';
const account={id:'a',email:'a@example.invalid',enabled:1,translationVerified:true};
async function fixture(provider){const f=await jobFixture(1);f.sql.exec(readFileSync('cloudflare/reader/staging-migrations/0016_translation_credits.sql','utf8'));f.grant(1000000);Object.assign(f.env,{TRANSLATION_UI:'1',TRANSLATION_BILLING_SCHEMA:'1',OWNER_EMAIL:account.email});let calls=0;const service=new TranslationCredits(f.env,{now:()=>f.clock,provider:async(...args)=>{calls++;return provider?provider(...args):{text:'Complete synthetic translation.',target:args[1]};}});const result={...f,service,calls:()=>calls,request:(input={})=>service.request(account,{requestId:crypto.randomUUID(),text:'Exact original 😀 text.\nLast line.',target:'en',priceCreditsPer1000:4,...input})};service.now=()=>result.clock;return result;}
test('exact fractional rate, one settlement and reusable source-target result across different entrypoint IDs',async()=>{
 const f=await fixture(),before=await f.wallet.balance('a'),text='A😀é',r=await f.request({text});assert.equal(r.status,200);assert.equal(r.creditsUsed,.012);assert.equal(f.calls(),1);assert.equal((await f.wallet.balance('a')).balance,before.balance-12);
 const cached=await f.request({text});assert.equal(cached.cached,true);assert.equal(cached.creditsUsed,0);assert.equal(cached.id,r.id);assert.equal(f.calls(),1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM translation_events').get().n,2);assert.throws(()=>f.sql.exec("UPDATE translation_attempts SET result='corrupt'"));assert.throws(()=>f.sql.exec('DELETE FROM translation_events'));assert.throws(()=>f.sql.exec('DELETE FROM translation_attempts'));
});
test('competing requests share one provider dispatch, one hold and one usable result',async()=>{
 let finish;const pending=new Promise(r=>finish=r),f=await fixture(async(_text,target)=>{await pending;return {text:'Complete queued translation.',target};});const before=await f.wallet.balance('a');const jobs=Array.from({length:12},()=>f.request());
 while(!f.calls())await new Promise(r=>setTimeout(r,1));const held=await f.wallet.balance('a');assert.ok(held.held>0);assert.equal(f.calls(),1);finish();const results=await Promise.all(jobs);assert.ok(results.every(r=>[200,202].includes(r.status)));assert.equal(f.calls(),1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM translation_events WHERE kind='hold'").get().n,1);assert.equal((await f.wallet.balance('a')).held,0);assert.ok((await f.wallet.balance('a')).balance<before.balance);
});
test('known pre-dispatch failure releases fully; another paid attempt requires explicit linked retry',async()=>{
 let fail=true;const f=await fixture(async(_text,target)=>{if(fail)throw Object.assign(Error('Synthetic authentication failure'),{translationNotDispatched:true});return {text:'Complete retry result.',target};});const before=await f.wallet.balance('a'),id=crypto.randomUUID(),r=await f.request({requestId:id});assert.equal(r.status,503);assert.equal(r.retryEligible,true);assert.equal((await f.wallet.balance('a')).balance,before.balance);assert.equal((await f.request({requestId:id})).status,409);assert.equal((await f.request()).status,409);assert.equal(f.calls(),1);
 fail=false;const retry=await f.request({retryOf:id});assert.equal(retry.status,200);assert.equal(f.calls(),2);assert.equal(f.sql.prepare('SELECT retry_of FROM translation_attempts WHERE id=?').get(retry.id).retry_of,id);
});
test('unknown provider outcome refunds customer but never silently permits another provider request',async()=>{
 const f=await fixture(async()=>{throw Error('Connection ended after dispatch');}),before=await f.wallet.balance('a'),r=await f.request();assert.equal(r.status,503);assert.equal(r.retryEligible,false);assert.equal((await f.wallet.balance('a')).balance,before.balance);assert.equal((await f.request({retryOf:r.id})).status,409);assert.equal(f.calls(),1);
});
test('lost insert/dispatch acknowledgements cannot double dispatch or lose a refundable hold',async()=>{
 for(const prefix of ['INSERT INTO translation_attempts','UPDATE translation_attempts SET dispatched=']){
  const f=await fixture(),before=await f.wallet.balance('a'),id=crypto.randomUUID();f.loseAck(prefix);try{await f.request({requestId:id});}catch{}
  assert.equal(f.calls(),0);assert.equal((await f.request({requestId:id})).status,202);f.clock+=120001;await f.service.expire();assert.equal((await f.wallet.balance('a')).balance,before.balance);assert.equal((await f.wallet.balance('a')).held,0);assert.equal(f.calls(),0);
 }
});
test('lost successful settlement acknowledgement reopens charged result without refund or new charge',async()=>{
 const f=await fixture(),id=crypto.randomUUID();f.loseAck("UPDATE translation_attempts SET state='ready'");const r=await f.request({requestId:id});assert.equal(r.status,200);assert.equal(r.cached,true);assert.equal(f.calls(),1);const balance=(await f.wallet.balance('a')).balance;assert.equal((await f.request({requestId:id})).status,200);assert.equal((await f.wallet.balance('a')).balance,balance);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM translation_events WHERE kind='release'").get().n,0);
});
test('expired result needs explicit new priced request; old paid receipt survives',async()=>{
 const f=await fixture(),r=await f.request(),balance=(await f.wallet.balance('a')).balance;f.clock+=86400001;await f.service.expire();assert.equal(f.sql.prepare('SELECT result FROM translation_attempts WHERE id=?').get(r.id).result,null);assert.equal((await f.request()).status,409);assert.equal((await f.wallet.balance('a')).balance,balance);const next=await f.request({retryOf:r.id});assert.equal(next.status,200);assert.equal(f.calls(),2);assert.equal(f.sql.prepare('SELECT consumed FROM translation_attempts WHERE id=?').get(r.id).consumed,Math.round(r.creditsUsed*1000));
});
test('foreign/unverified/production and insufficient balances cannot dispatch; changed identity rejected',async()=>{
 const f=await fixture();await assert.rejects(f.service.request({...account,translationVerified:false},{}));f.env.READER_MODE='production-public';await assert.rejects(f.request());f.env.READER_MODE='staging';f.sql.exec("UPDATE unified_wallets SET balance=0 WHERE account='a'");await assert.rejects(f.request());assert.equal(f.calls(),0);f.grant(1000);const id=crypto.randomUUID();await f.request({requestId:id,text:'First'});await assert.rejects(f.request({requestId:id,text:'Changed'}));assert.equal(f.calls(),1);
});
test('migration preserves every prior row and passes database integrity/foreign-key checks',async()=>{
 const f=await jobFixture(1),tables=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name),snapshot=()=>Object.fromEntries(tables.map(t=>[t,f.sql.prepare('SELECT * FROM "'+t+'"').all()])),before=snapshot();f.sql.exec(readFileSync('cloudflare/reader/staging-migrations/0016_translation_credits.sql','utf8'));assert.deepEqual(snapshot(),before);assert.equal(f.sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('prepared HTTP seam enforces account, quoted price and stable request; usable result settles once',async()=>{
 const f=await fixture(),owner={...account,translationScope:'opaque-synthetic-scope'},id=crypto.randomUUID(),input={requestId:id,text:'Complete source.',target:'en',priceCreditsPer1000:4,scope:owner.translationScope};let calls=0;
 const provider=async(_text,target)=>{calls++;return {text:'Complete synthetic translation.',target};};
 const request=(body=input)=>new Request('https://fixture/api/translation',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':body.requestId},body:JSON.stringify(body)});
 assert.equal((await liveTranslationResponse(request(),f.env,null,{provider})).status,403);
 assert.equal((await liveTranslationResponse(request({...input,scope:'old-account'}),f.env,owner,{provider})).status,409);
 assert.equal((await liveTranslationResponse(request({...input,priceCreditsPer1000:3}),f.env,owner,{provider})).status,409);assert.equal(calls,0);
 const r=await liveTranslationResponse(request(),f.env,owner,{provider});assert.equal(r.status,200);assert.equal((await r.json()).creditsUsed,.064);
 const replay=await liveTranslationResponse(request(),f.env,owner,{provider});assert.equal(replay.status,200);assert.equal((await replay.json()).creditsUsed,0);assert.equal(calls,1);
});

test('bounded live proof atomically permits at most two dispatches and 5000 total code points; cache is free',async()=>{
 const f=await fixture();f.env.TRANSLATION_LIVE_TEST_BUDGET='1';const before=await f.wallet.balance('a');
 const inputs=['A','B','C'].map(letter=>letter.repeat(2500));const requests=await Promise.all(inputs.map(text=>f.request({text})));
 assert.equal(f.calls(),2);assert.equal(requests.filter(r=>r.status===200).length,2);assert.equal(requests.filter(r=>r.status===409).length,1);
 const budget=f.sql.prepare('SELECT COUNT(*) n,SUM(characters) characters FROM translation_attempts WHERE dispatched IS NOT NULL').get();assert.deepEqual({...budget},{n:2,characters:5000});
 const after=await f.wallet.balance('a');assert.equal(before.balance-after.balance,20000);assert.equal(after.held,0);
 assert.equal((await f.request({text:inputs[requests.findIndex(r=>r.status===200)]})).cached,true);assert.equal(f.calls(),2);assert.equal((await f.wallet.balance('a')).balance,after.balance);
});
test('a single oversized live proof input never reaches provider and returns its entire hold',async()=>{
 const f=await fixture();f.env.TRANSLATION_LIVE_TEST_BUDGET='1';const before=await f.wallet.balance('a');const result=await f.request({text:'x'.repeat(5001)});assert.equal(result.status,409);assert.equal(f.calls(),0);assert.equal((await f.wallet.balance('a')).balance,before.balance);assert.equal((await f.wallet.balance('a')).held,0);
});

test('failure diagnostics distinguish provider HTTP from settlement without recording source or raw errors',async()=>{
 for(const mode of ['http','settlement']){
  const f=await fixture(mode==='http'?async()=>{throw Object.assign(Error('SECRET RAW PROVIDER BODY'),{translationStage:'provider_http',translationStatus:429});}:undefined),events=[];f.service.diagnose=event=>events.push(event);
  if(mode==='settlement')f.sql.exec("CREATE TRIGGER synthetic_translation_settlement_failure BEFORE UPDATE OF state ON translation_attempts WHEN NEW.state='ready' BEGIN SELECT RAISE(ABORT,'SECRET RAW SQL MESSAGE'); END;");
  const result=await f.request({text:'PRIVATE SOURCE MUST NOT ENTER DIAGNOSTICS'});assert.equal(result.status,503);assert.equal(result.failure.stage,mode==='http'?'provider_http':'settlement');assert.equal(events.length,1);assert.doesNotMatch(JSON.stringify(events),/PRIVATE SOURCE|SECRET RAW/);if(mode==='http')assert.equal(result.failure.httpStatus,429);assert.equal(f.calls(),1);assert.equal((await f.wallet.balance('a')).held,0);
 }
});
test('omitting the already-off temporary test flag preserves normal staging behavior and charges',async()=>{const observations=[];for(const value of['0',undefined]){const f=await fixture();if(value!==undefined)f.env.TRANSLATION_LIVE_TEST_BUDGET=value;const before=await f.wallet.balance('a'),results=[];for(let i=0;i<4;i++){const r=await f.request({text:'A distinct synthetic source '+i,target:'eo'});results.push({status:r.status,creditsUsed:r.creditsUsed});}const config=await(await liveTranslationResponse(new Request('https://synthetic.test/api/translation/config'),f.env,account)).json();observations.push({results,calls:f.calls(),delta:before.balance-(await f.wallet.balance('a')).balance,config});}assert.deepEqual(observations[0],observations[1]);assert.equal(observations[0].calls,4);});
