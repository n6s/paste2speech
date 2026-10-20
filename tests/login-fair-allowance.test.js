import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './helpers/unified-wallet-fixture.js';
import {EmailIdentity} from '../cloudflare/prepared/identity.js';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['cloudflare/reader/worker.js'],bundle:true,write:false,format:'esm',platform:'node'});
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const migration=readFileSync('cloudflare/reader/staging-migrations/0015_login_fair_allowance.sql','utf8');
const time=Date.now();
function setup(){const f=fixture();f.sql.exec(migration);return {...f,auth:new EmailIdentity(f.db)};}
async function exhaustPublic(f){for(let i=0;i<90;i++)await f.auth.request(`new${i}@example.invalid`,null,`public-ip-${Math.floor(i/20)}`,time);}
const count=(f,scope)=>f.sql.prepare('SELECT COUNT(*) n FROM login_limits WHERE scope=?').get(scope).n;

test('public exhaustion cannot block another existing identity; valid browser-bound confirmation still works',async()=>{
 const f=setup();const balance=await f.wallet.balance('a');await exhaustPublic(f);
 await assert.rejects(f.auth.request('unrelated@example.invalid',null,'fresh-ip',time),e=>e.status===429);
 const link=await f.auth.request('A@Example.invalid',null,'member-ip',time);assert.equal(count(f,'global'),90);
 await assert.rejects(f.auth.confirm(link.token,'wrong-browser',time),e=>e.status===400);
 const session=await f.auth.confirm(link.token,link.flow,time);assert.equal((await f.speech.session(session,time)).id,'a');
 await assert.rejects(f.auth.confirm(link.token,link.flow,time),e=>e.status===400);
 assert.deepEqual(await f.wallet.balance('a'),balance);f.sql.close();
});

test('five reserved links belong to each enabled identity, retain a finite budget and roll off after 24 hours',async()=>{
 const f=setup();await exhaustPublic(f);
 for(let i=0;i<5;i++)await f.auth.request('a@example.invalid',null,`member-${i}`,time);
 await assert.rejects(f.auth.request('a@example.invalid',null,'later-ip',time+3600001),e=>e.status===429);
 await f.auth.request('b@example.invalid',null,'other-member',time+3600001);assert.equal(count(f,'global'),90);
 await assert.rejects(f.auth.request('new-later@example.invalid',null,'fresh-ip',time+3600001),e=>e.status===429);
 await f.auth.request('a@example.invalid',null,'tomorrow-ip',time+86400001);assert.equal(count(f,'global'),0);f.sql.close();
});

test('ordinary public registration, existing-member fallback and five-per-email/hour limit remain available',async()=>{
 const f=setup();const fresh=await f.auth.request('fresh@example.invalid',null,'new-ip',time);
 const session=await f.auth.confirm(fresh.token,fresh.flow,time);assert.ok(await f.speech.session(session,time));assert.equal(count(f,'global'),1);
 for(let i=0;i<5;i++)await f.auth.request('a@example.invalid',null,`ip-${i}`,time);
 await assert.rejects(f.auth.request('a@example.invalid',null,'ip-six',time),e=>e.status===429);
 await f.auth.request('a@example.invalid',null,'later-ip',time+3600001);assert.equal(count(f,'global'),2);f.sql.close();
});

test('member reserve cannot bypass the IP limit or grant disabled/nonexistent identities reserved capacity',async()=>{
 const f=setup();for(let i=0;i<20;i++)await f.auth.request(`ipuser${i}@example.invalid`,null,'same-ip',time);
 await assert.rejects(f.auth.request('a@example.invalid',null,'same-ip',time),e=>e.status===429);f.sql.close();
 const g=setup();await exhaustPublic(g);g.sql.prepare("UPDATE accounts SET enabled=0 WHERE id='a'").run();
 await assert.rejects(g.auth.request('a@example.invalid',null,'disabled-ip',time),e=>e.status===429);
 await assert.rejects(g.auth.request('unknown@example.invalid',null,'unknown-ip',time),e=>e.status===429);g.sql.close();
});

