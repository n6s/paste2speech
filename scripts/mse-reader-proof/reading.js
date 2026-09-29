import {PreparedReading} from '../../cloudflare/prepared/durable.js';
import {newJob,prepareJob} from '../../cloudflare/prepared/job.js';
import {saveJob} from '../../cloudflare/prepared/storage.js';
import fixtures from '../wavenet-worker-proof/fixture.json';

import {options,texts,delayFor,status} from './model.js';
const json=(value,code=200)=>Response.json(value,{status:code,headers:{'Cache-Control':'no-store'}});

export class MseReading extends PreparedReading {
  // Snapshot at enqueue time: concurrent section completions cannot overwrite
  // one another or let cancellation be replaced by an earlier state write.
  save(job,alarm){
    const snapshot=structuredClone(job);
    const next=(this.saving||Promise.resolve()).then(()=>saveJob(this.ctx.storage,snapshot,alarm));
    this.saving=next.catch(()=>{});
    return next;
  }
  async alarm(){
    const job=this.job;if(!job)return;
    if(this.env.MSE_LOCAL_PROOF!=='1'||this.env.ENABLE_LIVE_SYNTHESIS!=='0')return;
    if(Date.now()>=job.expires || ['cancelled','expired'].includes(job.state)){
      job.state='expired';await this.save(job);
      if(!await this.clean())await this.ctx.storage.setAlarm(Date.now()+100);
      return;
    }
    if(job.state!=='preparing'||this.running)return;
    this.running=true;
    await this.ctx.storage.setAlarm(Date.now()+60000);
    try {
      await prepareJob(job,{save:j=>this.save(j),store:this.env.AUDIO,
        isCancelled:()=>job.state==='cancelled',maxBatches:1,concurrency:job.concurrency,publishEach:true,
        speech:async(_text,voice,index)=>{
          await new Promise(resolve=>setTimeout(resolve,delayFor(job,index)));
          if(job.scenario==='failure'&&index===1)throw Error('Synthetic section failure');
          const file=fixtures[voice][index%8].file;
          const response=await this.env.ASSETS.fetch(new Request(`http://assets/samples/${file}`));
          if(!response.ok)throw Error('Missing cached audio');
          return new Uint8Array(await response.arrayBuffer());
        }});
    }catch{
      if(job.state!=='cancelled'){job.state='failed';job.error='Local preparation failed';await this.save(job);}
    }finally{
      this.running=false;
      await this.ctx.storage.setAlarm(job.state==='preparing'||job.state==='cancelled'?Date.now()+100:job.expires);
    }
  }
  async fetch(request){
    const url=new URL(request.url),owner=request.headers.get('X-Proof-Owner');
    if(!owner)return json({detail:'Session required'},401);
    if(url.pathname==='/create')return this.ctx.blockConcurrencyWhile(async()=>{
      if(this.job)return json({detail:'Reading already exists'},409);
      const input=options(await request.json()),id=request.headers.get('X-Reading-Id');
      this.job={...newJob({voice:input.voice,chunks:texts(input),mode:'cached'},owner,id),...input};
      await this.save(this.job,Date.now()+100);
      return json({id,texts:this.job.chunks},201);
    });
    const job=this.job;
    if(!job||job.owner!==owner)return json({detail:'Reading not found'},404);
    if(Date.now()>=job.expires||['cancelled','expired'].includes(job.state))return json({detail:'Reading no longer available'},410);
    if(request.method==='DELETE'){
      job.state='cancelled';await this.save(job,Date.now()+100);return new Response(null,{status:204});
    }
    if(url.pathname==='/status')return json(status(job));
    const match=/^\/sections\/(0|[1-9]\d*)$/.exec(url.pathname);
    if(match){
      const index=Number(match[1]);
      if(index>=job.parts.length)return json({detail:'Section not found'},404);
      if(job.state==='failed')return json({detail:'Preparation failed'},422);
      if(job.parts[index].state!=='ready')return json({detail:'Section pending'},409);
      const object=await this.env.AUDIO.get(`${job.id}/part-${index}`);
      if(!object)return json({detail:'Stored section missing'},404);
      return new Response(object.body,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(object.size),'Cache-Control':'no-store'}});
    }
    if(!['/audio','/download/mp3','/download/vtt'].includes(url.pathname))return json({},404);
    return super.fetch(request);
  }
}
