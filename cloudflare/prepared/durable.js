import {production,publicMode,customerAllowed} from '../reader/modes.js';
import {progressiveReader,fixtureDelay} from '../reader/mse-staging.js';
import {dispatchBudget} from '../reader/budget.js';
import {loadJob,saveJob} from './storage.js';
import {ReaderLedger} from '../reader/ledger.js';
import {admitJob} from './admission.js';
import {UsageLedger} from './ledger.js';
import {newJob,prepareJob,publicStatus,canRetryAuthorization} from './job.js';
import {accessToken,synthesize} from './google.js';
import fixtures from '../../scripts/wavenet-worker-proof/fixture.json';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
export class PreparedReading {
  constructor(ctx,env){this.ctx=ctx;this.env=env;if(env.BACKGROUND_WORK_PAUSED!=='1')ctx.blockConcurrencyWhile(async()=>{this.job=await loadJob(ctx.storage);});}
  cachedStage(){return this.job?.mode==='staging-fixture'&&!!this.job.mseOptions;}
  async settle(){
    if(this.cachedStage())return;
    if(!this.env.LEDGER||this.job.admission==='rejected')return;
    const ledger=new (this.env.PRIVATE_READER==='1'||production(this.env)?ReaderLedger:UsageLedger)(this.env.LEDGER);
    // Pending admission may expire/cancel before a debit, or after a committed
    // debit whose response was lost. Serialized admission prevents a late debit.
    if(this.job.admission==='pending'&&!await ledger.receipt(this.job.id,this.job.owner))return;
    await ledger.settle(this.job);
  }
  async admit(){
    if(this.cachedStage()||!this.env.LEDGER||this.job.admission!=='pending'||this.job.state!=='preparing')return;
    await admitJob(this.job,{ledger:new (this.env.PRIVATE_READER==='1'||production(this.env)?ReaderLedger:UsageLedger)(this.env.LEDGER),save:j=>this.save(j),afterReserve:async()=>{
      if(this.job.proofAdmissionFault==='after-reserve'){
        this.job.proofAdmissionFault='';await this.save(this.job);
        throw Error('Synthetic lost reservation response');
      }
    }});
  }
  async finish(){
    try{await this.settle();if(this.job.state==='cancelled'&&!await this.clean()){await this.ctx.storage.setAlarm(Date.now()+1);return;}}
    catch(error){await this.ctx.storage.setAlarm(Date.now()+60000);throw error;}
    await this.ctx.storage.setAlarm(this.job.expires);
  }
  save(job,alarm){
    const snapshot=structuredClone(job);
    const next=(this.saving||Promise.resolve()).then(()=>saveJob(this.ctx.storage,snapshot,alarm));
    this.saving=next.catch(()=>{});return next;
  }
  async clean(){
    if(!this.job)return true;
    const keys=[...this.job.parts.map((_,i)=>`${this.job.id}/part-${i}`),...Array.from({length:this.job.assembledBlocks||0},(_,i)=>`${this.job.id}/block-${i}`),`${this.job.id}/reading.mp3`,`${this.job.id}/reading.vtt`];
    const start=this.job.cleanupOffset||0;
    await this.env.AUDIO.delete(keys.slice(start,start+100));
    this.job.cleanupOffset=Math.min(start+100,keys.length);await this.save(this.job);
    return this.job.cleanupOffset===keys.length;
  }
  async alarm(){
    if(this.env.BACKGROUND_WORK_PAUSED==='1'){await this.ctx.storage.setAlarm(Date.now()+86400000);return;}
    // No admission await may race cancellation/expiry or another create.
    await this.ctx.blockConcurrencyWhile(async()=>{
      if(this.job?.state==='preparing'&&Date.now()<this.job.expires){
        try{await this.admit();}
        catch{this.job=await loadJob(this.ctx.storage);await this.ctx.storage.setAlarm(Date.now()+5000);return;}
      }
    });
    const job=this.job;if(!job)return;
    if(job.state==='preparing'&&job.admission==='pending'&&Date.now()<job.expires)return;
    if(job.state==='expired'&&!job.owner)return;
    if(Date.now()>=job.expires){
      job.state='expired';await this.save(job);
      try{await this.settle();if(!await this.clean()){await this.ctx.storage.setAlarm(Date.now()+1);return;}}catch(error){await this.ctx.storage.setAlarm(Date.now()+60000);throw error;}
      // Keep only an attempt tombstone, so the bounded live ID cannot be reused.
      job.chunks=[];job.parts=[];job.owner='';await this.save(job);return;
    }
    if(job.state!=='preparing'){await this.finish();return;}
    if(this.running)return;
    this.running=true;
    await this.ctx.storage.setAlarm(Date.now()+120000);
    try {
      // Do not obtain new credentials if a prior paid call is uncertain.
      let token;
      if(job.mode==='live' && this.env.ENABLE_LIVE_SYNTHESIS!=='1')throw Error('Live synthesis disabled');
      if(job.mode==='live' && !job.parts.some(p=>p.state==='submitting')){
        if(!this.googleAuthorization||this.googleAuthorization.expires<=Date.now())
          this.googleAuthorization=await accessToken(this.env.GOOGLE_SERVICE_ACCOUNT_JSON,{includeExpiry:true});
        token=this.googleAuthorization.token;
      }
      await prepareJob(job,{maxBatches:1,concurrency:job.mseOptions?.concurrency||3,publishEach:!!job.mseOptions,stagingLive:progressiveReader(this.env),beforeBatch:()=>this.env.LEDGER&&!this.cachedStage()?new (this.env.PRIVATE_READER==='1'||production(this.env)?ReaderLedger:UsageLedger)(this.env.LEDGER).assertOpen(job.id,job.owner):Promise.resolve(),save:j=>this.save(j),store:this.env.AUDIO,isCancelled:()=>job.state==='cancelled',
        speech:async(text,voice,index)=>{
          if(job.mode==='live'){
            if(this.env.ENABLE_LIVE_SYNTHESIS!=='1')throw Error('Synthesis paused');
            if(publicMode(this.env)){
              if(!customerAllowed(this.env,await new ReaderLedger(this.env.LEDGER).account(job.owner)))throw Error('Account disabled');
              await dispatchBudget(this.env.LEDGER,job.id,index,text);
            }
            return synthesize(text,voice,token);
          }
          const fixture=fixtures[voice][index % fixtures[voice].length];
          await new Promise(resolve=>setTimeout(resolve,fixtureDelay(job,index,fixture.delayMs)));
          if((job.proofScenario==='fail-middle'||job.mseOptions?.scenario==='failure')&&index===1)throw Error('Synthetic failure');
          const response=await this.env.ASSETS.fetch(new Request(`http://assets/samples/${fixture.file}`));
          if(!response.ok)throw Error('Missing fixture');return new Uint8Array(await response.arrayBuffer());
        }});
    }catch(error){if(job.state!=='cancelled'){job.state='failed';job.error=error.message.startsWith('Google authorization failed')?error.message:'Preparation interrupted. No automatic retry.';job.costIncomplete=true;await this.save(job);}}
    finally{this.running=false;if(job.state==='preparing')await this.ctx.storage.setAlarm(Date.now()+1);else await this.finish();}
  }
  async fetch(request){
    if(this.env.BACKGROUND_WORK_PAUSED==='1')return json({detail:'Reading is temporarily paused for maintenance.'},503);
    const url=new URL(request.url),owner=request.headers.get('X-Proof-Owner');
    if(url.pathname==='/create')return this.ctx.blockConcurrencyWhile(async()=>{
      const input=await request.json();
      if(this.job){
        if(this.job.owner!==owner)return json({detail:'Reading not found'},404);
        if(this.job.voice!==input.voice||this.job.mode!==input.mode||(this.job.proofScenario||'')!==(input.proofScenario||'')||JSON.stringify(this.job.chunks)!==JSON.stringify(input.chunks)||JSON.stringify(this.job.mseOptions||null)!==JSON.stringify(input.mseOptions||null))return json({detail:'Request does not match existing reading'},409);
        if(Date.now()>=this.job.expires)return json({detail:'Reading expired'},410);
        try{await this.admit();}catch{this.job=await loadJob(this.ctx.storage);return json({detail:'Admission will recover automatically'},503);}
        if(this.job.admission==='rejected')return json({detail:this.job.error},this.job.errorStatus||402);
        // An explicit new create may retry authorization once, but only if the
        // durable audit proves no speech request was ever attempted.
        if(!this.env.LEDGER&&canRetryAuthorization(this.job)){
          this.job.authorizationRestarts=(this.job.authorizationRestarts||0)+1;
          this.job.state='preparing';this.job.error='';this.job.costIncomplete=false;this.job.created=Date.now();
          await this.save(this.job,Date.now()+1);
        }
        return json({id:this.job.id,reused:true});
      }
      // Durable state and the alarm are committed together before acknowledging.
      if(input.mseOptions&&!progressiveReader(this.env))return json({detail:'Staging playback unavailable'},403);
      this.job=newJob(input,owner,input.id);
      if(input.mseOptions)this.job.mseOptions=input.mseOptions;
      this.job.proofScenario=input.proofScenario||'';
      if(this.env.LEDGER&&!this.cachedStage()){this.job.admission='pending';this.job.proofAdmissionFault=input.proofAdmissionFault||'';}
      await this.save(this.job,Date.now()+(input.proofAdmissionFault?5000:1));
      if(this.job.proofAdmissionFault==='after-intent'){
        this.job.proofAdmissionFault='';await this.save(this.job);
        return json({detail:'Synthetic interrupted admission'},503);
      }
      try{await this.admit();}catch{this.job=await loadJob(this.ctx.storage);return json({detail:'Admission will recover automatically'},503);}
      if(this.job.admission==='rejected')return json({detail:this.job.error},this.job.errorStatus||402);
      return json({id:this.job.id},201);
    });
    const job=this.job;
    if(!job||job.owner!==owner||Date.now()>=job.expires||['cancelled','expired'].includes(job.state))return json({detail:'Reading not found'},404);
    if(request.method==='DELETE'){
      job.state='cancelled';await this.save(job);if(!this.running)await this.finish();else await this.ctx.storage.setAlarm(job.expires);
      return new Response(null,{status:204});
    }
    if(!this.running&&job.state!=='preparing')await this.settle();
    if(url.pathname==='/status')return json(publicStatus(job));
    const section=/^\/sections\/(0|[1-9]\d*)$/.exec(url.pathname);
    if(section){
      if(!job.mseOptions)return json({detail:'Section delivery unavailable'},404);
      if(job.state==='failed')return json({detail:'Preparation failed'},422);
      const part=job.parts[Number(section[1])];if(!part)return json({},404);
      if(part.state!=='ready')return json({detail:'Section pending'},409);
      const object=await this.env.AUDIO.get(`${job.id}/part-${section[1]}`);
      if(!object)return json({detail:'Section missing'},404);
      return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(object.size),'Cache-Control':'no-store'}});
    }
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
