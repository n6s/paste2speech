import {admitJob} from '../../cloudflare/prepared/admission.js';
import {UsageLedger,CreditError} from '../../cloudflare/prepared/ledger.js';
import {newJob,prepareJob,publicStatus,canRetryAuthorization} from '../../cloudflare/prepared/job.js';
import {accessToken,synthesize,readBounded} from '../../cloudflare/prepared/google.js';
import fixtures from './fixture.json';
const DEFAULT_ORIGIN='http://127.0.0.1:8788';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const textDecoder=new TextDecoder();
const cookieOwner=request=>request.headers.get('cookie')?.match(/(?:^|;\s*)p2s_worker_proof=([a-f0-9-]{36,72})(?:;|$)/)?.[1];
const inputJSON=async(request,limit=32000)=>JSON.parse(textDecoder.decode(await readBounded(request,limit)));

export class PreparedReading {
  constructor(ctx,env){this.ctx=ctx;this.env=env;ctx.blockConcurrencyWhile(async()=>{this.job=await ctx.storage.get('job');});}
  async settle(){
    if(!this.env.LEDGER||this.job.admission==='rejected')return;
    const ledger=new UsageLedger(this.env.LEDGER);
    // Pending admission may expire/cancel before a debit, or after a committed
    // debit whose response was lost. Serialized admission prevents a late debit.
    if(this.job.admission==='pending'&&!await ledger.receipt(this.job.id,this.job.owner))return;
    await ledger.settle(this.job);
  }
  async admit(){
    if(!this.env.LEDGER||this.job.admission!=='pending'||this.job.state!=='preparing')return;
    await admitJob(this.job,{ledger:new UsageLedger(this.env.LEDGER),save:j=>this.save(j),afterReserve:async()=>{
      if(this.job.proofAdmissionFault==='after-reserve'){
        this.job.proofAdmissionFault='';await this.save(this.job);
        throw Error('Synthetic lost reservation response');
      }
    }});
  }
  async finish(){
    try{await this.settle();if(this.job.state==='cancelled')await this.clean();}
    catch(error){await this.ctx.storage.setAlarm(Date.now()+60000);throw error;}
    await this.ctx.storage.setAlarm(this.job.expires);
  }
  async save(job){await this.ctx.storage.put('job',job);}
  async clean(){
    if(!this.job)return;
    await this.env.AUDIO.delete([...this.job.parts.map((_,i)=>`${this.job.id}/part-${i}`),`${this.job.id}/reading.mp3`,`${this.job.id}/reading.vtt`]);
  }
  async alarm(){
    // No admission await may race cancellation/expiry or another create.
    await this.ctx.blockConcurrencyWhile(async()=>{
      if(this.job?.state==='preparing'&&Date.now()<this.job.expires){
        try{await this.admit();}
        catch{this.job=await this.ctx.storage.get('job');await this.ctx.storage.setAlarm(Date.now()+5000);return;}
      }
    });
    const job=this.job;if(!job)return;
    if(job.state==='preparing'&&job.admission==='pending'&&Date.now()<job.expires)return;
    if(job.state==='expired'&&!job.owner)return;
    if(Date.now()>=job.expires){
      job.state='expired';await this.save(job);
      try{await this.settle();await this.clean();}catch(error){await this.ctx.storage.setAlarm(Date.now()+60000);throw error;}
      // Keep only an attempt tombstone, so the bounded live ID cannot be reused.
      job.chunks=[];job.parts=[];job.owner='';await this.save(job);return;
    }
    if(job.state!=='preparing'){await this.finish();return;}
    this.running=true;
    try {
      // Do not obtain new credentials if a prior paid call is uncertain.
      let token;
      if(job.mode==='live' && !job.parts.some(p=>p.state==='submitting'))token=await accessToken(this.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      await prepareJob(job,{beforeBatch:()=>this.env.LEDGER?new UsageLedger(this.env.LEDGER).assertOpen(job.id,job.owner):Promise.resolve(),save:j=>this.save(j),store:this.env.AUDIO,isCancelled:()=>job.state==='cancelled',
        speech:async(text,voice,index)=>{
          if(job.mode==='live')return synthesize(text,voice,token);
          const fixture=fixtures[voice][index];
          await new Promise(resolve=>setTimeout(resolve,fixture.delayMs));
          if(job.proofScenario==='fail-middle'&&index===1)throw Error('Synthetic failure');
          const response=await this.env.ASSETS.fetch(new Request(`http://assets/samples/${fixture.file}`));
          if(!response.ok)throw Error('Missing fixture');return new Uint8Array(await response.arrayBuffer());
        }});
    }catch(error){if(job.state!=='cancelled'){job.state='failed';job.error=error.message.startsWith('Google authorization failed')?error.message:'Preparation interrupted. No automatic retry.';job.costIncomplete=true;await this.save(job);}}
    finally{this.running=false;await this.finish();}
  }
  async fetch(request){
    const url=new URL(request.url),owner=request.headers.get('X-Proof-Owner');
    if(url.pathname==='/create')return this.ctx.blockConcurrencyWhile(async()=>{
      const input=await request.json();
      if(this.job){
        if(this.job.owner!==owner)return json({detail:'Reading not found'},404);
        if(this.job.voice!==input.voice||this.job.mode!==input.mode||(this.job.proofScenario||'')!==(input.proofScenario||'')||JSON.stringify(this.job.chunks)!==JSON.stringify(input.chunks))return json({detail:'Request does not match existing reading'},409);
        if(Date.now()>=this.job.expires)return json({detail:'Reading expired'},410);
        try{await this.admit();}catch{this.job=await this.ctx.storage.get('job');return json({detail:'Admission will recover automatically'},503);}
        if(this.job.admission==='rejected')return json({detail:this.job.error},402);
        // An explicit new create may retry authorization once, but only if the
        // durable audit proves no speech request was ever attempted.
        if(!this.env.LEDGER&&canRetryAuthorization(this.job)){
          this.job.authorizationRestarts=(this.job.authorizationRestarts||0)+1;
          this.job.state='preparing';this.job.error='';this.job.costIncomplete=false;this.job.created=Date.now();
          await this.ctx.storage.transaction(async transaction=>{await transaction.put('job',this.job);await transaction.setAlarm(Date.now()+1);});
        }
        return json({id:this.job.id,reused:true});
      }
      // Durable state and the alarm are committed together before acknowledging.
      this.job=newJob(input,owner,input.id);
      this.job.proofScenario=input.proofScenario||'';
      if(this.env.LEDGER){this.job.admission='pending';this.job.proofAdmissionFault=input.proofAdmissionFault||'';}
      await this.ctx.storage.transaction(async transaction=>{await transaction.put('job',this.job);await transaction.setAlarm(Date.now()+(input.proofAdmissionFault?5000:1));});
      if(this.job.proofAdmissionFault==='after-intent'){
        this.job.proofAdmissionFault='';await this.save(this.job);
        return json({detail:'Synthetic interrupted admission'},503);
      }
      try{await this.admit();}catch{this.job=await this.ctx.storage.get('job');return json({detail:'Admission will recover automatically'},503);}
      if(this.job.admission==='rejected')return json({detail:this.job.error},402);
      return json({id:this.job.id},201);
    });
    const job=this.job;
    if(!job||job.owner!==owner||Date.now()>=job.expires||['cancelled','expired'].includes(job.state))return json({detail:'Reading not found'},404);
    if(request.method==='DELETE'){
      job.state='cancelled';await this.save(job);if(!this.running)await this.finish();else await this.ctx.storage.setAlarm(job.expires);await this.clean();
      return new Response(null,{status:204});
    }
    if(!this.running&&job.state!=='preparing')await this.settle();
    if(url.pathname==='/status')return json(publicStatus(job));
    if(job.state!=='ready')return json({detail:'The full reading is not ready'},409);
    const kind=url.pathname.endsWith('/vtt')?'vtt':'mp3';
    const range=request.headers.get('Range');
    let parsed;
    if(range&&kind==='mp3'){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${job.bytes}`}});
      const start=match[1]?Number(match[1]):Math.max(0,job.bytes-Number(match[2]));
      const end=match[1]&&match[2]?Math.min(Number(match[2]),job.bytes-1):job.bytes-1;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=job.bytes)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${job.bytes}`}});
      parsed={offset:start,length:end-start+1};
    }
    const object=await this.env.AUDIO.get(`${job.id}/reading.${kind}`,parsed?{range:parsed}:undefined);
    if(!object)return json({detail:'Recording unavailable'},404);
    const headers={'Content-Type':kind==='mp3'?'audio/mpeg':'text/vtt','Cache-Control':'no-store',
      'Content-Length':String(parsed?.length??object.size),'Accept-Ranges':'bytes',
      'Content-Disposition':`${url.pathname.startsWith('/download')?'attachment':'inline'}; filename="reading.${kind}"`};
    if(parsed)headers['Content-Range']=`bytes ${parsed.offset}-${parsed.offset+parsed.length-1}/${job.bytes}`;
    return new Response(request.method==='HEAD'?null:object.body,{status:parsed?206:200,headers});
  }
}

