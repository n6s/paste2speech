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
for(const command of [['test'],['run','build:reader:staging'],['run','build:reader:production'],['run','check:reader:paste'],['run','check:reader:parity'],['run','check:reader:resume'],['run','check:reader:recovery'],['run','check:reader:reload'],['run','check:reader:documents'],['run','check:reader:previews']])execFileSync('npm',command,{stdio:'inherit'});
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
