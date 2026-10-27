// Successful exact-input gate receipts are opt-in on interrupted-run recovery.
import{execFileSync as execute}from'node:child_process';import{readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync}from'node:fs';import{createHash}from'node:crypto';import{performance}from'node:perf_hooks';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function createGateRunner({reuse=false,directory='work/reader-gates',identity,run=execute,now=()=>performance.now()}={}){
 mkdirSync(directory,{recursive:true});const timings=[];
 return {timings,run(command,args,options={}){
  const relevant=command==='npm'&&(args[0]==='test'||args[0]==='run'&&args[1]?.startsWith('check:'))||command==='node'&&(args[0]?.startsWith('tests/')||args[0]==='scripts/video-download/check.mjs');
  if(!relevant)return run(command,args,options);
  const start=now(),context=identity?identity():null,env=Object.fromEntries(Object.entries(options.env||process.env).filter(([key])=>!/(TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE|CREDENTIAL|SESSION)/i.test(key)).sort());
  const key=sha(JSON.stringify([context,command,args,env])),file=`${directory}/${key}.json`,label=[command,...args].join(' ');
  if(reuse&&context&&existsSync(file)){const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.key===key&&saved.success===true){const item={gate:label,reused:true,elapsedMs:now()-start,originalElapsedMs:saved.elapsedMs};timings.push(item);writeFileSync(`${directory}/latest-timings.json`,JSON.stringify(timings,null,2)+'\n');console.log('REUSED exact verified gate: '+label+' ('+Math.round(saved.elapsedMs)+' ms original)');return;}}
  // A failed forced fresh rerun must invalidate an earlier successful receipt.
  if(existsSync(file))unlinkSync(file);const active=`${directory}/active-${process.pid}.json`;writeFileSync(active,JSON.stringify({gate:label,pid:process.pid,startedAt:new Date().toISOString()},null,2)+'\n');console.log('START gate: '+label);let success=false;
  try{const result=run(command,args,options);success=true;return result;}finally{if(existsSync(active))unlinkSync(active);const item={gate:label,reused:false,success,elapsedMs:now()-start};timings.push(item);writeFileSync(`${directory}/latest-timings.json`,JSON.stringify(timings,null,2)+'\n');if(success&&context)writeFileSync(file,JSON.stringify({key,success:true,elapsedMs:item.elapsedMs,completedAt:new Date().toISOString()},null,2)+'\n');console.log((success?'PASS':'FAIL')+' gate: '+label+' · '+Math.round(item.elapsedMs)+' ms');}
 }};
}
export function readerGateIdentity(){
 if(execute('git',['status','--porcelain'],{encoding:'utf8'}).trim())return null;
 const read=path=>existsSync(path)?sha(readFileSync(path)):null;
 const assets=path=>{if(!existsSync(path+'/release.json'))return null;const manifest=JSON.parse(readFileSync(path+'/release.json'));return sha(JSON.stringify([read(path+'/release.json'),Object.keys(manifest.assets).sort().map(file=>[file,read(path+'/'+file)])]));};
 return {commit:execute('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,chrome:execute('/usr/bin/google-chrome',['--version'],{encoding:'utf8'}).trim(),dependencies:read('node_modules/.package-lock.json'),lock:read('package-lock.json'),staging:assets('work/private-reader/site'),trial:assets('work/production-reader/site'),stagingConfig:read('cloudflare/reader/wrangler.staging.jsonc'),trialConfig:read('cloudflare/reader/wrangler.production.jsonc'),publicConfig:read('cloudflare/reader/wrangler.public.jsonc')};
}