export default {async fetch(request,env){
  const url=new URL(request.url),ORIGIN=env.LEDGER?'http://127.0.0.1:8789':DEFAULT_ORIGIN;
  // This pilot is deliberately unusable on public hosts, even if deployed by mistake.
  if(env.LOCAL_PROOF!=='1'||url.origin!==ORIGIN)return json({detail:'Local proof only'},403);
  if(['POST','DELETE'].includes(request.method)&&request.headers.get('Origin')!==ORIGIN)return json({detail:'Origin rejected'},403);
  const token=cookieOwner(request),ledger=env.LEDGER?new UsageLedger(env.LEDGER):null;
  try {
    // This separate local pilot never accepts credentials or enables live TTS.
    if(ledger&&String(env.ENABLE_LIVE_SYNTHESIS)==='1')return json({detail:'Account pilot accepts cached audio only'},403);
    if(ledger&&url.pathname==='/api/test-login'&&request.method==='POST'){
      const {account}=await inputJSON(request);
      if(!['test-reader-a','test-reader-b','test-low-credit'].includes(account))return json({},422);
      const session=await ledger.issueSession(account);
      return json({localTestAccount:true},200,{'Set-Cookie':`p2s_worker_proof=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`});
    }
    const identity=ledger?await ledger.session(token):null,owner=ledger?(identity?.enabled?identity.id:null):token;
    if(ledger&&url.pathname==='/api/logout'&&request.method==='POST'){await ledger.logout(token);return json({},200,{'Set-Cookie':'p2s_worker_proof=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});}
    if(ledger&&url.pathname==='/api/account')return owner?json(await ledger.account(owner)):json({},401);
    const receipt=url.pathname.match(/^\/api\/reservations\/([a-f0-9-]{36})$/);
    if(ledger&&receipt){const result=owner?await ledger.receipt(receipt[1],owner):null;return result?json(result):json({},404);}
    if(ledger&&url.pathname==='/'&&request.method==='GET')return new Response('Local account API proof. Synthetic identities and fake credit only. Run check-accounts.mjs; browser sign-in is not connected yet.',{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
    if(url.pathname==='/capabilities'){
      let credentialJsonValid=false;try{credentialJsonValid=!!JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON).private_key;}catch{}
      return json({liveEnabled:String(env.ENABLE_LIVE_SYNTHESIS)==='1',hasGoogleCredential:!!env.GOOGLE_SERVICE_ACCOUNT_JSON,credentialJsonValid});
    }
    if(url.pathname==='/auth-check' && request.method==='POST' && owner && String(env.ENABLE_LIVE_SYNTHESIS)==='1'){
      try{await accessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);return json({authorized:true,speechRequests:0});}
      catch(error){return json({authorized:false,error:error.message,speechRequests:0},502);}
    }
    if(url.pathname==='/api/readings' && request.method==='POST'){
      if(!owner)return json({detail:'Open the proof page first'},401);
      const input=await inputJSON(request),fixture=fixtures[input.voice];
      if(!fixture || JSON.stringify(input.chunks)!==JSON.stringify(fixture.map(s=>s.text)))return json({detail:'Only the fixed synthetic passage is accepted'},422);
      const mode=input.provider==='live-full'?'live':'fixture';
      if(mode==='live' && String(env.ENABLE_LIVE_SYNTHESIS)!=='1')return json({detail:'Live generation disabled'},403);
      // One persistent paid run per voice in this local state directory. Reloads
      // return the existing job; failed/cancelled attempts cannot be resubmitted.
      const id=ledger?request.headers.get('Idempotency-Key'):(mode==='live'?`live-${input.voice}-baseline-1`:crypto.randomUUID());
      if(ledger){
        if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id||''))return json({detail:'A UUID request key is required'},422);
        if(input.proofScenario&&!['fail-middle'].includes(input.proofScenario))return json({},422);
        const fault=request.headers.get('X-Proof-Admission-Fault');
        if(fault&&!['after-intent','after-reserve'].includes(fault))return json({},422);
        // Only the cached, loopback account harness accepts fault injection.
        input.proofAdmissionFault=fault||'';
      }
      const stub=env.JOBS.get(env.JOBS.idFromName(id));
      return stub.fetch(new Request('http://job/create',{method:'POST',headers:{'X-Proof-Owner':owner},body:JSON.stringify({...input,mode,id})}));
    }
    const match=url.pathname.match(/^\/api\/readings\/([a-zA-Z0-9-]{1,64})(\/audio|\/download\/(?:mp3|vtt))?$/);
    if(match){
      if(!owner)return json({detail:'Reading not found'},404);
      const stub=env.JOBS.get(env.JOBS.idFromName(match[1]));
      return stub.fetch(new Request(`http://job${match[2]||'/status'}`,{method:request.method,headers:{'X-Proof-Owner':owner,...(request.headers.has('Range')?{Range:request.headers.get('Range')}:{})}}));
    }
    if(url.pathname==='/metrics' && owner){
      const key=`metrics/${owner}`;
      if(request.method==='POST'){const data=await readBounded(request,200000);await env.AUDIO.put(key,data);return json({saved:true});}
      const object=await env.AUDIO.get(key);return object?new Response(object.body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}):json({},404);
    }
    if(request.method!=='GET')return json({},405);
    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
    if(!ledger&&!owner&&url.pathname==='/')headers.set('Set-Cookie',`p2s_worker_proof=${crypto.randomUUID()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    return new Response(response.body,{status:response.status,headers});
  }catch(error){return error instanceof CreditError?json({detail:error.message},error.status):json({detail:'Private preparation request failed'},500);}
}};
