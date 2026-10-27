import{spawn}from'node:child_process';import{createGateRunner,readerGateIdentity}from'./reader-gate-runner.mjs';import{mkdirSync,openSync,closeSync,readFileSync,writeFileSync,readdirSync}from'node:fs';import{resolve}from'node:path';
const light=new Set(['npm:check:reader:paste','npm:check:reader:modes','npm:check:reader:unified',...['cloud-choice','summary-credits','summary-consent-recovery','word-import','screenshot-recovery','scan-outcome','intake-summary-ui','plain-text','pdf-native-routing','input-copy','ocr-picker','reading-lifecycle','reading-history','reading-retention','unavailable-reading-voice','temporary-playlist','mobile-input-controls','math-speech-engine','math-speech-ui','math-speech-reading','translation','translation-documents'].map(n=>'node:tests/'+n+'-browser.mjs')]);
export function gateClass(command,args){return light.has(command+':'+(command==='npm'?args[1]:args[0]))?'light':'heavy';}
export function gateResources(command,args){const path=args.join(' ');return /math-speech/.test(path)?['math-output']:/translation/.test(path)?['translation-output']:/reading-history|reading-lifecycle|temporary-playlist|mobile-input-controls|unavailable-reading-voice|image-queue|natural-.*queue|native-queue|prose-symbols|saved-tap-resume|clear-reload|repeated-paste-play|queue-recovery/.test(path)?['reading-history-output']:[];}
export async function scheduleGates(gates,{run,concurrency=2,onEvent=()=>{},signal}={}){
 if(![1,2].includes(concurrency))throw Error('Only one heavy plus one light gate is supported.');const pending=[...gates],active=new Map(),locks=new Set();let failure=null,sequence=0;
 const cancel=()=>{if(!failure)failure=signal.reason||Error('Gate run canceled');for(const value of active.values())value.controller.abort(failure);};
 if(signal?.aborted)cancel();signal?.addEventListener('abort',cancel,{once:true});
 const start=gate=>{const id=++sequence,resources=gate.resources||[];for(const r of resources)locks.add(r);const controller=new AbortController();onEvent({type:'start',gate});const promise=Promise.resolve().then(()=>run(gate,controller.signal)).catch(error=>{if(!failure){failure=error;for(const value of active.values())if(value.id!==id)value.controller.abort(error);}onEvent({type:'failed',gate,error});}).finally(()=>{for(const r of resources)locks.delete(r);active.delete(id);onEvent({type:'finish',gate});});active.set(id,{id,gate,controller,promise});};
 try{while(pending.length||active.size){if(!failure){while(active.size<concurrency){const heavy=[...active.values()].some(x=>(x.gate.resourceClass||'heavy')==='heavy');let index=pending.findIndex(g=>(!heavy||(g.resourceClass||'heavy')!=='heavy')&&(g.resources||[]).every(r=>!locks.has(r)));if(index<0)break;start(pending.splice(index,1)[0]);}}if(!active.size)break;await Promise.race([...active.values()].map(x=>x.promise));}
 }finally{signal?.removeEventListener('abort',cancel);}
 if(failure)throw failure;
}
export const isReaderCheck=(command,args)=>command==='npm'&&(args[0]==='test'||args[0]==='run'&&args[1]?.startsWith('check:'))||command==='node'&&(args[0]?.startsWith('tests/')||args[0]?.startsWith('scripts/reader-parity/')||args[0]==='scripts/video-download/check.mjs');
// npm/shell may exit before a child finishes its SIGTERM cleanup. Read only
// process-group metadata; never signal a stale PID after the owned leader exits.
async function drainOwnedGroup(pid){
 const deadline=Date.now()+5000;
 for(;;){
  const live=[];
  for(const entry of readdirSync('/proc')){if(!/^\d+$/.test(entry))continue;try{const stat=readFileSync('/proc/'+entry+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');if(Number(fields[2])===pid&&Number(fields[3])===pid&&!['Z','X'].includes(fields[0]))live.push(entry);}catch{}}
  if(!live.length)return;
  if(Date.now()>=deadline)throw Error('Owned gate descendants did not finish teardown: '+live.join(', '));
  await new Promise(resolve=>setTimeout(resolve,25));
 }
}
export function executeGate(gate,signal,{logFile,timeoutMs=300000,spawnProcess=spawn}={}){
 if(signal?.aborted)return Promise.reject(signal.reason||Error('Gate canceled before start'));
 const fd=openSync(logFile,'w'),controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal].filter(Boolean));let child,spawnError,force;
 const timeout=setTimeout(()=>controller.abort(Error('Gate exceeded '+timeoutMs+' ms: '+gate.args.join(' '))),timeoutMs);timeout.unref();
 return new Promise((resolveResult,reject)=>{try{child=spawnProcess(gate.command,gate.args,{cwd:process.cwd(),env:gate.options?.env||process.env,stdio:['ignore',fd,fd],detached:true});}catch(error){clearTimeout(timeout);closeSync(fd);reject(error);return;}
 // The group is created by this spawn; signal only while its owned child is live.
 const stop=kind=>{if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,kind);}catch(error){if(error.code!=='ESRCH')throw error;}}};
 const abort=()=>{stop('SIGTERM');force=setTimeout(()=>stop('SIGKILL'),5000);force.unref();};combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
 child.on('error',error=>{spawnError=error;});child.once('close',async(code,termination)=>{clearTimeout(timeout);clearTimeout(force);combined.removeEventListener('abort',abort);closeSync(fd);if((combined.aborted||spawnError||code!==0)&&child.pid){try{await drainOwnedGroup(child.pid);}catch(error){reject(error);return;}}if(code===0&&!combined.aborted&&!spawnError)resolveResult();else reject(combined.reason||spawnError||Error('Gate failed ('+(termination||code)+'): '+gate.args.join(' ')+' · '+logFile));});});
}

