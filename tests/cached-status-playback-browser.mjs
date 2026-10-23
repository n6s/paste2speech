// Real Chrome MSE decoding of fixture audio; no provider or account requests.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {inspectMp3} from '../cloudflare/prepared/mp3.js';
const bytes=await readFile('tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3'),info=inspectMp3(bytes);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://fixture').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');res.end(path==='/'?'<button id="start">Start</button>':await readFile('.'+path));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{for(const action of ['continue','pause','stop']){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const origin=process.env.READER_ORIGIN||`http://127.0.0.1:${server.address().port}`;
 if(process.env.READER_ORIGIN){const token=execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();await context.addCookies([{name:'CF_Authorization',value:token,url:origin,secure:true,httpOnly:true}]);}
 await page.route('**/api/**',route=>route.abort());await page.goto(origin);
 await page.evaluate(async({hosted,bytes,info})=>{
  const {MsePlayer}=await import(hosted?'/mse-buffer-player.js':'/public/mse-buffer-player.js');
  const audio=new Audio();window.audio=audio;window.requests=[];
  window.player=new MsePlayer(audio,()=>{},async(url,init={})=>{
   requests.push([new URL(url).pathname,init.method||'GET']);
   if(init.method==='POST')return Response.json({id:'fixture-saved'});
   if(init.method==='DELETE')return new Response(null,{status:204});
   if(new URL(url).pathname.endsWith('/sections/0')){await new Promise(resolve=>window.releaseAudio=resolve);return new Response(new Uint8Array(bytes));}
   return Response.json({state:'ready',connectionUnavailable:true,total:1,completed:1,starts:[0],duration:info.samples/24000,sections:[{index:0,start:0,samples:info.samples,bytes:info.bytes}]});
  });
  // Fixture construction admission is local only; the tested recovery performs no POST.
  const button=document.createElement('button');button.id='fixture-start';button.textContent='Start fixture';button.onclick=()=>player.start({chunks:['Saved fixture.']});document.body.append(button);
 },{hosted:!!process.env.READER_ORIGIN,bytes:[...bytes],info});
 await page.click('#fixture-start');await page.waitForFunction(()=>!!window.releaseAudio&&player.connectionPaused);
 if(action==='pause')await page.evaluate(()=>player.pause());
 if(action==='stop')await page.evaluate(()=>player.invalidate({preserveReady:true}));
 await page.evaluate(()=>releaseAudio());
 if(action==='continue'){await page.waitForFunction(()=>player.finalized&&audio.currentTime>.1&&!audio.paused);assert.equal(await page.evaluate(()=>player.connectionInterrupted),true);}
 else{await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>audio.paused),true);assert.equal(await page.evaluate(()=>player.wantPlay),false);assert.equal(await page.evaluate(()=>player.state),action==='pause'?'paused':'idle');}
 assert.equal(await page.evaluate(()=>requests.filter(([,method])=>method==='POST').length),1);assert.deepEqual(errors,[]);
 await page.evaluate(()=>player.invalidate({preserveReady:true}));await context.close();console.log('PASS cached audio with unavailable status: '+action+'; no recovery admission or live provider calls.');
}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
