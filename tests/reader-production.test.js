import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
import {ReaderLedger} from '../cloudflare/reader/ledger.js';
import {EmailIdentity} from '../cloudflare/prepared/identity.js';
import {paddleProvider} from '../cloudflare/reader/providers.js';
const bundled=await build({entryPoints:['cloudflare/reader/worker.js'],bundle:true,write:false,format:'esm',platform:'node'});
const {default:worker,PreparedReading}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const origin='https://pastetospeech.com';
function setup(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync('cloudflare/reader/migrations').sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+name,'utf8'));
 const db={prepare(text){return {bind(...values){return {first:async()=>sql.prepare(text).get(...values)||null,run:async()=>sql.prepare(text).run(...values),all:async()=>({results:sql.prepare(text).all(...values)})};}};},async batch(statements){sql.exec('BEGIN');try{for(const s of statements)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={READER_MODE:'production-trial',LOCAL_READER:'0',PRIVATE_READER:'0',READER_ORIGIN:origin,TRIAL_EMAIL:'rogerpbrown@gmail.com',ENABLE_EMAIL:'0',ENABLE_PAYMENTS:'0',ENABLE_LIVE_SYNTHESIS:'0',MAX_LIFETIME_CHARACTERS:'100000',LEDGER:db,ACCOUNT_LIMIT:{limit:async()=>({success:true})},EMAIL_LIMIT:{limit:async()=>({success:true})},ASSETS:{fetch:async()=>new Response('reader')},JOBS:{idFromName:id=>id,get:()=>({fetch:async()=>Response.json({ready:true}, {status:201})})}};
 const ledger=new ReaderLedger(db);
 async function request(path,{data,method=data?'POST':'GET',token,headers={}}={}){return worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,...(token?{Cookie:'p2s_private_reader='+token}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),env,{});}
 async function verified(email){const auth=new EmailIdentity(db),link=await auth.request(email,null,crypto.randomUUID());const token=await auth.confirm(link.token,link.flow);return {token,account:await ledger.session(token)};}
 return {sql,db,env,ledger,request,verified};
}
test('production anonymous reader is public, private staging stays fail closed, checkout cannot activate',async()=>{
 const s=setup();assert.equal((await s.request('/')).status,200);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,0);
 const state=await (await s.request('/api/billing/status')).json();assert.deepEqual(state.usage,[]);assert.equal(state.account,null);assert.equal(state.configured,false);
 s.env.ENABLE_PAYMENTS='1';s.env.PADDLE_API_KEY='pdl_sdbx_apikey_fake';assert.equal((await s.request('/api/billing/order',{data:{}})).status,503);assert.throws(()=>paddleProvider(s.env));
 assert.equal((await s.request('/api/test-mail')).status,404);
 assert.equal((await s.request('/api/billing/session',{data:{},headers:{Origin:'https://evil.invalid'}})).status,403);
 s.env.READER_MODE='staging';assert.equal((await s.request('/')).status,403);s.sql.close();
});
test('production account and email endpoints fail closed without rate limiting',async()=>{
 const s=setup();delete s.env.ACCOUNT_LIMIT;assert.equal((await s.request('/api/billing/session',{data:{}})).status,429);
 s.env.EMAIL_LIMIT={limit:async()=>({success:false})};assert.equal((await s.request('/api/billing/login/request',{data:{email:'owner@example.invalid'}})).status,429);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,0);s.sql.close();
});
test('trial grant requires verified owner, retries once, cannot use another grant id',async()=>{
 const s=setup(),grant=readFileSync('cloudflare/reader/grant-production-trial.sql','utf8');assert.throws(()=>s.sql.exec(grant),/trial_identity_required/);
 const {account}=await s.verified('rogerpbrown@gmail.com');s.sql.exec(grant);s.sql.exec(grant);assert.equal((await s.ledger.account(account.id)).balance,100000);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM grants').get().n,1);
 assert.throws(()=>s.sql.exec("INSERT INTO trial_grants VALUES('another','rogerpbrown@gmail.com',100000,1)"));s.sql.close();
});
test('only verified metered owner can admit; caps are atomic and failed attempts remain charged',async()=>{
 const s=setup(),other=await s.verified('other@example.invalid'),owner=await s.verified('rogerpbrown@gmail.com');
 s.sql.prepare('INSERT INTO grants VALUES(?,?,?)').run('other',other.account.id,100000);s.sql.exec(readFileSync('cloudflare/reader/grant-production-trial.sql','utf8'));
 const data={voice:'en-US-Wavenet-F',chunks:['Hello.']},headers={'Idempotency-Key':crypto.randomUUID()};
 assert.equal((await s.request('/api/readings',{data,headers,token:other.token})).status,403);
 assert.equal((await s.request('/api/readings',{data,headers,token:owner.token})).status,503);
 s.env.ENABLE_LIVE_SYNTHESIS='1';s.env.MAX_LIFETIME_CHARACTERS='10';
 const results=await Promise.all([s.request('/api/readings',{data,headers,token:owner.token}),s.request('/api/readings',{data,headers:{'Idempotency-Key':crypto.randomUUID()},token:owner.token})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,429]);
 assert.equal(s.sql.prepare('SELECT characters FROM speech_budget').get().characters,6);
 assert.equal((await s.request('/api/readings',{data,headers,token:owner.token})).status,201);assert.equal(s.sql.prepare('SELECT characters FROM speech_budget').get().characters,6);
 s.sql.prepare('INSERT INTO legacy_pilots VALUES(?)').run(owner.account.id);assert.equal((await s.request('/api/readings',{data,headers,token:owner.token})).status,403);s.sql.close();
});
test('billing usage is scoped to current account and excludes unowned legacy totals',async()=>{
 const s=setup(),one=await s.verified('one@example.invalid'),two=await s.verified('two@example.invalid');
 for(const [i,a] of [one,two].entries())s.sql.prepare('INSERT INTO reading_audit VALUES(?,?,?,?,?,?,?,?,?)').run('job'+i,a.account.id,Date.now(),'voice','live',100,60*(i+1),0,'ready');
 const first=await (await s.request('/api/billing/status',{token:one.token})).json();assert.equal(first.usage[0].seconds,60);
 const second=await (await s.request('/api/billing/status',{token:two.token})).json();assert.equal(second.usage[0].seconds,120);
 await s.request('/api/billing/logout',{data:{},token:one.token});assert.deepEqual((await (await s.request('/api/billing/status',{token:one.token})).json()).usage,[]);s.sql.close();
});
for(const mode of ['production-trial','production-public','production-trial-progressive'])test(mode+' durable preparation preserves credit audit, cached audio, ownership and restart',async t=>{
 const s=setup(),owner=await s.verified('rogerpbrown@gmail.com');s.sql.exec(readFileSync('cloudflare/reader/grant-production-trial.sql','utf8'));s.env.ENABLE_LIVE_SYNTHESIS='1';
 s.env.READER_MODE=mode==='production-trial-progressive'?'production-trial':mode;s.env.PUBLIC_LAUNCH_OPEN='1';if(mode==='production-trial-progressive')s.env.PROGRESSIVE_READER='1';
 const saved=new Map(),objects=new Map();let initializing;
 const storage={get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>saved.set(k,structuredClone(v)),delete:async k=>saved.delete(k),setAlarm:async()=>{},transaction:async f=>f(storage)};
 const ctx={storage,blockConcurrencyWhile:fn=>(initializing=fn())};
 s.env.AUDIO={put:async(k,v)=>objects.set(k,new Uint8Array(await new Response(v).arrayBuffer())),get:async(k,opts)=>{const b=objects.get(k);if(!b)return null;const r=opts?.range;const response=new Response(r?b.slice(r.offset,r.offset+r.length):b);response.size=b.length;return response;},delete:async keys=>keys.forEach(k=>objects.delete(k))};
 const audio=readFileSync('tests/fixtures/wavenet/'+JSON.parse(readFileSync('scripts/wavenet-worker-proof/fixture.json'))['en-US-Wavenet-F'][0].file);
 let calls=0;t.mock.method(globalThis,'fetch',async url=>{assert.equal(url,'https://texttospeech.googleapis.com/v1/text:synthesize');calls++;return Response.json({audioContent:audio.toString('base64')});});
 let durable=new PreparedReading(ctx,s.env);await initializing;durable.googleAuthorization={token:'synthetic',expires:Date.now()+60000};
 const id=crypto.randomUUID(),input={id,voice:'en-US-Wavenet-F',chunks:['Hello.'],mode:'live'};
 if(mode==='production-trial-progressive')input.mseOptions={delivery:'mse',concurrency:3,cached:false,scenario:'normal'};
 if(mode==='production-public')s.sql.prepare('INSERT INTO public_jobs VALUES(?,?)').run(id,owner.account.id);
 const request=(path,method='GET',body,who=owner.account.id,headers={})=>new Request('https://job'+path,{method,headers:{'X-Proof-Owner':who,...headers},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await durable.fetch(request('/create','POST',input))).status,201);await durable.alarm();assert.equal(durable.job.state,'ready');assert.equal(calls,1);
 assert.equal((await s.ledger.account(owner.account.id)).balance,99994);assert.equal(s.sql.prepare('SELECT submitted FROM reading_audit WHERE job=?').get(id).submitted,6);
 assert.equal((await durable.fetch(request('/audio','GET',null,'someone-else'))).status,404);
 if(mode==='production-trial-progressive'){assert.equal((await durable.fetch(request('/sections/0','GET',null,'someone-else'))).status,404);assert.deepEqual(Buffer.from(await (await durable.fetch(request('/sections/0'))).arrayBuffer()),audio);assert.equal((await durable.fetch(request('/create','POST',{...input,mseOptions:{...input.mseOptions,delivery:'complete'}}))).status,409);}
 assert.equal((await durable.fetch(request('/audio','GET',null,owner.account.id,{Range:'bytes=0-99'}))).status,206);
 durable=new PreparedReading(ctx,s.env);await initializing;assert.equal((await durable.fetch(request('/audio'))).status,200);assert.match(await (await durable.fetch(request('/download/vtt'))).text(),/Hello\./);assert.equal(calls,1);
 await durable.fetch(request('/status'));assert.equal((await s.ledger.account(owner.account.id)).balance,99994);
 if(mode==='production-public'){
  assert.equal(s.sql.prepare('SELECT SUM(characters) n FROM provider_attempts').get().n,6);
  s.sql.exec('UPDATE public_controls SET daily=6');
  const blocked=crypto.randomUUID();s.sql.prepare('INSERT INTO public_jobs VALUES(?,?)').run(blocked,owner.account.id);
  saved.clear();durable=new PreparedReading(ctx,s.env);await initializing;durable.googleAuthorization={token:'synthetic',expires:Date.now()+60000};
  await durable.fetch(request('/create','POST',{...input,id:blocked}));await durable.alarm();
  assert.equal(durable.job.state,'failed');assert.equal(calls,1);assert.equal((await s.ledger.account(owner.account.id)).balance,99994);
 }
 s.sql.close();
});
test('production feedback keeps the existing database and review delivery mode',async()=>{
 const s=setup(),other=setup();s.env.DB=other.db;s.env.FEEDBACK_DELIVERY_MODE='review';s.env.FEEDBACK_SECRET='synthetic-feedback-secret';
 const pending=[];const ctx={waitUntil:p=>pending.push(p)};
 const ticket=await (await s.request('/api/feedback-ticket')).json();
 const response=await worker.fetch(new Request(origin+'/api/feedback',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({message:'Production feedback test',email:'',website:'',ticket})}),s.env,ctx);
 assert.equal(response.status,202);await Promise.all(pending);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM feedback').get().n,0);assert.equal(other.sql.prepare('SELECT COUNT(*) n FROM feedback').get().n,1);assert.equal(other.sql.prepare('SELECT attempts FROM feedback').get().attempts,0);s.sql.close();other.sql.close();
});

