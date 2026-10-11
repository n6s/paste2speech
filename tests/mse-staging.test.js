import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {stagingInput,mseStaging,fixtureChunks} from '../cloudflare/reader/mse-staging.js';
import {newJob,prepareJob,publicStatus} from '../cloudflare/prepared/job.js';
const env={MSE_STAGING:'1',PRIVATE_READER:'1',READER_MODE:'staging'};
const options={delivery:'mse',concurrency:3,cached:true,scenario:'normal'};
const raw={voice:'en-US-Wavenet-F',chunks:fixtureChunks('en-US-Wavenet-F'),mseOptions:options};
function db(){const sql=new DatabaseSync(':memory:');for(const file of readdirSync('cloudflare/reader/migrations').filter(name=>name<'0018').sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+file,'utf8'));sql.exec(readFileSync('cloudflare/reader/staging-migrations/0001_mse_campaign.sql','utf8'));sql.exec("INSERT INTO speech_budget VALUES('private-lifetime',24100,100000)");return sql;}
test('staging-only options validate fixtures and canonicalize identity',()=>{
 assert.ok(mseStaging(env));assert.equal(mseStaging({...env,READER_MODE:'production-public'}),false);
 assert.throws(()=>stagingInput(raw,{...env,READER_MODE:'production-trial'}));
 assert.deepEqual(stagingInput({...raw,mseOptions:{scenario:'normal',cached:true,concurrency:3,delivery:'mse'}},env),stagingInput(raw,env));
 assert.throws(()=>stagingInput({...raw,chunks:['private text']},env));
 assert.throws(()=>stagingInput({...raw,mseOptions:{...options,cached:false,scenario:'failure'}},env));
 assert.throws(()=>stagingInput(raw,{...env,MSE_NEW_READINGS:'0'}));
 assert.deepEqual(stagingInput({voice:raw.voice,chunks:['plain']},{READER_MODE:'production-public'}),{voice:raw.voice,chunks:['plain']});
});
test('trusted live incremental preparation requires an explicit server option and preserves sample metadata',async()=>{
 const bytes=new Uint8Array(readFileSync('tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3'));
 const job={...newJob({voice:raw.voice,chunks:['one','two'],mode:'live'},'owner','id'),mseOptions:{...options,cached:false,concurrency:1}};
 const objects=new Map();let calls=0;
 const deps={concurrency:1,publishEach:true,save:async()=>{},isCancelled:()=>false,store:{put:async(k,v)=>objects.set(k,v),get:async k=>new Response(objects.get(k))},speech:async()=>{calls++;return bytes;}};
 await assert.rejects(prepareJob(job,deps),/cached-only/);assert.equal(calls,0);
 await prepareJob(job,{...deps,stagingLive:true});assert.equal(calls,2);assert.equal(job.state,'ready');assert.equal(publicStatus(job).sections.length,2);
});

test('normal staging requests share production defaults without exposing testing options',()=>{
 const input={voice:raw.voice,chunks:['ordinary reading'],delivery:'mse'};
 const production={PROGRESSIVE_READER:'1',READER_MODE:'production-trial',PRIVATE_READER:'0',LOCAL_READER:'0'};
 assert.deepEqual(stagingInput(input,env),stagingInput(input,production));
 assert.deepEqual(stagingInput(input,env).mseOptions,{delivery:'mse',concurrency:3,cached:false,scenario:'normal'});
 for(const extra of [{cached:true},{concurrency:1},{scenario:'failure'},{mseOptions:options}])assert.throws(()=>stagingInput({...input,...extra},env));
 assert.throws(()=>stagingInput(input,{...env,MSE_NEW_READINGS:'0'}));
});
test('retiring staging ceilings preserves history and accounting above both former caps',()=>{
 const sql=db();sql.exec("INSERT INTO speech_admissions VALUES('historical',2084,'original')");
 const migration=readFileSync('cloudflare/reader/staging-migrations/0002_retire_speech_ceilings.sql','utf8');
 sql.exec(migration);sql.exec(migration);
 sql.exec("INSERT INTO speech_admissions VALUES('new',200000,'new')");
 assert.equal(sql.prepare('SELECT characters FROM speech_budget').get().characters,226184);
 assert.deepEqual({...sql.prepare('SELECT characters,active FROM mse_campaign').get()},{characters:2084,active:0});
 assert.equal(sql.prepare('SELECT characters FROM mse_campaign_admissions').get().characters,2084);
 assert.equal(sql.prepare("SELECT fingerprint FROM speech_admissions WHERE job='historical'").get().fingerprint,'original');
 assert.ok(sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='reservation_check'").get());
 sql.exec("INSERT INTO accounts(id,label,enabled,balance) VALUES('metered','Test',1,0)");
 assert.throws(()=>sql.exec("INSERT INTO reservations(job,account,fingerprint,plan,total,remaining,created) VALUES('unfunded','metered','test','[1]',1,1,1)"),/insufficient credit/);
 assert.equal(sql.prepare("SELECT balance FROM accounts WHERE id='metered'").get().balance,0);
 sql.close();
 const production=new DatabaseSync(':memory:');for(const file of readdirSync('cloudflare/reader/migrations').filter(name=>name<'0018').sort())production.exec(readFileSync('cloudflare/reader/migrations/'+file,'utf8'));
 assert.throws(()=>production.exec(migration),/mse_campaign/);
 assert.ok(production.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='budget_check'").get());production.close();
});
