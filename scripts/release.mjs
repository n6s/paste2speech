import {execFileSync} from 'node:child_process';
if(!process.argv.includes('--legacy-production-approved'))throw Error('This legacy release targets the retired Worker. Use release:reader:public or release:reader:production. Explicit legacy rollback requires --legacy-production-approved.');
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit or otherwise resolve working-tree changes before releasing.');
for(const args of [['test'],['run','build']])execFileSync('npm',args,{stdio:'inherit'});
execFileSync('npx',['wrangler','deploy'],{stdio:'inherit'});
