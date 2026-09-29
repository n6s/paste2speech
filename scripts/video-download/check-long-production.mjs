// Real browser/WASM conversion with intercepted speech APIs: no paid synthesis.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {captions, inspectMp3} from '../../cloudflare/prepared/mp3.js';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const remote=undefined;
if(remote && remote!=='https://staging.pastetospeech.com')throw Error('Only private staging is permitted');
const folder='work/long-reading'; await mkdir(folder,{recursive:true});
const source=fixtures['en-US-Wavenet-F'][3]; // A single whole sentence, known audio.
const mp3=await readFile('tests/fixtures/wavenet/'+source.file), info=inspectMp3(mp3);
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname, file=path==='/'?'index.html':path.slice(1);
 const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.bin')?'application/octet-stream':'text/html';
 res.setHeader('Content-Type',type);res.setHeader('Content-Security-Policy',csp);res.end(await readFile('work/production-reader/site/'+file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1100,height:900}}), errors=[],jobs=new Map();let posts=0,toolLoads=0,downloads=0,audioDownloads=0,partial=true,allowComplete=false,partialPolls=0,longMode=true;
 page.on('download',()=>downloads++);
 if(remote)await page.context().addCookies([{name:'CF_Authorization',value:execFileSync('cloudflared',['access','token','--app',remote],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),url:remote,httpOnly:true,secure:true,sameSite:'Lax'}]);
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(r.url().includes('/video/'))toolLoads++;});
 await page.route('**/api/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(p==='/api/readings'&&r.method()==='POST'){
   const id=r.headers()['idempotency-key'],body=r.postDataJSON(); posts++;
   assert.ok(body.chunks.reduce((n,c)=>n+c.length,0)<=(longMode?20000:1200));if(!longMode)assert.ok(body.chunks.every(c=>c===source.text));
   const starts=body.chunks.map((_,i)=>i*info.duration),duration=info.duration*body.chunks.length;
   jobs.set(id,{mp3:Buffer.concat(body.chunks.map(()=>mp3)),vtt:captions(body.chunks,{starts,duration}),duration,total:body.chunks.length});
   return route.fulfill({json:{id}});
  }
  const match=p.match(/^\/api\/readings\/([^/]+)(.*)$/);
  if(match){const job=jobs.get(match[1]);assert.ok(job);
   if(match[2]==='/download/mp3'){audioDownloads++;return route.fulfill({contentType:'audio/mpeg',body:job.mp3});}
   if(match[2].startsWith('/sections/'))return route.fulfill({contentType:'audio/mpeg',body:mp3});
   if(match[2]==='/download/vtt')return route.fulfill({contentType:'text/vtt',body:job.vtt});
   if(partial)partialPolls++;
   const ready=!partial||allowComplete,count=ready?job.total:6;
   return route.fulfill({json:{state:ready?'ready':'preparing',duration:count*info.duration,total:job.total,completed:count,starts:Array.from({length:count},(_,i)=>i*info.duration),sections:Array.from({length:count},(_,i)=>({index:i,start:i*info.duration,samples:info.samples,bytes:info.bytes}))}});
  }
  return route.fulfill({json:p==='/api/reader'?{eligible:true,account:{balance:10000}}:{}});
 });

 await page.addInitScript(()=>{const Native=window.Audio;window.__audio=[];window.Audio=function(...args){const a=new Native(...args);window.__audio.push(a);return a;};});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
 const longText=[...Array(42).fill('Reading '+'a'.repeat(491)+'.'),'Ending '+'b'.repeat(339)+'.'].join('\n\n');
 await page.fill('#text',longText);await page.click('#play');
 await page.waitForFunction(()=>document.getElementById('recording-progress').textContent.includes('6 of 43'));
 await page.waitForFunction(()=>__audio.some(a=>a.currentTime>0));
 assert.equal(posts,1);assert.equal(toolLoads,0);
 allowComplete=true;
 await page.waitForFunction(()=>document.getElementById('recording-progress').textContent.includes('Recording ready'));
 await page.click('#pause');
 await page.locator('#seek').evaluate(e=>{e.value=String(40*1.848+.1);e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));});
 await page.waitForFunction(()=>__audio.some(a=>a.currentTime>73));
 assert.equal(posts,2);
 const video=await page.locator('#video-download').count();
 if(video){
  await page.locator('#video-download').evaluate(e=>e.open=true);await page.click('#download-video');
  await page.waitForFunction(()=>document.getElementById('open-video').getAttribute('href')?.startsWith('blob:'),{},{timeout:180000});
  const pending=page.waitForEvent('download');await page.locator('#open-video').evaluate(link=>{const a=link.cloneNode(true);a.removeAttribute('id');document.body.append(a);a.click();a.remove();});await (await pending).saveAs(folder+'/joined.mp4');
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',folder+'/joined.mp4'],{encoding:'utf8'}));
  assert.deepEqual(probe.streams.map(s=>s.codec_name),['h264','aac','mov_text']);assert.equal(probe.format.tags.comment,'Created with PasteToSpeech — https://pastetospeech.com');
  const vtt=execFileSync('ffmpeg',['-v','error','-i',folder+'/joined.mp4','-map','0:s:0','-f','webvtt','-'],{encoding:'utf8'});assert.equal((vtt.match(/ --> /g)||[]).length,43);
  assert.ok(Math.abs(Number(probe.streams.find(s=>s.codec_type==='audio').duration)-43*info.duration)<.1);
 }else{
 await page.locator('#recording-download').evaluate(e=>e.open=true);
 let pending=page.waitForEvent('download');await page.click('#download-audio');await (await pending).saveAs(folder+'/joined.mp3');
 const audio=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',folder+'/joined.mp3'],{encoding:'utf8'}));
 assert.ok(Math.abs(Number(audio.format.duration)-43*info.duration)<.1);
 await page.check('#include-captions');pending=page.waitForEvent('download');await page.click('#download-captions');await (await pending).saveAs(folder+'/joined.vtt');
 const vtt=await readFile(folder+'/joined.vtt','utf8');assert.equal((vtt.match(/ --> /g)||[]).length,43);assert.ok(vtt.includes('Ending '+'b'.repeat(339)+'.'));
 assert.equal(toolLoads,0);
 }
 assert.equal(posts,2);assert.deepEqual(errors,[]);
 console.log(`PASS: production long reading, early playback, cross-part seek, complete ${video?'MP4 with metadata':'MP3'} and 43 caption cues; two admissions, no duplicate synthesis.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
