// Real Chrome media events + UI, simulated audio-focus interruption/resume. No physical Android.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inspectMp3} from '../cloudflare/prepared/mp3.js';
const variant=process.env.READER_VARIANT||'staging',isPublic=variant==='public';
assert.ok(['staging','public'].includes(variant));
const root=isPublic?'work/production-reader/site':'work/private-reader/site',out=process.env.PLAYBACK_INTERRUPTION_OUT||'work/playback-interruption-2026-10-16';await mkdir(out,{recursive:true});
const bytes=await Promise.all([0,1,2].map(index=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${index}.mp3`)));
let duration=0;const sections=bytes.map((body,index)=>{const info=inspectMp3(body),result={index,start:duration,samples:info.samples,bytes:info.bytes};duration+=info.samples/24000;return result;});
const server=createServer(async(req,res)=>{try{const file=new URL(req.url,'http://local').pathname.slice(1)||'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(root+'/'+file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=process.env.READER_ORIGIN||`http://127.0.0.1:${server.address().port}`;
let browser;const results=[];
try{
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
 for(const delivery of ['mse','complete']){
  const loadedAssets=[];let loadedAppHashes=[];
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];let posts=0,id,prepared=true;if(process.env.READER_ORIGIN&&!isPublic){const {execFileSync}=await import('node:child_process');const token=execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();await context.addCookies([{name:'CF_Authorization',value:token,domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true}]);}
  if(isPublic&&delivery==='complete')await context.addInitScript(()=>{window.MediaSource=undefined;});
  page.on('response',response=>{if(new URL(response.url()).pathname==='/app.js')loadedAssets.push(response);});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__mediaSourceCreations=0;const Source=window.MediaSource;if(Source)window.MediaSource=new Proxy(Source,{construct(target,args){__mediaSourceCreations++;return Reflect.construct(target,args);}});const Native=window.Audio;window.__audio=[];window.__mediaEvents=[];window.Audio=function(...args){const audio=new Native(...args);__audio.push(audio);for(const name of ['play','playing','pause','waiting','timeupdate','ended','error'])audio.addEventListener(name,event=>__mediaEvents.push({name,at:performance.now(),trusted:event.isTrusted,paused:audio.paused,ended:audio.ended,time:audio.currentTime}));return audio;};});
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(url.origin!==origin)return route.abort();
   if(!path.startsWith('/api/'))return route.continue();
   if(path==='/api/reader')return route.fulfill({json:{eligible:true,account:{balance:1000000}}});
   if(path==='/api/readings'&&request.method()==='POST'){posts++;id=request.headers()['idempotency-key'];return route.fulfill({json:{id}});}
   if(request.method()==='DELETE')return route.fulfill({status:204});
   if(path===`/api/readings/${id}`)return route.fulfill({json:{id,state:prepared?'ready':'preparing',starts:sections.map(s=>s.start),duration,completed:prepared?3:1,total:3,sections:prepared?sections:sections.slice(0,1)}});
   const section=path.match(/\/sections\/(\d+)$/);if(section)return route.fulfill({contentType:'audio/mpeg',body:bytes[Number(section[1])]});
   if(path.endsWith('/audio')){const body=Buffer.concat(bytes),range=request.headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Number(range[2]):body.length-1;return route.fulfill({status:range?206:200,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})},body:body.subarray(start,end+1)});}
   return route.fulfill({json:{}});
  });
  try{
  await page.goto(origin+(!isPublic&&delivery==='complete'?'/?testing=1':''));await page.locator('#voice-settings').evaluate(element=>element.open=true);await page.selectOption('#engine','google');
  const {createHash}=await import('node:crypto');
  loadedAppHashes=await Promise.all(loadedAssets.map(async response=>createHash('sha256').update(await response.body()).digest('hex')));
  assert.deepEqual(loadedAppHashes,[createHash('sha256').update(await readFile(root+'/app.js')).digest('hex')]);
  if(!isPublic&&delivery==='complete'){await page.locator('#playback-options').evaluate(element=>element.open=true);await page.selectOption('#mse-delivery',delivery);}
  const text='First section.\n\nSecond section.\n\nThird section.';await page.fill('#text',text);await page.click('#play');
  await page.waitForFunction(()=>__audio.some(a=>a.currentTime>.1&&!a.paused)&&document.querySelector('#status').textContent==='Reading aloud');
  const before=await page.evaluate(()=>{const audio=__audio.find(a=>a.src);audio.pause();return {time:audio.currentTime,src:audio.src};});
  await page.waitForFunction(()=>!document.querySelector('#play').disabled&&document.querySelector('#pause').disabled);
  assert.match(await page.locator('#status').textContent(),/Paused/);assert.match(await page.locator('#play').textContent(),/Resume/);
  assert.equal(await page.evaluate(()=>navigator.mediaSession.playbackState),'paused');
  await page.waitForTimeout(650); // Delayed media notifications must not restart the reading.
  await page.evaluate(()=>{const audio=__audio.find(a=>a.src);for(const name of ['playing','canplay','progress','waiting'])audio.dispatchEvent(new Event(name));});
  assert.equal(await page.evaluate(()=>__audio.find(a=>a.src).paused),true);
  assert.equal(await page.evaluate(()=>__audio.find(a=>a.src).currentTime),before.time);
  assert.equal(await page.locator('#play').isEnabled(),true);assert.equal(posts,1);
  // Emulate the browser resuming the existing element after microphone use.
  await page.evaluate(()=>__audio.find(a=>a.src).play());
  await page.waitForFunction(time=>__audio.some(a=>!a.paused&&a.currentTime>time+.05)&&document.querySelector('#status').textContent==='Reading aloud'&&navigator.mediaSession.playbackState==='playing',before.time,{timeout:3000});
  assert.equal(await page.locator('#status').textContent(),'Reading aloud');
  assert.equal(await page.locator('#pause').isEnabled(),true);assert.equal(await page.locator('#play').isDisabled(),true);
  assert.equal(await page.evaluate(()=>navigator.mediaSession.playbackState),'playing');assert.equal(posts,1);await page.screenshot({path:out+'/'+delivery+'-native-resumed.png'});
  await page.evaluate(()=>__audio.find(a=>a.src).pause());
  await page.waitForFunction(()=>!document.querySelector('#play').disabled&&document.querySelector('#pause').disabled);
  await page.click('#play'); // Exactly one Resume, with no intervening Pause.
  await page.waitForFunction(time=>__audio.some(a=>!a.paused&&a.currentTime>time+.05)&&document.querySelector('#status').textContent==='Reading aloud',before.time);
  assert.equal(await page.evaluate(()=>__audio.find(a=>a.src).src),before.src);assert.equal(posts,1);
  await page.evaluate(()=>__audio.find(a=>a.src).dispatchEvent(new Event('suspend')));
  assert.equal(await page.locator('#pause').isEnabled(),true);assert.equal(await page.locator('#status').textContent(),'Reading aloud');
  // Same interruption during a buffering indication must also enable Resume.
  await page.evaluate(()=>{const audio=__audio.find(a=>a.src);audio.dispatchEvent(new Event('waiting'));audio.pause();});
  await page.waitForFunction(()=>!document.querySelector('#play').disabled&&document.querySelector('#pause').disabled);
  await page.click('#play');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Reading aloud');
  // Explicit app Pause must still win over a later external start notification.
  await page.click('#pause');await page.waitForFunction(()=>document.querySelector('#pause').disabled);
  const pausedAt=await page.evaluate(()=>__audio.find(a=>a.src).currentTime);
  await page.evaluate(()=>__audio.find(a=>a.src).play().catch(()=>{}));
  await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>__audio.find(a=>a.src).paused),true);
  assert.equal(await page.locator('#play').isEnabled(),true);assert.match(await page.locator('#status').textContent(),/Paused/);
  assert.ok(await page.evaluate(t=>Math.abs(__audio.find(a=>a.src).currentTime-t)<.1,pausedAt));
  await page.evaluate(()=>{const audio=__audio.find(a=>a.src);for(const name of ['playing','canplay','waiting','progress'])audio.dispatchEvent(new Event(name));});
  assert.equal(await page.locator('#play').isEnabled(),true);assert.equal(await page.evaluate(()=>__audio.find(a=>a.src).paused),true);
  assert.equal(await page.locator('#text').inputValue(),text);assert.equal(posts,1);assert.deepEqual(errors,[]);
  const mediaSourceCreations=await page.evaluate(()=>__mediaSourceCreations);assert.equal(mediaSourceCreations,delivery==='mse'?1:0);
  results.push({variant,loadedAppHashes,mediaSourceCreations,delivery,sameJob:true,positionPreserved:true,oneClickResume:true,nativeAutomaticResumeReconciled:true,explicitPauseRejectsExternalRestart:true,stalePlayingIgnored:true,noAutomaticRestart:true,bufferingPauseHandled:true,mediaEvents:await page.evaluate(()=>__mediaEvents),pageErrors:errors,syntheticSpeechPosts:posts});
  await page.screenshot({path:out+'/'+delivery+'-explicit-paused.png'});console.log(`PASS ${variant} ${delivery}: native media pause updates UI/Media Session; native automatic resume reconciles UI; explicit Pause wins; one Resume reuses saved audio; stale notifications cannot autoplay.`);
  }catch(error){await writeFile(out+'/'+delivery+'-failure.json',JSON.stringify({message:error.message,variant,origin,loadedAppHashes,snapshot:await page.evaluate(()=>({status:document.querySelector('#status')?.textContent,media:navigator.mediaSession.playbackState,audio:__audio.map(a=>({src:a.src,currentSrc:a.currentSrc,paused:a.paused,ended:a.ended,time:a.currentTime,error:a.error?.message})),events:__mediaEvents})).catch(()=>null)},null,2)+'\n');await page.screenshot({path:out+'/'+delivery+'-failure.png'}).catch(()=>{});throw error;}finally{await context.close();}
 }
 if(process.env.READER_ORIGIN){const {execFileSync}=await import('node:child_process');const headers=isPublic?{}:{Cookie:'CF_Authorization='+execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()};const response=await fetch(origin+'/release.json',{headers,redirect:'error'});assert.equal(response.status,200);const release=await response.json();assert.equal(release.commit,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());assert.equal(release.dirty,false);}
 await writeFile(out+'/browser.json',JSON.stringify({results,physicalAndroidBluetoothVerified:false,physicalAndroidMicrophoneInterruptionVerified:false,browser:'isolated headless /usr/bin/google-chrome on pop-os',paidProviderCalls:0},null,2)+'\n');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
