// No remote changes without the explicit production-approved deployment flag.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const config='cloudflare/reader/wrangler.public.jsonc',settings=JSON.parse(readFileSync(config)),deploy=process.argv.includes('--deploy');
if(settings.vars.READER_MODE!=='production-public'||settings.vars.PADDLE_ENVIRONMENT!=='live'||settings.vars.LOCAL_READER!=='0')throw Error('Invalid public release configuration');
if(deploy){
 if(!process.argv.includes('--production-approved'))throw Error('Review and approve the exact release before deployment');
 if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit the release before deployment');
 if(!/^pri_[a-z0-9]{26}$/.test(settings.vars.PADDLE_PRICE_ID)||!/^pro_[a-z0-9]{26}$/.test(settings.vars.PADDLE_PRODUCT_ID))throw Error('Verified live catalog is required');
}
execFileSync('npm',['test'],{stdio:'inherit'});
execFileSync('node',['cloudflare/reader/build.mjs','--public'],{stdio:'inherit'});
const site='work/production-reader/site';
for(const file of ['index.html','billing.html'])if(/private staging|owner-only trial|test checkout|test buying/i.test(readFileSync(site+'/'+file,'utf8')))throw Error('Test/trial wording in public assets');
if(readdirSync(site+'/samples').length)throw Error('Test audio must not ship');
execFileSync('node',['node_modules/wrangler/bin/wrangler.js','deploy','--config',config,'--dry-run','--outdir','work/production-reader/public-worker'],{stdio:'inherit'});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function assets(dir){return Object.fromEntries(readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?Object.entries(assets(dir+'/'+f.name)).map(([k,v])=>[f.name+'/'+k,v]):[[f.name,sha(dir+'/'+f.name)]]));}
const manifest={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),worker:settings.name,origin:settings.vars.READER_ORIGIN,configSHA256:sha(config),speechEnabled:settings.vars.ENABLE_LIVE_SYNTHESIS==='1',checkoutEnabled:settings.vars.ENABLE_PAYMENTS==='1',publicLaunchOpen:settings.vars.PUBLIC_LAUNCH_OPEN==='1',dailyUSD:10,monthlyUSD:50,catalogConfigured:!!settings.vars.PADDLE_PRICE_ID&&!!settings.vars.PADDLE_PRODUCT_ID,assets:assets(site),migrations:assets('cloudflare/reader/migrations')};
writeFileSync('work/production-reader/public-release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
if(deploy)execFileSync('node',['node_modules/wrangler/bin/wrangler.js','deploy','--config',config],{stdio:'inherit'});
console.log(deploy?'Approved public release deployed.':'Public release prepared locally; no production changes.');
