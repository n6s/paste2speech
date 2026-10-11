import {OCR_SOURCE_MAX_BYTES,OCR_SOURCE_MIMES} from './ocr-source.js';
const rejected=()=>Response.json({detail:'The upload cannot be accepted. Nothing was sent to OCR or charged.'},{status:422,headers:{'Cache-Control':'no-store'}});
// Caller supplies an authenticated account and its bound job stub. Forward no
// incoming auth/account headers. Keep the HTTP context alive until its native
// stream pump has completed or stopped, including an early DO rejection.
export async function proxyOcrSourceUpload(request,stub,owner){
 let metadata;try{const state=await stub.fetch('https://ocr-job/upload-state',{headers:{'X-Ocr-Owner':owner}});if(!state.ok){await request.body?.cancel().catch(()=>{});return state;}metadata=await state.json();}catch{await request.body?.cancel().catch(()=>{});return rejected();}
 const declared=request.headers.get('Content-Length');
 if(request.method!=='PUT'||!request.body||metadata.state!=='awaiting-upload'||!Number.isSafeInteger(metadata.bytes)||metadata.bytes<1||metadata.bytes>OCR_SOURCE_MAX_BYTES||!OCR_SOURCE_MIMES.includes(metadata.mime)||request.headers.get('Content-Type')!==metadata.mime||declared!==null&&declared!==String(metadata.bytes)){await request.body?.cancel().catch(()=>{});return rejected();}
 const fixed=new FixedLengthStream(metadata.bytes),abort=new AbortController(),writing=request.body.pipeTo(fixed.writable,{signal:abort.signal});
 try{const response=await stub.fetch(new Request('https://ocr-job/upload',{method:'PUT',headers:{'Content-Type':metadata.mime,'X-Ocr-Owner':owner},body:fixed.readable}));if(!response.ok){abort.abort();await fixed.readable.cancel().catch(()=>{});}await writing.catch(()=>{});return response;}
 catch{abort.abort();await fixed.readable.cancel().catch(()=>{});await writing.catch(()=>{});return rejected();}
}
