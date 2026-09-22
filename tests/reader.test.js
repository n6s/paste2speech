import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {ReaderLedger} from '../cloudflare/reader/ledger.js';
import {EmailIdentity} from '../cloudflare/prepared/identity.js';
import {sections} from '../cloudflare/reader/site/chunks.js';
import {privateAccess} from '../cloudflare/reader/access.js';
import {paddleProvider,sendLink} from '../cloudflare/reader/providers.js';
function setup(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync('cloudflare/reader/migrations').sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+name,'utf8'));
 const db={prepare(text){return {bind(...values){return {first:async()=>sql.prepare(text).get(...values)||null,run:async()=>sql.prepare(text).run(...values),all:async()=>({results:sql.prepare(text).all(...values)})};}};},async batch(statements){sql.exec('BEGIN');try{for(const s of statements)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db,ledger:new ReaderLedger(db)};
}
test('private schema has no accounts or free grants; unmetered pilot retains balance',async()=>{
 const {sql,ledger}=setup();assert.equal(sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,0);
 const token=await ledger.newAccount(),account=await ledger.session(token);assert.equal(account.enabled,0);
 const input={chunks:['literal text'],voice:'en-US-Wavenet-F',mode:'fixture'};
 await ledger.reserve('job',account.id,input);await ledger.assertOpen('job',account.id);
 await ledger.settle({id:'job',owner:account.id,state:'ready',parts:[{state:'ready',samples:24000}],created:Date.now(),voice:input.voice,mode:'fixture',submittedCharacters:12});
 assert.equal((await ledger.account(account.id)).balance,0);assert.equal((await ledger.summary(new Date().toISOString().slice(0,7)))[0].seconds,1);
 await ledger.enable(account.id,true);await assert.rejects(ledger.reserve('paid',account.id,input),e=>e.status===402);sql.close();
});
test('metered reservation refunds once and failed grants never erase prior debt',async()=>{
 const {sql,ledger}=setup();const account=await ledger.session(await ledger.newAccount());await ledger.enable(account.id,true);
 sql.prepare('INSERT INTO grants VALUES(?,?,?)').run('synthetic',account.id,100);
 const input={chunks:['1234567890'],voice:'en-US-Wavenet-F',mode:'fixture'};await ledger.reserve('job',account.id,input);
 assert.equal((await ledger.account(account.id)).balance,90);
 const job={id:'job',owner:account.id,state:'cancelled',parts:[{state:'pending'}],created:Date.now(),voice:input.voice,mode:'fixture'};
 await ledger.settle(job);await ledger.settle(job);assert.equal((await ledger.account(account.id)).balance,100);sql.close();
});
test('lifetime speech budget is atomic, bounded and not refunded after admission',()=>{
 const {sql}=setup();sql.exec("INSERT INTO speech_budget VALUES('private-lifetime',0,10)");
 sql.exec("INSERT INTO speech_admissions VALUES('one',6,'fingerprint')");
 assert.throws(()=>sql.exec("INSERT INTO speech_admissions VALUES('two',5,'fingerprint')"),/speech_budget/);
 assert.equal(sql.prepare('SELECT characters FROM speech_budget').get().characters,6);
 assert.throws(()=>sql.exec("INSERT INTO speech_budget VALUES('other',0,100001)"));sql.close();
});
test('verified login atomically revokes legacy browser access and preserves balance',async()=>{
 const {sql,db,ledger}=setup();const account=await ledger.session(await ledger.newAccount());
 sql.prepare('INSERT INTO legacy_accounts VALUES(?,?)').run('legacy',account.id);
 const auth=new EmailIdentity(db),link=await auth.request('reader@example.invalid',account.id,'local');
 await auth.confirm(link.token,link.flow);assert.equal(sql.prepare('SELECT COUNT(*) n FROM legacy_accounts').get().n,0);sql.close();
});
test('section boundaries preserve exact Unicode source without pronunciation rewrites',()=>{
 const text=('At 12:30, Dr. Brown read STRC. 😀\n\n').repeat(250);const chunks=sections(text);
 assert.equal(chunks.join(''),text);assert.ok(chunks.every(s=>new TextEncoder().encode(s).length<=5000));
 assert.throws(()=>sections('x'.repeat(20001)));assert.throws(()=>sections(' '));
});
test('hosted access fails closed and local bypass is exact loopback only',async()=>{
 assert.equal(await privateAccess(new Request('https://example.com/'),{LOCAL_READER:'1'}),false);
 assert.equal(await privateAccess(new Request('http://127.0.0.1:8790/'),{LOCAL_READER:'1'}),true);
 assert.equal(await privateAccess(new Request('https://example.com/'),{}),false);
});
test('Access validates signature, issuer, audience, expiry and key algorithm',async()=>{
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);Object.assign(jwk,{kid:'key',alg:'RS256'});
 const env={READER_ORIGIN:'https://private.example.invalid',ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUD:'aud'};
 const base={iss:env.ACCESS_ISSUER,aud:['aud'],iat:100,exp:200};
 const b64=b=>Buffer.from(b).toString('base64url');
 async function signed(claims){const input=b64(JSON.stringify({alg:'RS256',kid:'key'}))+'.'+b64(JSON.stringify(claims));return input+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(input)));}
 const options={now:()=>150000,fetcher:async url=>{assert.equal(url,env.ACCESS_ISSUER+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});}};
 for(const [claims,expected] of [[base,true],[{...base,aud:['wrong']},false],[{...base,exp:149},false],[{...base,iss:'https://wrong'},false],[{...base,nbf:160},false]])assert.equal(await privateAccess(new Request(env.READER_ORIGIN,{headers:{'Cf-Access-Jwt-Assertion':await signed(claims)}}),env,options),expected);
 const token=await signed(base);assert.equal(await privateAccess(new Request(env.READER_ORIGIN,{headers:{'Cf-Access-Jwt-Assertion':token.slice(0,-20)+'aaaaaaaaaaaaaaaaaaaa'}}),env,options),false);
});
test('local environment cannot activate paid speech-adjacent services with credentials',async()=>{
 const env={LOCAL_READER:'1',ENABLE_PAYMENTS:'1',PADDLE_API_KEY:'pdl_sdbx_apikey_fake',ENABLE_EMAIL:'1',RESEND_API_KEY:'fake',EMAIL_FROM:'test@example.invalid'};
 assert.throws(()=>paddleProvider(env));await assert.rejects(sendLink(env,{},()=>{throw Error('must not call');}));
 assert.throws(()=>paddleProvider({...env,LOCAL_READER:'0',PADDLE_API_KEY:'pdl_live_apikey_fake'}));
});

