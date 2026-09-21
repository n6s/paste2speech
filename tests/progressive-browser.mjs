import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const engine=process.env.P2S_TEST_ENGINE || 'workstation';
const voice=process.env.P2S_TEST_VOICE || 'af_heart';
const output=engine==='deepinfra'?'work/deepinfra-validation':'work/progressive';
const base=process.env.P2S_TEST_URL || 'http://127.0.0.1:8779';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const bundle=(await readFile('dist/app.js','utf8')).replace('location.hostname==="pop-os.tailbd091c.ts.net"','true');
const paragraphs=Array.from({length:24},(_,i)=>`At station ${i+1}, Mara opened the notebook and studied the route through the valley. The morning rain had stopped, leaving small pools beside the path. She could hear a train in the distance, although the trees hid the tracks from view. There was still plenty of time to reach the next village before evening.\n\nShe paused to write a clear description of what she had seen. Every detail would help the next traveler: the narrow bridge, the fallen branch, and the safe place to cross the stream. Then she packed the notebook carefully and continued walking, listening to the birds above her.`);
const text=paragraphs.join('\n\n');
await mkdir(output,{recursive:true});await writeFile(`${output}/chapter.txt`,text);
const page=await browser.newPage({viewport:{width:412,height:915}});const errors=[];let creates=0;let latest,recordingId;
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/readings'))creates++;});
page.on('response',async r=>{if(r.request().method()==='POST'&&r.url().endsWith('/api/readings'))try{recordingId=(await r.json()).id;}catch{};if(/\/api\/readings\/[^/]+$/.test(r.url())&&r.request().method()==='GET')try{latest=await r.json();}catch{}});
await page.addInitScript(()=>{const NativeAudio=window.Audio;window.__audios=[];window.Audio=function(...args){const a=new NativeAudio(...args);window.__audios.push(a);return a;};});
await page.route('**/app.js?*',r=>r.fulfill({contentType:'text/javascript',body:bundle}));
await page.route('https://speak.rogerpbrown.com/api/**',r=>r.fulfill({status:204,headers:{'access-control-allow-origin':base}}));
try {
 await page.goto(base);
 await page.locator('#voice-settings > summary').click();
 await page.waitForFunction(()=>!document.querySelector('#engine option[value=workstation]').disabled);
 await page.locator('#engine').selectOption(engine);await page.locator('#voice').selectOption(voice);await page.locator('#text').fill(text);
 const started=Date.now();await page.locator('#play').click();
 await page.waitForFunction(()=>window.__audios[0].currentTime>.1 && !window.__audios[0].paused,{},{timeout:60000});
 const firstMs=Date.now()-started;
 assert.ok(latest && latest.completed<latest.total,'must start before full preparation');
 console.log('First playback',firstMs,'ms; prepared',latest.completed,'of',latest.total);
 assert.equal(await page.locator('#preview [aria-current=true]').count(),1);
 await page.locator('#rate').fill('1.5');await page.locator('#rate').dispatchEvent('input');
 assert.equal(await page.evaluate(()=>window.__audios[0].playbackRate),1.5);assert.equal(creates,1);
 await page.locator('#pause').click();const paused=await page.evaluate(()=>window.__audios[0].currentTime);
 await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__audios[0].currentTime),paused);
 await page.locator('#play').click();
 await page.locator('#next-section').click();
 await page.waitForFunction(()=>document.querySelector('#position').textContent.startsWith('2 /') && !window.__audios[0].paused,{},{timeout:900000});
 await page.locator('#previous-section').click();
 await page.waitForFunction(()=>document.querySelector('#position').textContent.startsWith('1 /'));
 // Wait for full real synthesis while the browser is playing the first section.
 await page.waitForFunction(()=>!document.querySelector('#download-audio').hidden,{},{timeout:900000});
 const fullMs=Date.now()-started;
 await page.locator('#pause').click();
 const audioUrl=await page.locator('#download-audio').getAttribute('href');
 const data=await page.request.get(audioUrl);assert.equal(data.status(),200);await writeFile(`${output}/chapter.mp3`,await data.body());
 await page.locator('#recording-controls summary').click();await page.locator('#include-captions').check();
 const vtt=await page.request.get(await page.locator('#download-captions').getAttribute('href'));await writeFile(`${output}/chapter.vtt`,await vtt.body());
 assert.ok((await vtt.text()).startsWith('WEBVTT'));
 const cueCount=(await vtt.text()).split(' --> ').length-1;
 const chunks=await page.locator('#preview .sentence').count();assert.equal(cueCount,chunks);
 // Exact mid-chapter seek, highlighting after rate changes, and final chunk.
 for(const index of [Math.floor(chunks/2),chunks-1]){
  await page.locator('#preview .sentence').nth(index).click();
  await page.waitForFunction(i=>document.querySelector('#position').textContent.startsWith(`${i+1} /`)&&!window.__audios[0].paused,index,{timeout:30000});
  assert.equal(await page.locator('#preview [aria-current=true]').textContent(),await page.locator('#preview .sentence').nth(index).textContent());
 }
 assert.equal(creates,1);
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='All read. Take a breath.',{},{timeout:30000});
 await page.locator('#play').click();
 await page.waitForFunction(()=>!window.__audios[0].paused);
 assert.equal(creates,1);
 await page.locator('#pause').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('.player').screenshot({path:`${output}/mobile-controls.png`});
 const metrics={engine,voice,providerCost:latest.providerCost,submittedCharacters:latest.submittedCharacters,words:text.split(/\s+/).length,chunks,firstMs,fullMs,duration:latest.duration,bytes:(await data.body()).length,creates,errors};console.log(JSON.stringify(metrics));await writeFile(`${output}/metrics.json`,JSON.stringify(metrics,null,2));
 assert.deepEqual(errors,[]);
 await page.locator('#clear').click();
 assert.equal((await page.request.get(audioUrl)).status(),404);
 console.log('Real chapter: progressive playback, rate, seek/highlights, pause/resume, MP3/VTT, mobile layout, deletion passed.');
}catch(error){console.log('Last preparation status:',latest);console.log(await page.evaluate(()=>({status:document.querySelector('#status').textContent,position:document.querySelector('#position').textContent,audio:window.__audios.map(a=>({time:a.currentTime,paused:a.paused,ended:a.ended,error:a.error?.message,ready:a.readyState,buffer:a.buffered.length?a.buffered.end(a.buffered.length-1):0}))})));throw error;}finally{if(recordingId)await page.request.delete(`${base}/api/readings/${recordingId}`,{headers:{Origin:base}}).catch(()=>{});await browser.close();}
