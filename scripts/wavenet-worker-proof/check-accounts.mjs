// Runs against the separate local account pilot, using seeded fake credit only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const base='http://127.0.0.1:8789';
const fixture=JSON.parse(await readFile('scripts/wavenet-worker-proof/fixture.json'));
const body={voice:'en-US-Wavenet-F',provider:'full',chunks:fixture['en-US-Wavenet-F'].map(s=>s.text)};
const counts=body.chunks.map(t=>[...t].length),total=counts.reduce((a,b)=>a+b,0);
const request=(cookie,path,options={})=>fetch(base+path,{...options,headers:{Origin:base,Cookie:cookie,...options.headers}});
const login=async account=>{const r=await request('','/api/test-login',{method:'POST',body:JSON.stringify({account})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
const account=async cookie=>(await request(cookie,'/api/account')).json();
const create=(cookie,id=crypto.randomUUID(),extra={})=>request(cookie,'/api/readings',{method:'POST',headers:{'Idempotency-Key':id},body:JSON.stringify({...body,...extra})});
const pause=()=>new Promise(r=>setTimeout(r,40));
async function receipt(cookie,id){for(let n=0;n<300;n++){const r=await(await request(cookie,`/api/reservations/${id}`)).json();if(r.state==='closed')return r;await pause();}throw Error('Settlement timeout');}
if(process.argv.includes('--resume')){
 const saved=JSON.parse(await readFile('work/wavenet-account-proof/session.json'));
 const balance=await account(saved.cookie);assert.equal(balance.balance,saved.balance);assert.equal(balance.reserved,0);
 const status=await(await request(saved.cookie,`/api/readings/${saved.id}`)).json();assert.equal(status.state,'ready');assert.equal(status.attempts,8);
 await create(saved.cookie,saved.id);assert.equal((await account(saved.cookie)).balance,saved.balance);
 console.log('PASS: runtime restart preserves account, recording, eight attempts and settled balance');process.exit(0);
}
const checks=[];
assert.equal((await create('')).status,401);
const a=await login('test-reader-a'),b=await login('test-reader-b'),low=await login('test-low-credit');
assert.equal((await request('p2s_worker_proof=test-reader-a','/api/account')).status,401);
checks.push('Missing and forged sessions rejected');
const before=await account(a),id=crypto.randomUUID();
const duplicate=await Promise.all([create(a,id),create(a,id)]);
assert.ok(duplicate.every(r=>[200,201].includes(r.status)));
const held=await account(a);assert.equal(held.balance,before.balance-total);assert.equal(held.reserved,total);
assert.equal((await create(a,id,{voice:'en-GB-Wavenet-F',chunks:fixture['en-GB-Wavenet-F'].map(s=>s.text)})).status,409);
assert.equal((await create(b,id)).status,404);
for(const path of [`/api/readings/${id}`,`/api/readings/${id}/audio`,`/api/reservations/${id}`])assert.equal((await request(b,path)).status,404);
assert.equal((await request(b,`/api/readings/${id}`,{method:'DELETE'})).status,404);
checks.push('Concurrent duplicate reserves once; changed input and cross-account access rejected');
const complete=await receipt(a,id);assert.equal(complete.consumed,total);assert.equal(complete.released,0);
for(let n=0;n<3;n++){assert.equal((await create(a,id)).status,200);assert.equal((await request(a,`/api/readings/${id}`)).status,200);}
assert.equal((await account(a)).balance,before.balance-total);assert.equal((await account(a)).reserved,0);
checks.push('Successful preparation charges once despite repeated creates and status reads');
const failureId=crypto.randomUUID();assert.equal((await create(a,failureId,{proofScenario:'fail-middle'})).status,201);
const failed=await receipt(a,failureId);assert.equal(failed.outcome,'failed');assert.equal(failed.consumed,counts[0]+counts[2]);assert.equal(failed.released,total-failed.consumed);
checks.push('Partial failure charges only successful sections and releases the rest');
const cancelId=crypto.randomUUID();assert.equal((await create(a,cancelId)).status,201);
let submitting=false;
for(let n=0;n<100;n++){const s=await(await request(a,`/api/readings/${cancelId}`)).json();if(s.attempts===3){submitting=true;break;}await pause();}
assert.ok(submitting);assert.equal((await request(a,`/api/readings/${cancelId}`,{method:'DELETE'})).status,204);
const cancelled=await receipt(a,cancelId);assert.equal(cancelled.outcome,'cancelled');assert.equal(cancelled.consumed,counts.slice(0,3).reduce((a,b)=>a+b,0));assert.equal(cancelled.released,total-cancelled.consumed);
assert.equal((await request(a,`/api/readings/${cancelId}/audio`)).status,404);
checks.push('Stop records successful in-flight sections before refund; no later batches');
const lowBefore=await account(low);assert.ok(lowBefore.balance>=total&&lowBefore.balance<2*total,'Use a fresh local state directory for the low-credit race');
const races=await Promise.all([create(low),create(low)]);assert.deepEqual(races.map(r=>r.status).sort(),[201,402]);
const winner=await races.find(r=>r.status===201).json();await receipt(low,winner.id);
assert.equal((await account(low)).balance,lowBefore.balance-total);
checks.push('Two simultaneous readings cannot overspend the available credit');
await request(b,'/api/logout',{method:'POST'});assert.equal((await request(b,'/api/account')).status,401);
checks.push('Logout invalidates the stored session');
const after=await account(a);assert.equal(after.balance,before.balance-complete.consumed-failed.consumed-cancelled.consumed);assert.equal(after.reserved,0);
await writeFile('work/wavenet-account-proof/session.json',JSON.stringify({cookie:a,id,balance:after.balance}),{mode:0o600});
const report={result:'PASS',scope:'Local D1, Durable Objects and R2; synthetic identities, fake credit, cached audio',charactersPerReading:total,complete,failed,cancelled,checks};
await mkdir('work/wavenet-account-proof',{recursive:true});await writeFile('work/wavenet-account-proof/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
