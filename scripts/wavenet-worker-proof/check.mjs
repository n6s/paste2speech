import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8788',root='work/wavenet-worker-proof';
const fixture=JSON.parse(await readFile('scripts/wavenet-worker-proof/fixture.json'));
const resume=process.argv.includes('--resume');
let cookie,id;
if(resume)({cookie,id}=JSON.parse(await readFile(`${root}/api-session.json`)));
else {const page=await fetch(base);cookie=page.headers.get('set-cookie').split(';')[0];}
const request=(path,options={})=>fetch(base+path,{...options,headers:{Cookie:cookie,Origin:base,...options.headers}});
const report={restart:resume,checks:[]};
const check=(condition,message)=>{assert.ok(condition,message);report.checks.push(message);};
if(!resume){
  const body={voice:'en-US-Wavenet-F',provider:'full',chunks:fixture['en-US-Wavenet-F'].map(s=>s.text)};
  const started=performance.now();
  const create=await request('/api/readings',{method:'POST',body:JSON.stringify(body)});assert.equal(create.status,201);id=(await create.json()).id;
  report.createdMs=performance.now()-started;
  const partial=await request(`/api/readings/${id}/audio`);check(partial.status===409,'Partial audio is unavailable');
  const bad=await request('/api/readings',{method:'POST',body:JSON.stringify({...body,chunks:['Not the fixed synthetic text.']})});check(bad.status===422,'Arbitrary text cannot trigger this pilot');
  const other=await fetch(`${base}/api/readings/${id}`,{headers:{Cookie:'p2s_worker_proof=00000000-0000-0000-0000-000000000000'}});check(other.status===404,'Another owner cannot read job status');
  await writeFile(`${root}/api-session.json`,JSON.stringify({cookie,id}),{mode:0o600});
}
const deadline=Date.now()+15000;let status;
do {status=await(await request(`/api/readings/${id}`)).json();if(status.state==='ready')break;assert.equal(status.state,'preparing');await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
check(status.state==='ready','Stored recording is ready');
check(status.attempts===8,'Exactly eight section attempts');
check(status.speechRules==='google-default','Google default speech policy');
const original=await readFile('work/wavenet-mp3-proof/en-US-Wavenet-F.mp3');
const audio=await request(`/api/readings/${id}/download/mp3`);assert.deepEqual(Buffer.from(await audio.arrayBuffer()),original);report.checks.push('Stored flat MP3 matches original section bytes');
const vtt=await(await request(`/api/readings/${id}/download/vtt`)).text();check(vtt.split(' --> ').length-1===8,'VTT contains eight cues');
for(const range of ['bytes=192-383','bytes=-192']){
 const response=await request(`/api/readings/${id}/audio`,{headers:{Range:range}});check(response.status===206,`${range} uses partial response`);
 const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,range.includes('-192')?original.subarray(-192):original.subarray(192,384));
}
const denied=await fetch(`${base}/api/readings/${id}/audio`);check(denied.status===404,'Anonymous audio access denied');
const invalid=await request(`/api/readings/${id}/audio`,{headers:{Range:'bytes=99999999-'}});check(invalid.status===416,'Out-of-range seek rejected');
if(!resume){
 const body={voice:'en-US-Wavenet-F',provider:'full',chunks:fixture['en-US-Wavenet-F'].map(s=>s.text)};
 const cancelled=await(await request('/api/readings',{method:'POST',body:JSON.stringify(body)})).json();
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){const s=await(await request(`/api/readings/${cancelled.id}`)).json();if(s.attempts>0)break;await new Promise(r=>setTimeout(r,25));}
 const remove=await request(`/api/readings/${cancelled.id}`,{method:'DELETE'});check(remove.status===204,'Active preparation can be cancelled');
 await new Promise(r=>setTimeout(r,1600));
 const gone=await request(`/api/readings/${cancelled.id}/audio`);check(gone.status===404,'Cancelled recording stays unavailable after in-flight sections finish');
 const foreignDelete=await fetch(`${base}/api/readings/${id}`,{method:'DELETE',headers:{Origin:base,Cookie:'p2s_worker_proof=00000000-0000-0000-0000-000000000000'}});check(foreignDelete.status===404,'Another owner cannot delete the reading');
}
report.status=status;report.result='PASS';await writeFile(`${root}/api-${resume?'restart':'initial'}-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