test('production progressive options preserve owner admission and exclude staging controls',async()=>{
 const s=setup(),owner=await s.verified('rogerpbrown@gmail.com'),other=await s.verified('other@example.invalid');
 s.sql.exec(readFileSync('cloudflare/reader/grant-production-trial.sql','utf8'));
 s.sql.prepare('INSERT INTO grants VALUES(?,?,?)').run('other-progressive',other.account.id,100000);
 s.env.ENABLE_LIVE_SYNTHESIS='1';s.env.PROGRESSIVE_READER='1';
 const data={voice:'en-US-Wavenet-F',chunks:['Hello.'],delivery:'mse'};
 assert.equal((await s.request('/api/readings',{data,token:other.token})).status,403);
 for(const extra of [{cached:true},{concurrency:1},{scenario:'normal'},{mseOptions:{delivery:'mse'}}])assert.equal((await s.request('/api/readings',{data:{...data,...extra},token:owner.token,headers:{'Idempotency-Key':crypto.randomUUID()}})).status,422);
 assert.equal(s.sql.prepare('SELECT characters FROM speech_budget').get()?.characters||0,0);
 assert.equal((await s.request('/api/readings',{data,token:owner.token,headers:{'Idempotency-Key':crypto.randomUUID()}})).status,201);
 assert.equal(s.sql.prepare('SELECT characters FROM speech_budget').get().characters,6);
 s.env.MSE_NEW_READINGS='0';assert.equal((await s.request('/api/readings',{data,token:owner.token,headers:{'Idempotency-Key':crypto.randomUUID()}})).status,422);
 assert.equal((await s.request('/api/readings',{data:{...data,delivery:'complete'},token:owner.token,headers:{'Idempotency-Key':crypto.randomUUID()}})).status,201);
 delete s.env.PROGRESSIVE_READER;assert.equal((await s.request('/api/readings',{data,token:owner.token,headers:{'Idempotency-Key':crypto.randomUUID()}})).status,422);
 s.sql.close();
});
test('emergency pause defers alarms without loading jobs or touching ledgers and blocks API work',async()=>{
 const s=setup();s.env.BACKGROUND_WORK_PAUSED='1';s.env.LEDGER=new Proxy({}, {get(){throw Error('Paused ledger accessed');}});
 const alarms=[];const ctx={blockConcurrencyWhile(){throw Error('Paused object loaded');},storage:{setAlarm:async value=>alarms.push(value)}};
 const durable=new PreparedReading(ctx,s.env);await durable.alarm();
 assert.ok(alarms[0]>=Date.now()+86390000);
 assert.equal((await durable.fetch(new Request('https://internal/create'))).status,503);
 const {PaymentCoordinator}=await import('../cloudflare/reader/payments-do.js');
 const payments=new PaymentCoordinator(ctx,s.env);await payments.alarm();
 assert.equal((await payments.fetch(new Request('https://internal/wake'))).status,503);
 await worker.scheduled({},s.env,{});
 assert.equal((await s.request('/api/readings',{data:{}})).status,503);
 assert.equal((await s.request('/api/billing/order',{data:{}})).status,503);
 assert.equal(alarms.length,2);s.sql.close();
});

