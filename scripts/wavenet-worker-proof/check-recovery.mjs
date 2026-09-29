// All requests go to the cached-only local account harness. No cloud calls.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8789',root='work/wavenet-account-proof';
const fixture=JSON.parse(await readFile('scripts/wavenet-worker-proof/fixture.json'));
const body={voice:'en-US-Wavenet-F',provider:'full',chunks:fixture['en-US-Wavenet-F'].map(p=>p.text)};
const total=body.chunks.reduce((n,t)=>n+[...t].length,0);
let cookie;
const request=(path,options={})=>fetch(base+path,{signal:AbortSignal.timeout(10000),...options,headers:{Cookie:cookie||'',Origin:base,...options.headers}});
const account=async()=>(await request('/api/account')).json();
const create=(id,fault)=>request('/api/readings',{method:'POST',headers:{'Idempotency-Key':id,...(fault?{'X-Proof-Admission-Fault':fault}:{})},body:JSON.stringify(body)});
const pause=()=>new Promise(r=>setTimeout(r,80));
async function done(id){
 for(let n=0;n<250;n++){
  const s=await(await request(`/api/readings/${id}`)).json();
  if(s.state==='ready'){assert.equal(s.attempts,8);const r=await(await request(`/api/reservations/${id}`)).json();if(r.state==='closed'){assert.equal(r.consumed,total);return;}}
  else assert.equal(s.state,'preparing');
  await pause();
 }throw Error('Recovery timeout');
}
if(process.argv.includes('--resume')){
 const saved=JSON.parse(await readFile(`${root}/recovery-session.json`));cookie=saved.cookie;
 await done(saved.id);assert.equal((await account()).balance,saved.before-total);assert.equal((await account()).reserved,0);
 for(let n=0;n<3;n++)assert.equal((await create(saved.id)).status,200);
 assert.equal((await account()).balance,saved.before-total);
 console.log('PASS: pending admission recovers after full runtime restart; one reservation, eight attempts, one charge');
 await writeFile(`${root}/recovery-restart.json`,JSON.stringify({result:'PASS',charged:total,attempts:8}));process.exit(0);
}
const caps=await(await request('/capabilities')).json();assert.equal(caps.liveEnabled,false);assert.equal(caps.hasGoogleCredential,false);
const login=await request('/api/test-login',{method:'POST',body:JSON.stringify({account:'test-reader-a'})});cookie=login.headers.get('set-cookie').split(';')[0];
if(process.argv.includes('--stage')){
 const id=crypto.randomUUID(),before=(await account()).balance;
 assert.equal((await create(id,'after-reserve')).status,503);
 const s=await(await request(`/api/readings/${id}`)).json();assert.equal(s.attempts,0);assert.equal((await account()).reserved,total);
 await writeFile(`${root}/recovery-session.json`,JSON.stringify({id,cookie,before}),{mode:0o600});
 console.log('Staged pending admission with credit reserved and zero speech attempts; restart local runtime now');process.exit(0);
}
const checks=[];
for(const fault of ['after-intent','after-reserve']){
 const before=(await account()).balance,id=crypto.randomUUID();
 assert.equal((await create(id,fault)).status,503);
 const pending=await(await request(`/api/readings/${id}`)).json();assert.equal(pending.attempts,0);
 assert.equal((await account()).reserved,fault==='after-intent'?0:total);
 // No retry POST: the durable alarm must recover without the browser.
 await done(id);assert.equal((await account()).balance,before-total);assert.equal((await account()).reserved,0);
 assert.equal((await create(id)).status,200);assert.equal((await account()).balance,before-total);
 checks.push(`${fault}: automatic recovery without resubmission; eight attempts and one charge`);
}
for(const fault of ['after-intent','after-reserve']){
 const before=(await account()).balance,id=crypto.randomUUID();await create(id,fault);
 assert.equal((await request(`/api/readings/${id}`,{method:'DELETE'})).status,204);
 assert.equal((await account()).balance,before);assert.equal((await account()).reserved,0);
 assert.equal((await create(id)).status,200);assert.equal((await account()).balance,before);
 assert.equal((await request(`/api/readings/${id}`)).status,404);
 checks.push(`${fault}: cancelling pending admission returns any hold; replay cannot reserve again`);
}
await writeFile(`${root}/recovery-results.json`,JSON.stringify({result:'PASS',checks},null,2));console.log(JSON.stringify({result:'PASS',checks},null,2));
