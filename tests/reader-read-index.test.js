import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {ReaderLedger} from '../cloudflare/reader/ledger.js';
import {UsageLedger} from '../cloudflare/prepared/ledger.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync('cloudflare/reader/migrations').filter(name=>name<'0018').sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+name,'utf8'));
 const queries=[];
 const db={prepare(text){queries.push(text);return {bind(...args){return {first:async()=>sql.prepare(text).get(...args)||null,run:async()=>sql.prepare(text).run(...args),all:async()=>({results:sql.prepare(text).all(...args)})};}};}};
 db.batch=async statements=>{sql.exec('BEGIN');try{for(const statement of statements)await statement.run();sql.exec('COMMIT');}catch(error){sql.exec('ROLLBACK');throw error;}};
 sql.exec("INSERT INTO accounts VALUES('a','A',0,0),('b','B',0,0); INSERT INTO identities VALUES('a@example.test','a'); INSERT INTO legacy_pilots VALUES('a');");
 const insert=sql.prepare("INSERT INTO reservations(job,account,fingerprint,plan,total,remaining,state,created,metered) VALUES(?,?,'f','[]',100,?,?,0,?)");
 return {sql,queries,reader:new ReaderLedger(db),base:new UsageLedger(db),add:(id,account,remaining,state,metered)=>insert.run(id,account,remaining,state,metered)};
}
test('open reservation index excludes closed history for both balance aggregates',async()=>{
 const s=setup();s.sql.exec("UPDATE accounts SET enabled=1,balance=1000000");
 for(let i=0;i<1000;i++)s.add('closed'+i,'a',0,'closed',1);
 s.add('one','a',10,'open',1);s.add('two','a',20,'open',1);s.add('unmetered','a',40,'open',0);s.add('foreign','b',70,'open',1);
 for(const extra of ['', ' AND metered=1']){
  const query="SELECT COALESCE(SUM(remaining),0) AS reserved FROM reservations WHERE account=? AND state='open'"+extra;
  const plan=s.sql.prepare('EXPLAIN QUERY PLAN '+query).all('a').map(r=>r.detail).join('\n');
  assert.match(plan,/USING INDEX reservations_open_account/);assert.doesNotMatch(plan,/SCAN reservations/);
  assert.equal(s.sql.prepare(query).get('a').reserved,extra?30:70);
 }
 assert.equal((await s.base.account('a')).reserved,70);assert.equal((await s.reader.account('a')).reserved,30);
 assert.equal(await s.reader.account('missing'),null);s.sql.close();
});
test('account fields and metered holds stay correct through reservation lifecycle',async()=>{
 const s=setup();const before=await s.reader.account('a');assert.equal(before.reserved,0);assert.equal(before.email,'a@example.test');assert.equal(before.legacyPilot,true);
 s.sql.exec("UPDATE accounts SET enabled=1 WHERE id='a'; INSERT INTO grants VALUES('grant','a',100);");
 const input={voice:'en-US-Wavenet-F',mode:'fixture',chunks:['hello']};
 await s.reader.reserve('ready','a',input);assert.equal((await s.reader.account('a')).reserved,5);
 await s.reader.settle({...input,id:'ready',owner:'a',state:'ready',created:Date.now(),parts:[{state:'ready',samples:24000}],submittedCharacters:5});
 assert.equal((await s.reader.account('a')).balance,95);assert.equal((await s.reader.account('a')).reserved,0);
 await s.reader.reserve('cancel','a',input);
 await s.reader.settle({...input,id:'cancel',owner:'a',state:'cancelled',created:Date.now(),parts:[{state:'pending'}]});
 const after=await s.reader.account('a');assert.equal(after.balance,95);assert.equal(after.reserved,0);assert.equal(after.email,before.email);assert.equal(after.legacyPilot,true);
 s.sql.exec("INSERT INTO account_debt VALUES('a',7) ON CONFLICT(account) DO UPDATE SET characters=excluded.characters");assert.equal((await s.reader.account('a')).shortfall,7);s.sql.close();
});

test('reader account uses one metered hold aggregate and missing accounts use none',async()=>{
 const s=setup();await s.reader.account('a');
 const aggregates=s.queries.filter(q=>/SUM\(remaining\)/.test(q));
 assert.equal(aggregates.length,1);assert.match(aggregates[0],/metered=1/);
 s.queries.length=0;assert.equal(await s.reader.account('missing'),null);
 assert.equal(s.queries.filter(q=>/SUM\(remaining\)/.test(q)).length,0);
 assert.equal(await s.base.account('missing'),null);s.sql.close();
});
