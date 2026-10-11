// Optional reproduction of retired September 2026 staging limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
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
