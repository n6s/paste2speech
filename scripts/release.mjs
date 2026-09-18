import {execFileSync} from 'node:child_process';
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit or otherwise resolve working-tree changes before releasing.');
for(const args of [['test'],['run','build']])execFileSync('npm',args,{stdio:'inherit'});
execFileSync('npx',['wrangler','deploy'],{stdio:'inherit'});
