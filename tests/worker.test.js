import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{validFeedback,validEvent,deliver} from '../cloudflare/worker.js';
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_feedback_context.sql',import.meta.url),'utf8'));
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

test('private reader can submit feedback through narrowly scoped CORS',async()=>{
 const {env}=setup();const origin='https://pop-os.tailbd091c.ts.net';
 const preflight=await worker.fetch(new Request('https://speak.rogerpbrown.com/api/feedback',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}}),env,{});
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const ticket=await worker.fetch(request('/api/feedback-ticket',null,{origin}),env,{});
 assert.equal(ticket.status,200);assert.equal(ticket.headers.get('access-control-allow-origin'),origin);
 const denied=await worker.fetch(request('/api/feedback-ticket',null,{origin:'https://untrusted.test'}),env,{});
 assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
});
test('feedback diagnostics survive storage and Telegram delivery, with server-derived environment',async()=>{
 const {db,env}=setup();const pending=[];const ctx={waitUntil:p=>pending.push(p)};
 const origin='https://pop-os.tailbd091c.ts.net';
 const ticket=await (await worker.fetch(request('/api/feedback-ticket',null,{origin}),env,ctx)).json();
 const context={environment:'production',browser:'Chrome',device:'mobile',engine:'workstation',voice:'Heart · American English',release:'abc123',playback:'paused'};
 const feedback={message:'Diagnostic context integration test.',email:'',website:'',ticket,context};
 assert.ok(validFeedback(feedback));
 for(const bad of [{...context,reading:'secret'},{...context,voice:'x'.repeat(121)},{...context,engine:'invalid'}])assert.ok(!validFeedback({...feedback,context:bad}));
 const original=globalThis.fetch;let notification;
 try{
  globalThis.fetch=async(_url,options)=>{notification=JSON.parse(options.body).text;return new Response(JSON.stringify({ok:true,result:{message_id:45}}));};
  assert.equal((await worker.fetch(request('/api/feedback',feedback,{origin}),env,ctx)).status,202);await Promise.all(pending);
  assert.deepEqual(JSON.parse(db.prepare('SELECT context FROM feedback').get().context),{...context,environment:'test'});
  assert.match(notification,/Site: test/);assert.match(notification,/Chrome · mobile/);assert.match(notification,/Workstation - Kokoro/);assert.match(notification,/Playback: paused/);
 }finally{globalThis.fetch=original;}
});

test('review mode stores feedback without immediate or scheduled raw delivery; direct rollback works',async()=>{
 const {db,env}=setup();env.FEEDBACK_DELIVERY_MODE='review';
 const pending=[];const ctx={waitUntil:p=>pending.push(p)};
 const ticket=await (await worker.fetch(request('/api/feedback-ticket'),env,ctx)).json();
 const original=globalThis.fetch;let sends=0;
 try{
  globalThis.fetch=async()=>{sends++;return new Response(JSON.stringify({ok:true,result:{message_id:99}}));};
  assert.equal((await worker.fetch(request('/api/feedback',{message:'Review mode integration feedback.',email:'',website:'',ticket}),env,ctx)).status,202);
  await Promise.all(pending);await worker.scheduled({},env,ctx);await Promise.all(pending);
  assert.equal(sends,0);assert.equal(db.prepare('SELECT attempts FROM feedback').get().attempts,0);
  assert.equal(db.prepare('SELECT status FROM feedback').get().status,'pending');
  env.FEEDBACK_DELIVERY_MODE='direct';await worker.scheduled({},env,ctx);await Promise.all(pending);
  assert.equal(sends,1);assert.equal(db.prepare('SELECT telegram_message_id FROM feedback').get().telegram_message_id,99);
 }finally{globalThis.fetch=original;}
});

test('optional cleanup diagnostics are validated, stored, and summarized without breaking older tabs',async()=>{
 const {db,env}=setup();env.FEEDBACK_DELIVERY_MODE='review';
 const pending=[];const ctx={waitUntil:p=>pending.push(p)};
 const ticket=await (await worker.fetch(request('/api/feedback-ticket'),env,ctx)).json();
 const cleanup={markdown:true,citations:false,urls:true,code:false,tables:true,emoji:false,joinLines:true};
 const context={environment:'production',browser:'Chrome',device:'mobile',engine:'browser',voice:'Default',release:'test',playback:'paused',cleanup};
 const feedback={message:'Cleanup diagnostic test report.',email:'',website:'',ticket,context};
 assert.ok(validFeedback(feedback));
 for(const bad of [null,{},[],{...cleanup,joinLines:'true'},{...cleanup,reading:'secret'},{...cleanup,markdown:undefined}]){
  assert.ok(!validFeedback({...feedback,context:{...context,cleanup:bad}}));
 }
 assert.ok(validFeedback({...feedback,context:undefined}));
 const {cleanup:_,...legacy}=context;assert.ok(validFeedback({...feedback,context:legacy}));
 assert.equal((await worker.fetch(request('/api/feedback',feedback),env,ctx)).status,202);await Promise.all(pending);
 const saved=db.prepare('SELECT context FROM feedback').get().context;
 assert.deepEqual(JSON.parse(saved).cleanup,cleanup);
 const {contextSummary}=await import('../cloudflare/worker.js');
 assert.match(contextSummary(saved),/joinLines=on/);assert.match(contextSummary(saved),/emoji=off/);
});

test('bounded processing metrics survive feedback storage and summary',async()=>{
 const {db,env}=setup();env.FEEDBACK_DELIVERY_MODE='review';
 const ctx={waitUntil:()=>{}};
 const ticket=await(await worker.fetch(request('/api/feedback-ticket'),env,ctx)).json();
 const processing={version:1,requestedGPU:true,chunks:2,generationMs:850,audioMs:6000,last:{status:'ok',backend:'gpu',dtype:'fp16',fallback:false,hidden:false,loadMs:100,probeMs:80,generateMs:400,audioMs:3000,characters:40},comparison:[{backend:'cpu',dtype:'q8',status:'ok',loadMs:50,firstMs:400,repeatMs:300,audioMs:3000},{backend:'gpu',dtype:'fp32',status:'failed'}]};
 const context={environment:'test',browser:'Chrome',device:'mobile',engine:'kokoro',voice:'Heart',release:'test',playback:'paused',processing};
 const feedback={message:'Processing metric integration report.',email:'',website:'',ticket,context};
 for(const bad of [{...processing,text:'private'}, {...processing,generationMs:-1}, {...processing,last:{...processing.last,generateMs:NaN}}, {...processing,comparison:Array(4).fill(processing.comparison[0])}])assert.equal(Boolean(validFeedback({...feedback,context:{...context,processing:bad}})),false);
 assert.equal((await worker.fetch(request('/api/feedback',feedback),env,ctx)).status,202);
 const saved=db.prepare('SELECT context FROM feedback').get().context;
 assert.deepEqual(JSON.parse(saved).processing,processing);
 const {contextSummary}=await import('../cloudflare/worker.js');assert.match(contextSummary(saved),/generationMs.*850/);
});
