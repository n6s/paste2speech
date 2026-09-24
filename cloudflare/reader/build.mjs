import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
const publicLaunch=process.argv.includes('--public');
const production=publicLaunch||process.argv.includes('--production');
const fixtureManifest=JSON.parse(await readFile('scripts/wavenet-worker-proof/fixture.json'));
const fixtureHash=createHash('sha256').update(JSON.stringify(fixtureManifest));
for(const list of Object.values(fixtureManifest))for(const section of list)fixtureHash.update(await readFile('tests/fixtures/wavenet/'+section.file));
const fixtureVersion=fixtureHash.digest('hex');
const mse=process.argv.includes('--mse-staging');if(mse&&production)throw Error('MSE test controls are staging-only');
const mseProduction=process.argv.includes('--mse-production');if(mseProduction&&(!production||publicLaunch))throw Error('Production MSE is owner-trial only');
const progressive=mse||mseProduction;
const configPath=`cloudflare/reader/wrangler.${publicLaunch?'public':production?'production':'staging'}.jsonc`;
const videoDownload=JSON.parse(await readFile(configPath,'utf8')).vars.VIDEO_DOWNLOAD==='1';
const root=production?'work/production-reader/site':'work/private-reader/site';await rm(root,{recursive:true,force:true});await mkdir(root+'/samples',{recursive:true});
const common={bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'warning'};
await build({...common,entryPoints:['public/app.js'],outfile:root+'/app.js',external:['./pdf.js','./video-export.js'],plugins:[{name:'private-reader-config',setup(b){
 b.onLoad({filter:/public\/config\.js$/},()=>({contents:`export const WORKSTATION=false,KOKORO_ENABLED=false,CLOUD_READER=true,MSE_STAGING=${mse ? "new URLSearchParams(location.search).get('testing')==='1'" : 'false'},MSE_ENABLED=${progressive},VIDEO_DOWNLOAD=${videoDownload},MSE_FIXTURE_VERSION='${fixtureVersion}',API_ORIGIN='',RELEASE='${publicLaunch?'production-public':production?'production-trial':'private-reader'}';`}));
 if(!videoDownload)b.onLoad({filter:/public\/video-ui\.js$/},()=>({contents:'export function setupVideoDownload() {}'}));
 if(!progressive)b.onLoad({filter:/public\/staging-player\.js$/},()=>({contents:'export class StagingPlayer {}'}));
 // Excluded engines have no implementation or model dependency in this build.
 b.onLoad({filter:/public\/local-kokoro\.js$/},()=>({contents:'export class LocalKokoro {resetMetrics(){} cancel(){} }'}));
}}]});
await build({...common,entryPoints:['browser/pdf.js'],outfile:root+'/pdf.js'});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs',root+'/pdf.worker.min.mjs');
if(videoDownload){
 await mkdir(root+'/video',{recursive:true});
 await build({...common,entryPoints:['public/video-export.js'],outfile:root+'/video-export.js'});
 await build({...common,entryPoints:['node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js'],outfile:root+'/video/worker.js'});
 await copyFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',root+'/video/ffmpeg-core.js');
 // Workers Assets have a per-file size limit; each immutable segment is 8 MiB.
 const wasm=await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'),parts=[];
 for(let i=0;i<wasm.length;i+=8*1024*1024){const name=`core-${parts.length}.bin`;parts.push(name);await writeFile(root+'/video/'+name,wasm.subarray(i,i+8*1024*1024));}
 await writeFile(root+'/video/core.json',JSON.stringify({parts}));
}
await copyFile('public/style.css',root+'/style.css');
let html=await readFile('public/index.html','utf8');
html=html.replace(/(style\.css|app\.js)\?[^" ]+/g,'$1');
html=html.replace('<option value="kokoro" disabled>Workstation · checking…</option>','<option value="google">WaveNet · speech credit</option>');
html=html.replace('PDFs are sent to your workstation for extraction and are not saved.','PDFs are read on this device and are not uploaded.');
html=html.replace('<div class="mode-controls"','<button id="cancel-pdf" type="button" hidden>Cancel import</button><div class="mode-controls"');
html=html.replace('Text is not saved.','Original editing text stays in this tab. Prepared WaveNet text and audio expire after 24 hours.');
html=html.replace('Workstation voices send it over Tailscale to your workstation.','WaveNet sends the cleaned reading text to Google Cloud.');
html=html.replace('<header>', '<header><p><a href="/api/billing">Account &amp; speech credit</a></p><p id="account-summary" class="hint"></p>');
html=html.replace('<section class="player', '<p id="upgrade-note" class="hint" hidden>WaveNet requires speech credit. <a href="/api/billing">Upgrade with a speech pack</a>. Browser voices remain free. Staging uses test purchases only.</p><section class="player');
html=html.replace('<div id="recording-controls" hidden>','<div id="recording-controls" hidden><label>Position <span id="seek-time">0 / 0 seconds</span><input id="seek" type="range" min="0" max="1" step="0.05" value="0" disabled></label>');
html=html.replace(/<p id="playback-note"[^>]*>.*?<\/p>/,'<p id="playback-note" class="hint">Browser voices are free. WaveNet prepares the complete recording before playback.</p>');
let footer=await readFile('browser/footer.html','utf8');
footer=footer.replace('Voice generation uses Kokoro and Transformers.js; PDF extraction uses PDF.js.','Browser voices are free; WaveNet uses prepaid speech credit. PDF extraction uses PDF.js.');
footer=footer.replace(/<details><summary>Privacy<\/summary>[\s\S]*?<\/details>/,`<details><summary>Privacy</summary><p>PDFs are read locally. Browser voices use your device speech service, which may connect to the internet. WaveNet sends cleaned reading text to Google Cloud. Prepared text and audio are stored privately for up to 24 hours for playback and downloads; Clear removes the recording. Account and payment records retain balances and usage without reading text. Preferences are saved in this browser.</p><p>This private staging site stores feedback and aggregate statistics separately from production. It sends no test notifications. Do Not Track and Global Privacy Control disable statistics.</p></details>`);
footer=footer.replace(/<p class="hint">Your message, optional email,[\s\S]*?<\/p>/,'<p id="feedback-privacy" class="hint">Feedback stays in this private staging database. No notifications are sent. Do not include private reading text. Reports and aggregate statistics expire after 90 days.</p>');
html=html.replace('<footer>Made for a quieter kind of reading.</footer>',footer);
if(production){
 if(!publicLaunch){html=html.replace('Staging uses test purchases only.','').replace('WaveNet requires speech credit. <a href="/api/billing">Upgrade with a speech pack</a>.','WaveNet is available only to the verified trial owner. <a href="/api/billing">Sign in to your account</a>.');
 html=html.replace('WaveNet uses prepaid speech credit.','WaveNet is currently an owner-only trial.');}
 html=html.replace('Staging uses test purchases only.','').replace('</footer>','<p><a href="/pricing">Pricing</a> · <a href="/terms">Terms, refunds &amp; privacy</a></p></footer>');
 html=html.replace('This private staging site stores feedback and aggregate statistics separately from production. It sends no test notifications.','This site stores feedback and aggregate statistics for review.');
 html=html.replace('Feedback stays in this private staging database. No notifications are sent.','Feedback is stored for review.');
}
if(progressive)html=html.replace('<div id="recording-controls" hidden>',`<div id="recording-controls" hidden>
<details id="playback-options"><summary>Playback options</summary>
<label>Playback <select id="mse-delivery"><option value="mse">Progressive</option><option value="complete">Prepare everything first</option></select></label><p id="mse-support"></p>
<button id="mse-fallback" hidden type="button">Use completed file · no new speech</button>
</details>
`);
if(mse)html=html.replace('<div id="recording-controls" hidden>',`<div id="recording-controls" hidden>
<details id="staging-checks" hidden><summary>Staging checks</summary>
<p>Testing mode · <a href="/">Return to the reader</a></p>
<label><input id="mse-cached" type="checkbox" checked>Use cached test audio · no credit used</label>
<label>Scenario <select id="mse-scenario"><option value="normal">Normal</option><option value="out-of-order">Out of order</option><option value="stalled">Stalled section</option><option value="failure">Failed section</option><option value="long">Long · about five minutes</option></select></label>
<label>Requests in flight <select id="mse-concurrency"><option value="3">Three</option><option value="1">One</option></select></label>
<details><summary>Playback results</summary><pre id="mse-diagnostics"></pre></details>
<button id="mse-sample" type="button">Load test sample</button><button id="mse-results" type="button">Save playback results</button>
<p>To compare settings, choose them and load the sample again. Cached preparation timings are simulated and use no credit. Live speech uses your staging account credit. Loading a sample does not generate speech.</p>
</details>`);
if(videoDownload)html=html.replace(/<details id="recording-download">[\s\S]*?<\/details>/,`<details id="video-download" hidden>
<summary>Download recording</summary>
<p class="hint">One MP4 with audio and built-in subtitles. Adjust playback speed in your player.</p>
<p id="video-prepared-note" class="hint"></p>
<button id="download-video" type="button" disabled>Download</button>
<button id="cancel-video" type="button" hidden>Cancel</button>
<p id="video-status" role="status" aria-live="polite"></p>
<p><a id="open-video" hidden></a></p>
<video id="video-preview" controls playsinline hidden style="width:100%;max-width:960px"></video>
<label id="video-split-settings" hidden>Split size <select id="video-split-limit"><option value="20000" ${production?'selected':''}>20,000 characters</option><option value="1200" ${production?'':'selected'}>1,200 characters · testing</option></select></label>
</details>`);
if(mse)html=html.replace('</footer>','<p id="testing-mode-link"><a href="/?testing=1">Testing mode</a></p></footer>');
const origin='https://speak.rogerpbrown.com';
if(production)html=html.replace('<title>Paste to Speech</title>', '<title>Paste to Speech — Text and PDF Reader</title><meta name="description" content="Listen to pasted text and PDFs with free browser voices. Read PDFs locally, follow along, and adjust playback speed. WaveNet is currently an owner-only trial."><link rel="canonical" href="'+origin+'/">');
else html=html.replace('</head>','<meta name="robots" content="noindex, nofollow"></head>');
await writeFile(root+'/robots.txt',production?'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /billing\nDisallow: /signin\nSitemap: '+origin+'/sitemap.xml\n':'User-agent: *\nDisallow: /\n');
if(production)await writeFile(root+'/sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['/','/pricing','/terms'].map(path=>'<url><loc>'+origin+path+'</loc></url>').join('')+'</urlset>\n');
await writeFile(root+'/index.html',html);
for(const name of ['signin.html','signin.js','signin.css'])await copyFile('server/billing/'+name,root+'/'+name);
let billing=await readFile(publicLaunch?'cloudflare/reader/public-account.html':production?'cloudflare/reader/trial-account.html':'server/billing/index.html','utf8');
billing=billing.replace('src="billing/app.js"','src="/api/billing/app.js"').replace(/<p><label><input id="mode"[\s\S]*?<\/label><\/p>/,'').replace('Pronunciation expansions cost no extra allowance.','WaveNet uses its default pronunciation.');
await writeFile(root+'/billing.html',billing);
let billingJS=await readFile(publicLaunch?'cloudflare/reader/public-account.js':production?'cloudflare/reader/trial-account.js':'server/billing/app.js','utf8');billingJS=billingJS.replace("$('mode').checked=!!s.account?.enabled;",'').replace(/^\$\('mode'\)\.onchange=.*$/m,'');
await writeFile(root+'/billing.js',billingJS);
const fixtures=JSON.parse(await readFile('scripts/wavenet-worker-proof/fixture.json'));
if(!production)for(const list of Object.values(fixtures))for(const section of list)await copyFile('tests/fixtures/wavenet/'+section.file,root+'/samples/'+section.file);
console.log(publicLaunch?'Built public reader with prepaid WaveNet.':production?'Built public reader with owner-only WaveNet trial.':'Built shared reader for private Cloudflare staging.');

for(const page of ['terms','pricing']){
 let content=await readFile('cloudflare/reader/'+page+'.html','utf8');
 content=content.replace('</title>','</title>'+(production?'<link rel="canonical" href="'+origin+'/'+page+'">':'<meta name="robots" content="noindex, nofollow">'));
 await writeFile(root+'/'+page,content);
}

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await writeFile(root+'/release.json',JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:production?'production':'staging',dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),configSHA256:sha(await readFile(configPath)),assets:Object.fromEntries(await Promise.all(['index.html','app.js',...(videoDownload?['video-export.js','video/worker.js','video/ffmpeg-core.js','video/core.json',...Array.from({length:4},(_,i)=>`video/core-${i}.bin`)]:[])].map(async name=>[name,sha(await readFile(root+'/'+name))])))})+'\n');
