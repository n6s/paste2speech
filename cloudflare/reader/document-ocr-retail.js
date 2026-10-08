import {OCR_MODEL,validateDocumentBytes} from '../../public/document-format.js';
import {readBounded} from '../prepared/google.js';
import {digest} from '../prepared/ledger.js';
import {OcrLedger} from './ocr-ledger.js';
const reply=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const acknowledged=r=>{if(r.success!==true||!Number.isSafeInteger(r.meta?.changes)||r.meta.changes<1)throw Error('Unconfirmed admission');};
// Draft retail policy is sandbox-only. Existing owner experiment stays unchanged.
export async function retailDocumentOcr(request,env,{token,fetcher=fetch,now=Date.now,payload}={}){
 if(env.READER_MODE!=='staging'||env.OCR_RETAIL_SANDBOX!=='1')return reply({},404);
 const clock=()=>typeof now==='function'?now():now,ledger=new OcrLedger(env.LEDGER);
 const account=await ledger.query("SELECT a.id FROM sessions s JOIN accounts a ON a.id=s.account JOIN identities i ON i.account=a.id WHERE s.token_hash=? AND s.kind='verified' AND s.expires>? AND a.enabled=1",await digest(token||''),clock()).first();
 if(!account)return reply({detail:'Sign in with a verified email to use OCR pages.'},403);
 const url=new URL(request.url),path=url.pathname,hash=url.searchParams.get('document_hash');if(hash&&!/^[a-f0-9]{64}$/.test(hash))return reply({detail:'Invalid document reference.'},422);
 const find=h=>ledger.find(account.id,h,OCR_MODEL),receipt=row=>({attemptId:row.id,pagesUsed:row.consumed,pagesReleased:row.released,state:row.state});
 const cached=async row=>{
  if(row?.state!=='ready'||row.expires<=clock())return reply({detail:'This OCR result is unfinished, uncertain or expired. No automatic retry or debit was made.',attemptId:row?.id},409);
  try{const object=await env.AUDIO.get(row.cache_key);if(!object)throw Error();return reply({...await object.json(),p2s_ocr:{...receipt(row),pagesUsed:0,cached:true,...await ledger.balance(account.id)}});}catch{return reply({detail:'Saved OCR could not be read. No replacement request or debit was made.'},503);}
 };
 const enabled=env.ENABLE_DOCUMENT_OCR==='1'&&!!env.MISTRAL_API_KEY;
 if(request.method==='GET'){
  try{
   await ledger.expireHolds(clock());const row=await find(hash),balance=await ledger.balance(account.id),budget=await ledger.query("SELECT * FROM ocr_business_budget WHERE id='sandbox-retail'").first();
   const state=!row?'idle':row.state==='ready'&&row.expires<=clock()?'expired':row.state==='held'?'pending':row.state;
   const status={state,attemptId:row?.id,fileName:row?.name,elapsedSeconds:row?Math.max(0,Math.floor((clock()-row.created)/1000)):undefined,retryAllowed:false,...(row?receipt(row):{}),...balance,detail:state==='ready'?`Saved OCR is ready. ${row.consumed} pages were charged; saved replay uses 0 credits.`:state==='idle'?'No OCR attempt exists for this document.':'This attempt is pending, uncertain or expired. No automatic retry is allowed. Customer holds are released after five minutes if completion remains unconfirmed.'};status.state=state;
   if(path==='/api/ocr/result')return row?cached(row):reply({detail:'No saved OCR result exists.'},404);
   if(path==='/api/ocr/status')return reply(status);
   if(path==='/api/ocr/config')return reply({enabled,retail:true,model:OCR_MODEL,maxBytes:6*1024*1024,maxPages:10,balance,canSubmit:enabled&&balance.debt===0&&!!budget&&budget.reserved_cents+8<=budget.cap_cents,attempt:row?status:null,costNotice:'Sandbox OCR page billing. One credit per submitted page on complete, validated and privately saved output. Failed or incomplete output uses 0 customer credits. Local extraction and saved replay use 0 credits. Speech credit is separate. Purchased pages have no scheduled expiry. Draft policies: blank-page treatment, expired-cache reprocessing, refund rounding and spent-credit debt await live approval. Saved content expires after 24 hours; new attempts after expiry are currently blocked.'});
  }catch{return reply({detail:'OCR balance or status could not be confirmed. Nothing was uploaded.'},503);}
 }
 if(path!=='/api/ocr'||request.method!=='POST')return reply({detail:'New retries are not enabled.'},409);
 let bytes,mime,pages,name,h;
 try{
  const contentType=request.headers.get('Content-Type');if(!contentType?.startsWith('multipart/form-data;'))throw Error();
  const form=await new Response(await readBounded(request,6*1024*1024+65536),{headers:{'Content-Type':contentType}}).formData(),fields=['file','model','consent','pages'];
  if([...form.keys()].some(k=>!fields.includes(k))||fields.some(k=>form.getAll(k).length!==1)||form.get('model')!==OCR_MODEL||form.get('consent')!=='true')throw Error();
  const file=form.get('file');mime=file?.type;pages=Number(form.get('pages'));if(!file||file.size>6*1024*1024||!Number.isInteger(pages)||pages<1||pages>10||!['application/pdf','image/png','image/jpeg','image/webp'].includes(mime)||mime!=='application/pdf'&&pages!==1)throw Error();
  bytes=new Uint8Array(await file.arrayBuffer());validateDocumentBytes(bytes,mime);h=await hashBytes(bytes);name=String(file.name||'document').replace(/[\x00-\x1f\x7f]/g,'').slice(0,255);
 }catch{return reply({detail:'Choose a supported file up to 6 MB, 1–10 PDF pages or one image, and explicitly consent. Nothing was submitted.'},422);}
 let id,savedKey;
 try{
  await ledger.expireHolds(clock());const prior=await find(h);if(prior)return cached(prior);
  if(!enabled)return reply({detail:'Cloud OCR is paused.'},503);
  id=crypto.randomUUID();acknowledged(await ledger.query('INSERT INTO ocr_attempts(id,account,document_hash,model,mime,pages,name,created,updated,deadline) VALUES(?,?,?,?,?,?,?,?,?,?)',id,account.id,h,OCR_MODEL,mime,pages,name,clock(),clock(),clock()+300000).run());
 }catch{try{const prior=await find(h);if(prior)return cached(prior);}catch{}return reply({detail:'OCR credit, business capacity or admission could not be confirmed. No new provider request was made.'},402);}
 try{
  const body=payload(bytes,mime);
  // Bound dispatch to the consented page count. The reader obtains the whole
  // file count locally; independent server PDF counting remains a live gate.
  // Business reservation covers ten pages even if the client count is wrong.
  body.pages=Array.from({length:pages},(_,i)=>i);
  acknowledged(await ledger.query("UPDATE ocr_attempts SET dispatched=? WHERE id=? AND state='held' AND dispatched IS NULL",clock(),id).run());
  const response=await fetcher('https://api.mistral.ai/v1/ocr',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+env.MISTRAL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok){await response.body?.cancel();throw Error();}
  const raw=JSON.parse(new TextDecoder().decode(await readBounded(response,16*1024*1024)));
  if(raw.model!==OCR_MODEL||!Array.isArray(raw.pages)||raw.pages.length!==pages||raw.usage_info?.pages_processed!==pages||raw.pages.some((p,i)=>!p||p.index!==i||typeof p.markdown!=='string'&&!Array.isArray(p.blocks))||!raw.pages.some(p=>p.blocks?.some(b=>String(b.content||'').trim())||String(p.markdown||'').trim()))throw Error();
  const key=`ocr-retail/${account.id}/${id}.json`,expires=clock()+86400000;savedKey=key;await env.AUDIO.put(key,JSON.stringify(raw),{httpMetadata:{contentType:'application/json'},customMetadata:{expires:String(expires)}});
  const settled=await ledger.settle(id,'ready',clock(),key,expires);if(settled.state!=='ready')throw Error();
  return reply({...raw,p2s_ocr:{...receipt(settled),cached:false,...await ledger.balance(account.id)}});
 }catch{
  // A lost completion acknowledgement is recovered from the durable receipt.
  try{const row=await find(h);if(row?.state==='ready')return cached(row);if(savedKey)await env.AUDIO.delete(savedKey);await ledger.settle(id,'uncertain',clock());}catch{}
  return reply({attemptId:id,detail:'OCR completion could not be confirmed. Failed or incomplete output consumes 0 customer credits. No automatic retry was made; check status to recover any saved result or released hold.'},502);
 }
}
export async function maintainRetailOcr(env,now=Date.now()){
 if(env.READER_MODE!=='staging'||env.OCR_RETAIL_SANDBOX!=='1')return;
 const ledger=new OcrLedger(env.LEDGER);await ledger.expireHolds(now);
 const rows=await ledger.query('SELECT id,cache_key FROM ocr_attempts WHERE expires<=? AND cache_key IS NOT NULL LIMIT 20',now).all();
 for(const row of rows.results){await env.AUDIO.delete(row.cache_key);await ledger.query('UPDATE ocr_attempts SET cache_key=NULL WHERE id=?',row.id).run();}
}
