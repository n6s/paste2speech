// Private staging original-file lifecycle. No source bytes or clear capability
// are stored in Durable Object state, D1, URLs returned to users, or logs.
export const OCR_SOURCE_MAX_BYTES=50_000_000;
export const OCR_SOURCE_LIFETIME_MS=3_600_000;
export const OCR_SOURCE_CAPABILITY_MS=900_000;
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
 constructor(storage,bucket,{now=Date.now,fixedLength=n=>new FixedLengthStream(n),dispatchAuthorized=async()=>false}={}){this.storage=storage;this.bucket=bucket;this.now=now;this.fixedLength=fixedLength;this.dispatchAuthorized=dispatchAuthorized;this.readers=new Set();this.writers=new Set();}
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
  await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r||r.state!=='uploaded'||!r.documentHash||r.capabilityHash||r.expires<=this.now()||!await this.dispatchAuthorized(tx,r))fail('source_not_dispatchable');expires=Math.min(this.now()+OCR_SOURCE_CAPABILITY_MS,r.expires);r.capabilityHash=tokenHash;r.capabilityExpires=expires;await tx.put('source',r);});
  return {token,expires};
 }
 async serve(request){
  if(request.method!=='GET')return safeError(405);if(request.headers.has('Range'))return safeError(416);const token=request.headers.get('X-Ocr-Source-Capability');if(!hex.test(token||''))return safeError();const tokenHash=await hash(token);let record;
  try{await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r||r.state!=='uploaded'||r.capabilityUsed||r.capabilityExpires<=this.now()||r.expires<=this.now()||!equal(r.capabilityHash,tokenHash)||!await this.dispatchAuthorized(tx,r))fail('source_unavailable');r.capabilityUsed=this.now()||1;await tx.put('source',r);record=r;});
   const object=await this.bucket.get(record.key,{onlyIf:{etagMatches:record.etag}});if(!object?.body||object.size!==record.bytes)return safeError(503);
   // Hard original expiry and local revocation also terminate a started stream.
   const reader=object.body.getReader();let timer,closed=false,handle;const cleanup=()=>{closed=true;clearTimeout(timer);this.readers.delete(handle);};
   const body=new ReadableStream({start:controller=>{handle={stop:()=>{if(closed)return;cleanup();void reader.cancel().catch(()=>{});controller.error(new OcrSourceError('source_revoked'));}};this.readers.add(handle);timer=setTimeout(handle.stop,Math.max(1,record.expires-this.now()));},pull:async controller=>{if(closed)return;if(record.expires<=this.now()){handle.stop();return;}try{const result=await reader.read();if(closed)return;if(result.done){cleanup();controller.close();}else controller.enqueue(result.value);}catch{if(!closed){cleanup();controller.error(new OcrSourceError('source_read_failed'));}}},cancel:async()=>{cleanup();await reader.cancel().catch(()=>{});}});
   return new Response(body,{headers:{'Content-Type':record.mime,'Content-Length':String(record.bytes),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','ETag':object.httpEtag||'"'+record.etag+'"'}});
  }catch(error){return safeError(error instanceof OcrSourceError?404:503);}
 }
 async revoke(owner){
  await this.storage.transaction(async tx=>{const r=await tx.get('source');if(!r||r.owner!==owner)fail('source_not_found');r.state='revoked';r.cleanupAfter=this.now();await tx.put('source',r);});for(const writer of this.writers)writer.abort();for(const reader of [...this.readers])reader.stop();return this.cleanup();
 }
 async cleanup(){
  let r=await this.read();if(!r)return true;if(r.state!=='revoked'&&r.state!=='deleted'&&r.expires<=this.now()){await this.storage.transaction(async tx=>{const v=await tx.get('source');v.state='revoked';v.cleanupAfter=this.now();await tx.put('source',v);});r=await this.read();for(const writer of this.writers)writer.abort();for(const reader of [...this.readers])reader.stop();}
  if(r.state!=='revoked')return r.state==='deleted';
  try{await this.bucket.delete(r.key);await this.storage.transaction(async tx=>{const v=await tx.get('source');v.state='deleted';delete v.cleanupAfter;await tx.put('source',v);});return true;}catch{await this.alarmAt(this.now()+OCR_SOURCE_CLEANUP_RETRY_MS);return false;}
 }
}
export {uuid as OCR_JOB_ID_PATTERN};
