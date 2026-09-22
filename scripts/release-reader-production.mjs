// Default is a local preparation/dry run. No provisioning or remote mutation.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const config='cloudflare/reader/wrangler.production.jsonc';
const settings=JSON.parse(readFileSync(config,'utf8'));
const deploy=process.argv.includes('--deploy');
if(deploy){
 if(!process.argv.includes('--production-approved'))throw Error('Production approval is required. Use the default dry run to prepare review.');
 if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit the release before deployment.');
 if(settings.d1_databases.find(d=>d.binding==='LEDGER').database_id==='00000000-0000-0000-0000-000000000000')throw Error('Provision and record the approved production ledger first.');
}
if(settings.vars.ENABLE_PAYMENTS!=='0'||settings.vars.READER_MODE!=='production-trial'||settings.vars.LOCAL_READER!=='0')throw Error('Invalid trial configuration.');
for(const args of [['test'],['run','build:reader:production']])execFileSync('npm',args,{stdio:'inherit'});
for(const file of ['index.html','billing.html','billing.js'])if(/paddle|sandbox|staging|test purchases|Upgrade with a speech pack/i.test(readFileSync('work/production-reader/site/'+file,'utf8')))throw Error('Staging or checkout content in production assets: '+file);
if(readdirSync('work/production-reader/site/samples').length)throw Error('Test audio must not ship in production assets.');
execFileSync('node',['node_modules/wrangler/bin/wrangler.js','deploy','--config',config,...(deploy?[]:['--dry-run','--outdir','work/production-reader/worker'])],{stdio:'inherit'});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const site='work/production-reader/site';
const manifest={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),worker:settings.name,origin:settings.vars.READER_ORIGIN,configSHA256:sha(config),speechEnabled:settings.vars.ENABLE_LIVE_SYNTHESIS==='1',paymentsEnabled:false,maximumCharacters:Number(settings.vars.MAX_LIFETIME_CHARACTERS),assets:Object.fromEntries(readdirSync(site,{withFileTypes:true}).filter(f=>f.isFile()).map(f=>[f.name,sha(site+'/'+f.name)]))};
writeFileSync('work/production-reader/release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(deploy?'Production reader deployed.':'Prepared locally. No production resources, secrets, or routes changed.');