test('concurrent admissions cannot overspend reserve and cancelled/failed delivery never refunds mail capacity',async()=>{
 const f=setup();await exhaustPublic(f);
 const results=await Promise.allSettled(Array.from({length:8},(_,i)=>f.auth.request('a@example.invalid',null,`concurrent-${i}`,time)));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,5);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===429).length,3);
 for(const r of results)if(r.status==='fulfilled')await f.auth.cancel(r.value.token);
 await assert.rejects(f.auth.request('a@example.invalid',null,'after-hour-ip',time+3600001),e=>e.status===429);
 assert.equal(count(f,'global'),90);await f.auth.request('b@example.invalid',null,'independent-ip',time+3600001);f.sql.close();
});

test('migration is staging-only, preserves every prior row and reapplying cannot refill any quota',async()=>{
 const f=fixture();const tables=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
 const snapshot=()=>Object.fromEntries(tables.map(name=>[name,f.sql.prepare('SELECT * FROM '+name).all()]));const before=snapshot();f.sql.exec(migration);assert.deepEqual(snapshot(),before);
 const g={...f,auth:new EmailIdentity(f.db)};await exhaustPublic(g);const limits=f.sql.prepare('SELECT * FROM login_limits').all();f.sql.exec(migration);assert.deepEqual(f.sql.prepare('SELECT * FROM login_limits').all(),limits);
 await assert.rejects(g.auth.request('new@example.invalid',null,'fresh-ip',time),e=>e.status===429);f.sql.close();
 const p=fixture('production');const triggers=p.sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'login_limit_%'").all();assert.throws(()=>p.sql.exec(migration),/malformed JSON/);assert.deepEqual(p.sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'login_limit_%'").all(),triggers);p.sql.close();
});

function localWorker(f,patch={}){
 const origin=patch.READER_ORIGIN||'http://127.0.0.1:8790',pending=[];
 const env={...f.env,LEDGER:f.db,UNIFIED_CREDITS:'0',LOCAL_READER:'1',PRIVATE_READER:'1',READER_ORIGIN:origin,LOGIN_FAIR_ALLOWANCE:'1',ENABLE_EMAIL:'1',...patch};
 const ctx={waitUntil(p){pending.push(p);}};
 const request=(path,data,cookie='',headers={})=>worker.fetch(new Request(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);
 return {request,env,async flush(){while(pending.length)await Promise.all(pending.splice(0));}};
}
function flowCookie(response){const value=response.headers.get('Set-Cookie');assert.match(value,/HttpOnly; SameSite=Strict/);return value.split(';')[0];}

test('actual Worker gives indistinguishable responses before quota lookup; existing member can confirm with mocked mail',async()=>{
 const f=setup();await exhaustPublic(f);const w=localWorker(f),logs=[],prior=console.error;console.error=s=>logs.push(s);
 try{
 const unknown=await w.request('/api/billing/login/request',{email:'unknown@example.invalid'}),member=await w.request('/api/billing/login/request',{email:'a@example.invalid'});
 assert.equal(unknown.status,200);assert.equal(member.status,200);assert.deepEqual(await unknown.json(),await member.json());
 const unknownCookie=flowCookie(unknown),memberCookie=flowCookie(member);assert.equal(unknownCookie.length,memberCookie.length);
 assert.equal(unknown.headers.get('Cache-Control'),member.headers.get('Cache-Control'));await w.flush();
 const absent=await w.request('/api/test-mail',null,unknownCookie);assert.equal(absent.status,404);
 const mail=await(await w.request('/api/test-mail',null,memberCookie)).json(),token=new URL(mail.url).hash.slice(1);
 const wrong=await w.request('/api/billing/login/confirm',{token},unknownCookie);assert.equal(wrong.status,400);
 const confirmed=await w.request('/api/billing/login/confirm',{token},memberCookie);assert.equal(confirmed.status,200);assert.match(confirmed.headers.get('Set-Cookie'),/p2s_private_reader=/);
 const replay=await w.request('/api/billing/login/confirm',{token},memberCookie);assert.equal(replay.status,400);
 assert.equal(logs.length,1);assert.deepEqual(JSON.parse(logs[0]),{event:'signin_link_unavailable',reason:'rate-limit'});
 assert.doesNotMatch(logs.join(''),/example.invalid|token|flow|private/);
 }finally{console.error=prior;await w.flush();f.sql.close();}
});

test('queued delivery failure masks provider detail, cancels link and preserves attempted-mail accounting',async()=>{
 const f=setup(),w=localWorker(f);w.env.AUDIO={put:async()=>{throw Error('private provider detail secret');}};
 const logs=[],prior=console.error;console.error=s=>logs.push(s);
 try{const response=await w.request('/api/billing/login/request',{email:'a@example.invalid'});assert.equal(response.status,200);assert.deepEqual(await response.json(),{sent:true});await w.flush();
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM login_links').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM login_limits').get().n,3);
 assert.deepEqual(logs.map(s=>JSON.parse(s)),[{event:'signin_link_unavailable',reason:'delivery'}]);
 }finally{console.error=prior;await w.flush();f.sql.close();}
});

