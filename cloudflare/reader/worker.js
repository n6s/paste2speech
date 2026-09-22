import {privateAccess} from './access.js';
import {ReaderLedger} from './ledger.js';
import {EmailIdentity} from '../prepared/identity.js';
import {CreditError,digest,sourceCounts} from '../prepared/ledger.js';
import {validateInput} from '../prepared/job.js';
import {readBounded} from '../prepared/google.js';
import {sendLink} from './providers.js';
import fixtures from '../../scripts/wavenet-worker-proof/fixture.json';
export {PreparedReading} from '../prepared/durable.js';
export {PaymentCoordinator} from './payments-do.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const cookie=(request,name)=>request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const body=async(request,limit=120000)=>{try{return JSON.parse(new TextDecoder().decode(await readBounded(request,limit)));}catch{throw new CreditError('Invalid or oversized request.',422);}};
function setCookie(response,env,name,value,age){response.headers.append('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${env.LOCAL_READER==='1'?'':'; Secure'}`);}
async function asset(request,env,path){
 const url=new URL(request.url);url.pathname=path;const response=await env.ASSETS.fetch(new Request(url,{method:request.method}));
 const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');
 headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.paddle.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.paddle.com; frame-src https://*.paddle.com; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 if(path.startsWith('/signin'))headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 return new Response(response.body,{status:response.status,headers});
}
export default {
 async scheduled(_event,env){if(env.ENABLE_PAYMENTS==='1'&&env.LOCAL_READER!=='1')await env.PAYMENTS.get(env.PAYMENTS.idFromName('coordinator')).fetch('https://payments/wake',{method:'POST',body:JSON.stringify({action:'wake'})});},
 async fetch(request,env){
  if(!await privateAccess(request,env))return json({detail:'Private reader access required.'},403);
  const url=new URL(request.url),local=env.LOCAL_READER==='1';
  if(!['GET','HEAD','POST','DELETE'].includes(request.method))return json({},405);
  if(['POST','DELETE'].includes(request.method)&&request.headers.get('Origin')!==url.origin)return json({detail:'Origin rejected.'},403);
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return json({detail:'Open the private reader directly.'},403);
  try{
   const ledger=new ReaderLedger(env.LEDGER),token=cookie(request,'p2s_private_reader')||cookie(request,'p2s_sandbox'),session=await ledger.session(token),account=session?await ledger.account(session.id):null;
   const owner=account?.id,flow=cookie(request,'p2s_login_flow'),path=url.pathname;
   if(path==='/api/billing/session'&&request.method==='POST'){
    const response=json({ready:true});if(!owner)setCookie(response,env,'p2s_private_reader',await ledger.newAccount(),2592000);return response;
   }
   if(path==='/api/billing/status'&&request.method==='GET'){
    const configured=!local&&env.ENABLE_PAYMENTS==='1'&&!!env.PADDLE_API_KEY&&env.PADDLE_CLIENT_TOKEN?.startsWith('test_');
    const rows=await ledger.query("SELECT COALESCE(SUM(u.characters),0) AS characters FROM usage u JOIN reservations r ON r.job=u.job WHERE r.account=?",owner||'').first();
    return json({emailConfigured:local||env.ENABLE_EMAIL==='1',email:account?.email||null,sandbox:true,configured,clientToken:configured?env.PADDLE_CLIENT_TOKEN:'',packCharacters:1000000,priceUSD:10,account,pendingOrder:owner?await ledger.pendingOrder(owner):null,paymentStatus:owner?await ledger.paymentStatus(owner):null,month:new Date().toISOString().slice(0,7),usage:await ledger.summary(new Date().toISOString().slice(0,7)),successfulCharacters:rows.characters,local});
   }
   if(path==='/api/billing/login/request'&&request.method==='POST'){
    const input=await body(request,2048),auth=new EmailIdentity(env.LEDGER);
    if(local&&!input.email?.endsWith('@example.invalid'))throw new CreditError('Use an example.invalid address for local testing.',422);
    if(!local&&env.ENABLE_EMAIL!=='1')throw new CreditError('Email delivery is disabled. Your credit is safe.',503);
    const link=await auth.request(input.email,owner,request.headers.get('CF-Connecting-IP')||'local');
    try{
     if(local)await env.AUDIO.put(`mail/${await digest(link.flow)}`,JSON.stringify({url:url.origin+'/api/billing/signin#'+link.token,expires:Date.now()+900000}));
     else await sendLink(env,link);
    }catch{await auth.cancel(link.token);throw new CreditError('The sign-in email could not be sent. Please try again later.',503);}
    const response=json({sent:true});setCookie(response,env,'p2s_login_flow',link.flow,900);return response;
   }
   if(local&&path==='/api/test-mail'&&request.method==='GET'){
    const object=flow?await env.AUDIO.get(`mail/${await digest(flow)}`):null;if(!object)return json({},404);
    const mail=await object.json();return mail.expires>Date.now()?json(mail):json({},404);
   }
   if(path==='/api/billing/login/confirm'&&request.method==='POST'){
    const issued=await new EmailIdentity(env.LEDGER).confirm((await body(request,2048)).token,flow);
    if(local&&flow)await env.AUDIO.delete(`mail/${await digest(flow)}`).catch(()=>{});
    const response=json({signedIn:true});setCookie(response,env,'p2s_private_reader',issued,2592000);setCookie(response,env,'p2s_login_flow','',0);return response;
   }
   if(path==='/api/billing/logout'&&request.method==='POST'){
    await ledger.logout(token);const response=json({signedOut:true});setCookie(response,env,'p2s_private_reader','',0);setCookie(response,env,'p2s_sandbox','',0);setCookie(response,env,'p2s_login_flow','',0);return response;
   }
   if(path==='/api/billing/mode'&&request.method==='POST'){
    if(!owner)return json({},401);const input=await body(request,2048);if(Object.keys(input).length!==1||typeof input.enabled!=='boolean')return json({},422);
    await ledger.enable(owner,input.enabled);return json({enabled:input.enabled});
   }
   if(['/api/billing/order','/api/billing/reconcile'].includes(path)&&request.method==='POST'){
    if(!owner)return json({},401);if(local||env.ENABLE_PAYMENTS!=='1')throw new CreditError('Sandbox checkout is disabled.',503);
    const input=await body(request,2048);return env.PAYMENTS.get(env.PAYMENTS.idFromName('coordinator')).fetch('https://payments/',{method:'POST',body:JSON.stringify({action:path.endsWith('/order')?'order':'reconcile',account:owner,id:input.order})});
   }
   if(path==='/api/reader'&&request.method==='GET')return json({local,liveEnabled:!local&&env.ENABLE_LIVE_SYNTHESIS==='1',fixtures:local?fixtures:undefined});
   if(path==='/api/readings'&&request.method==='POST'){
    if(!owner)return json({detail:'Open your account to start a session.'},401);
    let input=await body(request);try{input=validateInput(input);}catch(error){throw new CreditError(error.message,422);}
    const id=request.headers.get('Idempotency-Key');if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id||''))throw new CreditError('A UUID request key is required.',422);
    if(local){if(JSON.stringify(input.chunks)!==JSON.stringify(fixtures[input.voice].map(s=>s.text)))throw new CreditError('Local mode uses the cached sample only.',422);}
    else {
     if(env.ENABLE_LIVE_SYNTHESIS!=='1')throw new CreditError('Speech generation is disabled.',503);
     // Lifetime budget is deliberately never replenished automatically. Failed
     // or cancelled admissions consume budget too, bounding uncertain charges.
     const maximum=Number(env.MAX_LIFETIME_CHARACTERS);if(!Number.isSafeInteger(maximum)||maximum<1||maximum>100000)throw new CreditError('Private speech budget is not configured.',503);
     await ledger.query("INSERT OR IGNORE INTO speech_budget VALUES('private-lifetime',0,?)",maximum).run();
     try{const fingerprint=await digest(JSON.stringify({owner,...input}));await ledger.query('INSERT INTO speech_admissions(job,characters,fingerprint) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM speech_admissions WHERE job=?)',id,sourceCounts(input.chunks).reduce((a,b)=>a+b,0),fingerprint,id).run();const admission=await ledger.query('SELECT fingerprint FROM speech_admissions WHERE job=?',id).first();if(admission.fingerprint!==fingerprint)throw Error('Request mismatch');}catch{throw new CreditError('Private speech budget reached. Generation is paused.',429);}
    }
    return env.JOBS.get(env.JOBS.idFromName(id)).fetch('https://job/create',{method:'POST',headers:{'X-Proof-Owner':owner},body:JSON.stringify({...input,id,mode:local?'fixture':'live'})});
   }
   const match=path.match(/^\/api\/readings\/([a-f0-9-]{36})(\/audio|\/download\/(?:mp3|vtt))?$/);
   if(match){
    if(!owner)return json({},404);if(!['GET','HEAD','DELETE'].includes(request.method)||request.method==='DELETE'&&match[2])return json({},405);
    return env.JOBS.get(env.JOBS.idFromName(match[1])).fetch('https://job'+(match[2]||'/status'),{method:request.method,headers:{'X-Proof-Owner':owner,...(request.headers.has('Range')?{Range:request.headers.get('Range')}:{})}});
   }
   const assets={'/':'/index.html','/api/billing':'/billing.html','/api/billing/app.js':'/billing.js','/api/billing/signin':'/signin.html','/api/billing/signin.js':'/signin.js','/api/billing/signin.css':'/signin.css'};
   if(['GET','HEAD'].includes(request.method)&&(!path.startsWith('/api/')||assets[path]))return asset(request,env,assets[path]||path);
   return json({},404);
  }catch(error){return error instanceof CreditError?json({detail:error.message},error.status):json({detail:'Private reader request failed. No automatic retry.'},500);}
 }
};
