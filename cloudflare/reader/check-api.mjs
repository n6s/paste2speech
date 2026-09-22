import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8790';
function browser(initial={}){const jar={...initial};return {jar,async request(path,{data,method=data?'POST':'GET',headers={}}={}){
 const response=await fetch(base+path,{method,headers:{Origin:base,Cookie:Object.entries(jar).map(([k,v])=>k+'='+v).join('; '),'Content-Type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});
 for(const entry of response.headers.getSetCookie()){const [key,value]=entry.split(';')[0].split('=');if(value)jar[key]=value;else delete jar[key];}return response;
}};}
if(process.argv.includes('--resume')){
 const saved=JSON.parse(await readFile('work/private-reader/restart.json')),a=browser(saved.jar);
 const status=await (await a.request('/api/billing/status')).json();assert.equal(status.account.id,saved.account);assert.equal(status.account.balance,saved.balance);
 assert.equal((await (await a.request('/api/readings/'+saved.id)).json()).state,'ready');assert.equal((await a.request('/api/readings/'+saved.id+'/audio')).status,200);
 console.log('PASS: account, balance and complete audio survive runtime restart');process.exit(0);
}
const a=browser(),b=browser();
await a.request('/api/billing/session',{data:{}});await b.request('/api/billing/session',{data:{}});
const info=await (await a.request('/api/reader')).json();const voice='en-GB-Wavenet-F',input={voice,chunks:info.fixtures[voice].map(s=>s.text)};
const id=crypto.randomUUID();
assert.equal((await a.request('/api/readings',{data:input,headers:{Origin:'https://other.invalid','Idempotency-Key':id}})).status,403);
assert.equal((await a.request('/api/readings',{data:input,headers:{'Idempotency-Key':id}})).status,201);
assert.equal((await a.request('/api/readings',{data:input,headers:{'Idempotency-Key':id}})).status,200);
assert.equal((await b.request('/api/readings/'+id)).status,404);
assert.equal((await a.request('/api/readings/'+id+'/audio')).status,409);
let status;for(let n=0;n<100;n++){status=await (await a.request('/api/readings/'+id)).json();if(status.state==='ready')break;await new Promise(r=>setTimeout(r,100));}
assert.equal(status.state,'ready');assert.equal(status.attempts,8);assert.equal(status.delivery,'complete');assert.equal(status.speechRules,'google-default');
for(const range of ['bytes=0-99','bytes=-100']){const response=await a.request('/api/readings/'+id+'/audio',{headers:{Range:range}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,100);}
assert.equal((await a.request('/api/readings/'+id+'/audio',{headers:{Range:'bytes=999999999-'}})).status,416);
assert.equal((await b.request('/api/readings/'+id+'/download/mp3')).status,404);
assert.equal((await a.request('/api/billing/order',{data:{}})).status,503);
assert.equal((await a.request('/api/billing/login/request',{data:{email:'real@example.com'}})).status,422);
const email='api-'+Date.now()+'@example.invalid';await a.request('/api/billing/login/request',{data:{email}});
const mail=await (await a.request('/api/test-mail')).json(),token=mail.url.split('#')[1];
assert.equal((await b.request('/api/billing/login/confirm',{data:{token}})).status,400);
assert.equal((await a.request('/api/billing/login/confirm',{data:{token}})).status,200);
assert.equal((await a.request('/api/billing/login/confirm',{data:{token}})).status,400);
const account=(await (await a.request('/api/billing/status')).json()).account;assert.equal(account.balance,0);
await writeFile('work/private-reader/restart.json',JSON.stringify({jar:a.jar,account:account.id,balance:account.balance,id}),{mode:0o600});
const cancelled=crypto.randomUUID();await a.request('/api/readings',{data:input,headers:{'Idempotency-Key':cancelled}});
assert.equal((await a.request('/api/readings/'+cancelled,{method:'DELETE'})).status,204);
assert.equal((await a.request('/api/readings/'+cancelled+'/audio')).status,404);
console.log('PASS: full preparation, idempotency, owner isolation, Range, cancellation, browser-bound one-use email, payment and email guards');
