// Deploy only the API, retaining the public reader's currently uploaded assets.
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit changes before deploying.');
execFileSync('npm',['test'],{stdio:'inherit'});
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
config.main=resolve(config.main);
delete config.assets;
for(const db of config.d1_databases||[])db.migrations_dir=resolve(db.migrations_dir);
config.unsafe={bindings:[{name:'ASSETS',type:'assets'}],metadata:{keep_assets:true}};
const dir=await mkdtemp(join(tmpdir(),'paste2speech-api-'));
try {
 const file=join(dir,'wrangler.json');await writeFile(file,JSON.stringify(config));
 execFileSync('npx',['wrangler','deploy','--config',file,'--keep-vars'],{stdio:'inherit'});
}finally{await rm(dir,{recursive:true,force:true});}
