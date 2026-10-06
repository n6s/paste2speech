import {OCR_MODEL,validateDocumentBytes} from '../../public/document-format.js';
import {readBounded} from '../prepared/google.js';
import {ownerAccess} from './owner-access.js';
export const OCR_TRIAL={id:'spanish-fork-october-2026',hash:'f23892d03f3b807089e1af35df8175acf87f3cc12c2df786d1ec8b17c2909c80',bytes:5814537,pages:4,capCents:500,reserveCents:100,priorKnownCents:2,priorAllowanceCents:100};
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const uuid=id=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id||'');
export function mistralOcrPayload(bytes,mime){
 validateDocumentBytes(bytes,mime);let encoded;
 if(typeof bytes.toBase64==='function')encoded=bytes.toBase64();
 else{const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));encoded=btoa(chunks.join(''));}
 const url=`data:${mime};base64,${encoded}`;
 return {model:OCR_MODEL,document:mime==='application/pdf'?{type:'document_url',document_url:url}:{type:'image_url',image_url:url},include_blocks:true,include_image_base64:false,extract_footer:true,confidence_scores_granularity:'block',table_format:'markdown'};
}
function acknowledged(result){if(result.success!==true||!Number.isSafeInteger(result.meta?.changes)||result.meta.changes<1)throw Error('OCR acknowledgement could not be confirmed.');}
export async function reserveOcrAttempt(db,hash,now=Date.now()){
 const id=crypto.randomUUID();const result=await db.prepare("INSERT INTO ocr_experiment_attempts(id,experiment,document_hash,model,reservation_cents,state,created,updated) VALUES(?,?,?,?,?,'reserved',?,?)").bind(id,OCR_TRIAL.id,hash,OCR_MODEL,100,now,now).run();
 // D1 includes the budget trigger update. Lost acknowledgements never dispatch.
 acknowledged(result);return id;
}
const allAttempts="SELECT id,NULL AS parent_id,experiment,document_hash,model,reservation_cents,state,created,updated,expires,cache_key,'ocr_experiment_attempts' AS storage_table FROM ocr_experiment_attempts UNION ALL SELECT id,parent_id,experiment,document_hash,model,reservation_cents,state,created,updated,expires,cache_key,'ocr_experiment_retries' AS storage_table FROM ocr_experiment_retries";
async function latest(env){return env.LEDGER.prepare(`SELECT a.*,d.started AS dispatch_started,d.deadline AS dispatch_deadline FROM (${allAttempts}) a LEFT JOIN ocr_experiment_dispatch d ON d.attempt_id=a.id WHERE experiment=? AND document_hash=? AND model=? ORDER BY a.created DESC,a.parent_id IS NOT NULL DESC LIMIT 1`).bind(OCR_TRIAL.id,OCR_TRIAL.hash,OCR_MODEL).first();}
async function byId(env,id){return env.LEDGER.prepare(`SELECT a.*,d.started AS dispatch_started,d.deadline AS dispatch_deadline FROM (${allAttempts}) a LEFT JOIN ocr_experiment_dispatch d ON d.attempt_id=a.id WHERE a.id=? AND experiment=? AND document_hash=? AND model=?`).bind(id,OCR_TRIAL.id,OCR_TRIAL.hash,OCR_MODEL).first();}
const retryable=(row,clock)=>!!row&&clock-row.created>=300000&&(row.dispatch_deadline||0)<=clock&&(row.state!=='ready'||row.expires<=clock);
async function replay(env,row,clock){
 if(row.state==='ready'&&row.expires>clock){const object=await env.AUDIO.get(row.cache_key);if(object)return json(await object.json());}
 return json({detail:row.state==='ready'?'The saved OCR result is unavailable or expired. Check OCR status before an explicitly approved retry.':'This OCR attempt is pending or uncertain. No automatic paid retry was made. Check OCR status for a separately budgeted owner retry.',attemptId:row.id},409);
}
async function status(env,row,clock){
 const budget=await env.LEDGER.prepare('SELECT * FROM ocr_experiment_budget WHERE id=?').bind(OCR_TRIAL.id).first();
 if(!row)return {state:'idle',detail:'No OCR attempt has been recorded.',budget:{capCents:budget?.cap_cents,reservedCents:budget?.reserved_cents}};
 const elapsedSeconds=Math.max(0,Math.floor((clock-row.created)/1000));
 const state=row.state==='reserved'?(elapsedSeconds>120?'uncertain':'pending'):row.state==='ready'&&row.expires<=clock?'expired':row.state;
 const retryAllowed=retryable(row,clock)&&budget?.cap_cents===500&&budget.reserved_cents+100<=500;
 return {state,attemptId:row.id,parentId:row.parent_id,elapsedSeconds,reservationCents:100,dispatchStarted:!!row.dispatch_started,retryAllowed,nextReservationCents:100,budget:{capCents:budget?.cap_cents,reservedCents:budget?.reserved_cents},detail:state==='ready'?'OCR is ready. Load the saved result without another paid request.':state==='pending'?'The OCR reservation is recorded; completion is not confirmed yet. Checking status never starts OCR.':retryAllowed?'OCR completion is unconfirmed. The original reservation is kept. Re-select the same newsletter and explicitly approve a new $1 reservation to retry within the $5 ceiling.':'OCR completion is unconfirmed or the result expired. No paid retry was made; the original reservation is kept. Retry needs a five-minute cooldown and at least $1 remaining in the experiment budget.'};
}
export async function documentOcrResponse(request,env,{token,fetcher=fetch,now=Date.now,verifyOwner=ownerAccess,hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')}={}){
 if(env.READER_MODE!=='staging')return json({},404);
 if(!await verifyOwner(env.LEDGER,token,env.OWNER_EMAIL))return json({detail:'Sign in with the verified owner account to use this private OCR trial.'},403);
 const path=new URL(request.url).pathname,clock=()=>typeof now==='function'?now():now;
 const enabled=env.ENABLE_DOCUMENT_OCR==='1'&&env.OCR_LIVE_APPROVED==='1'&&!!env.MISTRAL_API_KEY;
 if(path==='/api/ocr/config'&&request.method==='GET'&&!enabled)return json({enabled:false,model:OCR_MODEL,reason:'Private OCR awaits confirmed secure key setup and activation.'});
 if(['/api/ocr/status','/api/ocr/result','/api/ocr/config'].includes(path)&&request.method==='GET'){
  try{
   const row=await latest(env);
   if(path==='/api/ocr/result')return row?replay(env,row,clock()):json({detail:'No OCR result exists.'},404);
   const current=await status(env,row,clock());
   if(path==='/api/ocr/status')return json(current);
   if(!enabled)return json({enabled:false,model:OCR_MODEL,reason:'Private OCR awaits confirmed secure key setup and activation.'});
   const budget=await env.LEDGER.prepare('SELECT * FROM ocr_experiment_budget WHERE id=?').bind(OCR_TRIAL.id).first();
   if(!budget||budget.cap_cents!==500||budget.prior_reserved_cents<100)return json({enabled:false,model:OCR_MODEL,reason:'OCR budget is not configured.'});
   return json({enabled:true,model:OCR_MODEL,approvedDocument:{name:'October 2026 Spanish Fork newsletter',sha256:OCR_TRIAL.hash,bytes:OCR_TRIAL.bytes,pages:4},attempt:row?current:null,budget:current.budget,costNotice:`Private owner trial, exact four-page newsletter only. Estimated API cost $0.016 at list rate; each new attempt reserves $1, including uncertain outcomes. $${(budget.reserved_cents/100).toFixed(2)} currently reserved of the $5 ceiling, including $1 historical allowance (2 cents known). A retry keeps all earlier reservations. Results are cached privately for 24 hours. Invoice minimums, taxes and unrelated account use are unverified; speech credit is separate.`});
  }catch{return json({detail:'OCR status or budget could not be confirmed. Nothing was submitted.'},503);}
 }
 const retry=path==='/api/ocr/retry';
 if(!['/api/ocr','/api/ocr/retry'].includes(path)||request.method!=='POST')return json({},405);
 if(!enabled)return json({detail:'Cloud OCR is not enabled yet. Nothing was sent to Mistral.'},503);
 let bytes,parent;
 try{
  if(!request.headers.get('Content-Type')?.startsWith('multipart/form-data;'))return json({detail:'Choose the approved newsletter file and explicitly agree to OCR.'},422);
  const body=await readBounded(request,6*1024*1024+65536),form=await new Response(body,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData(),fields=retry?['file','consent','model','retry_of','retry_consent']:['file','consent','model'];
  if([...form.keys()].some(k=>!fields.includes(k))||fields.some(k=>form.getAll(k).length!==1)||form.get('consent')!=='true'||form.get('model')!==OCR_MODEL||retry&&(form.get('retry_consent')!=='true'||!uuid(form.get('retry_of'))))return json({detail:'Explicit consent, retry approval when needed, and the pinned model are required.'},422);
  const file=form.get('file');if(!file||typeof file.arrayBuffer!=='function'||file.size!==OCR_TRIAL.bytes||file.type!=='application/pdf')return json({detail:'This private trial accepts only the approved four-page newsletter PDF.'},422);
  bytes=new Uint8Array(await file.arrayBuffer());validateDocumentBytes(bytes,'application/pdf');if(await hashBytes(bytes)!==OCR_TRIAL.hash)return json({detail:'This document is not approved for the private OCR trial. Nothing was sent.'},403);
  if(retry)parent=form.get('retry_of');
 }catch{return json({detail:'The document upload is invalid or too large. Nothing was sent.'},422);}
 let id,table='ocr_experiment_attempts';
 try{
  if(retry){
   const child=await env.LEDGER.prepare('SELECT id FROM ocr_experiment_retries WHERE parent_id=?').bind(parent).first();if(child)return replay(env,await byId(env,child.id),clock());
   const old=await byId(env,parent),current=await latest(env);if(!old||current?.id!==old.id||!retryable(old,clock()))return json({detail:'The previous attempt may still be active, already succeeded, or is not the latest attempt. No retry was submitted.'},409);
   id=crypto.randomUUID();table='ocr_experiment_retries';
   acknowledged(await env.LEDGER.prepare("INSERT INTO ocr_experiment_retries(id,parent_id,experiment,document_hash,model,reservation_cents,state,created,updated) VALUES(?,?,?,?,?,?,'reserved',?,?)").bind(id,parent,OCR_TRIAL.id,OCR_TRIAL.hash,OCR_MODEL,100,clock(),clock()).run());
  }else{const prior=await latest(env);if(prior)return replay(env,prior,clock());id=await reserveOcrAttempt(env.LEDGER,OCR_TRIAL.hash,clock());}
 }catch{
  try{const prior=await latest(env);if(prior)return replay(env,prior,clock());}catch{}
  return json({detail:'OCR budget or admission could not be confirmed. No provider request was made.'},429);
 }
 let phase='payload',providerStatus=null;
 try{
  const payload={...mistralOcrPayload(bytes,'application/pdf'),pages:[0,1,2,3]},dispatch=clock();
  // Durable checkpoint before the one provider call; ambiguity never dispatches.
  phase='dispatch-checkpoint';acknowledged(await env.LEDGER.prepare('INSERT INTO ocr_experiment_dispatch VALUES(?,?,?)').bind(id,dispatch,dispatch+300000).run());
  phase='provider-fetch';const response=await fetcher('https://api.mistral.ai/v1/ocr',{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+env.MISTRAL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  providerStatus=response.status;phase='provider-response';if(!response.ok){await response.body?.cancel();throw Error('provider');}
  phase='response-decode';const raw=JSON.parse(new TextDecoder().decode(await readBounded(response,16*1024*1024)));
  phase='response-schema';if(raw.model!==OCR_MODEL||!Array.isArray(raw.pages)||raw.pages.length!==4||raw.usage_info?.pages_processed!==4||raw.pages.some((p,i)=>p.index!==i)||!raw.pages.some(p=>p.blocks?.some(b=>String(b.content||'').trim())||String(p.markdown||'').trim()))throw Error('result');
  const cacheKey=`ocr-trial/${OCR_TRIAL.id}/${id}.json`,expires=clock()+86400000;
  phase='cache-write';await env.AUDIO.put(cacheKey,JSON.stringify(raw),{httpMetadata:{contentType:'application/json'},customMetadata:{expires:String(expires)}});
  phase='receipt-completion';acknowledged(await env.LEDGER.prepare(`UPDATE ${table} SET state='ready',updated=?,expires=?,cache_key=? WHERE id=? AND state='reserved'`).bind(clock(),expires,cacheKey,id).run());
  return json(raw);
 }catch(error){
  const errorKind=['TypeError','SyntaxError','AbortError','TimeoutError','RangeError'].includes(error?.name)?error.name:'Error';
  try{await env.LEDGER.prepare("INSERT OR IGNORE INTO ocr_experiment_diagnostics(attempt_id,kind,phase,http_status,error_kind,created,updated) VALUES(?,'ocr',?,?,?,?,?)").bind(id,phase,providerStatus,errorKind,clock(),clock()).run();}catch{}
  try{await env.LEDGER.prepare(`UPDATE ${table} SET state='uncertain',updated=? WHERE id=? AND state='reserved'`).bind(clock(),id).run();}catch{}
  return json({attemptId:id,failure:{phase,httpStatus:providerStatus,errorKind},detail:'OCR could not be confirmed. The $1 reservation is retained; no automatic retry was made. Your existing text is unchanged. Check OCR status before an explicitly approved retry.'},502);
 }
}
export async function purgeOcrCache(env,now=Date.now()){
 if(env.READER_MODE!=='staging'||env.ENABLE_DOCUMENT_OCR!=='1')return;
 for(const table of ['ocr_experiment_attempts','ocr_experiment_retries']){const rows=await env.LEDGER.prepare(`SELECT id,cache_key FROM ${table} WHERE state='ready' AND cache_key IS NOT NULL AND expires<=? LIMIT 5`).bind(now).all();for(const row of rows.results){await env.AUDIO.delete(row.cache_key);await env.LEDGER.prepare(`UPDATE ${table} SET cache_key=NULL WHERE id=?`).bind(row.id).run();}}
}

// One read-only model-access check for the explicitly investigated failed receipt.
// No document, OCR POST, reservation, provider response body or key is stored.
export async function probeOcrAccess(env,{fetcher=fetch,now=Date.now}={}){
 const id=env.OCR_DIAGNOSTIC_ATTEMPT;if(env.READER_MODE!=='staging'||!uuid(id)||!env.MISTRAL_API_KEY)return;
 const attempt=await byId(env,id);if(attempt?.state!=='uncertain')return;
 let phase='key-format',httpStatus=null,errorKind=null,available=null;const key=env.MISTRAL_API_KEY;
 const edgeWhitespace=key!==key.trim(),controlCharacters=/[\x00-\x1f\x7f]/.test(key);
 try{
  const claim=await env.LEDGER.prepare("INSERT OR IGNORE INTO ocr_experiment_diagnostics(attempt_id,kind,phase,key_edge_whitespace,key_control_characters,created,updated) VALUES(?,'access-check','claimed',?,?,?,?)").bind(id,Number(edgeWhitespace),Number(controlCharacters),now(),now()).run();
  if(claim.success!==true||claim.meta?.changes!==1)return;
 }catch{return;}
 try{
  const headers=new Headers({Authorization:'Bearer '+key});
  phase='model-access';const response=await fetcher('https://api.mistral.ai/v1/models',{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers});httpStatus=response.status;
  if(response.ok){phase='model-list';const data=JSON.parse(new TextDecoder().decode(await readBounded(response,1024*1024)));available=Number(Array.isArray(data.data)&&data.data.some(model=>model.id===OCR_MODEL));phase='complete';}
  else{await response.body?.cancel();phase='provider-rejected';}
 }catch(error){errorKind=['TypeError','SyntaxError','AbortError','TimeoutError','RangeError'].includes(error?.name)?error.name:'Error';}
 await env.LEDGER.prepare("UPDATE ocr_experiment_diagnostics SET phase=?,http_status=?,error_kind=?,model_available=?,updated=? WHERE attempt_id=? AND kind='access-check'").bind(phase,httpStatus,errorKind,available,now(),id).run();
}