test('unapproved production ignores queue flag; malformed email and hostile source fail before queued delivery',async()=>{
 const f=fixture('production'),w=localWorker(f,{READER_MODE:'production-public',UNIFIED_LIVE_APPROVED:'0',LOCAL_READER:'0',READER_ORIGIN:'https://pastetospeech.com',EMAIL_LIMIT:{limit:async()=>({success:true})}});
 // Hosted production ignores the flag: missing mail credentials still fail
 // synchronously with the original 503 instead of entering the staging queue.
 assert.equal((await w.request('/api/billing/login/request',{email:'a@example.invalid'})).status,503);await w.flush();f.sql.close();
 const g=setup(),v=localWorker(g);
 assert.equal((await v.request('/api/billing/login/request',{email:'malformed'})).status,422);
 assert.equal((await v.request('/api/billing/login/request',{email:'a@example.invalid'},'',{Origin:'https://attacker.example.invalid'})).status,403);
 assert.equal(g.sql.prepare('SELECT COUNT(*) n FROM login_links').get().n,0);await v.flush();g.sql.close();
});

for(const environment of ['staging','production'])test(`hosted ${environment} reuses only its host-protected flow so a suppressed resend preserves an earlier link`,async()=>{
 const f=environment==='staging'?setup():fixture('production');if(environment==='production')f.sql.exec(readFileSync('cloudflare/reader/migrations/0023_login_fair_allowance.sql','utf8'));f.auth??=new EmailIdentity(f.db);await exhaustPublic(f);
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);Object.assign(jwk,{kid:'mock-key',alg:'RS256'});
 const b64=x=>Buffer.from(x).toString('base64url'),seconds=Math.floor(Date.now()/1000),issuer='https://unit.cloudflareaccess.com';
 const input=b64(JSON.stringify({alg:'RS256',kid:'mock-key'}))+'.'+b64(JSON.stringify({iss:issuer,aud:['test-aud'],iat:seconds,exp:seconds+3600}));
 const jwt=input+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input)));
 const w=localWorker(f,{LOCAL_READER:'0',READER_ORIGIN:environment==='staging'?'https://staging.example.invalid':'https://pastetospeech.com',READER_MODE:environment==='staging'?'staging':'production-public',UNIFIED_LIVE_APPROVED:'1',EMAIL_LIMIT:{limit:async()=>({success:true})},PRIVATE_READER:environment==='staging'?'1':'0',ACCESS_ISSUER:issuer,ACCESS_AUD:'test-aud',RESEND_API_KEY:'synthetic-test-only',EMAIL_FROM:'noreply@example.invalid'});
 const priorFetch=globalThis.fetch,priorError=console.error,mails=[],logs=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url)===issuer+'/cdn-cgi/access/certs')return Response.json({keys:[jwk]});
  if(String(url)==='https://api.resend.com/emails'){mails.push(JSON.parse(options.body));return Response.json({id:'synthetic'});}
  throw Error('Unexpected external request blocked by fixture');
 };
 console.error=s=>logs.push(s);
 const request=(path,data,cookie='')=>w.request(path,data,cookie,{'Cf-Access-Jwt-Assertion':jwt});
 try{
 const planted='p2s_login_flow='+crypto.randomUUID()+crypto.randomUUID();
 const first=await request('/api/billing/login/request',{email:'a@example.invalid',flow:planted.split('=')[1]},planted);
 assert.equal(first.status,200);const hostCookie=flowCookie(first);assert.match(hostCookie,/^__Host-p2s_login_flow=/);assert.notEqual(hostCookie.split('=')[1],planted.split('=')[1]);assert.match(first.headers.get('Set-Cookie'),/; Secure/);assert.doesNotMatch(first.headers.get('Set-Cookie'),/Domain=/i);await w.flush();assert.equal(mails.length,1);
 const token=mails[0].text.match(/signin#([^\s]+)/)[1];
 for(let i=0;i<5;i++){
  const retry=await request('/api/billing/login/request',{email:'a@example.invalid'},hostCookie);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),{sent:true});assert.equal(flowCookie(retry),hostCookie);await w.flush();
 }
 assert.equal(mails.length,5);assert.equal(logs.length,1);assert.deepEqual(JSON.parse(logs[0]),{event:'signin_link_unavailable',reason:'rate-limit'});
 // A legacy-cookie-only request must not confirm even a newly issued token.
 const legacyOnly='p2s_login_flow='+hostCookie.split('=')[1];
 assert.equal((await request('/api/billing/login/confirm',{token},legacyOnly)).status,400);
 const confirmed=await request('/api/billing/login/confirm',{token},hostCookie);assert.equal(confirmed.status,200);
 const cleared=confirmed.headers.getSetCookie();assert.ok(cleared.some(v=>v.startsWith('__Host-p2s_login_flow=;')&&v.includes('Max-Age=0')));assert.ok(cleared.some(v=>v.startsWith('p2s_login_flow=;')&&v.includes('Max-Age=0')));
 assert.equal((await request('/api/billing/login/confirm',{token},hostCookie)).status,400);
 const invalid=await request('/api/billing/login/request',{email:'b@example.invalid'},'__Host-p2s_login_flow=planted-invalid');assert.notEqual(flowCookie(invalid),'__Host-p2s_login_flow=planted-invalid');await w.flush();
 const nextToken=mails.at(-1).text.match(/signin#([^\s]+)/)[1],nextFlow=flowCookie(invalid).split('=')[1];
 await assert.rejects(f.auth.confirm(nextToken,nextFlow,Date.now()+900001),e=>e.status===400);
 const logout=await request('/api/billing/logout',{});assert.ok(logout.headers.getSetCookie().some(v=>v.startsWith('__Host-p2s_login_flow=;')&&v.includes('Max-Age=0')));
 }finally{await w.flush();globalThis.fetch=priorFetch;console.error=priorError;f.sql.close();}
});

