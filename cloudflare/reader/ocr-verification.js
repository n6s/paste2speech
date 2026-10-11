import {verifiedLargePdfPages} from './pdf-admission.js';
import {validateDocumentBytes} from '../../public/document-format.js';
import {OcrSourceError} from './ocr-source.js';
// One large original allocation per isolate, also when multiple DO instances
// share it. Queued verification allocates no original bytes while waiting.
let verificationTail=Promise.resolve(),activeVerificationAllocations=0,maxObservedVerificationAllocations=0;
export async function withOcrVerificationAllocation(operation){const previous=verificationTail;let release;verificationTail=new Promise(r=>release=r);await previous;activeVerificationAllocations++;maxObservedVerificationAllocations=Math.max(maxObservedVerificationAllocations,activeVerificationAllocations);try{return await operation();}finally{activeVerificationAllocations--;release();}}
export async function verifyOcrSource(source,owner,{measure=false}={}){
 return withOcrVerificationAllocation(async()=>{
  const record=await source.owned(owner);if(record.state!=='uploaded'||record.expires<=source.now())throw new OcrSourceError('source_closed');
  if(record.documentHash)return {documentHash:record.documentHash,pages:record.pages,bytes:record.bytes,cached:true};
  const object=await source.bucket.get(record.key,{onlyIf:{etagMatches:record.etag}});if(!object?.body||object.size!==record.bytes)throw new OcrSourceError('source_changed');
  const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.byteLength!==record.bytes)throw new OcrSourceError('source_incomplete');// Only reuse the shared magic-header check; its full-file limit belongs to
  // the 20 MiB local importer, not this explicitly bounded 50 MB server path.
  validateDocumentBytes(bytes.subarray(0,12),record.mime);
  // Hash before constructing the parse context, so temporary native digest work
  // does not overlap its retained structural objects. Never base64 the original.
  const hashStart=performance.now(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),hashWallMs=performance.now()-hashStart;
  let stats;const parseStart=performance.now(),pages=record.mime==='application/pdf'?await verifiedLargePdfPages(bytes,s=>stats=s):1,parseWallMs=performance.now()-parseStart;
  try{await source.markVerified(owner,{documentHash:hash,pages});}catch(error){const recovered=await source.owned(owner);if(recovered.documentHash!==hash||recovered.pages!==pages||recovered.state!=='uploaded')throw error;}
  return {documentHash:hash,pages,bytes:record.bytes,...(measure?{resource:{hashWallMs,parseWallMs,activeVerificationAllocations,maxObservedVerificationAllocations,...stats}}:{})};
 });
}
