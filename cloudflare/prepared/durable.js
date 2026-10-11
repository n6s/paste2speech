import {production,publicMode,customerAllowed} from '../reader/modes.js';
import {progressiveReader,fixtureDelay,fixtureChunks,mseStaging} from '../reader/mse-staging.js';
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
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async load(){
    if(this.loaded)return;
    this.loading??=loadJob(this.ctx.storage).then(job=>{this.job=job;this.loaded=true;}).finally(()=>{this.loading=null;});
    await this.loading;
  }
  async recover(error){
    const previous=await this.ctx.storage.get('recovery')||{attempts:0};
    const attempts=previous.attempts+1,delays=[60000,300000,900000,3600000];
    const recovery={attempts,next:attempts<=delays.length?Date.now()+delays[attempts-1]:null,phase:this.phase||'load',code:error?.name||'Error'};
    await this.ctx.storage.put('recovery',recovery);
    if(recovery.next)await this.ctx.storage.setAlarm(recovery.next);else await this.ctx.storage.deleteAlarm();
    console.error(JSON.stringify({event:'reading_recovery',...recovery}));
  }
  retired(meta){const cutoff=Number(this.env.RETIRE_BEFORE||0);return cutoff>0&&meta&&(meta.created||0)<cutoff;}
  cachedStage(){return this.job?.mode==='staging-fixture'&&!!this.job.mseOptions;}
  async settle(){
    if(this.job.settlementDone||this.cachedStage())return;
    if(!this.env.LEDGER||this.job.admission==='rejected')return;
    const ledger=new (this.env.PRIVATE_READER==='1'||production(this.env)?ReaderLedger:UsageLedger)(this.env.LEDGER,this.env);
    // Pending admission may expire/cancel before a debit, or after a committed
    // debit whose response was lost. Serialized admission prevents a late debit.
    if(this.job.admission==='pending'&&!await ledger.receipt(this.job.id,this.job.owner))return;
    this.phase='settlement';
    await ledger.settle(this.job);
    this.job.settlementDone=true;await this.save(this.job);
  }
  async admit(){
    if(!this.job||Date.now()>=this.job.expires||this.cachedStage()||!this.env.LEDGER||this.job.admission!=='pending'||this.job.state!=='preparing')return;
    await admitJob(this.job,{ledger:new (this.env.PRIVATE_READER==='1'||production(this.env)?ReaderLedger:UsageLedger)(this.env.LEDGER,this.env),save:j=>this.save(j),afterReserve:async()=>{
      if(this.job.proofAdmissionFault==='after-reserve'){
        this.job.proofAdmissionFault='';await this.save(this.job);
        throw Error('Synthetic lost reservation response');
      }
    }});
  }
  async finish(){
    await this.settle();if(this.job.state==='cancelled'&&!await this.clean()){await this.ctx.storage.setAlarm(Date.now()+1000);return;}
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
    this.phase='cleanup';
    const start=this.job.cleanupOffset||0;
    if(start>=keys.length)return true;
    await this.env.AUDIO.delete(keys.slice(start,start+100));
    this.job.cleanupOffset=Math.min(start+100,keys.length);await this.save(this.job);
    return this.job.cleanupOffset===keys.length;
  }
  async alarm(){
    if(this.env.BACKGROUND_WORK_PAUSED==='1'){await this.ctx.storage.setAlarm(Date.now()+86400000);return;}
    try{
      if(this.retired(await this.ctx.storage.get('job'))){await this.ctx.storage.deleteAlarm();return;}
      const recovery=await this.ctx.storage.get('recovery');
      if(recovery?.next===null)return;
      if(recovery?.next>Date.now()){await this.ctx.storage.setAlarm(recovery.next);return;}
      this.phase='load';await this.load();
      await this.runAlarm();
      if(recovery)await this.ctx.storage.delete('recovery');
    }catch(error){await this.recover(error);}
  }
  async runAlarm(){
    // Catch inside the concurrency gate: rejecting it resets the object.
    let admissionError;
    await this.ctx.blockConcurrencyWhile(async()=>{
      try{this.phase='admission';await this.admit();}catch(error){admissionError=error;}
    });
    if(admissionError)throw admissionError;
    const job=this.job;if(!job)return;
    if(job.state==='preparing'&&job.admission==='pending'&&Date.now()<job.expires)return;
    if(job.state==='expired'&&!job.owner)return;
    if(Date.now()>=job.expires){
      if(job.state==='preparing')job.state='expired';
      await this.settle();
      if(!await this.clean()){await this.ctx.storage.setAlarm(Date.now()+1000);return;}
      // Publish the tombstone in memory only after durable commit succeeds.
      const tombstone={...job,state:'expired',chunks:[],parts:[],owner:''};
      await this.save(tombstone);this.job=tombstone;return;
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
      await prepareJob(job,{maxBatches:1,concurrency:job.mseOptions?.concurrency||3,publishEach:!!job.mseOptions,stagingLive:progressiveReader(this.env),beforeBatch:()=>this.env.LEDGER&&!this.cachedStage()?new (this.env.PRIVATE_READER==='1'||production(this.env)?ReaderLedger:UsageLedger)(this.env.LEDGER,this.env).assertOpen(job.id,job.owner):Promise.resolve(),save:j=>this.save(j),store:this.env.AUDIO,isCancelled:()=>job.state==='cancelled',
        speech:async(text,voice,index)=>{
          if(job.mode==='live'){
            if(this.env.ENABLE_LIVE_SYNTHESIS!=='1')throw Error('Synthesis paused');
            if(publicMode(this.env)){
              if(!customerAllowed(this.env,await new ReaderLedger(this.env.LEDGER,this.env).account(job.owner)))throw Error('Account disabled');
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
  async maintenance({action,probe,id}){
    if(probe){
      if(!mseStaging(this.env)||!['ready','cancel','expire'].includes(probe)||!/^[a-f0-9-]{36}$/.test(id))return json({attention:true,code:'probe_forbidden'},403);
      try{
        await this.load();
        if(!this.job){
          this.job=newJob({voice:'en-US-Wavenet-F',chunks:fixtureChunks('en-US-Wavenet-F'),mode:'staging-fixture'},'maintenance-probe',id);
          this.job.mseOptions={delivery:'mse',concurrency:3,cached:true,scenario:'normal'};
          this.job.probeKind=probe;await this.save(this.job);
        }
        if(this.job.probeDone)return json(this.job.probeDone);
        if(this.job.probeKind!==probe||this.job.owner!=='maintenance-probe'||!this.cachedStage())return json({attention:true,code:'probe_mismatch'});
        await this.runAlarm();
        if(probe==='cancel'&&this.job.state==='preparing'){this.job.state='cancelled';await this.save(this.job);await this.finish();}
        if(this.job.state==='failed')return json({attention:true,code:'probe_failed'});
        if(this.job.state==='preparing')return json({done:false,probe,state:'preparing'});
        if(probe==='cancel'){await this.ctx.storage.deleteAlarm();this.job.probeDone={done:true,probe,state:this.job.state};await this.save(this.job);return json(this.job.probeDone);}
        const audio=await this.env.AUDIO.head(id+'/reading.mp3'),captions=await this.env.AUDIO.head(id+'/reading.vtt');
        if(!audio?.size||!captions?.size)return json({attention:true,code:'probe_artifacts_missing'});
        if(probe==='expire'){this.job.expires=Date.now()-1;await this.save(this.job);await this.runAlarm();}
        await this.ctx.storage.deleteAlarm();
        this.job.probeDone={done:true,probe,state:this.job.state,audioBytes:audio.size};await this.save(this.job);return json(this.job.probeDone);
      }catch(error){return json({attention:true,code:error.name||'Error'});}
    }
    try{
      const meta=await this.ctx.storage.get('job');
      if(action==='inspect'){
        let code=null;try{await this.load();}catch(error){code=error.message==='Missing durable reading page'?'missing_page':error.name;}
        return json({state:meta?.state||'missing',admission:meta?.admission||null,expires:meta?.expires||null,pageCount:meta?.pageCount||0,cleanupOffset:meta?.cleanupOffset||0,partsCount:this.job?.parts?.length??null,assembledBlocks:meta?.assembledBlocks||0,code,recovery:await this.ctx.storage.get('recovery')||null});
      }
      if(action!=='retire')return json({detail:'Unsupported maintenance action'},400);
      await this.ctx.storage.deleteAlarm();
      if(!meta){return json({done:true,state:'empty'});}
      if(!meta.id||!/^[a-f0-9-]{36}$/.test(meta.id))return json({done:false,attention:true,code:'invalid_job_id'});
      if(this.env.LEDGER){
        const ledger=new ReaderLedger(this.env.LEDGER,this.env),receipt=await ledger.receipt(meta.id,meta.owner);
        if(receipt?.state==='open'){
          await this.load();
          if(this.job.parts.some(part=>part.state==='submitting'))return json({done:false,attention:true,code:'uncertain_speech'});
          if(this.job.state==='preparing')this.job.state='cancelled';
          await this.settle();
        }
      }
      const listed=await this.env.AUDIO.list({prefix:meta.id+'/',limit:100});
      if(listed.objects.length)await this.env.AUDIO.delete(listed.objects.map(object=>object.key));
      if(listed.truncated)return json({done:false});
      const tombstone={id:meta.id,state:'expired',owner:'',chunks:[],parts:[],created:meta.created,expires:meta.expires,retired:true};
      await this.save(tombstone);this.job=tombstone;this.loaded=true;
      await this.ctx.storage.delete('recovery');await this.ctx.storage.deleteAlarm();
      return json({done:true,state:'retired'});
    }catch(error){return json({done:false,attention:true,code:error?.name||'Error',message:String(error.message).slice(0,200)});}
  }
  async fetch(request){
    if(new URL(request.url).pathname==='/maintenance')return this.maintenance(await request.json());
    if(this.env.BACKGROUND_WORK_PAUSED==='1')return json({detail:'Reading is temporarily paused for maintenance.'},503);
    if(this.retired(await this.ctx.storage.get('job')))return json({detail:'This old test reading has been retired.'},410);
    const recovery=await this.ctx.storage.get('recovery');
    if(recovery)return json({detail:'Reading recovery needs attention.'},503);
    try{await this.load();}catch(error){await this.recover(error);return json({detail:'Reading recovery needs attention.'},503);}
    const url=new URL(request.url),owner=request.headers.get('X-Proof-Owner');
    if(url.pathname==='/create')return this.ctx.blockConcurrencyWhile(async()=>{
      const input=await request.json();
      if(this.job){
        if(this.job.owner!==owner)return json({detail:'Reading not found'},404);
        if(this.job.voice!==input.voice||this.job.mode!==input.mode||(this.job.proofScenario||'')!==(input.proofScenario||'')||JSON.stringify(this.job.chunks)!==JSON.stringify(input.chunks)||JSON.stringify(this.job.mseOptions||null)!==JSON.stringify(input.mseOptions||null))return json({detail:'Request does not match existing reading'},409);
        if(Date.now()>=this.job.expires)return json({detail:'Reading expired'},410);
        // Only an unpaid, untouched credit rejection may re-enter admission.
        // Matching owner/body and expiry were checked above; the same ID is reused.
        if(this.env.LEDGER&&this.job.state==='failed'&&this.job.admission==='rejected'&&this.job.errorStatus===402&&!this.job.attempts&&!this.job.submittedCharacters&&this.job.parts.every(part=>part.state==='pending')&&!await new UsageLedger(this.env.LEDGER,this.env).receipt(this.job.id,owner)){
          this.job.admission='pending';this.job.state='preparing';this.job.error='';this.job.settlementDone=false;
          await this.save(this.job,Date.now()+1);
        }
        try{await this.admit();}catch(error){await this.recover(error);return json({detail:'Admission will recover automatically'},503);}
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
      this.job=newJob(input,owner,input.id);this.loaded=true;
      if(input.mseOptions)this.job.mseOptions=input.mseOptions;
      this.job.proofScenario=input.proofScenario||'';
      if(this.env.LEDGER&&!this.cachedStage()){this.job.admission='pending';this.job.proofAdmissionFault=input.proofAdmissionFault||'';}
      await this.save(this.job,Date.now()+(input.proofAdmissionFault?5000:1));
      if(this.job.proofAdmissionFault==='after-intent'){
        this.job.proofAdmissionFault='';await this.save(this.job);
        return json({detail:'Synthetic interrupted admission'},503);
      }
      try{await this.admit();}catch(error){await this.recover(error);return json({detail:'Admission will recover automatically'},503);}
      if(this.job.admission==='rejected')return json({detail:this.job.error},this.job.errorStatus||402);
      return json({id:this.job.id},201);
    });
    const job=this.job;
    if(!job||job.owner!==owner||Date.now()>=job.expires||['cancelled','expired'].includes(job.state))return json({detail:'Reading not found'},404);
    if(request.method==='DELETE'){
      job.state='cancelled';await this.save(job);if(!this.running){try{await this.finish();}catch(error){await this.recover(error);}}else await this.ctx.storage.setAlarm(job.expires);
      return new Response(null,{status:204});
    }
    if(!this.running&&job.state!=='preparing'&&!job.settlementDone){try{await this.settle();}catch(error){await this.recover(error);return json({detail:'Reading settlement is recovering.'},503);}}
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