test('old hostname permanently redirects without touching accounts or forwarding tokens',async()=>{
 const env={READER_MODE:'production-trial',READER_ORIGIN:origin};
 for(const [path,target] of [['/','/'],['/terms','/terms'],['/pricing','/pricing'],['/sitemap.xml','/sitemap.xml'],['/signin#secret','/api/billing'],['/api/billing/signin?token=secret','/api/billing'],['//evil.invalid/?next=https://evil.invalid','/']]){
  const response=await worker.fetch(new Request('https://speak.rogerpbrown.com'+path),env,{});
  assert.equal(response.status,301);assert.equal(response.headers.get('location'),`${origin}${target}#`);assert.equal(response.headers.get('x-robots-tag'),null);assert.equal(await response.text(),'');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 }
 for(const [path,method] of [['/api/readings','POST'],['/api/billing/webhook','POST'],['/api/billing/status','GET']]){
  const response=await worker.fetch(new Request('https://speak.rogerpbrown.com'+path,{method}),env,{});assert.equal(response.status,410);assert.equal(response.headers.get('location'),null);
 }
 const robots=await worker.fetch(new Request('https://speak.rogerpbrown.com/robots.txt'),env,{});assert.equal(robots.status,200);assert.match(await robots.text(),/Allow: \/\n/);
 const head=await worker.fetch(new Request('https://speak.rogerpbrown.com/',{method:'HEAD'}),env,{});assert.equal(await head.text(),'');
 const staging=await worker.fetch(new Request('https://speak.rogerpbrown.com/'),{READER_MODE:'staging'},{});assert.equal(staging.status,403);
});
