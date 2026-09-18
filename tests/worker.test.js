import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{validFeedback,validEvent,deliver} from '../cloudflare/worker.js';
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));
 const wrapper=sql=>{let params=[];return {bind(...p){params=p;return this;},async first(){return db.prepare(sql).get(...params)||null;},async run(){return db.prepare(sql).run(...params);},async all(){return {results:db.prepare(sql).all(...params)}}};};
 return {db,env:{DB:{prepare:wrapper,async batch(items){return Promise.all(items.map(x=>x.run()));}},PUBLIC_ORIGIN:'https://speak.rogerpbrown.com',FEEDBACK_SECRET:'test-secret',TELEGRAM_BOT_TOKEN:'TEST',TELEGRAM_CHAT_ID:'123',EVENT_LIMIT:{limit:async()=>({success:true})},FEEDBACK_LIMIT:{limit:async()=>({success:true})}}};
}
const request=(path,data,headers={})=>new Request('https://speak.rogerpbrown.com'+path,{method:data?'POST':'GET',headers:{origin:'https://speak.rogerpbrown.com','content-type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});
test('bounded feedback rejects honeypots and unwanted fields',()=>{
 const good={message:'Please improve this voice.',email:'',website:'',ticket:{}};
 assert.ok(validFeedback(good));assert.ok(!validFeedback({...good,website:'spam'}));assert.ok(!validFeedback({...good,message:'x'.repeat(3001)}));assert.ok(!validFeedback({...good,text:'private reading'}));
});
test('analytics contain only aggregate fields and respect privacy headers',async()=>{
 const {db,env}=setup();const e={event:'page_view',engine:'none',category:'none',release:'test',duration:0};
 assert.ok(validEvent(e));assert.ok(!validEvent({...e,reading:'private'}));
 for(let i=0;i<2;i++)assert.equal((await worker.fetch(request('/api/events',e),env,{})).status,204);
 await worker.fetch(request('/api/events',e,{dnt:'1'}),env,{});
 assert.equal(db.prepare('SELECT count FROM daily_events').get().count,2);
 assert.equal((await worker.fetch(request('/api/events',e,{origin:'https://wrong.test'}),env,{})).status,403);
 env.EVENT_LIMIT.limit=async()=>({success:false});assert.equal((await worker.fetch(request('/api/events',e),env,{})).status,429);
});
test('feedback is saved once and Telegram delivery can recover from failures',async()=>{
 const {db,env}=setup();const pending=[];const ctx={waitUntil:p=>pending.push(p)};
 const ticket=await (await worker.fetch(request('/api/feedback-ticket'),env,ctx)).json();
 const feedback={message:'This is a reproducible voice issue.',email:'',website:'',ticket};
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw Error('network');};
  assert.equal((await worker.fetch(request('/api/feedback',feedback),env,ctx)).status,202);await Promise.all(pending);
  assert.equal(db.prepare('SELECT count(*) AS n FROM feedback').get().n,1);
  assert.equal(db.prepare('SELECT status FROM feedback').get().status,'pending');
  globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,result:{message_id:42}}));
  await deliver(env,ticket.id);assert.equal(db.prepare('SELECT telegram_message_id FROM feedback').get().telegram_message_id,42);
  await worker.fetch(request('/api/feedback',feedback),env,ctx);await Promise.all(pending);
  assert.equal(db.prepare('SELECT attempts FROM feedback').get().attempts,2);
  const bad={...feedback,ticket:{...ticket,signature:'0'.repeat(64)}};assert.equal((await worker.fetch(request('/api/feedback',bad),env,ctx)).status,400);
 }finally{globalThis.fetch=original;}
});
test('retention removes expired reports and totals',async()=>{
 const {db,env}=setup();db.exec("INSERT INTO feedback(id,created_at,message,email,digest,status) VALUES('old',0,'old','a@b.com','old','sent'); INSERT INTO daily_events VALUES('2000-01-01','page_view','none','none','old',1,0)");
 const pending=[];await worker.scheduled({},env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);
 assert.equal(db.prepare('SELECT count(*) AS n FROM feedback').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM daily_events').get().n,0);
});
