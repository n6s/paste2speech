import {documentOcrResponse,purgeOcrCache} from './document-ocr.js';
import {WAVENET_VOICE_IDS} from '../../public/wavenet-voices.js';
import {ownerResponse} from './owner-dashboard.js';
import {legacyDomainResponse,legacyStagingResponse} from './legacy-domain.js';
import {runMaintenance} from './maintenance.js';
import {production,trialMode,publicMode,verifiedCustomer,customerAllowed,paymentConfig} from './modes.js';
import {mseStaging,progressiveReader,stagingInput,fixtureChunks} from './mse-staging.js';
import {capacity,recordOperations} from './budget.js';
import {receiveWebhook} from './webhooks.js';
import publicWorker from '../worker.js';
import {privateAccess,allowedRequestSource} from './access.js';
import {ReaderLedger} from './ledger.js';
import {EmailIdentity} from '../prepared/identity.js';
import {CreditError,digest,sourceCounts} from '../prepared/ledger.js';
import {validateInput} from '../prepared/job.js';
import {readBounded} from '../prepared/google.js';
import {sendLink} from './providers.js';
import fixtures from '../../scripts/wavenet-worker-proof/fixture.json';
export {PreparedReading} from '../prepared/durable.js';
export {PaymentCoordinator} from './payments-do.js';
const approved=(env,account)=>!!account && account.email===env.TRIAL_EMAIL && account.enabled===1 && !account.legacyPilot;
const feedbackEnv=env=>production(env)?env:{...env,DB:env.LEDGER,FEEDBACK_DELIVERY_MODE:'review'};
async function rateLimit(env,name,request){
 const binding=env[name];
 if(!binding || !(await binding.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'})).success)throw new CreditError('Too many requests. Please try again later.',429);
}
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const cookie=(request,name)=>request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const body=async(request,limit=120000)=>{try{return JSON.parse(new TextDecoder().decode(await readBounded(request,limit)));}catch{throw new CreditError('Invalid or oversized request.',422);}};
function setCookie(response,env,name,value,age){response.headers.append('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${env.LOCAL_READER==='1'?'':'; Secure'}`);}
async function asset(request,env,path){
 const url=new URL(request.url);url.pathname=path;const response=await env.ASSETS.fetch(new Request(url,{method:request.method}));
 const headers=new Headers(response.headers);if(!production(env)||['/billing.html','/signin.html','/release.json'].includes(path))headers.set('X-Robots-Tag','noindex, nofollow');if(['/terms','/pricing'].includes(path))headers.set('Content-Type','text/html; charset=utf-8');headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');
 headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.paddle.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.paddle.com; frame-src https://*.paddle.com; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 if(trialMode(env))headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 if(env.VIDEO_DOWNLOAD==='1')headers.set('Content-Security-Policy',headers.get('Content-Security-Policy').replace("script-src 'self'","script-src 'self' 'wasm-unsafe-eval'").replace("connect-src 'self'","connect-src 'self' blob:"));
 if(path.startsWith('/signin'))headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 return new Response(response.body,{status:response.status,headers});
}
export default {
 async scheduled(_event,env,ctx){await runMaintenance(env);await purgeOcrCache(env);if(env.BACKGROUND_WORK_PAUSED==='1')return;if(publicMode(env))ctx.waitUntil(recordOperations(env));if(production(env)||(new Date(_event.scheduledTime).getUTCHours()===0&&new Date(_event.scheduledTime).getUTCMinutes()===0))await publicWorker.scheduled(_event,feedbackEnv(env),ctx);if(!trialMode(env)&&env.LOCAL_READER!=='1')await env.PAYMENTS.get(env.PAYMENTS.idFromName('coordinator')).fetch('https://payments/wake',{method:'POST',body:JSON.stringify({action:'wake'})});},
 async fetch(request,env,ctx){
  if(env.READER_MODE==='staging'&&env.LOCAL_READER!=='1'&&env.READER_ORIGIN==='https://staging.pastetospeech.com'&&new URL(request.url).origin==='https://speak-staging.rogerpbrown.com'){
   if(!await privateAccess(request,{...env,READER_ORIGIN:'https://speak-staging.rogerpbrown.com'}))return json({detail:'Private reader access required.'},403);
   return legacyStagingResponse(request);
  }
  const moved=production(env)&&legacyDomainResponse(request);
  if(moved)return moved;
  if(production(env) ? env.LOCAL_READER==='1'||new URL(request.url).origin!==env.READER_ORIGIN||new URL(request.url).protocol!=='https:' : !await privateAccess(request,env))return json({detail:'Private reader access required.'},403);
  const url=new URL(request.url),local=env.LOCAL_READER==='1';
  if(env.BACKGROUND_WORK_PAUSED==='1'&&url.pathname.startsWith('/api/'))return json({detail:'The reader is temporarily paused for maintenance. Please try again later.'},503);
  if(!['GET','HEAD','POST','DELETE'].includes(request.method))return json({},405);
  if(url.pathname==='/api/billing/webhook'&&request.method==='POST'&&publicMode(env))return receiveWebhook(request,env,ctx);
  if(!allowedRequestSource(request))return json({detail:'Open the reader directly.'},403);
  try{
   if(['/api/events','/api/feedback','/api/feedback-ticket'].includes(url.pathname))return publicWorker.handle(request,{...feedbackEnv(env),PUBLIC_ORIGIN:url.origin},ctx);
   const token=cookie(request,'p2s_private_reader')||cookie(request,'p2s_sandbox');
   if(['/api/ocr','/api/ocr/config','/api/ocr/status','/api/ocr/result','/api/ocr/retry'].includes(url.pathname))return await documentOcrResponse(request,env,{token});
   if(url.pathname==='/api/owner'||url.pathname.startsWith('/api/owner/'))return await ownerResponse(request,env,token);
   const ledger=new ReaderLedger(env.LEDGER),session=await ledger.session(token),account=session?await ledger.account(session.id):null;
   const owner=account?.id,flow=cookie(request,'p2s_login_flow'),path=url.pathname;
   if(path==='/api/billing/session'&&request.method==='POST'){
    if(production(env)&&!owner)await rateLimit(env,'ACCOUNT_LIMIT',request);
    const response=json({ready:true});if(!owner)setCookie(response,env,'p2s_private_reader',await ledger.newAccount(),2592000);return response;
   }
   if(path==='/api/billing/status'&&request.method==='GET'){
    let configured=false;try{paymentConfig(env);configured=env.ENABLE_PAYMENTS==='1';}catch{}
    const serviceCapacity=publicMode(env)?await capacity(env.LEDGER):null;
    if(publicMode(env))configured=configured&&customerAllowed(env,account)&&serviceCapacity.available&&env.ENABLE_LIVE_SYNTHESIS==='1';
    const rows=await ledger.query("SELECT COALESCE(SUM(u.characters),0) AS characters FROM usage u JOIN reservations r ON r.job=u.job WHERE r.account=?",owner||'').first();
    return json({emailConfigured:local||env.ENABLE_EMAIL==='1',email:account?.email||null,sandbox:!production(env),trial:trialMode(env),serviceCapacity,checkoutAvailable:configured,configured,clientToken:configured?env.PADDLE_CLIENT_TOKEN:'',packCharacters:1000000,priceUSD:10,account,pendingOrder:owner?await ledger.pendingOrder(owner):null,paymentStatus:owner?await ledger.paymentStatus(owner):null,month:new Date().toISOString().slice(0,7),usage:owner?await ledger.summary(new Date().toISOString().slice(0,7),owner):[],successfulCharacters:rows.characters,local});
   }
   if(path==='/api/billing/login/request'&&request.method==='POST'){
    if(production(env))await rateLimit(env,'EMAIL_LIMIT',request);
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
   if(path==='/api/billing/mode')return json({detail:'Speech credit is required for WaveNet.'},403);
   if(['/api/billing/order','/api/billing/reconcile'].includes(path)&&request.method==='POST'){
    if(trialMode(env))return json({detail:'Checkout is unavailable during the trial.'},503);
    if(!owner)return json({},401);if(local)throw new CreditError('Checkout is disabled.',503);
    if(publicMode(env)){
     await rateLimit(env,'CHECKOUT_LIMIT',request);
     if(path.endsWith('/order')&&!customerAllowed(env,account))throw new CreditError('Purchases are not available for this account yet. Verify your email before purchasing.',403);
    }
    if(path.endsWith('/order')&&(env.ENABLE_PAYMENTS!=='1'||publicMode(env)&&env.ENABLE_LIVE_SYNTHESIS!=='1'))throw new CreditError('New purchases are temporarily paused.',503);
    const input=await body(request,2048);return env.PAYMENTS.get(env.PAYMENTS.idFromName('coordinator')).fetch('https://payments/',{method:'POST',body:JSON.stringify({action:path.endsWith('/order')?'order':'reconcile',account:owner,id:input.order})});
   }
   if(path==='/api/staging/fixtures'&&request.method==='GET'){
    if(!mseStaging(env))return json({},404);
    return json({voices:Object.fromEntries(Object.keys(fixtures).map(voice=>[voice,fixtureChunks(voice)]))});
   }
   if(path==='/api/reader'&&request.method==='GET')return json({local,mseStaging:mseStaging(env),liveEnabled:!local&&env.ENABLE_LIVE_SYNTHESIS==='1',voices:WAVENET_VOICE_IDS,account:account?{balance:account.balance,reserved:account.reserved,creditRequired:!account.legacyPilot,verified:verifiedCustomer(account),shortfall:!!account.shortfall}:null,accessAllowed:!!account&&(!production(env)||(trialMode(env)?approved(env,account):customerAllowed(env,account))),eligible:!!account&&(!production(env)||(trialMode(env)?approved(env,account):customerAllowed(env,account)))&&(account.legacyPilot||account.balance>0)&&!account.shortfall,fixtures:local?fixtures:undefined});
   if(path==='/api/readings'&&request.method==='POST'){
    if(!owner)return json({detail:'Open your account to start a session.'},401);
    if(trialMode(env)&&!approved(env,account))return json({detail:'WaveNet is available only to the verified trial owner. Browser voices remain free.'},403);
    if(publicMode(env)){await rateLimit(env,'READING_LIMIT',request);if(!customerAllowed(env,account))throw new CreditError('WaveNet is not available for this account yet. Sign in with a verified email.',403);}
    let input=await body(request);try{input=stagingInput(input,env);}catch(error){throw new CreditError(error.message,422);}
    const id=request.headers.get('Idempotency-Key');if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id||''))throw new CreditError('A UUID request key is required.',422);
    const cachedStage=!!input.mseOptions?.cached;
    if(cachedStage){/* Fixed synthetic sections never reserve credit or provider budget. */}
    else if(local){/* Local harness maps each sentence to cached synthetic audio. */}
    else {
     const requested=sourceCounts(input.chunks).reduce((a,b)=>a+b,0);
     const receipt=await ledger.receipt(id,owner);
     if(mseStaging(env)&&env.MSE_ADMISSIONS_PAUSED==='1'&&!receipt)throw new CreditError('New live staging readings are paused.',503);
     if(!receipt && (account.shortfall||(!account.legacyPilot&&account.balance<requested)))throw new CreditError(trialMode(env)?'Not enough trial allowance. Browser voices remain free.':'WaveNet needs sufficient speech credit. Upgrade with a speech pack, or choose free browser voices.',402);
     if(env.ENABLE_LIVE_SYNTHESIS!=='1')throw new CreditError('Speech generation is disabled.',503);
     // Lifetime budget is deliberately never replenished automatically. Failed
     // or cancelled admissions consume budget too, bounding uncertain charges.
     if(publicMode(env)){
      const cap=await capacity(env.LEDGER);
      if(!receipt&&(requested>cap.dailyRemaining||requested>cap.monthlyRemaining))throw new CreditError('Speech capacity is temporarily full. Your credit is safe; check your account for reset times.',429);
      await ledger.query('INSERT OR IGNORE INTO public_jobs(job,account) VALUES(?,?)',id,owner).run();
      const admitted=await ledger.query('SELECT account FROM public_jobs WHERE job=?',id).first();
      if(admitted.account!==owner)throw new CreditError('Reading not found.',404);
     }else{
     // Staging retains admission accounting, but its staging-only migration
     // retires the campaign and removes the lifetime admission ceiling.
     const maximum=mseStaging(env)?100000:Number(env.MAX_LIFETIME_CHARACTERS);if(!Number.isSafeInteger(maximum)||maximum<1||maximum>100000)throw new CreditError('Private speech budget is not configured.',503);
     await ledger.query("INSERT OR IGNORE INTO speech_budget VALUES('private-lifetime',0,?)",maximum).run();
     try{const fingerprint=await digest(JSON.stringify({owner,...input}));await ledger.query('INSERT INTO speech_admissions(job,characters,fingerprint) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM speech_admissions WHERE job=?)',id,sourceCounts(input.chunks).reduce((a,b)=>a+b,0),fingerprint,id).run();const admission=await ledger.query('SELECT fingerprint FROM speech_admissions WHERE job=?',id).first();if(admission.fingerprint!==fingerprint)throw Error('Request mismatch');}catch{throw new CreditError('Private speech budget reached. Generation is paused.',429);}
    }
    }
    return env.JOBS.get(env.JOBS.idFromName(id)).fetch('https://job/create',{method:'POST',headers:{'X-Proof-Owner':owner},body:JSON.stringify({...input,id,mode:cachedStage?'staging-fixture':local?'fixture':'live'})});
   }
   const match=path.match(/^\/api\/readings\/([a-f0-9-]{36})(\/audio|\/sections\/\d+|\/download\/(?:mp3|vtt))?$/);
   if(match){
    if(!owner)return json({},404);if(match[2]?.startsWith('/sections/')&&!progressiveReader(env))return json({},404);if(!['GET','HEAD','DELETE'].includes(request.method)||request.method==='DELETE'&&match[2])return json({},405);
    return env.JOBS.get(env.JOBS.idFromName(match[1])).fetch('https://job'+(match[2]||'/status'),{method:request.method,headers:{'X-Proof-Owner':owner,...(request.headers.has('Range')?{Range:request.headers.get('Range')}:{})}});
   }
   const assets={'/':'/index.html','/api/billing':'/billing.html','/api/billing/app.js':'/billing.js','/api/billing/signin':'/signin.html','/api/billing/signin.js':'/signin.js','/api/billing/signin.css':'/signin.css'};
   if(['GET','HEAD'].includes(request.method)&&(!path.startsWith('/api/')||assets[path]))return asset(request,env,assets[path]||path);
   return json({},404);
  }catch(error){return error instanceof CreditError?json({detail:error.message},error.status):json({detail:'Reader request failed. No automatic retry.'},500);}
 }
};
