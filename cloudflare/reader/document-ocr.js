import {OCR_MODEL,validateDocumentBytes} from '../../public/document-format.js';
import {readBounded} from '../prepared/google.js';
import {ownerAccess} from './owner-access.js';
export const OCR_TRIAL={id:'spanish-fork-october-2026',hash:'f23892d03f3b807089e1af35df8175acf87f3cc12c2df786d1ec8b17c2909c80',bytes:5814537,pages:4,capCents:500,reserveCents:100,priorKnownCents:2,priorAllowanceCents:100};
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export function mistralOcrPayload(bytes,mime) {
 validateDocumentBytes(bytes,mime);const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
 const url=`data:${mime};base64,${btoa(chunks.join(''))}`;
 return {model:OCR_MODEL,document:mime==='application/pdf'?{type:'document_url',document_url:url}:{type:'image_url',image_url:url},include_blocks:true,include_image_base64:false,extract_footer:true,confidence_scores_granularity:'block',table_format:'markdown'};
}
export async function reserveOcrAttempt(db,hash,now=Date.now()) {
 const id=crypto.randomUUID();
 // A unique durable insert is the only permission to make one paid call.
 // A committed insert with a lost acknowledgement never authorizes dispatch.
 const result=await db.prepare('INSERT INTO ocr_experiment_attempts(id,experiment,document_hash,model,reservation_cents,state,created,updated) VALUES(?,?,?,?,?,\'reserved\',?,?)').bind(id,OCR_TRIAL.id,hash,OCR_MODEL,OCR_TRIAL.reserveCents,now,now).run();
 if(result.meta?.changes!==1)throw Error('OCR reservation could not be confirmed.');
 return id;
}
async function receipt(env,hash) {return env.LEDGER.prepare('SELECT * FROM ocr_experiment_attempts WHERE experiment=? AND document_hash=? AND model=?').bind(OCR_TRIAL.id,hash,OCR_MODEL).first();}
async function replay(env,row,now) {
 if(row.state==='ready'&&row.expires>now){const object=await env.AUDIO.get(row.cache_key);if(object)return json(await object.json());return json({detail:'The cached OCR result is unavailable. No paid retry was made.'},409);}
 return json({detail:row.state==='ready'?'The OCR cache expired. A fresh paid attempt needs separate approval.':'This OCR attempt is pending or uncertain. No automatic paid retry was made. Check Mistral usage before requesting another attempt.'},409);
}
export async function documentOcrResponse(request,env,{token,fetcher=fetch,now=Date.now,verifyOwner=ownerAccess,hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')}={}) {
 if(env.READER_MODE!=='staging')return json({},404);
 const path=new URL(request.url).pathname;
 // Access JWT/origin are checked by the Worker before this handler. This is an
 // additional verified billing-session owner check, never a client assertion.
 if(!await verifyOwner(env.LEDGER,token,env.OWNER_EMAIL))return json({detail:'Sign in with the verified owner account to use this private OCR trial.'},403);
 const enabled=env.ENABLE_DOCUMENT_OCR==='1'&&env.OCR_LIVE_APPROVED==='1'&&!!env.MISTRAL_API_KEY;
 if(path==='/api/ocr/config'&&request.method==='GET'){
  if(!enabled)return json({enabled:false,model:OCR_MODEL,reason:'Private OCR awaits confirmed secure key setup and activation.'});
  let budget;try{budget=await env.LEDGER.prepare('SELECT * FROM ocr_experiment_budget WHERE id=?').bind(OCR_TRIAL.id).first();}catch{return json({enabled:false,model:OCR_MODEL,reason:'OCR budget is not configured.'});}
  if(!budget||budget.cap_cents!==OCR_TRIAL.capCents||budget.prior_reserved_cents<OCR_TRIAL.priorAllowanceCents)return json({enabled:false,model:OCR_MODEL,reason:'OCR budget is not configured.'});
  return json({enabled:true,model:OCR_MODEL,approvedDocument:{name:'October 2026 Spanish Fork newsletter',sha256:OCR_TRIAL.hash,bytes:OCR_TRIAL.bytes,pages:OCR_TRIAL.pages},costNotice:'Private owner trial: only the approved four-page October 2026 Spanish Fork newsletter. Estimated OCR API cost $0.016 at the verified list rate; $1 is reserved before a call, including uncertain outcomes. Total experiment ceiling $5 includes $1 reserved for earlier usage (2 cents known). Provider invoice minimums, taxes and unrelated account use are not established. Results are cached privately for 24 hours; speech credit is separate.',budget:{capCents:budget.cap_cents,reservedCents:budget.reserved_cents}});
 }
 if(path!=='/api/ocr'||request.method!=='POST')return json({},405);
 if(!enabled)return json({detail:'Cloud OCR is not enabled yet. Nothing was sent to Mistral.'},503);
 let bytes,hash;
 try{
  if(!request.headers.get('Content-Type')?.startsWith('multipart/form-data;'))return json({detail:'Choose the approved newsletter file and explicitly agree to OCR.'},422);
  const body=await readBounded(request,6*1024*1024+65536),form=await new Response(body,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();
  if([...form.keys()].some(k=>!['file','consent','model'].includes(k))||['file','consent','model'].some(k=>form.getAll(k).length!==1)||form.get('consent')!=='true'||form.get('model')!==OCR_MODEL)return json({detail:'Explicit consent and the approved model are required.'},422);
  const file=form.get('file');if(!file||typeof file.arrayBuffer!=='function'||file.size!==OCR_TRIAL.bytes||file.type!=='application/pdf')return json({detail:'This private trial accepts only the approved four-page newsletter PDF.'},422);
  bytes=new Uint8Array(await file.arrayBuffer());validateDocumentBytes(bytes,'application/pdf');hash=await hashBytes(bytes);if(hash!==OCR_TRIAL.hash)return json({detail:'This document is not approved for the private OCR trial. Nothing was sent.'},403);
 }catch{return json({detail:'The document upload is invalid or too large. Nothing was sent.'},422);}
 const clock=typeof now==='function'?now():now;let prior;
 try{prior=await receipt(env,hash);if(prior)return replay(env,prior,clock);}catch{return json({detail:'OCR budget status could not be confirmed. Nothing was sent.'},503);}
 let id;try{id=await reserveOcrAttempt(env.LEDGER,hash,clock);}catch{
  // Includes concurrent duplicate, exhausted budget and uncertain acknowledgement.
  try{const saved=await receipt(env,hash);if(saved)return replay(env,saved,clock);}catch{}
  return json({detail:'OCR budget or admission could not be confirmed. No provider request was made.'},429);
 }
 try{
  const payload={...mistralOcrPayload(bytes,'application/pdf'),pages:[0,1,2,3]};
  const response=await fetcher('https://api.mistral.ai/v1/ocr',{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{'Authorization':'Bearer '+env.MISTRAL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  // Never expose provider bodies or network messages that might contain keys.
  if(!response.ok){await response.body?.cancel();throw Error('provider');}
  const raw=JSON.parse(new TextDecoder().decode(await readBounded(response,16*1024*1024)));
  if(raw.model!==OCR_MODEL||!Array.isArray(raw.pages)||raw.pages.length!==4||raw.usage_info?.pages_processed!==4||raw.pages.some((p,i)=>p.index!==i)||!raw.pages.some(p=>p.blocks?.some(b=>String(b.content||'').trim())||String(p.markdown||'').trim()))throw Error('result');
  const cacheKey=`ocr-trial/${OCR_TRIAL.id}/${id}.json`,expires=clock+86400000;
  await env.AUDIO.put(cacheKey,JSON.stringify(raw),{httpMetadata:{contentType:'application/json'},customMetadata:{expires:String(expires)}});
  const saved=await env.LEDGER.prepare("UPDATE ocr_experiment_attempts SET state='ready',updated=?,expires=?,cache_key=? WHERE id=? AND state='reserved'").bind(clock,expires,cacheKey,id).run();if(saved.meta?.changes!==1)throw Error('settlement');
  return json(raw);
 }catch{
  try{await env.LEDGER.prepare("UPDATE ocr_experiment_attempts SET state='uncertain',updated=? WHERE id=? AND state='reserved'").bind(clock,id).run();}catch{}
  return json({detail:'OCR could not be confirmed. The $1 reservation is retained; no automatic retry was made. Your existing text is unchanged. Check Mistral usage before another paid attempt.'},502);
 }
}

// Retire private cached source results after 24 hours. Admission receipts and
// reservations remain permanently; deleting a cache never permits another call.
export async function purgeOcrCache(env,now=Date.now()) {
 if(env.READER_MODE!=='staging'||env.ENABLE_DOCUMENT_OCR!=='1')return;
 const rows=await env.LEDGER.prepare("SELECT id,cache_key FROM ocr_experiment_attempts WHERE state='ready' AND cache_key IS NOT NULL AND expires<=? LIMIT 5").bind(now).all();
 for(const row of rows.results){await env.AUDIO.delete(row.cache_key);await env.LEDGER.prepare('UPDATE ocr_experiment_attempts SET cache_key=NULL WHERE id=?').bind(row.id).run();}
}
