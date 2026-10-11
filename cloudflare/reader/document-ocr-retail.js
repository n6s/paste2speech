import {summaryPriced} from './summary-credits.js';
import {CLOUD_POLICIES} from '../../public/cloud-choices.js';
import {assertUnifiedEnvironment} from './unified-wallet.js';
import {publicMode,customerAllowed} from './modes.js';
import {ocrRetailEnabled,ocrOwnerOnly,providerPermit} from './ocr-policy.js';
import {OCR_PROOF_HASH,syntheticOcr} from './ocr-proof-fixture.js';
import {verifiedPdfPages,pdfAdmissionMessage} from './pdf-admission.js';
import {OCR_MODEL,validateDocumentBytes} from '../../public/document-format.js';
import {readBounded} from '../prepared/google.js';
import {digest} from '../prepared/ledger.js';
import {OcrLedger} from './ocr-ledger.js';
const reply=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const acknowledged=r=>{if(r.success!==true||!Number.isSafeInteger(r.meta?.changes)||r.meta.changes<1)throw Error('Unconfirmed admission');};
// Retail OCR is admitted only by the explicit staging/live policy gate.
export async function retailDocumentOcr(request,env,{token,fetcher=fetch,now=Date.now,payload}={}){
 if(!ocrRetailEnabled(env))return reply({},404);
 const synthetic=env.OCR_RETAIL_PROVIDER_MODE==='synthetic';
 const clock=()=>typeof now==='function'?now():now,ledger=new OcrLedger(env.LEDGER,env);
 if(ledger.unified)await assertUnifiedEnvironment(env.LEDGER,env);
 const account=await ledger.query("SELECT a.id,a.enabled,i.email FROM sessions s JOIN accounts a ON a.id=s.account JOIN identities i ON i.account=a.id WHERE s.token_hash=? AND s.kind='verified' AND s.expires>? AND a.enabled=1",await digest(token||''),clock()).first();
 if(!account||publicMode(env)&&!customerAllowed(env,account)||(synthetic||ocrOwnerOnly(env))&&account.email!==env.OWNER_EMAIL)return reply({detail:'Sign in with a verified email to use OCR pages.'},403);
 const url=new URL(request.url),path=url.pathname,hash=url.searchParams.get('document_hash');if(hash&&!/^[a-f0-9]{64}$/.test(hash))return reply({detail:'Invalid document reference.'},422);
 const find=h=>ledger.find(account.id,h,OCR_MODEL),receipt=row=>({attemptId:row.id,pagesUsed:row.consumed,pagesReleased:row.released,state:row.state,...(row.wallet_version==='unified-v1'?{creditsUsed:row.consumed*2,creditsReleased:row.released*2,walletVersion:'unified-v1'}:{})});
 const cached=async row=>{
  if(row?.state!=='ready'||row.expires<=clock())return reply({detail:'This OCR result is unfinished, uncertain or expired. No automatic retry or debit was made.',attemptId:row?.id},409);
  try{const object=await env.AUDIO.get(row.cache_key);if(!object)throw Error();return reply({...await object.json(),p2s_ocr:{...receipt(row),pagesUsed:0,creditsUsed:0,cached:true,...await ledger.balance(account.id)}});}catch{return reply({detail:'Saved OCR could not be read. No replacement request or debit was made.'},503);}
 };
 const enabled=env.PAID_ADMISSIONS_PAUSED!=='1'&&env.ENABLE_DOCUMENT_OCR==='1'&&(synthetic||env.OCR_RETAIL_PROVIDER_MODE==='live'&&!!env.MISTRAL_API_KEY);
 if(request.method==='GET'){
  try{
   await ledger.expireHolds(clock());const row=await find(hash),balance=await ledger.balance(account.id),budget=await ledger.query("SELECT * FROM ocr_business_budget WHERE id='sandbox-retail'").first();
   const permit=synthetic?null:await providerPermit(ledger,env,account.id,hash);const allowance=synthetic?null:await ledger.query("SELECT p.* FROM ocr_provider_permits p JOIN identities i ON i.email=p.owner_email WHERE i.account=? AND p.id='personal'",account.id).first();
   const state=!row?'idle':row.state==='ready'&&row.expires<=clock()?'expired':row.state==='held'?'pending':row.state;
   const status={state,attemptId:row?.id,fileName:row?.name,elapsedSeconds:row?Math.max(0,Math.floor((clock()-row.created)/1000)):undefined,retryAllowed:false,...(row?receipt(row):{}),...balance,detail:state==='ready'?`Saved OCR is ready. ${row.consumed} pages were charged; saved replay uses 0 credits.`:state==='idle'?'No OCR attempt exists for this document.':'This attempt is pending, uncertain or expired. No automatic retry is allowed. Customer holds are released after five minutes if completion remains unconfirmed.'};status.state=state;
   if(path==='/api/ocr/result')return row?cached(row):reply({detail:'No saved OCR result exists.'},404);
   if(path==='/api/ocr/status')return reply(status);
   if(path==='/api/ocr/config'&&ledger.unified)return reply({enabled,retail:true,synthetic,consentScope:account.id,consentPolicy:CLOUD_POLICIES.ocr.version,model:OCR_MODEL,maxBytes:6*1024*1024,maxPages:10,balance,unitsPerPage:2000,providerAllowance:allowance?{remainingCents:allowance.cap_cents-allowance.reserved_cents,capCents:allowance.cap_cents}:null,canSubmit:enabled&&balance.debt===0&&!!budget&&(budget.cap_cents===null||budget.reserved_cents+1<=budget.cap_cents)&&(synthetic||env.READER_MODE!=='staging'||!!permit),attempt:row?status:null,costNotice:'OCR uses 2 shared credits per page when complete, validated output is saved. Failed, incomplete or entirely blank results use 0 credits. Local extraction and saved replay are free. Saved OCR expires after 24 hours; reprocessing the same expired file is currently blocked. Speech uses 1 credit per 1,000 characters, counted exactly. '+(summaryPriced(env)?'Summary uses 1 shared credit per accepted result.':'Summary is free.')});
   if(path==='/api/ocr/config')return reply({enabled,retail:true,synthetic,consentScope:account.id,consentPolicy:CLOUD_POLICIES.ocr.version,model:OCR_MODEL,maxBytes:6*1024*1024,maxPages:10,balance,providerAllowance:allowance?{remainingCents:allowance.cap_cents-allowance.reserved_cents,capCents:allowance.cap_cents}:null,canSubmit:enabled&&balance.debt===0&&!!budget&&(budget.cap_cents===null||budget.reserved_cents+1<=budget.cap_cents)&&(synthetic||env.READER_MODE!=='staging'||!!permit),attempt:row?status:null,costNotice:(synthetic?'Synthetic fixture only; no file is sent to Mistral. ':'')+'One OCR credit is used for each submitted page only when the whole document produces complete, validated output that is saved privately. This includes blank pages within an otherwise successful document. Failed, incomplete or entirely blank results use 0 customer credits. Local extraction and replay of a saved result use 0 credits. Saved OCR results expire after 24 hours; processing the same file again after expiry is currently blocked. Download the text before expiry. Purchased OCR pages have no scheduled expiry. Approved refunds remove the corresponding pages; partial refunds round the removed amount up to a whole page. Credits already used become a page shortfall that a later purchase covers first. Speech credit is separate.'});
  }catch{return reply({detail:'OCR balance or status could not be confirmed. Nothing was uploaded.'},503);}
 }
 if(path!=='/api/ocr'||request.method!=='POST')return reply({detail:'New retries are not enabled.'},409);
 let bytes,mime,pages,name,h;
 try{
  const contentType=request.headers.get('Content-Type');if(!contentType?.startsWith('multipart/form-data;'))throw Error();
  const form=await new Response(await readBounded(request,6*1024*1024+65536),{headers:{'Content-Type':contentType}}).formData(),fields=['file','model','consent','pages'];
  const choice=form.get('consent_policy');if(choice!==null&&(choice!==CLOUD_POLICIES.ocr.version||form.get('consent_scope')!==account.id))return reply({detail:'Your scanning choice changed. Review the Mistral disclosure again. Nothing was submitted.'},409);
  if([...form.keys()].some(k=>![...fields,'consent_policy','consent_scope'].includes(k))||['consent_policy','consent_scope'].some(k=>form.getAll(k).length>1)||fields.some(k=>form.getAll(k).length!==1)||form.get('model')!==OCR_MODEL||form.get('consent')!=='true')throw Error();
  const file=form.get('file');mime=file?.type;pages=Number(form.get('pages'));if(!file||file.size>6*1024*1024||!Number.isInteger(pages)||pages<1||pages>10||!['application/pdf','image/png','image/jpeg','image/webp'].includes(mime)||mime!=='application/pdf'&&pages!==1)throw Error();
  bytes=new Uint8Array(await file.arrayBuffer());validateDocumentBytes(bytes,mime);const actualPages=mime==='application/pdf'?await verifiedPdfPages(bytes):1;if(pages!==actualPages)throw Error('PDF page count mismatch');pages=actualPages;h=await hashBytes(bytes);name=String(file.name||'document').replace(/[\x00-\x1f\x7f]/g,'').slice(0,255);
 }catch(error){const specific=pdfAdmissionMessage(error)||(error.message==='PDF page count mismatch'?'The file’s verified page count does not match the consent notice. Choose the file again to refresh the page count.':null);if(specific)return reply({detail:specific+' Nothing was submitted; no OCR credits were used.'},422);return reply({detail:'Choose an unencrypted, structurally valid PDF of 1–10 pages up to 6 MB or one supported image, and explicitly consent. The consented page count must match the whole document. Complex or unsupported PDF structures are rejected safely. Nothing was submitted.'},422);}
 if(synthetic&&h!==OCR_PROOF_HASH)return reply({detail:'Synthetic billing proof accepts only the supplied one-page billing-proof.pdf. Nothing was sent to Mistral.'},422);
 let id,savedKey;
 try{
  await ledger.expireHolds(clock());const prior=await find(h);if(prior)return cached(prior);
  if(!enabled)return reply({detail:'Cloud OCR is paused.'},503);
  const permit=synthetic?null:await providerPermit(ledger,env,account.id,h,pages);if(!synthetic&&env.READER_MODE==='staging'&&!permit)return reply({detail:'The approved provider allowance cannot cover this document. Saved results remain free; no file was sent.'},402);
  id=crypto.randomUUID();acknowledged(await ledger.query(ledger.unified?'INSERT INTO ocr_attempts(id,account,document_hash,model,mime,pages,name,created,updated,deadline,provider_permit,wallet_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)':'INSERT INTO ocr_attempts(id,account,document_hash,model,mime,pages,name,created,updated,deadline,provider_permit) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,account.id,h,OCR_MODEL,mime,pages,name,clock(),clock(),clock()+300000,permit?.id||null,...(ledger.unified?['unified-v1']:[])).run());
 }catch{try{const prior=await find(h);if(prior)return cached(prior);}catch{}return reply({detail:'OCR credit, business capacity or admission could not be confirmed. No new provider request was made.'},402);}
 try{
  const body=payload(bytes,mime);
  // Dispatch exactly the whole-file page count independently verified before
  // any credit hold/provider reservation. Client page claims must match it.
  body.pages=Array.from({length:pages},(_,i)=>i);
  acknowledged(await ledger.query("UPDATE ocr_attempts SET dispatched=? WHERE id=? AND state='held' AND dispatched IS NULL"+(ledger.unified?" AND (wallet_version='legacy' OR NOT EXISTS(SELECT 1 FROM unified_wallets WHERE account=ocr_attempts.account AND debt>0))":""),clock(),id).run());
  let raw;if(synthetic)raw=syntheticOcr();else {
  const response=await fetcher('https://api.mistral.ai/v1/ocr',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+env.MISTRAL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok){await response.body?.cancel();throw Error();}
  raw=JSON.parse(new TextDecoder().decode(await readBounded(response,16*1024*1024)));
  }
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
 if(!ocrRetailEnabled(env))return;
 const ledger=new OcrLedger(env.LEDGER,env);await ledger.expireHolds(now);
 const rows=await ledger.query('SELECT id,cache_key FROM ocr_attempts WHERE expires<=? AND cache_key IS NOT NULL LIMIT 20',now).all();
 for(const row of rows.results){await env.AUDIO.delete(row.cache_key);await ledger.query('UPDATE ocr_attempts SET cache_key=NULL WHERE id=?',row.id).run();}
}
