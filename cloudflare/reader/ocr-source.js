// Private staging original-file lifecycle. No source bytes or clear capability
// are stored in Durable Object state, D1, URLs returned to users, or logs.
export const OCR_SOURCE_MAX_BYTES=50_000_000;
export const OCR_SOURCE_LIFETIME_MS=3_600_000;
export const OCR_SOURCE_CAPABILITY_MS=900_000; // Existing grants remain single-use.
export const OCR_SOURCE_BOUNDED_POLICY='bounded-read-3-v2';
export const OCR_SOURCE_REPEAT_MS=600_000;
export const OCR_SOURCE_MAX_READS=3;
export const OCR_SOURCE_MAX_ACTIVE_READS=2;
export const OCR_SOURCE_CLEANUP_RETRY_MS=60_000;
export const OCR_SOURCE_MIMES=['application/pdf','image/png','image/jpeg','image/webp'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hex=/^[0-9a-f]{64}$/;
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
export class OcrSourceError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new OcrSourceError(code);};
const safeError=(status=404)=>new Response('Source unavailable.',{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export class OcrSourceStore {
 constructor(storage,bucket,{now=Date.now,fixedLength=n=>new FixedLengthStream(n),dispatchAuthorized=async()=>false,dispatchDeadline=async()=>Infinity,repeatConsent=async()=>false,waitUntil=()=>{}}={}){this.storage=storage;this.bucket=bucket;this.now=now;this.fixedLength=fixedLength;this.dispatchAuthorized=dispatchAuthorized;this.dispatchDeadline=dispatchDeadline;this.repeatConsent=repeatConsent;this.waitUntil=waitUntil;this.revocationEpoch=0;this.readers=new Set();this.writers=new Set();this.cleanupQueue=Promise.resolve();}
 async read(){return this.storage.get('source');}
 async alarmAt(deadline){const current=await this.storage.getAlarm();if(!current||current<=this.now()||deadline<current)await this.storage.setAlarm(deadline);}
 async create({id,owner,mime,bytes,name}){
  if(!uuid.test(id)||typeof owner!=='string'||!owner||owner.length>100||!OCR_SOURCE_MIMES.includes(mime)||!Number.isSafeInteger(bytes)||bytes<1||bytes>OCR_SOURCE_MAX_BYTES)fail('invalid_source');
  const started=this.now();const record={id,owner,mime,bytes,name:String(name||'document').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,255),key:'ocr-originals/'+id,state:'awaiting-upload',started,expires:started+OCR_SOURCE_LIFETIME_MS};
  await this.storage.transaction(async tx=>{if(await tx.get('source'))fail('source_exists');await tx.put('source',record);await tx.setAlarm(record.expires);});return {id,bytes,mime,expires:record.expires,state:record.state};
 }
 async owned(owner){const r=await this.read();if(!r||r.owner!==owner)fail('source_not_found');return r;}
 async upload(owner,request){
  let record;try{await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r||r.owner!==owner)fail('source_not_found');if(r.state!=='awaiting-upload'||r.expires<=this.now())fail('source_closed');if(request.method!=='PUT'||!request.body||request.headers.get('Content-Type')!==r.mime)fail('invalid_upload');const declared=request.headers.get('Content-Length');if(declared!==null&&declared!==String(r.bytes))fail('invalid_upload');r.state='writing';await tx.put('source',r);record=r;});}catch(error){await request.body?.cancel().catch(()=>{});throw error;}
  // FixedLengthStream is native and enforces both underflow and overflow without
  // buffering the original. R2 conditional PUT prevents replacing this object.
  let putResult;const abort=new AbortController();this.writers.add(abort);const timeout=setTimeout(()=>abort.abort(),Math.max(1,record.expires-this.now()));try{const fixed=this.fixedLength(record.bytes);const writing=request.body.pipeTo(fixed.writable,{signal:abort.signal});const putting=this.bucket.put(record.key,fixed.readable,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:record.mime},customMetadata:{expires:String(record.expires),purpose:'temporary-ocr-original'}}).then(value=>{if(!value){abort.abort();void fixed.readable.cancel().catch(()=>{});fail('source_exists');}return value;},error=>{abort.abort();void fixed.readable.cancel().catch(()=>{});throw error;});const settled=await Promise.allSettled([writing,putting]);if(settled[0].status!=='fulfilled')fail('incomplete_upload');if(settled[1].status==='fulfilled'){putResult=settled[1].value;if(!putResult)fail('source_exists');}else{const head=await this.bucket.head(record.key);if(!head||head.size!==record.bytes)fail('unconfirmed_upload');putResult=head;}
   const head=await this.bucket.head(record.key);if(!head||head.size!==record.bytes||head.etag!==putResult.etag)fail('unconfirmed_upload');
   let committed;await this.storage.transaction(async tx=>{const r=await tx.get('source');if(r.state!=='writing'||r.expires<=this.now())fail('source_closed');r.state='uploaded';r.etag=head.etag;await tx.put('source',r);committed=r;});return {id:committed.id,state:'uploaded',bytes:committed.bytes,expires:committed.expires};
  }catch{await this.revoke(owner).catch(()=>{});fail('upload_failed');}finally{clearTimeout(timeout);this.writers.delete(abort);}
 }
 async markVerified(owner,{documentHash,pages}){
  if(!hex.test(documentHash)||!Number.isInteger(pages)||pages<1||pages>1000)fail('invalid_verification');
  await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r||r.owner!==owner)fail('source_not_found');if(r.state!=='uploaded'||r.expires<=this.now()||r.documentHash||r.mime!=='application/pdf'&&pages!==1)fail('source_closed');r.documentHash=documentHash;r.pages=pages;await tx.put('source',r);});
 }
 async issueCapability(){
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),tokenHash=await hash(token);let expires;
  await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r||r.state!=='uploaded'||!r.documentHash||r.capabilityHash||r.expires<=this.now()||!await this.dispatchAuthorized(tx,r))fail('source_not_dispatchable');const bounded=await this.repeatConsent();expires=Math.min(this.now()+(bounded?OCR_SOURCE_REPEAT_MS:OCR_SOURCE_CAPABILITY_MS),r.expires,await this.dispatchDeadline());r.capabilityPolicy=bounded?OCR_SOURCE_BOUNDED_POLICY:'single-get-v1';r.providerReads=[];r.providerReadReservedBytes=0;r.capabilityHash=tokenHash;r.capabilityExpires=expires;await tx.put('source',r);});
  return {token,expires};
 }
 // Admissions reserve whole bytes before R2 access; neither failures nor restart replenish them.
 async delivery(update,index=null){try{await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r)return;r.delivery={...(r.delivery||{}),...update};if(index!==null&&r.providerReads?.[index])r.providerReads[index]={...r.providerReads[index],...update,...(update.finishedAt!==undefined?{active:false}:{})};await tx.put('source',r);});}catch{} }
 async serve(request){
  const admissionEpoch=this.revocationEpoch;
  if(request.method!=='GET')return safeError(405);if(request.headers.has('Range'))return safeError(416);const token=request.headers.get('X-Ocr-Source-Capability');if(!hex.test(token||''))return safeError();const tokenHash=await hash(token);let record;
  try{await this.storage.transaction(async tx=>{const r=await tx.get('source'),bounded=r?.capabilityPolicy===OCR_SOURCE_BOUNDED_POLICY,maxGets=bounded?OCR_SOURCE_MAX_READS:1;if(!r||r.state!=='uploaded'||r.providerAccessClosed||!bounded&&r.capabilityUsed||(r.providerReads||[]).length>=maxGets||(r.providerReads||[]).filter(x=>x.active).length>=(bounded?OCR_SOURCE_MAX_ACTIVE_READS:1)||(r.providerReadReservedBytes||0)+r.bytes>r.bytes*maxGets||r.capabilityExpires<=this.now()||r.expires<=this.now()||!equal(r.capabilityHash,tokenHash)||!await this.dispatchAuthorized(tx,r))fail('source_unavailable');r.providerReads||=[];const attemptIndex=r.providerReads.length;r.providerReads.push({active:true,startedAt:this.now(),reservedBytes:r.bytes,httpStatus:null,bytesEnqueued:0,streamComplete:false,outcome:'started'});r.providerReadReservedBytes=(r.providerReadReservedBytes||0)+r.bytes;r.capabilityUsed||=this.now()||1;r.delivery={httpStatus:null,expectedBytes:r.bytes,bytesEnqueued:0,streamComplete:false,outcome:'started',startedAt:r.capabilityUsed,finishedAt:null,reusedGetDenied:r.delivery?.reusedGetDenied||0};await tx.put('source',r);record={...r,attemptIndex};});
   const object=await this.bucket.get(record.key,{onlyIf:{etagMatches:record.etag}});if(!object?.body||object.size!==record.bytes){await this.delivery({httpStatus:503,outcome:'unavailable',finishedAt:this.now()},record.attemptIndex);return safeError(503);}// Recheck after asynchronous lookup: cancellation/terminal state may have won the race.
   const fresh=await this.read();if(admissionEpoch!==this.revocationEpoch||fresh?.state!=='uploaded'||fresh.providerAccessClosed||fresh.capabilityHash!==record.capabilityHash||record.capabilityExpires<=this.now()||record.expires<=this.now()||!await this.dispatchAuthorized(this.storage,record)||admissionEpoch!==this.revocationEpoch){void object.body.cancel().catch(()=>{});await this.delivery({httpStatus:404,outcome:'revoked',finishedAt:this.now()},record.attemptIndex);return safeError();}await this.delivery({httpStatus:200,outcome:'streaming'},record.attemptIndex);if(admissionEpoch!==this.revocationEpoch||record.capabilityExpires<=this.now()||record.expires<=this.now()){void object.body.cancel().catch(()=>{});await this.delivery({httpStatus:404,outcome:'revoked',finishedAt:this.now()},record.attemptIndex);return safeError();}
   // Hard original expiry and local revocation also terminate a started stream.
   const reader=object.body.getReader(),streamDeadline=Math.min(record.expires,record.capabilityExpires);let timer,closed=false,handle,bytesEnqueued=0;
   const cleanup=()=>{closed=true;clearTimeout(timer);this.readers.delete(handle);};
   const finish=async outcome=>this.delivery({bytesEnqueued,streamComplete:outcome==='complete',outcome,finishedAt:this.now()},record.attemptIndex);
   const body=new ReadableStream({start:controller=>{handle={stop:()=>{if(closed)return;cleanup();void reader.cancel().catch(()=>{});this.waitUntil(finish(streamDeadline<=this.now()?'expired':'revoked'));controller.error(new OcrSourceError('source_revoked'));}};this.readers.add(handle);timer=setTimeout(handle.stop,Math.max(1,streamDeadline-this.now()));},pull:async controller=>{if(closed)return;if(streamDeadline<=this.now()){handle.stop();return;}try{const result=await reader.read();if(closed)return;if(result.done){cleanup();await finish(bytesEnqueued===record.bytes?'complete':'length_mismatch');if(bytesEnqueued===record.bytes)controller.close();else controller.error(new OcrSourceError('source_length_mismatch'));}else{if(bytesEnqueued+result.value.byteLength>record.bytes){cleanup();await finish('length_mismatch');void reader.cancel().catch(()=>{});controller.error(new OcrSourceError('source_length_mismatch'));return;}bytesEnqueued+=result.value.byteLength;controller.enqueue(result.value);}}catch{if(!closed){cleanup();await finish('read_failed');controller.error(new OcrSourceError('source_read_failed'));}}},cancel:async()=>{if(closed)return;cleanup();await finish('cancelled');await reader.cancel().catch(()=>{});}});
   return new Response(body,{headers:{'Content-Type':record.mime,'Content-Length':String(record.bytes),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','ETag':object.httpEtag||'"'+record.etag+'"'}});
  }catch(error){if(record)await this.delivery({httpStatus:503,outcome:'unavailable',finishedAt:this.now()},record.attemptIndex);else{try{await this.storage.transaction(async tx=>{const r=await tx.get('source');if(r?.state==='uploaded'&&r.capabilityUsed&&equal(r.capabilityHash,tokenHash)&&r.delivery&&r.expires>this.now()&&r.capabilityExpires>this.now()&&(r.delivery.reusedGetDenied||0)<20){r.delivery.reusedGetDenied=(r.delivery.reusedGetDenied||0)+1;await tx.put('source',r);}});}catch{}}return safeError(error instanceof OcrSourceError?404:503);}
 }
 async closeProviderAccess(owner){await this.owned(owner);this.revocationEpoch++;await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r||r.owner!==owner)fail('source_not_found');r.providerAccessClosed=true;r.providerAccessClosedAt=this.now();await tx.put('source',r);});for(const reader of [...this.readers])reader.stop();}
 async revoke(owner){
  this.revocationEpoch++;
  await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r||r.owner!==owner)fail('source_not_found');r.state='revoked';r.cleanupAfter=this.now();await tx.put('source',r);});for(const writer of this.writers)writer.abort();for(const reader of [...this.readers])reader.stop();return this.cleanup();
 }
 async serializeCleanup(fn){const operation=this.cleanupQueue.then(fn);this.cleanupQueue=operation.catch(()=>{});return operation;}
 async diagnosticAvailable(owner){const r=await this.owned(owner);const head=await this.bucket.head(r.key);return {available:r.state!=='deleted'&&!!head&&head.size===r.bytes&&!!r.etag&&head.etag===r.etag,mime:r.mime,bytes:r.bytes,sha256:r.documentHash||null};}
 async retainDiagnostic(owner,reportId,expires){return this.serializeCleanup(async()=>{
  if(!uuid.test(reportId)||!Number.isSafeInteger(expires)||expires<=this.now()||expires>this.now()+7*86400000)fail('invalid_diagnostic_retention');
  const available=await this.diagnosticAvailable(owner);if(!available.available)return available;
  await this.storage.transaction(async tx=>{const r=await tx.get('source');r.diagnosticReports=(r.diagnosticReports||[]).filter(v=>v.expires>this.now());if(r.diagnosticReports.length>=20&&!r.diagnosticReports.some(v=>v.id===reportId))fail('diagnostic_limit');if(!r.diagnosticReports.some(v=>v.id===reportId))r.diagnosticReports.push({id:reportId,expires});r.diagnosticUntil=Math.max(...r.diagnosticReports.map(v=>v.expires));await tx.put('source',r);});const r=await this.read(),retained=r.diagnosticReports.find(v=>v.id===reportId);await this.alarmAt(retained.expires);return {...available,expires:retained.expires};
 });}
 async diagnosticResponse(owner,reportId){
  const r=await this.owned(owner),consent=r.diagnosticReports?.find(v=>v.id===reportId&&v.expires>this.now());if(!consent)return safeError(410);
  const object=await this.bucket.get(r.key,{onlyIf:{etagMatches:r.etag}});if(!object||object.size!==r.bytes)return safeError(410);
  const reader=object.body.getReader();let timer,closed=false;const stop=()=>{if(closed)return;closed=true;clearTimeout(timer);void reader.cancel().catch(()=>{});};
  const body=new ReadableStream({start:controller=>{timer=setTimeout(()=>{stop();controller.error(new OcrSourceError('diagnostic_expired'));},Math.max(1,consent.expires-this.now()));},pull:async controller=>{if(closed)return;if(consent.expires<=this.now()){stop();controller.error(new OcrSourceError('diagnostic_expired'));return;}try{const result=await reader.read();if(closed)return;if(result.done){stop();controller.close();}else controller.enqueue(result.value);}catch{stop();controller.error(new OcrSourceError('diagnostic_unavailable'));}},cancel:stop});
  return new Response(body,{headers:{'Content-Type':r.mime,'Content-Length':String(r.bytes),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="diagnostic-scan"'}});
 }
 async cleanup(){return this.serializeCleanup(()=>this.cleanupLocked());}
 async cleanupLocked(){
  let r=await this.read();if(!r)return true;if(r.state!=='revoked'&&r.state!=='deleted'&&r.expires<=this.now()){await this.storage.transaction(async tx=>{const v=await tx.get('source');v.state='revoked';v.cleanupAfter=this.now();await tx.put('source',v);});r=await this.read();for(const writer of this.writers)writer.abort();for(const reader of [...this.readers])reader.stop();}
  if(r.state!=='revoked')return r.state==='deleted';
  if(r.diagnosticUntil>this.now()){await this.alarmAt(r.diagnosticUntil);return false;}
  try{await this.bucket.delete(r.key);await this.storage.transaction(async tx=>{const v=await tx.get('source');v.state='deleted';delete v.cleanupAfter;await tx.put('source',v);});return true;}catch{await this.alarmAt(this.now()+OCR_SOURCE_CLEANUP_RETRY_MS);return false;}
 }
}
export {uuid as OCR_JOB_ID_PATTERN};

export function sourceDeliveryDiagnostics(r){if(!r?.delivery)return null;const bounded=r.capabilityPolicy===OCR_SOURCE_BOUNDED_POLICY;return {...r.delivery,readLimit:bounded?OCR_SOURCE_MAX_READS:1,reads:(r.providerReads||[]).slice(0,OCR_SOURCE_MAX_READS).map(v=>({httpStatus:v.httpStatus??null,expectedBytes:v.reservedBytes,bytesEnqueued:v.bytesEnqueued,streamComplete:v.streamComplete===true,outcome:v.outcome,startedAt:v.startedAt,finishedAt:v.finishedAt??null,active:v.active===true})),reservedBytes:r.providerReadReservedBytes||0,maxReservedBytes:r.bytes*(bounded?OCR_SOURCE_MAX_READS:1),grantExpiresAt:r.capabilityExpires??null,accessClosed:r.providerAccessClosed===true||r.state!=='uploaded'};}
