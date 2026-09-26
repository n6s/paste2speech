import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
import {ReaderLedger} from '../cloudflare/reader/ledger.js';
const bundled=await build({entryPoints:['cloudflare/prepared/durable.js'],bundle:true,write:false,format:'esm',platform:'node'});
const {PreparedReading}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
function database(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('cloudflare/reader/migrations').sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+file,'utf8'));
 const db={prepare(text){return {bind(...args){return {first:async()=>sql.prepare(text).get(...args)||null,run:async()=>sql.prepare(text).run(...args),all:async()=>({results:sql.prepare(text).all(...args)})};}};},async batch(statements){sql.exec('BEGIN');try{for(const s of statements)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,ledger:new ReaderLedger(db)};
}
function context(){
 const values=new Map();let alarm=null;
 const storage={get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),delete:async key=>values.delete(key),setAlarm:async value=>{alarm=value;},getAlarm:async()=>alarm,deleteAlarm:async()=>{alarm=null;},transaction:async fn=>fn(storage)};
 return {storage,blockConcurrencyWhile:async fn=>fn(),values};
}
test('repeated settlement and reads do not write; expiry preserves original outcome',async()=>{
 const {sql,ledger}=database();const account=(await ledger.session(await ledger.newAccount())).id;
 sql.prepare('INSERT INTO grants VALUES(?,?,?)').run('grant',account,100);
 const input={voice:'en-US-Wavenet-F',mode:'fixture',chunks:['hello']};await ledger.reserve('job',account,input);
 const job={...input,id:'job',owner:account,state:'ready',created:Date.now(),parts:[{state:'ready',samples:24000}],submittedCharacters:5};
 await ledger.settle(job);const before=sql.prepare('SELECT total_changes() AS n').get().n;
 for(let i=0;i<100;i++)await ledger.settle({...job,state:i%2?'expired':'ready'});
 assert.equal(sql.prepare('SELECT total_changes() AS n').get().n,before);
 assert.equal(sql.prepare('SELECT outcome FROM reading_audit').get().outcome,'ready');sql.close();
});
test('unchanged payments only write their check timestamp; refunds remain atomic',async()=>{
 const {sql,ledger}=database(),account=(await ledger.session(await ledger.newAccount())).id;
 let order=await ledger.newOrder(account);await ledger.bindOrder(order.id,'txn_test');
 await ledger.syncPayment(order.id,'txn_test','completed',0);
 assert.equal((await ledger.order(order.id,account)).status,'credited');
 const before=sql.prepare('SELECT total_changes() AS n').get().n;
 await ledger.syncPayment(order.id,'txn_test','completed',0);
 assert.equal(sql.prepare('SELECT total_changes() AS n').get().n-before,1);
 await ledger.syncPayment(order.id,'txn_test','completed',500000);assert.equal((await ledger.account(account)).balance,500000);
 await ledger.syncPayment(order.id,'txn_test','completed',0);assert.equal((await ledger.account(account)).balance,1000000);sql.close();
});
test('corrupt storage has four delayed retries then stops, including after object restart',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);t.mock.method(console,'error',()=>{});
 const ctx=context();ctx.values.set('job',{storageVersion:2,pageCount:1});
 const env={};let object=new PreparedReading(ctx,env);
 for(const delay of [60000,300000,900000,3600000]){
  await object.alarm();assert.equal(await ctx.storage.getAlarm(),now+delay);
  const attempts=ctx.values.get('recovery').attempts;
  await object.alarm();assert.equal(ctx.values.get('recovery').attempts,attempts);
  now+=delay;object=new PreparedReading(ctx,env);
 }
 await object.alarm();assert.equal(await ctx.storage.getAlarm(),null);assert.equal(ctx.values.get('recovery').next,null);
 now+=48*3600000;await new PreparedReading(ctx,env).alarm();assert.equal(ctx.values.get('recovery').attempts,5);
});
test('cleanup retry skips completed/empty batches and resumes after failed deletion',async()=>{
 const ctx=context();let calls=0,fail=true;
 const object=new PreparedReading(ctx,{AUDIO:{delete:async keys=>{assert.ok(keys.length);calls++;if(fail)throw Error('transient');}}});
 object.job={id:'job',chunks:[],parts:[],cleanupOffset:0};object.loaded=true;
 await assert.rejects(object.clean());assert.equal(object.job.cleanupOffset,0);
 fail=false;assert.equal(await object.clean(),true);assert.equal(await object.clean(),true);assert.equal(calls,2);
});
test('retirement skips damaged pages when reservation is closed and retains a tombstone',async()=>{
 const ctx=context(),id='00000000-0000-4000-8000-000000000001';ctx.values.set('job',{id,owner:'owner',storageVersion:2,pageCount:1,created:1,expires:2});
 const object=new PreparedReading(ctx,{AUDIO:{list:async()=>({objects:[],truncated:false})}});
 const result=await (await object.maintenance({action:'retire'})).json();assert.equal(result.done,true);
 assert.equal(ctx.values.get('job').retired,true);assert.equal(ctx.values.get('job').owner,'');assert.equal(await ctx.storage.getAlarm(),null);
});
