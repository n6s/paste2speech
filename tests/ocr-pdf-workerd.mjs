import {outlinePdf} from './ocr-pdf-outline-fixture.js';
import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {mkdir,writeFile,readFile} from 'node:fs/promises';import {resolve} from 'node:path';import assert from 'node:assert/strict';import {PDFDocument} from 'pdf-lib';
const root=resolve('work/ocr-pdf-local-proof');await mkdir(root,{recursive:true});const config=root+'/wrangler.json';await writeFile(config,JSON.stringify({name:'ocr-pdf-local-proof',main:resolve('tests/ocr-pdf-worker.js'),compatibility_date:'2026-09-21',workers_dev:false}));
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--config',config,'--ip','127.0.0.1','--port',String(port),'--persist-to',root+'/state'],{env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_API_TOKEN:''},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
const url=`http://127.0.0.1:${port}`,send=bytes=>fetch(url,{method:'POST',body:bytes,signal:AbortSignal.timeout(5000)});
try{
 let ready=false;for(let i=0;i<100;i++){try{await send(new Uint8Array([0]));ready=true;break;}catch{if(child.exitCode!==null)throw Error('workerd exited');await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,'Local workerd did not start');
 for(const objectStreams of [false,true]){const pdf=await PDFDocument.create();for(let i=0;i<10;i++)pdf.addPage();const bytes=await pdf.save({useObjectStreams:objectStreams}),r=await send(bytes);assert.equal(r.status,200);assert.equal((await r.json()).pages,10);}
 const outlined=await send(await outlinePdf());assert.equal(outlined.status,200);assert.equal((await outlined.json()).pages,5);assert.equal((await send(await outlinePdf(1200))).status,422);
 const fixture=await send(await readFile('tests/fixtures/ocr/billing-proof.pdf'));assert.equal(fixture.status,200);assert.equal((await fixture.json()).pages,1);
 const pdf=await PDFDocument.create();for(let i=0;i<11;i++)pdf.addPage();assert.equal((await send(await pdf.save())).status,422);assert.equal((await send(new TextEncoder().encode('%PDF-broken'))).status,422);
 console.log('PASS local workerd: bounded server PDF admission, normal and compressed 10-page PDFs, pinned one-page fixture, outline-rich five-page PDF, excessive metadata and >10/malformed rejection; no bindings or provider calls.');
}catch(error){await writeFile(root+'/failure.log',log);throw error;}finally{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));}
