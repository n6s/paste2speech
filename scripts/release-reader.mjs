// Both environments are built and checked together. Production promotes the
// exact clean commit already served by staging; no secrets or data are copied.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateEnvironments,assertStagingPromotion} from './reader-release-policy.mjs';
const args=process.argv.slice(2),deploy=args.includes('--deploy');
if(args.includes('--staging')===args.includes('--production'))throw Error('Choose exactly one of --staging or --production');
const environment=args.includes('--staging')?'staging':'production';
const config=name=>`cloudflare/reader/wrangler.${name}.jsonc`;
const settings=Object.fromEntries(['staging','production'].map(name=>[name,JSON.parse(readFileSync(config(name),'utf8'))]));
validateEnvironments(settings.staging,settings.production);
if(deploy){
 if(environment==='production'&&!args.includes('--production-approved'))throw Error('Production approval is required. Prepare with the default dry run first.');
 if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit the release before deployment.');
}
for(const command of [['test'],['run','build:reader:staging'],['run','build:reader:production'],['run','check:reader:paste'],['run','check:reader:parity'],['run','check:reader:progress'],['run','check:reader:modes'],...(settings.staging.vars.UNIFIED_CREDITS==='1'?[['run','check:reader:unified']]:[]),['run','check:reader:resume'],['run','check:reader:recovery'],['run','check:reader:reload'],['run','check:reader:documents'],['run','check:reader:previews']])execFileSync('npm',command,{stdio:'inherit'});
for(const file of ['tests/cached-status-playback-browser.mjs','tests/video-voices-browser.mjs','scripts/video-download/check.mjs','tests/cloud-choice-browser.mjs','tests/reading-window-browser.mjs','tests/summary-credits-browser.mjs','tests/summary-consent-recovery-browser.mjs'])execFileSync('node',[file],{stdio:'inherit'});
if(settings.staging.vars.OCR_DURABLE_JOBS==='1')for(const file of ['tests/ocr-fetch-native.mjs','tests/ocr-job-native.mjs','tests/ocr-jobs-browser.mjs','tests/word-import-browser.mjs','tests/processing-indicator-browser.mjs','tests/screenshot-recovery-browser.mjs','tests/scan-outcome-browser.mjs','tests/intake-summary-ui-browser.mjs'])execFileSync('node',[file],{stdio:'inherit'});
if(settings.staging.vars.LOCAL_TEXT_IMPORT==='1')execFileSync('node',['tests/plain-text-browser.mjs'],{stdio:'inherit'});
execFileSync('node',['tests/pdf-native-routing-browser.mjs'],{stdio:'inherit'});
if(settings.staging.vars.SPEECH_SECTION_RECOVERY==='1')execFileSync('node',['tests/speech-section-recovery-browser.mjs'],{stdio:'inherit'});
if(settings.staging.vars.INPUT_QUEUE_UI==='1')for(const file of ['tests/input-queue-browser.mjs','tests/input-copy-browser.mjs','tests/image-queue-browser.mjs'])execFileSync('node',[file],{stdio:'inherit'});
if(settings.staging.vars.OCR_PICKER_AUTOSCAN==='1')execFileSync('node',['tests/ocr-picker-browser.mjs'],{stdio:'inherit'});
if(settings.staging.vars.PERSISTENT_AUDIO==='1')for(const file of ['tests/persistent-audio-browser.mjs','tests/device-audio-shell-browser.mjs','tests/persistent-audio-ui-browser.mjs','tests/reading-lifecycle-browser.mjs','tests/reading-history-browser.mjs','tests/reading-history-natural-browser.mjs','tests/reading-continuation-browser.mjs','tests/reading-retention-browser.mjs','tests/unavailable-reading-voice-browser.mjs','tests/temporary-playlist-browser.mjs','tests/mobile-input-controls-browser.mjs'])execFileSync('node',[file],{stdio:'inherit'});
if(settings.staging.vars.PERSISTENT_AUDIO==='1'){for(const file of ['tests/natural-queue-audit-browser.mjs','tests/native-queue-retention-audit-browser.mjs','tests/prose-symbols-browser.mjs','tests/saved-tap-resume-browser.mjs','tests/clear-reload-browser.mjs','tests/repeated-paste-play-browser.mjs','tests/queue-recovery-browser.mjs'])execFileSync('node',[file],{stdio:'inherit'});for(const file of ['tests/natural-queue-audit-browser.mjs','tests/natural-ocr-queue-audit-browser.mjs','tests/prose-symbols-browser.mjs','tests/saved-tap-resume-browser.mjs','tests/clear-reload-browser.mjs','tests/repeated-paste-play-browser.mjs','tests/queue-recovery-browser.mjs'])execFileSync('node',[file],{stdio:'inherit',env:{...process.env,AUDIT_DELIVERY:'mse'}});}
if(settings.staging.vars.PERSISTENT_AUDIO==='1')execFileSync('node',['tests/saved-tap-resume-browser.mjs'],{stdio:'inherit',env:{...process.env,AUDIT_DELIVERY:'mse',WINDOWED_RELOAD:'1'}});
const sites={staging:'work/private-reader/site',production:'work/production-reader/site'};
for(const file of ['index.html','billing.html','billing.js'])if(/paddle|sandbox|staging|test purchases|Upgrade with a speech pack/i.test(readFileSync(sites.production+'/'+file,'utf8')))throw Error('Staging or checkout content in production assets: '+file);
assert.equal(readdirSync(sites.production+'/samples').length,0,'Test audio must not ship in production assets');
const releases=Object.fromEntries(Object.entries(sites).map(([name,path])=>[name,JSON.parse(readFileSync(path+'/release.json','utf8'))]));
assert.equal(releases.staging.commit,releases.production.commit);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function verifyHosted(name){
 const origin=settings[name].vars.READER_ORIGIN;
 const headers=name==='staging'?{Cookie:'CF_Authorization='+execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}:{};
 async function get(path){const response=await fetch(origin+path,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`Cannot verify ${name} ${path}: ${response.status}`);return response;}
 const hosted=await (await get('/release.json')).json();
 if(name==='staging')assertStagingPromotion(hosted,releases.staging);
 else assert.deepEqual(hosted,releases.production,'Hosted production metadata differs');
 for(const [file,digest] of Object.entries(releases[name].assets))assert.equal(sha(Buffer.from(await (await get('/'+file)).arrayBuffer())),digest,`Hosted ${name} ${file} differs`);
 return hosted;
}
if(deploy&&environment==='production')await verifyHosted('staging');
execFileSync('node',['node_modules/wrangler/bin/wrangler.js','deploy','--config',config(environment),...(deploy?[]:['--dry-run','--outdir',`work/shared-reader/${environment}-worker`])],{stdio:'inherit'});
if(deploy){
 // A successful upload can precede the edge serving the new asset manifest.
 // Retry read-only verification briefly; never retry the deployment itself.
 for(let attempt=0;;attempt++){
  try{await verifyHosted(environment);break;}
  catch(error){if(attempt===5)throw error;console.log('Waiting for deployed assets to become available…');await new Promise(resolve=>setTimeout(resolve,2500*(attempt+1)));}
 }
}
mkdirSync('work/shared-reader',{recursive:true});
writeFileSync(`work/shared-reader/${environment}-${deploy?'deployed':'prepared'}.json`,JSON.stringify(releases[environment],null,2)+'\n');
console.log(deploy?`${environment} deployed and served assets verified at ${releases[environment].commit}.`:'Both readers passed parity checks. Prepared locally; nothing deployed.');
