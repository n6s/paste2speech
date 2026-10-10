// Built or hosted staging UI, real MP3/MSE playback, all APIs/speech synthetic.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {inspectMp3} from '../cloudflare/prepared/mp3.js';
const hosted=process.env.READER_ORIGIN,commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const root='work/private-reader/site',out='work/network-recovery-2026-10-10';await mkdir(out,{recursive:true});
const bytes=await Promise.all([0,1,2].map(i=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));
let duration=0;const sections=bytes.map((b,index)=>{const m=inspectMp3(b),s={index,start:duration,samples:m.samples,bytes:m.bytes};duration+=m.samples/24000;return s;});
const server=hosted?null:createServer(async(req,res)=>{try{const file=new URL(req.url,'http://local').pathname.slice(1)||'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(root+'/'+file));}catch{res.writeHead(404).end();}});
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=hosted||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 if(hosted){const token=execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();await context.addCookies([{name:'CF_Authorization',value:token,domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true}]);}
 const page=await context.newPage(),errors=[],posts=[],external=[];let id,failSection=true;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__audio=[];window.__appends=0;const Original=window.Audio;window.Audio=function(...args){const a=new Original(...args),load=a.load.bind(a);a.load=()=>{delete a.error;load();};__audio.push(a);return a;};
  const append=SourceBuffer.prototype.appendBuffer;SourceBuffer.prototype.appendBuffer=function(b){__appends++;return append.call(this,b);};
  window.__spoken=[];window.__nativePaused=true;window.__nativeResumes=0;window.__speechFail=false;
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'Local fixture',voiceURI:'local-fixture',lang:'en-US',localService:true}],addEventListener(){},get paused(){return __nativePaused;},resume(){__nativePaused=false;__nativeResumes++;},cancel(){},speak(u){if(__nativePaused)throw Error('Native engine remained paused');__spoken.push(u);if(__speechFail)queueMicrotask(()=>u.onerror?.({error:'synthesis-failed'}));}}});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  window.mediaError=()=>{const a=__audio.find(a=>a.src.startsWith('blob:')||a.src.includes('/audio'));Object.defineProperty(a,'error',{value:{code:2,message:'Synthetic signal loss'},configurable:true});a.dispatchEvent(new Event('error'));};
 });
 await page.route('**/*',async route=>{const r=route.request(),url=new URL(r.url()),p=url.pathname;
  if(url.origin!==origin){external.push(url.origin);return route.abort();}
  if(!p.startsWith('/api/'))return route.continue();
  if(p==='/api/reader')return route.fulfill({json:{eligible:true,account:{balance:1000000}}});
  if(p==='/api/readings'&&r.method()==='POST'){id=r.headers()['idempotency-key'];posts.push({id,chunks:r.postDataJSON().chunks});return route.fulfill({json:{id}});}
  if(r.method()==='DELETE')return route.fulfill({status:204});
  const section=p.match(/\/sections\/(\d+)$/);if(section){if(failSection&&section[1]==='1')return route.abort('internetdisconnected');return route.fulfill({contentType:'audio/mpeg',body:bytes[Number(section[1])]});}
  if(p.endsWith('/audio')){const audio=Buffer.concat(bytes),range=r.headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Number(range[2]):audio.length-1;return route.fulfill({status:range?206:200,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})},body:audio.subarray(start,end+1)});}
  if(p==='/api/readings/'+id)return route.fulfill({json:{id,state:'ready',starts:sections.map(s=>s.start),duration,completed:3,total:3,sections}});
  return route.fulfill({json:{}});
 });
 await page.goto(origin);await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');const text='First section.\n\nSecond section.\n\nThird section.';await page.fill('#text',text);await page.click('#play');
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='Failed to fetch');failSection=false;await page.click('#play');await page.waitForFunction(()=>__appends===3&&document.querySelector('#status').textContent==='Reading aloud');assert.equal(posts.length,1);
 await page.click('#pause');const before=await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).currentTime);await page.evaluate(()=>mediaError());assert.match(await page.locator('#status').textContent(),/Tap Resume to reconnect/);assert.ok(await page.locator('#play').isEnabled());await page.click('#play');
 await page.waitForFunction(()=>__audio.some(a=>a.src.includes('/audio')&&a.currentTime>.1)&&document.querySelector('#status').textContent==='Reading aloud');const after=await page.evaluate(()=>__audio.find(a=>a.src.includes('/audio')).currentTime);assert.ok(after>=before-.05&&after<before+1);assert.equal(posts.length,1);assert.equal(await page.locator('#text').inputValue(),text);
 for(let n=0;n<3;n++){
  await page.click('#pause');await page.locator('#seek').evaluate(e=>{e.value='1';e.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#seek-time').textContent==='2 / 3');await page.click('#play');
  await page.selectOption('#engine','browser');await page.selectOption('#voice','local-fixture');await page.evaluate(()=>__nativePaused=true);await page.click('#play');assert.ok(await page.evaluate(()=>__nativeResumes)>n);const spoken=await page.evaluate(()=>__spoken.length);assert.ok(spoken>n);
  await page.evaluate(()=>{for(const a of __audio){a.dispatchEvent(new Event('playing'));a.dispatchEvent(new Event('error'));}});assert.equal(await page.locator('#status').textContent(),'Reading aloud');
  await page.click('#stop');await page.selectOption('#engine','google');await page.click('#play');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Reading aloud');assert.equal(posts.length,1);
 }
 await page.selectOption('#engine','browser');await page.evaluate(()=>__speechFail=true);await page.click('#play');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('synthesis-failed'));const old=await page.evaluate(()=>__spoken.length);await page.click('#play');await page.waitForFunction(n=>__spoken.length>n,old);assert.match(await page.locator('#status').textContent(),/synthesis-failed/);
 await page.click('#stop');await page.click('#clear');assert.equal(await page.locator('#text').inputValue(),'');assert.ok(await page.locator('#play').isDisabled());await page.evaluate(()=>{__speechFail=false;__spoken.at(-1).onend?.();__spoken.at(-1).onerror?.({error:'synthesis-failed'});});assert.equal(await page.locator('#status').textContent(),'Ready when you are');await page.fill('#text','Short fresh text.');await page.evaluate(()=>__nativePaused=true);await page.click('#play');assert.equal(await page.locator('#status').textContent(),'Reading aloud');await page.click('#stop');
 const served=await page.evaluate(async()=>(await fetch('/release.json')).json());if(hosted)assert.equal(served.commit,commit);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(posts.length,1);
 await page.screenshot({path:out+'/recovery-'+(hosted?'hosted':'built')+'.png'});await writeFile(out+'/recovery-'+(hosted?'hosted':'built')+'.json',JSON.stringify({commit,servedCommit:served.commit,hosted:!!hosted,sourcePreserved:true,recoveredPosition:{before,after},syntheticSpeechJobPosts:posts,nativeResumeCalls:await page.evaluate(()=>__nativeResumes),repeatedEngineTransitions:3,paidCalls:0,liveInferenceCalls:0,pageErrors:errors,externalRequests:external},null,2));await context.close();console.log('PASS '+(hosted?'hosted':'built')+' staging recovery UI: same job/source/position, interrupted download retry, seeking, three engine switches, paused native engine, persistent synthesis error, Stop/Clear and stale callbacks.');
}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
