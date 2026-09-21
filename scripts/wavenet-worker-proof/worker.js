import {newJob,prepareJob,publicStatus,canRetryAuthorization} from '../../cloudflare/prepared/job.js';
import {accessToken,synthesize,readBounded} from '../../cloudflare/prepared/google.js';
import fixtures from './fixture.json';
const ORIGIN='http://127.0.0.1:8788';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const textDecoder=new TextDecoder();
const cookieOwner=request=>request.headers.get('cookie')?.match(/(?:^|;\s*)p2s_worker_proof=([a-f0-9-]{36})(?:;|$)/)?.[1];
const inputJSON=async(request,limit=32000)=>JSON.parse(textDecoder.decode(await readBounded(request,limit)));

export class PreparedReading {
  constructor(ctx,env){this.ctx=ctx;this.env=env;ctx.blockConcurrencyWhile(async()=>{this.job=await ctx.storage.get('job');});}
  async save(job){await this.ctx.storage.put('job',job);}
  async clean(){
    if(!this.job)return;
    await this.env.AUDIO.delete([...this.job.parts.map((_,i)=>`${this.job.id}/part-${i}`),`${this.job.id}/reading.mp3`,`${this.job.id}/reading.vtt`]);
  }
  async alarm(){
    const job=this.job;if(!job)return;
    if(Date.now()>=job.expires){
      job.state='expired';await this.save(job);await this.clean();
      // Keep only an attempt tombstone, so the bounded live ID cannot be reused.
      job.chunks=[];job.parts=[];job.owner='';await this.save(job);return;
    }
    if(job.state!=='preparing')return;
    try {
      // Do not obtain new credentials if a prior paid call is uncertain.
      let token;
      if(job.mode==='live' && !job.parts.some(p=>p.state==='submitting'))token=await accessToken(this.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      await prepareJob(job,{save:j=>this.save(j),store:this.env.AUDIO,isCancelled:()=>job.state==='cancelled',
        speech:async(text,voice,index)=>{
          if(job.mode==='live')return synthesize(text,voice,token);
          const fixture=fixtures[voice][index];
          await new Promise(resolve=>setTimeout(resolve,fixture.delayMs));
          const response=await this.env.ASSETS.fetch(new Request(`http://assets/samples/${fixture.file}`));
          if(!response.ok)throw Error('Missing fixture');return new Uint8Array(await response.arrayBuffer());
        }});
    }catch(error){if(job.state!=='cancelled'){job.state='failed';job.error=error.message.startsWith('Google authorization failed')?error.message:'Preparation interrupted. No automatic retry.';job.costIncomplete=true;await this.save(job);}}
    finally{if(job.state==='cancelled')await this.clean();await this.ctx.storage.setAlarm(job.expires);}
  }
  async fetch(request){
    const url=new URL(request.url),owner=request.headers.get('X-Proof-Owner');
    if(url.pathname==='/create'){
      const input=await request.json();
      if(this.job){
        if(this.job.owner!==owner)return json({detail:'Reading not found'},404);
        if(this.job.voice!==input.voice||JSON.stringify(this.job.chunks)!==JSON.stringify(input.chunks))return json({detail:'Request does not match existing reading'},409);
        // An explicit new create may retry authorization once, but only if the
        // durable audit proves no speech request was ever attempted.
        if(canRetryAuthorization(this.job)){
          this.job.authorizationRestarts=(this.job.authorizationRestarts||0)+1;
          this.job.state='preparing';this.job.error='';this.job.costIncomplete=false;this.job.created=Date.now();
          await this.ctx.storage.transaction(async transaction=>{await transaction.put('job',this.job);await transaction.setAlarm(Date.now()+1);});
        }
        return json({id:this.job.id,reused:true});
      }
      // Durable state and the alarm are committed together before acknowledging.
      this.job=newJob(input,owner,input.id);
      await this.ctx.storage.transaction(async transaction=>{await transaction.put('job',this.job);await transaction.setAlarm(Date.now()+1);});
      return json({id:this.job.id},201);
    }
    const job=this.job;
    if(!job||job.owner!==owner||Date.now()>=job.expires||['cancelled','expired'].includes(job.state))return json({detail:'Reading not found'},404);
    if(request.method==='DELETE'){
      job.state='cancelled';await this.save(job);await this.clean();await this.ctx.storage.setAlarm(job.expires);
      return new Response(null,{status:204});
    }
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
  const url=new URL(request.url);
  // This pilot is deliberately unusable on public hosts, even if deployed by mistake.
  if(env.LOCAL_PROOF!=='1'||url.origin!==ORIGIN)return json({detail:'Local proof only'},403);
  if(['POST','DELETE'].includes(request.method)&&request.headers.get('Origin')!==ORIGIN)return json({detail:'Origin rejected'},403);
  const owner=cookieOwner(request);
  try {
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
      const id=mode==='live'?`live-${input.voice}-baseline-1`:crypto.randomUUID();
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
    if(!owner&&url.pathname==='/')headers.set('Set-Cookie',`p2s_worker_proof=${crypto.randomUUID()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    return new Response(response.body,{status:response.status,headers});
  }catch{return json({detail:'Private preparation request failed'},500);}
}};
