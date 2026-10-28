// A scoped staging run is proof about a change from a full validated baseline.
// Unknown impact, shared code, migrations and production always retain full gates.
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {preloadIdentity} from './reader-gate-runner.mjs';
export const SCOPE_POLICY='reader-scope-v3';
export const SUMMARY_GATES=Object.freeze(['tests/summary-credits-browser.mjs','tests/summary-consent-recovery-browser.mjs','tests/intake-summary-ui-browser.mjs','tests/summary-documents-browser.mjs','tests/summary-documents-native.mjs']);
const summaryFile=/^(?:public\/summary-document-[a-z-]+\.js|cloudflare\/reader\/summary-document(?:s|-[a-z-]+)\.js|tests\/summary-document(?:s|-?[a-z-]+)\.(?:test\.js|mjs)|docs\/summary-documents-staging\.md)$/;
export const summaryOnlyPath=path=>typeof path==='string'&&!path.includes('..')&&summaryFile.test(path);
export function decideScope({requested='full',environment='staging',clean=true,baselineValid=false,changed=[],missing=[]}={}){
 const full=reason=>({scope:'full',requested,reason,changed});
 if(environment!=='staging')return full('Production and trial releases require full gates.');
 if(requested!=='summary')return full(requested==='full'?'Full gates requested.':'Unknown scope; full gates required.');
 if(!clean)return full('Dirty or untracked inputs; full gates required.');
 if(!baselineValid)return full('No compatible full validated baseline.');
 if(missing.length)return full('Removed inputs require full gates: '+missing.join(', '));
 if(!changed.length)return full('No changed-path evidence; full gates required.');
 const unknown=changed.filter(path=>!summaryOnlyPath(path));
 if(unknown.length)return full('Shared or unknown impact: '+unknown.join(', '));
 return{scope:'summary',requested,reason:'Only staging Summary document dependencies changed.',changed};
}
const hash=value=>createHash('sha256').update(value).digest('hex');
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const fileHash=path=>existsSync(path)?hash(readFileSync(path)):null;
export function scopeEnvironmentIdentity(env){const entries=Object.entries(env).filter(([key])=>!/^npm_/i.test(key)&&!['_','SHLVL','PWD','OLDPWD','INIT_CWD','PATH','CODEX_TOOL_CALL_ID'].includes(key)).sort(([a],[b])=>a.localeCompare(b));return hash(JSON.stringify(entries));}
export function scopeRuntime(env=process.env){
 // Hash values, never persist credentials. Ignore only shell/npm invocation
 // bookkeeping; application/test overrides and preloads remain in the identity.

 return{git:git(['--version']),node:process.version,nodeExecutable:process.execPath,npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),npmExecutable:execFileSync('which',['npm'],{encoding:'utf8'}).trim(),chrome:execFileSync('/usr/bin/google-chrome',['--version'],{encoding:'utf8'}).trim(),lock:fileHash('package-lock.json'),dependencies:fileHash('node_modules/.package-lock.json'),configs:['staging','production','public'].map(name=>fileHash('cloudflare/reader/wrangler.'+name+'.jsonc')),preloads:preloadIdentity(env),environment:scopeEnvironmentIdentity(env)};
}
export function validBaseline(value,{base,tree,runtime}){
 return!!value&&value.policy===SCOPE_POLICY&&value.scope==='full'&&value.environment==='staging'&&value.success===true&&value.commit===base&&value.tree===tree&&value.gates>=72&&value.runtime?.preloads!==null&&JSON.stringify(value.runtime)===JSON.stringify(runtime);
}
export function importSignature(source){
 if(/\b(?:import|require)\s*\(\s*[^'"\s]/.test(source)||/\b(?:eval|Function)\s*\(/.test(source))return null;
 const values=[];
 for(const regex of [/\bimport\s*(?:[^'";]*?\bfrom\s*)?(['"])([^'"]+)\1/g,/\bexport\s*(?:\*[^;]*?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\1/g,/\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1/g])for(const match of source.matchAll(regex))values.push(match[2]);
 return [...new Set(values)].sort();
}
export function compatibleImports(before,after){const a=importSignature(before),b=importSignature(after);return a!==null&&b!==null&&JSON.stringify(a)===JSON.stringify(b);}
export function resolveScope(args,environment,{directory='work/reader-scopes/baselines'}={}){
 const option=name=>{const index=args.indexOf(name);return index<0?args.find(v=>v.startsWith(name+'='))?.slice(name.length+1):args[index+1];};
 const requested=option('--scope')||'full',context={commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),clean:!git(['status','--porcelain']),runtime:scopeRuntime()},baseArgument=option('--base');
 let base=null,changed=[],baselineValid=false;
 if(requested==='summary'&&baseArgument){try{
  base=git(['rev-parse','--verify','--end-of-options',baseArgument+'^{commit}']);
  git(['merge-base','--is-ancestor',base,context.commit]);
  // --no-renames exposes deletion + addition; a shared file cannot be hidden
  // by renaming it into the Summary allowlist.
  changed=execFileSync('git',['diff','--no-renames','--name-only','-z',base,context.commit],{encoding:'utf8'}).split('\0').filter(Boolean);
  const path=directory+'/'+base+'.json';
  baselineValid=existsSync(path)&&validBaseline(JSON.parse(readFileSync(path,'utf8')),{base,tree:git(['rev-parse',base+'^{tree}']),runtime:context.runtime});
 }catch{/* Invalid/unknown baseline falls back to full, never to a smaller set. */}}
 let plan=decideScope({requested,environment,clean:context.clean,baselineValid,changed,missing:changed.filter(path=>!existsSync(path))});
 if(plan.scope==='summary')for(const path of changed.filter(path=>/^(public|cloudflare)\//.test(path)&&path.endsWith('.js'))){try{if(!compatibleImports(execFileSync('git',['show',base+':'+path],{encoding:'utf8'}),readFileSync(path,'utf8')))throw Error('changed imports');}catch{plan={...plan,scope:'full',reason:'New, removed or changed Summary dependencies: '+path};break;}}
 return{...plan,environment,base,context,directory};
}
export function selectScopeChecks(checks,plan){
 if(plan.scope!=='summary')return{checks,plan};
 const selected=checks.filter(gate=>gate.command==='node'&&SUMMARY_GATES.includes(gate.args[0]));
 if(selected.length!==SUMMARY_GATES.length||new Set(selected.map(x=>x.args[0])).size!==SUMMARY_GATES.length)return{checks,plan:{...plan,scope:'full',reason:'Required Summary coverage is missing from this configuration.'}};
 return{checks:selected,plan};
}
export function invalidateFullBaseline(plan){
 if(plan.scope!=='full'||!plan.context.clean)return;const path=plan.directory+'/'+plan.context.commit+'.json';if(existsSync(path))unlinkSync(path);
}
export function recordScopeSuccess(plan,{gates,elapsedMs,integrationMs,directory='work/reader-scopes'}={}){
 const record={policy:SCOPE_POLICY,scope:plan.scope,environment:plan.environment,success:true,commit:plan.context.commit,tree:plan.context.tree,runtime:plan.context.runtime,base:plan.base,changed:plan.changed,reason:plan.reason,gates,elapsedMs,integrationMs,completedAt:new Date().toISOString()};
 mkdirSync(directory,{recursive:true});writeFileSync(directory+'/latest.json',JSON.stringify(record,null,2)+'\n');
 if(plan.scope==='full'&&plan.environment==='staging'&&plan.context.clean){mkdirSync(plan.directory,{recursive:true});const path=plan.directory+'/'+record.commit+'.json';writeFileSync(path+'.tmp',JSON.stringify(record,null,2)+'\n');renameSync(path+'.tmp',path);}
 return record;
}
