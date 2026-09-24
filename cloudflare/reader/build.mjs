import {build} from 'esbuild';
import {createHash} from 'node:crypto';
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
const root=production?'work/production-reader/site':'work/private-reader/site';await rm(root,{recursive:true,force:true});await mkdir(root+'/samples',{recursive:true});
const common={bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'warning'};
await build({...common,entryPoints:['public/app.js'],outfile:root+'/app.js',external:['./pdf.js'],plugins:[{name:'private-reader-config',setup(b){
 b.onLoad({filter:/public\/config\.js$/},()=>({contents:`export const WORKSTATION=false,KOKORO_ENABLED=false,CLOUD_READER=true,MSE_STAGING=${mse},MSE_ENABLED=${progressive},MSE_FIXTURE_VERSION='${fixtureVersion}',API_ORIGIN='',RELEASE='${publicLaunch?'production-public':production?'production-trial':'private-reader'}';`}));
 if(!progressive)b.onLoad({filter:/public\/staging-player\.js$/},()=>({contents:'export class StagingPlayer {}'}));
 // Excluded engines have no implementation or model dependency in this build.
 b.onLoad({filter:/public\/local-kokoro\.js$/},()=>({contents:'export class LocalKokoro {resetMetrics(){} cancel(){} }'}));
}}]});
await build({...common,entryPoints:['browser/pdf.js'],outfile:root+'/pdf.js'});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs',root+'/pdf.worker.min.mjs');
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
<details id="staging-checks"><summary>Staging checks</summary>
<label><input id="mse-cached" type="checkbox">Use cached test audio · no credit used</label>
<label>Scenario <select id="mse-scenario"><option value="normal">Normal</option><option value="out-of-order">Out of order</option><option value="stalled">Stalled section</option><option value="failure">Failed section</option><option value="long">Long · about five minutes</option></select></label>
<label>Requests in flight <select id="mse-concurrency"><option value="3">Three</option><option value="1">One</option></select></label>
<details><summary>Playback results</summary><pre id="mse-diagnostics"></pre></details>
<button id="mse-sample" type="button">Load test sample</button><button id="mse-results" type="button">Save playback results</button>
<p>To compare settings, choose them and load the sample again. Cached preparation timings are simulated. Live staging checks share a 3,000-character campaign limit. Loading a sample does not generate speech.</p>
</details>`);
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

await copyFile('cloudflare/reader/terms.html',root+'/terms');
await copyFile('cloudflare/reader/pricing.html',root+'/pricing');
