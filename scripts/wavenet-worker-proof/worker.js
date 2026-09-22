import {EmailIdentity,normalizeEmail} from '../../cloudflare/prepared/identity.js';
import {UsageLedger,CreditError,digest} from '../../cloudflare/prepared/ledger.js';
import {accessToken,readBounded} from '../../cloudflare/prepared/google.js';
import fixtures from './fixture.json';
const DEFAULT_ORIGIN='http://127.0.0.1:8788';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const textDecoder=new TextDecoder();
const cookieOwner=request=>request.headers.get('cookie')?.match(/(?:^|;\s*)p2s_worker_proof=([a-f0-9-]{36,72})(?:;|$)/)?.[1];
const inputJSON=async(request,limit=32000)=>JSON.parse(textDecoder.decode(await readBounded(request,limit)));

export {PreparedReading} from '../../cloudflare/prepared/durable.js';

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
    if(ledger&&url.pathname==='/api/logout'&&request.method==='POST'){await ledger.logout(token);const response=json({},200,{'Set-Cookie':'p2s_worker_proof=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});response.headers.append('Set-Cookie','p2s_login_flow=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return response;}
    if(ledger&&url.pathname==='/api/billing/login/request'&&request.method==='POST'){
      const email=normalizeEmail((await inputJSON(request)).email);
      if(!email.endsWith('@example.invalid'))return json({detail:'Use an example.invalid address in this local email test'},422);
      const auth=new EmailIdentity(env.LEDGER),link=await auth.request(email,owner,'local');
      try{await env.AUDIO.put(`mail/${await digest(link.flow)}`,JSON.stringify({url:ORIGIN+'/api/billing/signin#'+link.token,expires:Date.now()+900000}));}
      catch{await auth.cancel(link.token);return json({detail:'Simulated delivery failed'},503);}
      return json({sent:true,simulated:true},200,{'Set-Cookie':`p2s_login_flow=${link.flow}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900`});
    }
    const flow=request.headers.get('cookie')?.match(/(?:^|;\s*)p2s_login_flow=([a-f0-9-]{72})(?:;|$)/)?.[1];
    if(ledger&&url.pathname==='/api/test-mail'&&request.method==='GET'){
      const object=flow?await env.AUDIO.get(`mail/${await digest(flow)}`):null;
      if(!object)return json({},404);const mail=await object.json();
      if(mail.expires<=Date.now())return json({},404);return json({url:mail.url,simulated:true});
    }
    if(ledger&&url.pathname==='/api/billing/login/confirm'&&request.method==='POST'){
      const session=await new EmailIdentity(env.LEDGER).confirm((await inputJSON(request)).token,flow);
      if(flow)await env.AUDIO.delete(`mail/${await digest(flow)}`).catch(()=>{});
      const response=json({signedIn:true});
      response.headers.append('Set-Cookie',`p2s_worker_proof=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
      response.headers.append('Set-Cookie','p2s_login_flow=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return response;
    }
    if(ledger&&request.method==='GET'&&url.pathname.startsWith('/api/billing')){
      const assets={'/api/billing':'account.html','/api/billing/account.js':'account.js','/api/billing/signin':'signin.html','/api/billing/signin.js':'signin.js','/api/billing/signin.css':'signin.css'};
      if(assets[url.pathname]){
        const asset=await env.ASSETS.fetch(new Request('http://assets/'+assets[url.pathname]));
        const headers=new Headers(asset.headers);headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');
        headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        return new Response(asset.body,{status:asset.status,headers});
      }
    }
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