test('Paddle transport stays sandbox-only and ignores remote pagination URLs',async()=>{
 const seen=[],id='txn_'+'a'.repeat(26),cursor='adj_'+'b'.repeat(26);
 const provider=paddleProvider({ENABLE_PAYMENTS:'1',PADDLE_API_KEY:'pdl_sdbx_apikey_synthetic'},async(url,options)=>{
  seen.push(url);assert.equal(new URL(url).origin,'https://sandbox-api.paddle.com');assert.equal(options.redirect,'error');
  if(seen.length===1)return Response.json({data:[{id:cursor}],meta:{pagination:{has_more:true,next:'https://attacker.invalid/key'}}});
  return Response.json({data:[],meta:{pagination:{has_more:false}}});
 });
 assert.equal((await provider.adjustments(id)).length,1);assert.ok(seen[1].endsWith('&after='+cursor));
 await assert.rejects(provider.transaction('../credentials'));
});
test('email includes permanent account URL and temporary fragment, never tokens in request URL',async()=>{
 let called=0;
 await sendLink({ENABLE_EMAIL:'1',RESEND_API_KEY:'synthetic',EMAIL_FROM:'reader@example.invalid',READER_ORIGIN:'https://private.example.invalid'},
 {email:'recipient@example.invalid',token:'synthetic-link-token'},async(url,options)=>{
  called++;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.redirect,'error');
  const message=JSON.parse(options.body);assert.match(message.text,/permanent account page is https:\/\/private.example.invalid\/api\/billing\./);
  assert.match(message.text,/signin#synthetic-link-token/);assert.equal(options.headers['Idempotency-Key'].length,64);return Response.json({id:'synthetic'});
 });assert.equal(called,1);
});

