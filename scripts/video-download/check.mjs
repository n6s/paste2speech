// Real browser/WASM conversion with intercepted speech APIs: no paid synthesis.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {captions, inspectMp3} from '../../cloudflare/prepared/mp3.js';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const remote=process.env.VIDEO_STAGING_ORIGIN;
if(remote && remote!=='https://speak-staging.rogerpbrown.com')throw Error('Only private staging is permitted');
const folder='work/video-download'+(remote?'/hosted':''); await mkdir(folder,{recursive:true});
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
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1100,height:900}}), errors=[],jobs=new Map();let posts=0,toolLoads=0,downloads=0,audioDownloads=0,partial=false,allowComplete=false,partialPolls=0,longMode=false;
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
 await page.goto(remote||`http://127.0.0.1:${server.address().port}/`);
 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
 await page.fill('#text',Array(60).fill(source.text).join('\n\n'));
 await page.locator('#video-download').evaluate(e=>e.open=true);
 assert.equal(await page.locator('#prepare-video, #include-captions, #download-audio, #download-captions, #video-parts').count(),0);
 assert.equal(toolLoads,0);assert.equal(posts,0);
 await page.click('#download-video');
 assert.equal(await page.locator('#download-video').isVisible(),false);
 await page.waitForFunction(()=>document.getElementById('open-video').getAttribute('href')?.startsWith('blob:'),{},{timeout:180000});
 assert.equal(downloads,0,'No automatic download: expose a real link instead');
 assert.equal(await page.locator('#download-video').isVisible(),false);
 async function saveLink(path){
   const pending=page.waitForEvent('download');
   const expectedName=await page.locator('#open-video').textContent();
   // Clone the actual anchor to exercise its native download attributes without
   // the plain-click preview handler supplying or overriding a filename.
   await page.locator('#open-video').evaluate(link=>{const a=link.cloneNode(true);a.removeAttribute('id');document.body.append(a);a.click();a.remove();});
   const download=await pending;assert.equal(download.suggestedFilename(),expectedName);
   await download.saveAs(path);
 }
 const output=folder+'/joined.mp4';await saveLink(output);
 assert.equal(posts,2,'Conversion must never generate speech');
 assert.deepEqual(errors,[]);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}));
 assert.deepEqual(probe.streams.map(s=>s.codec_name),['h264','aac','mov_text']);
 assert.equal(probe.format.tags.title,'Paste to Speech recording');
 assert.equal(probe.format.tags.comment,'Created with Paste to Speech — https://speak.rogerpbrown.com');
 const expected=[...jobs.values()].reduce((n,j)=>n+j.duration,0);
 assert.ok(Math.abs(Number(probe.streams.find(s=>s.codec_type==='audio').duration)-expected)<.1);
 const subs=execFileSync('ffmpeg',['-v','error','-i',output,'-map','0:s:0','-f','webvtt','-'],{encoding:'utf8'});
 assert.equal((subs.match(/A short pause follows\./g)||[]).length,60);
 await page.click('#open-video');await page.waitForFunction(()=>document.getElementById('video-preview').currentTime>.05);
 assert.equal(await page.locator('#video-preview').evaluate(v=>v.textTracks[0].mode),'showing');
 await page.locator('#video-preview').evaluate(v=>{v.pause();v.currentTime=v.duration-2;});
 await page.waitForFunction(()=>document.getElementById('video-preview').currentTime>100);
 await page.screenshot({path:folder+'/browser.png',fullPage:true});
 await saveLink(folder+'/joined-again.mp4');assert.equal(posts,2);
 await writeFile(folder+'/verification.json',JSON.stringify({parts:posts,expectedDuration:expected,formatDuration:probe.format.duration,codecs:probe.streams.map(s=>s.codec_name),subtitles:60,toolLoads,browserErrors:errors},null,2));
 execFileSync('ffmpeg',['-v','error','-y','-i',output,'-frames:v','1',folder+'/title.png']);
 // Borrow a running 44-section reader job with only six sections ready.
 partial=true;await page.reload();
 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
 await page.fill('#text',Array(44).fill(source.text).join('\n\n'));await page.click('#play');
 await page.waitForFunction(()=>document.getElementById('recording-progress').textContent.includes('6 of 44'));
 const priorPosts=posts,priorAudioDownloads=audioDownloads,priorTools=toolLoads;
 await page.locator('#video-download').evaluate(e=>e.open=true);await page.click('#download-video');
 while(partialPolls<3)await new Promise(r=>setTimeout(r,100));
 assert.equal(posts,priorPosts,'Download must reuse the ongoing reader job');
 assert.equal(audioDownloads,priorAudioDownloads,'No partial audio download');assert.equal(toolLoads,priorTools,'No encoder before complete audio');
 assert.equal(await page.locator('#open-video').isVisible(),false);
 allowComplete=true;
 await page.waitForFunction(()=>document.getElementById('open-video').getAttribute('href')?.startsWith('blob:'),{},{timeout:180000});
 await saveLink(folder+'/waited-for-complete.mp4');assert.equal(posts,priorPosts);
 const full=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',folder+'/waited-for-complete.mp4'],{encoding:'utf8'}));
 assert.ok(Math.abs(Number(full.streams.find(s=>s.codec_type==='audio').duration)-44*info.duration)<.1);
 const fullSubs=execFileSync('ffmpeg',['-v','error','-i',folder+'/waited-for-complete.mp4','-map','0:s:0','-f','webvtt','-'],{encoding:'utf8'});
 assert.equal((fullSubs.match(/A short pause follows\./g)||[]).length,44);
 assert.deepEqual(errors,[]);
 // Actual over-limit document: preserve all 21,347 submitted characters.
 longMode=true;partial=true;allowComplete=false;partialPolls=0;
 await page.goto((remote||`http://127.0.0.1:${server.address().port}`)+'/?testing=1');
 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
 await page.locator('#mse-cached').evaluate(e=>{e.checked=false;e.dispatchEvent(new Event('change'));});
 await page.locator('#video-split-limit').evaluate(e=>e.value='20000');
 const longText=[...Array(42).fill('Reading '+'a'.repeat(491)+'.'),'Ending '+'b'.repeat(339)+'.'].join('\n\n');
 await page.fill('#text',longText);const beforeLong=posts;
 await page.click('#play');await page.waitForFunction(()=>document.getElementById('recording-progress').textContent.includes('6 of 43'));
 assert.equal(posts,beforeLong+1);assert.ok(await page.evaluate(()=>__stagingReader.chunks.reduce((n,c)=>n+c.length,0)===21347));
 await page.locator('#video-download').evaluate(e=>e.open=true);await page.click('#download-video');
 while(partialPolls<3)await new Promise(r=>setTimeout(r,100));
 assert.equal(posts,beforeLong+1,'Video must follow the logical reading, not create another one');
 allowComplete=true;
 await page.waitForFunction(()=>document.getElementById('open-video').getAttribute('href')?.startsWith('blob:'),{},{timeout:180000});
 assert.equal(posts,beforeLong+2,'21,347 characters must use two bounded jobs');
 await saveLink(folder+'/long-reading.mp4');
 const longSubs=execFileSync('ffmpeg',['-v','error','-i',folder+'/long-reading.mp4','-map','0:s:0','-f','webvtt','-'],{encoding:'utf8'});
 assert.equal((longSubs.match(/ --> /g)||[]).length,43);
 assert.ok(longSubs.includes('Ending '+'b'.repeat(339)+'.'));
 await page.waitForFunction(()=>__stagingReader.finalized);await page.click('#pause');
 await page.evaluate(()=>__stagingReader.seekTo(40*1.848+.1));
 await page.waitForFunction(()=>__stagingReader.index===40);
 await page.locator('#playback-options').evaluate(e=>e.open=true);await page.click('#mse-fallback');
 await page.waitForFunction(()=>__stagingReader.mode==='full'&&__stagingReader.finalized&&__stagingReader.audio.readyState>=1);
 assert.ok(Math.abs(await page.evaluate(()=>__stagingReader.audio.duration)-43*info.duration)<.1);
 assert.equal(posts,beforeLong+2,'Seeking and full-file fallback must not regenerate speech');
 assert.deepEqual(errors,[]);
 console.log('PASS: 21,347-character normal Play split into 20,000 + 1,347; continuous playback, cross-part seek, full-file fallback, and complete 43-cue video all reused two jobs.');
 console.log('PASS: pending 6/44-section reader job reused without another admission; conversion waited for all 44 sections and captions.');
 console.log('PASS: two prepared jobs → one H.264/AAC/mov_text MP4; 60 captions; full duration; native preview, seeking, repeat download; zero provider calls.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
