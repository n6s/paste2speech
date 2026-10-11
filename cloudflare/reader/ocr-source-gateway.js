// Dedicated staging gateway. It has only the OCR job namespace binding, no R2,
// D1, app-session, account, payment, admin, or provider-credential binding.
import {OCR_JOB_ID_PATTERN} from './ocr-source.js';
const deny=(status=404)=>new Response('Source unavailable.',{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export default {
 async fetch(request,env){
  if(env.READER_MODE!=='staging'||env.OCR_SOURCE_GATEWAY_APPROVED!=='1'||!env.OCR_JOBS)return deny();
  if(request.method!=='GET')return deny(405);if(request.headers.has('Range'))return deny(416);
  const url=new URL(request.url),parts=url.pathname.split('/');
  if(url.search||parts.length!==4||parts[1]!=='v1'||!OCR_JOB_ID_PATTERN.test(parts[2])||!/^[0-9a-f]{64}$/.test(parts[3]))return deny();
  try{return await env.OCR_JOBS.get(env.OCR_JOBS.idFromName(parts[2])).fetch('https://ocr-job/provider-source',{method:'GET',headers:{'X-Ocr-Source-Capability':parts[3]}});}catch{return deny(503);}
 }
};
