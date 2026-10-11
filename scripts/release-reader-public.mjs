// No remote changes without the explicit production-approved deployment flag.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const config='cloudflare/reader/wrangler.public.jsonc',settings=JSON.parse(readFileSync(config)),deploy=process.argv.includes('--deploy');
if(settings.vars.READER_MODE!=='production-public'||settings.vars.PADDLE_ENVIRONMENT!=='live'||settings.vars.LOCAL_READER!=='0')throw Error('Invalid public release configuration');
if(deploy){
 if(!process.argv.includes('--production-approved'))throw Error('Review and approve the exact release before deployment');
 if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit the release before deployment');
 if(!/^pri_[a-z0-9]{26}$/.test(settings.vars.PADDLE_PRICE_ID)||!/^pro_[a-z0-9]{26}$/.test(settings.vars.PADDLE_PRODUCT_ID))throw Error('Verified live catalog is required');
}
execFileSync('npm',['test'],{stdio:'inherit'});
execFileSync('npm',['run','build:reader:staging'],{stdio:'inherit'});
execFileSync('node',['cloudflare/reader/build.mjs','--public'],{stdio:'inherit'});
execFileSync('npm',['run','check:reader:paste'],{stdio:'inherit'});
execFileSync('npm',['run','check:reader:parity'],{stdio:'inherit'});
execFileSync('npm',['run','check:reader:resume'],{stdio:'inherit'});
execFileSync('npm',['run','check:reader:recovery'],{stdio:'inherit'});
execFileSync('node',['scripts/reader-parity/check-built-offline.mjs'],{stdio:'inherit'});
execFileSync('npm',['run','check:reader:reload'],{stdio:'inherit'});
execFileSync('npm',['run','check:reader:documents'],{stdio:'inherit'});
execFileSync('npm',['run','check:reader:previews'],{stdio:'inherit'});
const site='work/production-reader/site';
for(const file of ['index.html','billing.html'])if(/private staging|owner-only trial|test checkout|test buying/i.test(readFileSync(site+'/'+file,'utf8')))throw Error('Test/trial wording in public assets');
if(readdirSync(site+'/samples').length)throw Error('Test audio must not ship');
execFileSync('node',['node_modules/wrangler/bin/wrangler.js','deploy','--config',config,'--dry-run','--outdir','work/production-reader/public-worker'],{stdio:'inherit'});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function assets(dir){return Object.fromEntries(readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?Object.entries(assets(dir+'/'+f.name)).map(([k,v])=>[f.name+'/'+k,v]):[[f.name,sha(dir+'/'+f.name)]]));}
const manifest={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),worker:settings.name,origin:settings.vars.READER_ORIGIN,configSHA256:sha(config),speechEnabled:settings.vars.ENABLE_LIVE_SYNTHESIS==='1',checkoutEnabled:settings.vars.ENABLE_PAYMENTS==='1',publicLaunchOpen:settings.vars.PUBLIC_LAUNCH_OPEN==='1',dailyUSD:10,monthlyUSD:50,catalogConfigured:!!settings.vars.PADDLE_PRICE_ID&&!!settings.vars.PADDLE_PRODUCT_ID,assets:assets(site),migrations:assets('cloudflare/reader/migrations')};
writeFileSync('work/production-reader/public-release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
async function verifyHosted(origin,root,headers={}){
 const expected=JSON.parse(readFileSync(root+'/release.json','utf8'));
 async function get(path){const r=await fetch(origin+'/'+path,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(r.status,200,path);return r;}
 assert.deepEqual(await (await get('release.json')).json(),expected,'Hosted release metadata differs');
 for(const [file,digest] of Object.entries(expected.assets))assert.equal(createHash('sha256').update(Buffer.from(await (await get(file)).arrayBuffer())).digest('hex'),digest,file);
}
if(deploy){
 const staging=JSON.parse(readFileSync('cloudflare/reader/wrangler.staging.jsonc','utf8')).vars.READER_ORIGIN;
 const token=execFileSync('cloudflared',['access','token','--app',staging],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 await verifyHosted(staging,'work/private-reader/site',{Cookie:'CF_Authorization='+token});
 execFileSync('node',['node_modules/wrangler/bin/wrangler.js','deploy','--config',config],{stdio:'inherit'});
 for(let attempt=0;;attempt++){
  try{await verifyHosted(settings.vars.READER_ORIGIN,site);break;}
  catch(error){if(attempt===5)throw error;await new Promise(resolve=>setTimeout(resolve,2500*(attempt+1)));}
 }
}
console.log(deploy?'Approved public release deployed.':'Public release prepared locally; no production changes.');
