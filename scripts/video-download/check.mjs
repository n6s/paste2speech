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
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1100,height:900}}), errors=[],jobs=new Map();let posts=0,toolLoads=0;
 if(remote)await page.context().addCookies([{name:'CF_Authorization',value:execFileSync('cloudflared',['access','token','--app',remote],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),url:remote,httpOnly:true,secure:true,sameSite:'Lax'}]);
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(r.url().includes('/video/'))toolLoads++;});
 await page.route('**/api/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(p==='/api/readings'&&r.method()==='POST'){
   const id=r.headers()['idempotency-key'],body=r.postDataJSON(); posts++;
   assert.ok(body.chunks.reduce((n,c)=>n+c.length,0)<=1200);assert.ok(body.chunks.every(c=>c===source.text));
   const starts=body.chunks.map((_,i)=>i*info.duration),duration=info.duration*body.chunks.length;
   jobs.set(id,{mp3:Buffer.concat(body.chunks.map(()=>mp3)),vtt:captions(body.chunks,{starts,duration}),duration});
   return route.fulfill({json:{id}});
  }
  const match=p.match(/^\/api\/readings\/([^/]+)(.*)$/);
  if(match){const job=jobs.get(match[1]);assert.ok(job);
   if(match[2]==='/download/mp3')return route.fulfill({contentType:'audio/mpeg',body:job.mp3});
   if(match[2]==='/download/vtt')return route.fulfill({contentType:'text/vtt',body:job.vtt});
   return route.fulfill({json:{state:'ready',duration:job.duration}});
  }
  return route.fulfill({json:p==='/api/reader'?{eligible:true,account:{balance:10000}}:{}});
 });
 await page.goto(remote||`http://127.0.0.1:${server.address().port}/`);
 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
 await page.fill('#text',Array(60).fill(source.text).join('\n\n'));
 await page.locator('#video-download').evaluate(e=>e.open=true);
 await page.click('#prepare-video');
 await page.waitForFunction(()=>!document.getElementById('prepare-video').disabled);
 console.log('PREPARE:',await page.locator('#video-status').textContent(), 'jobs:',posts);
 assert.equal(await page.locator('#download-video').isDisabled(),false);
 assert.equal(posts,2);assert.equal(toolLoads,0,'Video tools must not load before Download');
 const downloadPromise=page.waitForEvent('download',{timeout:180000});
 await page.click('#download-video');
 await page.waitForFunction(()=>!document.getElementById('download-video').disabled,{},{timeout:180000});
 console.log(await page.locator('#video-status').textContent());
 const download=await downloadPromise;const output=folder+'/joined.mp4';await download.saveAs(output);
 assert.equal(posts,2,'Conversion must never generate speech');
 assert.deepEqual(errors,[]);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}));
 assert.deepEqual(probe.streams.map(s=>s.codec_name),['h264','aac','mov_text']);
 const expected=[...jobs.values()].reduce((n,j)=>n+j.duration,0);
 assert.ok(Math.abs(Number(probe.streams.find(s=>s.codec_type==='audio').duration)-expected)<.1);
 const subs=execFileSync('ffmpeg',['-v','error','-i',output,'-map','0:s:0','-f','webvtt','-'],{encoding:'utf8'});
 assert.equal((subs.match(/A short pause follows\./g)||[]).length,60);
 await page.click('#open-video');await page.waitForFunction(()=>document.getElementById('video-preview').currentTime>.05);
 assert.equal(await page.locator('#video-preview').evaluate(v=>v.textTracks[0].mode),'showing');
 await page.locator('#video-preview').evaluate(v=>{v.pause();v.currentTime=v.duration-2;});
 await page.waitForFunction(()=>document.getElementById('video-preview').currentTime>100);
 await page.screenshot({path:folder+'/browser.png',fullPage:true});
 const again=page.waitForEvent('download');await page.click('#download-video');await again;assert.equal(posts,2);
 await writeFile(folder+'/verification.json',JSON.stringify({parts:posts,expectedDuration:expected,formatDuration:probe.format.duration,codecs:probe.streams.map(s=>s.codec_name),subtitles:60,toolLoads,browserErrors:errors},null,2));
 execFileSync('ffmpeg',['-v','error','-y','-i',output,'-frames:v','1',folder+'/title.png']);
 console.log('PASS: two prepared jobs → one H.264/AAC/mov_text MP4; 60 captions; full duration; native preview, seeking, repeat download; zero provider calls.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
