import {OCR_MODEL,validateDocumentBytes,ocrReservationCents} from '../../public/document-format.js';
import {readBounded} from '../prepared/google.js';
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const budgetId='spanish-fork-october-2026',maxBytes=6*1024*1024;
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const acknowledged=r=>{if(r.success!==true||!Number.isSafeInteger(r.meta?.changes)||r.meta.changes<1)throw Error('acknowledgement');};
// Invoked only after staging mode and the verified owner check in documentOcrResponse.
export async function ownerDocumentOcr(request,env,{fetcher,now,hashBytes,payload,legacy}={}){
 const clock=()=>typeof now==='function'?now():now,owner=await digest(new TextEncoder().encode(env.OWNER_EMAIL.trim().toLowerCase())),url=new URL(request.url),path=url.pathname;
 const hash=url.searchParams.get('document_hash');if(hash&&!/^[a-f0-9]{64}$/.test(hash))return reply({detail:'Invalid document reference.'},422);
 const find=async h=>{const row=await env.LEDGER.prepare(`SELECT * FROM owner_document_ocr WHERE owner=? AND model=? ${h?'AND document_hash=?':''} ORDER BY created DESC LIMIT 1`).bind(...[owner,OCR_MODEL,...(h?[h]:[])]).first();return row||await legacy(h);};
 const cached=async row=>{try{if(row?.state==='ready'&&row.expires>clock()&&row.cache_key){const object=await env.AUDIO.get(row.cache_key);if(object)return reply(await object.json());}}catch{return reply({detail:'Saved OCR could not be read. No paid retry was made.'},503);}return reply({detail:'This OCR attempt is unfinished, uncertain or its saved result expired. No paid retry was made.',attemptId:row?.id},409);};
 const enabled=env.ENABLE_DOCUMENT_OCR==='1'&&env.OCR_LIVE_APPROVED==='1'&&!!env.MISTRAL_API_KEY;
 if(request.method==='GET'){
  try{
   const row=await find(hash),budget=await env.LEDGER.prepare('SELECT * FROM ocr_owner_budget WHERE id=?').bind(budgetId).first();
   const state=!row?'idle':row.state==='reserved'?(clock()-row.created>120000?'uncertain':'pending'):row.state==='ready'&&row.expires<=clock()?'expired':row.state;
   const status={state,attemptId:row?.id,documentHash:row?.document_hash,fileName:row?.name||'October 2026 Spanish Fork newsletter.pdf',elapsedSeconds:row?Math.max(0,Math.floor((clock()-row.created)/1000)):undefined,retryAllowed:false,reservationCents:row?.reservation_cents,budget:{capCents:budget?.cap_cents,reservedCents:budget?.reserved_cents,baselineReservedCents:budget?.baseline_reserved_cents},detail:state==='ready'?'Saved OCR is ready; loading it makes no paid request.':state==='idle'?'No OCR attempt exists for this document.':'This OCR attempt is unfinished, uncertain or expired. Its reservation is retained. No automatic retry is allowed.'};
   if(path==='/api/ocr/result')return row?cached(row):reply({detail:'No saved OCR result exists for this document.'},404);
   if(path==='/api/ocr/status')return reply(status);
   if(path==='/api/ocr/config')return reply({enabled:enabled&&budget?.cap_cents===1000&&budget?.policy==='page-margin-v1',ownerDocuments:true,model:OCR_MODEL,maxBytes,maxPages:10,attempt:row?status:null,reservationCentsByPages:Array.from({length:10},(_,i)=>ocrReservationCents(i+1)),canSubmit:!!budget&&budget.reserved_cents+1<=budget.cap_cents,budget:status.budget,costNotice:`Owner-only trial. PDF: at most 10 pages; PNG/JPEG/WebP: one image. Maximum cloud file size 6 MB. At $0.004/page, the maximum listed API cost is $0.04; new attempts reserve twice the published page price, rounded up to cents (minimum 1 cent), including uncertain outcomes. $${((budget?.reserved_cents||0)/100).toFixed(2)} reserved of the cumulative $10 ceiling, including $${((budget?.baseline_reserved_cents||0)/100).toFixed(2)} retained from the original ledger. This is a safety allowance, not an invoice or confirmed charge. Invoice minimums, taxes and unrelated account use are unverified. Private cache lasts 24 hours. Speech credit is separate.`});
  }catch{return reply({detail:'OCR status or budget could not be confirmed. Nothing was uploaded.'},503);}
 }
 if(path!=='/api/ocr'||request.method!=='POST')return reply({detail:'New paid retries are not enabled. Saved results remain available.'},409);
 if(!enabled)return reply({detail:'Cloud OCR is paused. Nothing was submitted.'},503);
 let bytes,mime,pages,name,h;
 try{
  const contentType=request.headers.get('Content-Type');if(!contentType?.startsWith('multipart/form-data;'))throw Error();
  const form=await new Response(await readBounded(request,maxBytes+65536),{headers:{'Content-Type':contentType}}).formData();
  const fields=['file','model','consent','pages'];if([...form.keys()].some(k=>!fields.includes(k))||fields.some(k=>form.getAll(k).length!==1)||form.get('model')!==OCR_MODEL||form.get('consent')!=='true')throw Error();
  const file=form.get('file');mime=file?.type;pages=Number(form.get('pages'));if(!file||typeof file.arrayBuffer!=='function'||file.size>maxBytes||!Number.isInteger(pages)||pages<1||pages>10||!['application/pdf','image/png','image/jpeg','image/webp'].includes(mime)||mime!=='application/pdf'&&pages!==1)throw Error();
  bytes=new Uint8Array(await file.arrayBuffer());validateDocumentBytes(bytes,mime);h=await hashBytes(bytes);if(!/^[a-f0-9]{64}$/.test(h))throw Error();name=String(file.name||'document').replace(/[\x00-\x1f\x7f]/g,'').slice(0,255);
 }catch{return reply({detail:'Choose a supported file up to 6 MB and explicitly approve OCR. PDFs may request 1–10 pages; images exactly one. Nothing was submitted.'},422);}
 let id;const reservationCents=ocrReservationCents(pages);
 try{
  const prior=await find(h);if(prior)return cached(prior);
  id=crypto.randomUUID();acknowledged(await env.LEDGER.prepare("INSERT INTO owner_document_ocr(id,owner,experiment,document_hash,model,mime,pages,name,reservation_cents,state,created,updated) VALUES(?,?,?,?,?,?,?,?,?,'reserved',?,?)").bind(id,owner,budgetId,h,OCR_MODEL,mime,pages,name,reservationCents,clock(),clock()).run());
 }catch{try{const prior=await find(h);if(prior)return cached(prior);}catch{}return reply({detail:'The cumulative $10 OCR allowance cannot cover this reservation or admission is unconfirmed. No new provider request was made.'},429);}
 let phase='payload',httpStatus=null;
 try{
  const body=payload(bytes,mime);body.pages=Array.from({length:pages},(_,i)=>i);
  phase='dispatch-checkpoint';const start=clock();acknowledged(await env.LEDGER.prepare('INSERT INTO ocr_experiment_dispatch VALUES(?,?,?)').bind(id,start,start+300000).run());
  phase='provider-fetch';const response=await fetcher('https://api.mistral.ai/v1/ocr',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+env.MISTRAL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});httpStatus=response.status;phase='provider-response';if(!response.ok){await response.body?.cancel();throw Error();}
  phase='response-decode';const raw=JSON.parse(new TextDecoder().decode(await readBounded(response,16*1024*1024)));phase='response-schema';if(raw.model!==OCR_MODEL||raw.pages?.length!==pages||raw.usage_info?.pages_processed!==pages||raw.pages.some((p,i)=>p.index!==i)||!raw.pages.some(p=>p.blocks?.some(b=>String(b.content||'').trim())||String(p.markdown||'').trim()))throw Error();
  const cacheKey=`ocr-owner/${owner}/${id}.json`,expires=clock()+86400000;phase='cache-write';await env.AUDIO.put(cacheKey,JSON.stringify(raw),{httpMetadata:{contentType:'application/json'},customMetadata:{expires:String(expires)}});phase='receipt-completion';acknowledged(await env.LEDGER.prepare("UPDATE owner_document_ocr SET state='ready',updated=?,expires=?,cache_key=? WHERE id=? AND state='reserved'").bind(clock(),expires,cacheKey,id).run());return reply(raw);
 }catch(error){
  const errorKind=['TypeError','SyntaxError','AbortError','TimeoutError','RangeError'].includes(error?.name)?error.name:'Error';try{await env.LEDGER.prepare("INSERT OR IGNORE INTO ocr_experiment_diagnostics(attempt_id,kind,phase,http_status,error_kind,created,updated) VALUES(?,'ocr',?,?,?,?,?)").bind(id,phase,httpStatus,errorKind,clock(),clock()).run();await env.LEDGER.prepare("UPDATE owner_document_ocr SET state='uncertain',updated=? WHERE id=? AND state='reserved'").bind(clock(),id).run();}catch{}return reply({attemptId:id,failure:{phase,httpStatus,errorKind},detail:`OCR could not be confirmed. The $${(reservationCents/100).toFixed(2)} reservation is retained; no automatic retry was made. Existing text is unchanged.`},502);
 }
}
