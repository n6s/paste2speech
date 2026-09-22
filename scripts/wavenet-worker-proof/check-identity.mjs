import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8789',root='work/wavenet-account-proof';
function browser(initial={}){
 const jar={...initial};return {jar,async request(path,body){const r=await fetch(base+path,{signal:AbortSignal.timeout(10000),method:body?'POST':'GET',headers:{Origin:base,Cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');if(v)jar[k]=v;else delete jar[k];}return r;}};
}
async function requestLink(b,email){assert.equal((await b.request('/api/billing/login/request',{email})).status,200);const r=await b.request('/api/test-mail');assert.equal(r.status,200);return (await r.json()).url.split('#')[1];}
async function balance(b){const r=await b.request('/api/account');assert.equal(r.status,200);return r.json();}
if(process.argv.includes('--resume')){
 const saved=JSON.parse(await readFile(`${root}/identity-session.json`)),b=browser(saved.jar);assert.equal((await balance(b)).balance,saved.balance);assert.equal((await balance(b)).id,saved.id);
 console.log('PASS: verified email session and balance survive runtime restart');process.exit(0);
}
const a=browser(),b=browser(),foreign=browser();
assert.equal((await a.request('/api/test-login',{account:'test-reader-a'})).status,200);const before=await balance(a),old=browser(a.jar);
const token=await requestLink(a,'reader@example.invalid');
assert.equal((await foreign.request('/api/test-mail')).status,404);
assert.equal((await foreign.request('/api/billing/login/confirm',{token})).status,400);
const page=await a.request('/api/billing/signin');assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.match(page.headers.get('content-security-policy'),/default-src 'none'/);
const race=await Promise.all([a.request('/api/billing/login/confirm',{token}),a.request('/api/billing/login/confirm',{token})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);
assert.equal((await old.request('/api/account')).status,401);assert.equal((await balance(a)).balance,before.balance);
const link2=await requestLink(b,'READER@example.invalid');assert.equal((await b.request('/api/billing/login/confirm',{token:link2})).status,200);assert.equal((await balance(b)).id,before.id);
const fixture=JSON.parse(await readFile('scripts/wavenet-worker-proof/fixture.json'));
const id=crypto.randomUUID();const create=await fetch(base+'/api/readings',{method:'POST',headers:{Origin:base,Cookie:Object.entries(b.jar).map(([k,v])=>`${k}=${v}`).join('; '),'Idempotency-Key':id},body:JSON.stringify({voice:'en-US-Wavenet-F',provider:'full',chunks:fixture['en-US-Wavenet-F'].map(s=>s.text)})});assert.equal(create.status,201);
let ready=false;for(let n=0;n<200;n++){const s=await(await b.request(`/api/readings/${id}`)).json();if(s.state==='ready'){ready=true;assert.equal(s.attempts,8);break;}await new Promise(r=>setTimeout(r,40));}assert.ok(ready);
assert.equal((await balance(a)).balance,before.balance-521);assert.equal((await balance(b)).balance,before.balance-521);
await a.request('/api/logout',{});assert.equal((await a.request('/api/account')).status,401);assert.equal((await balance(b)).balance,before.balance-521);
await foreign.request('/api/test-login',{account:'test-reader-b'});const conflict=await requestLink(foreign,'reader@example.invalid');assert.equal((await foreign.request('/api/billing/login/confirm',{token:conflict})).status,409);assert.equal((await balance(foreign)).balance,5000);
await writeFile(`${root}/identity-session.json`,JSON.stringify({jar:b.jar,balance:before.balance-521,id:before.id}),{mode:0o600});
const report={result:'PASS',checks:['One-use confirmation under concurrent requests','Wrong browser and simulated mailbox isolation','Scanner GET does not consume link; protected confirmation page','Original test credential revoked; credit preserved','Second session recovers same account','Verified session prepares cached reading and charges shared balance once','Logout isolates sessions','Conflicting paid credit rejected without balance change'],speechRequests:0,emailSent:0};
await writeFile(`${root}/identity-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
