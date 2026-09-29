// Real MSE buffering with intercepted speech APIs: no paid synthesis.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const remote=process.env.VIDEO_STAGING_ORIGIN;
if(remote && remote!=='https://staging.pastetospeech.com')throw Error('Only private staging is permitted');
const source=fixtures['en-US-Wavenet-F'][3]; // A single whole sentence, known audio.
const mp3=await readFile('tests/fixtures/wavenet/'+source.file), info=inspectMp3(mp3);
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname, file=path==='/'?'index.html':path.slice(1);
 const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.bin')?'application/octet-stream':'text/html';
 res.setHeader('Content-Type',type);res.setHeader('Content-Security-Policy',csp);res.end(await readFile('work/private-reader/site/'+file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1100,height:900}}), errors=[],jobs=new Map();let posts=0;
 if(remote)await page.context().addCookies([{name:'CF_Authorization',value:execFileSync('cloudflared',['access','token','--app',remote],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),url:remote,httpOnly:true,secure:true,sameSite:'Lax'}]);
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/api/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(p==='/api/readings'&&r.method()==='POST'){
   const id=r.headers()['idempotency-key'],body=r.postDataJSON(); posts++;
   assert.ok(body.chunks.reduce((n,c)=>n+c.length,0)<=1200);assert.ok(body.chunks.every(c=>c===source.text));
   const duration=info.duration*body.chunks.length;
   jobs.set(id,{mp3:Buffer.concat(body.chunks.map(()=>mp3)),duration,total:body.chunks.length});
   return route.fulfill({json:{id}});
  }
  const match=p.match(/^\/api\/readings\/([^/]+)(.*)$/);
  if(match){const job=jobs.get(match[1]);assert.ok(job);
   if(match[2]==='/audio'||match[2]==='/download/mp3'){return route.fulfill({contentType:'audio/mpeg',body:job.mp3});}
   if(match[2].startsWith('/sections/'))return route.fulfill({contentType:'audio/mpeg',body:mp3});
   const count=job.total;
   return route.fulfill({json:{state:'ready',duration:count*info.duration,total:job.total,completed:count,starts:Array.from({length:count},(_,i)=>i*info.duration),sections:Array.from({length:count},(_,i)=>({index:i,start:i*info.duration,samples:info.samples,bytes:info.bytes}))}});
  }
  return route.fulfill({json:p==='/api/reader'?{eligible:true,account:{balance:10000}}:{}});
 });
 await page.goto((remote||`http://127.0.0.1:${server.address().port}`)+'/?testing=1');
 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
 await page.locator('#mse-cached').evaluate(e=>{e.checked=false;e.dispatchEvent(new Event('change'));});
 await page.fill('#text',Array(40).fill(source.text).join('\n\n'));
 await page.evaluate(()=>{__stagingReader.bufferAhead=5;__stagingReader.bufferBehind=1;});
 await page.click('#play');
 await page.waitForFunction(()=>__stagingReader.audio.currentTime>4);
 await page.click('#pause');
 assert.ok(await page.evaluate(()=>__stagingReader.ranges()[0][0]>0));
 assert.ok(await page.evaluate(()=>__stagingReader.next<__stagingReader.status.total));
 await page.evaluate(()=>__stagingReader.seek(0.2));
 await page.waitForFunction(()=>__stagingReader.pendingIndex==null&&Math.abs(__stagingReader.audio.currentTime-.2)<.1);
 await page.evaluate(()=>__stagingReader.seek(50));
 await page.waitForFunction(()=>__stagingReader.pendingIndex==null&&Math.abs(__stagingReader.audio.currentTime-50)<.1);
 assert.equal(posts,1);
 await page.evaluate(()=>__stagingReader.seek(__stagingReader.duration-2));
 await page.waitForFunction(()=>__stagingReader.finalized);
 await page.evaluate(()=>__stagingReader.seek(0));
 await page.waitForFunction(()=>__stagingReader.pendingIndex==null&&__stagingReader.audio.currentTime<.1);
 assert.equal(await page.evaluate(()=>__stagingReader.fatal),false);
 // Force quota pressure while preserving real MSE append/remove operations.
 await page.reload();
 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
 await page.locator('#mse-cached').evaluate(e=>{e.checked=false;e.dispatchEvent(new Event('change'));});
 await page.fill('#text',Array(40).fill(source.text).join('\n\n'));
 await page.evaluate(()=>{const append=SourceBuffer.prototype.appendBuffer;SourceBuffer.prototype.appendBuffer=function(bytes){if(this.buffered.length&&this.buffered.end(this.buffered.length-1)-this.buffered.start(0)>6)throw new DOMException('Test pressure','QuotaExceededError');return append.call(this,bytes);};});
 await page.click('#play');
 await page.waitForFunction(()=>__stagingReader.audio.currentTime>12,{},{timeout:30000});
 assert.ok(await page.evaluate(()=>__stagingReader.events.some(e=>e.type==='buffer-pressure')));
 assert.ok(await page.evaluate(()=>__stagingReader.events.some(e=>e.type==='buffer-trim')));
 assert.equal(await page.evaluate(()=>__stagingReader.fatal),false);
 assert.equal(posts,2);
 await page.reload();
 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
 await page.locator('#mse-cached').evaluate(e=>{e.checked=false;e.dispatchEvent(new Event('change'));});
 await page.fill('#text',Array(40).fill(source.text).join('\n\n'));
 await page.evaluate(()=>{SourceBuffer.prototype.appendBuffer=function(){throw new DOMException('No room','QuotaExceededError');};});
 await page.click('#play');
 await page.waitForFunction(()=>__stagingReader.mode==='full'&&__stagingReader.audio.currentTime>0);
 assert.equal(posts,3,'Native fallback preserves the existing speech job');
 assert.equal(await page.evaluate(()=>__stagingReader.fatal),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: bounded buffering, eviction, backward/forward seek, seek after EOS, and forced quota recovery without new speech jobs.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
