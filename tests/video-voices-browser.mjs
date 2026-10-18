// Real export UI and native playback, with a cached recording and stub encoder.
// No speech admission, providers, or changes to an existing browser profile.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {WAVENET_VOICE_IDS} from '../public/wavenet-voices.js';
const out=process.env.VIDEO_VOICES_OUT||'work/video-voices';await mkdir(out,{recursive:true});
const html=`<!doctype html><html><body>
<div class="download-card"><details id="video-download" open><p id="video-status"></p>
<button id="download-video">Download</button><button id="cancel-video">Cancel</button>
<select id="video-split-limit"><option value="20000">20000</option></select>
<p id="video-prepared-note"></p><a id="open-video" hidden></a><video id="video-preview"></video>
<div id="video-split-settings"></div></details></div><button id="clear">Clear</button><select id="voice"></select>
<script type="module">
import {setupVideoDownload} from '/public/video-ui.js';
window.fixture={voice:'en-US-Wavenet-H',exports:[],stops:0,pauses:0,pending:false,hold:false};
const f=fixture,text='A short pause follows.';
f.audio=new Audio('/fixture.mp3');f.audio.loop=true;
f.group={done:true,key:'paste2speech.video.cached-fixture',session:{records:[{id:'existing-paid-recording',state:'ready'}],parts:[{chunks:[text]}],assets:{cached:true},stop(){f.stops++;}}};
f.prepared={id:'existing-paid-recording',settings:{voice:f.voice},chunks:[text],getVideoPreparation:()=>f.group,pause(){f.pauses++;f.audio.pause();}};
f.ui=setupVideoDownload({getText:()=>text,getVoice:()=>f.voice,getPrepared:()=>f.prepared,isGoogle:()=>true});
f.ready=true;
</script></body></html>`;
const encoder=`export async function exportVideo(records,{signal,assets}){
const f=window.fixture;
if(records!==f.group.session.records||assets!==f.group.session.assets)throw Error('Did not borrow the exact cached session');
f.exports.push({ids:records.map(r=>r.id),voice:f.voice,cached:assets.cached});
if(f.hold)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
return {blob:new Blob(['synthetic MP4'],{type:'video/mp4'}),vtt:'WEBVTT',label:'generated 2026-10-18 00:00 UTC'};
}`;
const server=createServer(async(req,res)=>{try{
const path=new URL(req.url,'http://local').pathname;
if(path==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
if(path==='/public/video-export.js'){res.setHeader('Content-Type','text/javascript');return res.end(encoder);}
if(path==='/fixture.mp3'){res.setHeader('Content-Type','audio/mpeg');return res.end(await readFile('tests/fixtures/wavenet/en-US-Wavenet-F-03.mp3'));}
if(!/^\/public\/[a-z-]+\.js$/.test(path)){res.writeHead(404).end();return;}
res.setHeader('Content-Type','text/javascript');res.end(await readFile('.'+path));
}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),results=[];
let apiCalls=0;const errors=[];
try{
const page=await browser.newPage({viewport:{width:390,height:844}});
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',route=>{apiCalls++;return route.abort();});
async function fresh(voice){await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.fixture?.ready);await page.evaluate(voice=>{fixture.voice=voice;fixture.prepared.settings.voice=voice;},voice);}
async function playing(){await page.evaluate(()=>fixture.audio.play());await page.waitForFunction(()=>fixture.audio.currentTime>.05&&!fixture.audio.paused);}
async function continuing(time){await page.waitForFunction(time=>!fixture.audio.paused&&fixture.audio.currentTime>time+.05,time);assert.equal(await page.evaluate(()=>fixture.pauses+fixture.stops),0);}
for(const voice of WAVENET_VOICE_IDS){
await fresh(voice);await playing();const time=await page.evaluate(()=>fixture.audio.currentTime);
await page.click('#download-video');await page.waitForFunction(()=>!document.querySelector('#open-video').hidden);
assert.deepEqual(await page.evaluate(()=>fixture.exports),[{ids:['existing-paid-recording'],voice,cached:true}]);await continuing(time);
results.push({voice,reusedCachedRecording:true,noAdmission:true,playbackContinues:true});
}
for(const voice of ['', 'en-US-Wavenet-Z', 'browser-voice']){
await fresh(voice);await page.click('#download-video');await page.waitForFunction(()=>document.querySelector('#video-status').textContent==='Choose a WaveNet voice first.');
assert.equal(await page.evaluate(()=>fixture.exports.length),0);results.push({voice,invalidRejected:true});
}
for(const phase of ['preparing','encoding']){
await fresh('en-US-Wavenet-H');await playing();await page.evaluate(phase=>{fixture.group.done=phase!=='preparing';fixture.hold=phase==='encoding';},phase);
await page.click('#download-video');
if(phase==='preparing')await page.waitForFunction(()=>document.querySelector('#video-status').textContent.includes('Preparing complete audio'));
else await page.waitForFunction(()=>fixture.exports.length===1);
const time=await page.evaluate(()=>fixture.audio.currentTime);await page.click('#cancel-video');
await page.waitForFunction(()=>document.querySelector('#video-status').textContent==='Processing cancelled. Prepared audio is kept for another attempt.'&&!document.querySelector('#download-video').hidden);
await continuing(time);assert.equal(await page.evaluate(()=>fixture.prepared.id),'existing-paid-recording');
assert.equal(await page.evaluate(()=>fixture.exports.length),phase==='preparing'?0:1);
results.push({voice:'en-US-Wavenet-H',phase,cancelPreservesPlayback:true,recordingRetained:true});
}
assert.equal(apiCalls,0);assert.deepEqual(errors,[]);
await writeFile(out+'/verification.json',JSON.stringify({results,apiCalls,paidProviderCalls:0,encoder:'stubbed; real WASM export covered by scripts/video-download/check.mjs',pageErrors:errors},null,2)+'\n');
console.log('PASS export voice UI: all 12 supported voices borrow exact cached session/assets with no API calls; H cancellation during preparation/encoding preserves native playback; invalid voices rejected.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
