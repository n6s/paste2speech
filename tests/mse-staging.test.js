import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {stagingInput,mseStaging,fixtureChunks} from '../cloudflare/reader/mse-staging.js';
import {newJob,prepareJob,publicStatus} from '../cloudflare/prepared/job.js';
const env={MSE_STAGING:'1',PRIVATE_READER:'1',READER_MODE:'staging'};
const options={delivery:'mse',concurrency:3,cached:true,scenario:'normal'};
const raw={voice:'en-US-Wavenet-F',chunks:fixtureChunks('en-US-Wavenet-F'),mseOptions:options};
function db(){const sql=new DatabaseSync(':memory:');for(const file of readdirSync('cloudflare/reader/migrations').sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+file,'utf8'));sql.exec(readFileSync('cloudflare/reader/staging-migrations/0001_mse_campaign.sql','utf8'));sql.exec("INSERT INTO speech_budget VALUES('private-lifetime',24100,100000)");return sql;}
test('staging campaign admission and lifetime debit commit or roll back together',()=>{
 const sql=db();sql.exec("INSERT INTO speech_admissions VALUES('a',2084,'a')");
 assert.equal(sql.prepare('SELECT characters FROM mse_campaign').get().characters,2084);
 assert.equal(sql.prepare('SELECT characters FROM speech_budget').get().characters,26184);
 assert.throws(()=>sql.exec("INSERT INTO speech_admissions VALUES('b',917,'b')"),/mse_campaign/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM speech_admissions').get().n,1);
 assert.equal(sql.prepare('SELECT characters FROM speech_budget').get().characters,26184);
 sql.exec("INSERT INTO speech_admissions SELECT 'a',2084,'a' WHERE NOT EXISTS(SELECT 1 FROM speech_admissions WHERE job='a')");
 assert.equal(sql.prepare('SELECT characters FROM mse_campaign').get().characters,2084);
 sql.exec("INSERT INTO speech_admissions VALUES('c',916,'c')");assert.equal(sql.prepare('SELECT characters FROM mse_campaign').get().characters,3000);
 assert.throws(()=>sql.exec("UPDATE mse_campaign SET maximum=3001"));sql.close();
});
test('an exhausted lifetime budget cannot consume campaign credit',()=>{
 const sql=db();sql.exec('UPDATE speech_budget SET characters=100000');assert.throws(()=>sql.exec("INSERT INTO speech_admissions VALUES('a',1,'a')"),/speech_budget/);
 assert.equal(sql.prepare('SELECT characters FROM mse_campaign').get().characters,0);sql.close();
});
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