test('production migration preserves every table row, rejects staging, and retains rolling quotas on reapply',async()=>{
 const migration=readFileSync('cloudflare/reader/migrations/0023_login_fair_allowance.sql','utf8');
 const f=fixture('production'),auth=new EmailIdentity(f.db);
 await auth.request('a@example.invalid',null,'before-migration',time);
 const tables=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const snapshot=()=>Object.fromEntries(tables.map(n=>[n,f.sql.prepare('SELECT * FROM '+n).all()]));
 const before=snapshot();f.sql.exec(migration);assert.deepEqual(snapshot(),before);
 for(let i=0;i<89;i++)await auth.request(`promotion${i}@example.invalid`,null,`promotion-ip-${Math.floor(i/20)}`,time);const after=snapshot();f.sql.exec(migration);assert.deepEqual(snapshot(),after);
 await assert.rejects(auth.request('new-denied@example.invalid',null,'new-ip',time),e=>e.status===429);
 await auth.request('a@example.invalid',null,'member-ip',time);assert.equal(count(f,'global'),90);
 assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);f.sql.close();
 const staging=fixture(),triggers=staging.sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'login_limit_%'").all();
 assert.throws(()=>staging.sql.exec(migration),/malformed JSON/);assert.deepEqual(staging.sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'login_limit_%'").all(),triggers);staging.sql.close();
});
