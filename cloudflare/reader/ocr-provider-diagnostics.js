// Never persist provider bodies, signed URLs, credentials, filenames or arbitrary messages.
export const PROVIDER_ERROR_CATEGORIES=['source_fetch_error','document_rejected','request_rejected','authentication_error','rate_limited','provider_unavailable','bad_request_unspecified','provider_error'];
export const PROVIDER_ERROR_CODES=['invalid_request_error','validation_error','invalid_request','bad_request','invalid_document','unsupported_document','unsupported_image','invalid_image','image_decode_error','file_download_error','url_fetch_failed','document_fetch_error','rate_limit_exceeded','authentication_error','permission_denied','context_length_exceeded','internal_server_error'];
const codes=new Set(PROVIDER_ERROR_CODES);
export function safeProviderRequestId(value,secrets=[]){return typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(value)&&!secrets.some(s=>s&&value.includes(s))?value:null;}
const byStatus=status=>status===401||status===403?'authentication_error':status===429?'rate_limited':status>=500?'provider_unavailable':status===400?'bad_request_unspecified':'provider_error';
export async function providerRejection(response,{secrets=[],limit=4096,timeoutMs=2000}={}){
 const requestId=safeProviderRequestId(response.headers.get('x-request-id')||response.headers.get('x-mistral-request-id'),secrets);
 const base={category:byStatus(response.status),classificationSource:'http_status_only',code:null,bodyState:'unavailable'};
 const reader=response.body?.getReader();if(!reader)return {requestId,error:base};let timer;
 const read=async()=>{let n=0,parts=[];try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>limit){void reader.cancel().catch(()=>{});return {requestId,error:{...base,bodyState:'oversized'}};}parts.push(r.value);}const bytes=new Uint8Array(n);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}const value=JSON.parse(new TextDecoder().decode(bytes)),detail=value.error&&typeof value.error==='object'?value.error:value;const candidate=typeof detail.code==='string'?detail.code:typeof detail.type==='string'?detail.type:null,code=codes.has(candidate)?candidate:null;
  const text=[detail.message,detail.detail,value.message,value.detail].filter(x=>typeof x==='string').join(' ').toLowerCase();let category=base.category,source='http_status_only';
  if(code){source='provider_code';if(/fetch|download/.test(code))category='source_fetch_error';else if(/document|image/.test(code))category='document_rejected';else if(/invalid|validation|bad_request|context_length/.test(code))category='request_rejected';else if(/authentication|permission/.test(code))category='authentication_error';else if(/rate_limit/.test(code))category='rate_limited';else if(/server_error/.test(code))category='provider_unavailable';}
  if((!code||['invalid_request_error','invalid_request','bad_request','validation_error'].includes(code))&&/(?:failed|unable|cannot|could not).{0,40}(?:download|fetch|retrieve)|(?:download|fetch|retrieve).{0,40}(?:failed|error|unavailable)/.test(text)){category='source_fetch_error';source='message_pattern';}
  else if((!code||['invalid_request_error','invalid_request','bad_request','validation_error'].includes(code))&&/unsupported.{0,30}(?:image|document|format)|(?:image|document).{0,30}(?:invalid|decode|corrupt)/.test(text)){category='document_rejected';source='message_pattern';}
  else if(!code&&/validation|invalid request|invalid parameter|unsupported parameter/.test(text)){category='request_rejected';source='message_pattern';}
  return {requestId,error:{category,classificationSource:source,code,bodyState:'parsed'}};
 }catch{return {requestId,error:{...base,bodyState:'unreadable'}};}};
 try{return await Promise.race([read(),new Promise(resolve=>{timer=setTimeout(()=>{resolve({requestId,error:{...base,bodyState:'timeout'}});void reader.cancel().catch(()=>{});},timeoutMs);})]);}finally{clearTimeout(timer);}
}