// Every gate retains its own process, browser profile, server and assertions.
// Only audited lightweight suites overlap; unknown/new suites default to heavy.
export function gateEnvironment(env=process.env){
 const preload='--import='+resolve('scripts/reader-gate-lifecycle.mjs');
 return {...env,NODE_OPTIONS:[env.NODE_OPTIONS,preload].filter(Boolean).join(' ')};
}
export async function runFreshChecks(checks,{reuse=false,concurrency=2,directory='work/reader-gates'}={}){
 const controller=new AbortController(),interrupt=kind=>controller.abort(Error('Release checks interrupted by '+kind)),onTerm=()=>interrupt('SIGTERM'),onInt=()=>interrupt('SIGINT');process.once('SIGTERM',onTerm);process.once('SIGINT',onInt);
 const started=performance.now(),logs=resolve(directory,'logs');mkdirSync(logs,{recursive:true});
 const runner=createGateRunner({reuse,directory,identity:readerGateIdentity,run:(command,args,options)=>executeGate({command,args,options},options.signal,{logFile:options.logFile})});
 const gates=checks.map((gate,index)=>({...gate,index,resourceClass:gateClass(gate.command,gate.args),resources:[gate.command+':'+(gate.command==='npm'?gate.args[1]:gate.args[0]),...gateResources(gate.command,gate.args)]}));
 try{await scheduleGates(gates,{concurrency,signal:controller.signal,run:async(gate,signal)=>{
  const logFile=resolve(logs,String(gate.index+1).padStart(3,'0')+'.log');
  try{await runner.run(gate.command,gate.args,{...gate.options,env:gateEnvironment(gate.options?.env),signal,logFile});}
  finally{try{const output=readFileSync(logFile,'utf8');if(output)process.stdout.write('\n--- '+[gate.command,...gate.args].join(' ')+' ---\n'+output);}catch{}}
 }});}finally{process.removeListener('SIGTERM',onTerm);process.removeListener('SIGINT',onInt);writeFileSync(resolve(directory,'fresh-run.json'),JSON.stringify({concurrency,elapsedMs:performance.now()-started,planned:gates.map(({command,args,resourceClass,resources})=>({command,args,resourceClass,resources})),timings:runner.timings},null,2)+'\n');}
 return runner.timings;
}