test('background payment reconciliation works without browsers and serializes duplicate checkout',async()=>{
 const {PaymentCoordinator}=await import('../cloudflare/reader/payments-do.js');
 const {sql,db,ledger}=setup(),account=(await ledger.session(await ledger.newAccount())).id;
 const remoteId='txn_'+'a'.repeat(26);let orderId,creates=0,refund=0,alarms=0;
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(new URL(url).origin,'https://sandbox-api.paddle.com');
  if(options.method==='POST'){creates++;orderId=JSON.parse(options.body).custom_data.p2s_order;return Response.json({data:{id:remoteId}});}
  if(url.includes('/adjustments?'))return Response.json({data:refund?[{id:'adj_'+'b'.repeat(26),transaction_id:remoteId,currency_code:'USD',status:'approved',action:'refund',totals:{subtotal:String(refund)}}]:[],meta:{pagination:{has_more:false}}});
  return Response.json({data:{id:remoteId,status:'completed',custom_data:{p2s_order:orderId},currency_code:'USD',items:[{quantity:1,price:{id:'pri_01m32vvy2sptegx6arebyvxh37',product_id:'pro_01m32gd3hj94whqywcvmyta74b',unit_price:{amount:'1000',currency_code:'USD'}}}],details:{totals:{discount:'0',subtotal:'1000'}}}});
 };
 try{
  const coordinator=new PaymentCoordinator({storage:{getAlarm:async()=>null,setAlarm:async()=>{alarms++;}}},{LEDGER:db,ENABLE_PAYMENTS:'1',PADDLE_API_KEY:'pdl_sdbx_apikey_synthetic'});
  const request=()=>new Request('https://payments/',{method:'POST',body:JSON.stringify({action:'order',account})});
  const responses=await Promise.all([coordinator.fetch(request()),coordinator.fetch(request())]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(creates,1);
  await coordinator.alarm();assert.equal((await ledger.account(account)).balance,1000000);
  refund=500;await coordinator.alarm();assert.equal((await ledger.account(account)).balance,500000);
  refund=0;await coordinator.alarm();assert.equal((await ledger.account(account)).balance,1000000);assert.ok(alarms>=5);
 }finally{globalThis.fetch=original;sql.close();}
});
test('lost checkout response is never automatically resubmitted after restart',async()=>{
 const {PaymentCoordinator}=await import('../cloudflare/reader/payments-do.js');const {sql,db,ledger}=setup();
 const account=(await ledger.session(await ledger.newAccount())).id,original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('response lost');};
 try{
  const env={LEDGER:db,ENABLE_PAYMENTS:'1',PADDLE_API_KEY:'pdl_sdbx_apikey_synthetic'},ctx={storage:{getAlarm:async()=>null,setAlarm:async()=>{}}};
  const request=()=>new Request('https://payments/',{method:'POST',body:JSON.stringify({action:'order',account})});
  assert.equal((await new PaymentCoordinator(ctx,env).fetch(request())).status,503);
  assert.equal((await new PaymentCoordinator(ctx,env).fetch(request())).status,409);assert.equal(calls,1);
 }finally{globalThis.fetch=original;sql.close();}
});
test('email-first accounts retain the original unmetered default',async()=>{
 const {sql,db,ledger}=setup(),identity=new EmailIdentity(db);const link=await identity.request('fresh@example.invalid',null,'local');
 const account=await ledger.session(await identity.confirm(link.token,link.flow));assert.equal(account.enabled,0);sql.close();
});
test('cron wake does not postpone an existing background reconciliation deadline',async()=>{
 const {PaymentCoordinator}=await import('../cloudflare/reader/payments-do.js');const {sql,db}=setup();let changed=false;
 const coordinator=new PaymentCoordinator({storage:{getAlarm:async()=>123,setAlarm:async()=>{changed=true;}}},{LEDGER:db,ENABLE_PAYMENTS:'1',PADDLE_API_KEY:'pdl_sdbx_apikey_synthetic'});
 const response=await coordinator.fetch(new Request('https://payments/',{method:'POST',body:JSON.stringify({action:'wake'})}));
 assert.equal(response.status,200);assert.equal(changed,false);sql.close();
});
test('reader reservation lost acknowledgement remains recoverable without another debit',async()=>{
 const {sql,db,ledger}=setup(),account=(await ledger.session(await ledger.newAccount())).id;await ledger.enable(account,true);
 sql.prepare('INSERT INTO grants VALUES(?,?,?)').run('synthetic',account,100);
 const original=db.prepare.bind(db);let fail=true;
 db.prepare=text=>{const statement=original(text);return {bind(...values){const bound=statement.bind(...values);if(!text.startsWith('INSERT INTO reservations'))return bound;return {...bound,run:async()=>{const result=await bound.run();if(fail){fail=false;throw Error('lost committed acknowledgement');}return result;}};}};};
 const input={voice:'en-US-Wavenet-F',chunks:['12345'],mode:'fixture'};
 await assert.rejects(ledger.reserve('recover',account,input),error=>!error.status&&/lost committed/.test(error.message));
 assert.equal((await ledger.account(account)).balance,95);
 const recovered=await ledger.reserve('recover',account,input);assert.equal(recovered.state,'open');assert.equal((await ledger.account(account)).balance,95);sql.close();
});
