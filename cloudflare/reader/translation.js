import {UnifiedWallet} from './unified-wallet.js';
import {readerFeature,featureCustomer,featureAdmissionLimit} from './reader-features.js';
import {TranslationDocuments} from './translation-documents.js';
import {TRANSLATION_LANGUAGES,TRANSLATION_MAX_CHARACTERS,validateTranslation} from '../../public/translation-contract.js';
import {readBounded,translationAccessToken} from '../prepared/google.js';
import {TranslationCredits,TRANSLATION_RATE} from './translation-credits.js';
const PROJECT='paste-to-speech';
// Versioned public release and staging have separate credential identities.
// A temporary proof-only flag additionally caps dispatches during agent testing.
const LIVE_IMPLEMENTATION_APPROVED=true;
export function translationResponse(request,env,account=null,{ctx}={}){
 if(!readerFeature(env,'TRANSLATION_UI'))return Response.json({}, {status:404});
 const path=new URL(request.url).pathname;
 if(LIVE_IMPLEMENTATION_APPROVED&&readerFeature(env,'TRANSLATION_LIVE_APPROVED')&&readerFeature(env,'TRANSLATION_BILLING_SCHEMA'))return liveTranslationResponse(request,env,account,{ctx});
 if(request.method==='GET'&&path==='/api/translation/config')return Response.json({enabled:false,reason:'live_testing_not_approved',detail:`Translation is ready for staging review. The approved price is ${TRANSLATION_RATE} credits per 1,000 source characters, prorated. Live Google translation is not enabled yet. No text is sent and no credits are used.`,priceCreditsPer1000:TRANSLATION_RATE,maxCharacters:TRANSLATION_MAX_CHARACTERS,languages:TRANSLATION_LANGUAGES,scope:account?.translationScope||null},{headers:{'Cache-Control':'no-store'}});
 return Response.json({code:'live_testing_not_approved',dispatched:false,creditsUsed:0,detail:'Translation is not enabled yet. Nothing was sent to Google and no credits were used.'},{status:503,headers:{'Cache-Control':'no-store'}});
}
// Prepared integration seam, tested with synthetic wallets/provider injection.
// Every dispatch is behind authenticated, durable credit admission.
export async function liveTranslationResponse(request,env,account,{ctx,provider}={}){
 const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(!readerFeature(env,'TRANSLATION_UI'))return json({},404);
 if(!featureCustomer(env,account,'translationVerified'))return json({detail:'Sign in with a verified reader account. Nothing was sent.'},403);
 if(request.method==='GET'&&new URL(request.url).pathname==='/api/translation/config')return json({enabled:env.PAID_ADMISSIONS_PAUSED!=='1',wallet:await new UnifiedWallet(env.LEDGER,env).balance(account.id),scope:account.translationScope,priceCreditsPer1000:TRANSLATION_RATE,maxCharacters:TRANSLATION_MAX_CHARACTERS,documents:readerFeature(env,'TRANSLATION_DOCUMENT_SCHEMA'),languages:TRANSLATION_LANGUAGES,...(env.TRANSLATION_LIVE_TEST_BUDGET==='1'?{limitedLiveTest:true}:{})});
 if(new URL(request.url).pathname.startsWith('/api/translation/documents')){
  if(!readerFeature(env,'TRANSLATION_DOCUMENT_SCHEMA'))return json({},404);
  const service=new TranslationDocuments(env,{provider:provider||((text,target)=>translateWithGoogle(text,target,env.GOOGLE_TRANSLATION_SERVICE_ACCOUNT_JSON,{environment:env.READER_MODE}))});
  let input;try{input=JSON.parse(new TextDecoder().decode(await readBounded(request,1000000)));}catch{return json({detail:'Translation plan exceeds the 1 MB request envelope or is invalid. Source is unchanged.'},422);}
  if(request.method!=='POST'||input.scope!==account.translationScope||input.priceCreditsPer1000!==4)return json({detail:'Review the current account and quote.'},409);
  const operations={open:()=>service.open(account,input),lookup:()=>service.lookup(account,input),status:()=>service.status(account,input.id),pause:()=>service.pause(account,input.id),resume:()=>service.resume(account,input.id),part:()=>service.part(account,input.id,input.part,input.text)};
  if(!Object.hasOwn(operations,input.action))return json({},422);
  if(['open','resume'].includes(input.action)&&!await featureAdmissionLimit(env,account))return json({detail:'Too many new requests. Please try again shortly; saved translations are kept.'},429);
  const operation=operations[input.action]();ctx?.waitUntil(operation.catch(()=>{}));try{return json(await operation);}catch(error){const detail=String(error?.message).includes('insufficient shared credits')?'There are not enough available credits for the remaining quoted translation. Completed portions are kept; add credits or translate a smaller document.':error?.message==='Pause the current translation before starting another document.'?error.message:'Document operation could not be confirmed. Completed portions are kept. Check the same document before retrying; no automatic paid retry.';return json({detail},409);}
 }
 if(request.method!=='POST'||new URL(request.url).pathname!=='/api/translation')return json({},405);
 let input;try{input=JSON.parse(new TextDecoder().decode(await readBounded(request,256000)));}catch{return json({detail:'Translation input is invalid or too large. Nothing was sent.'},422);}
 if(input.scope!==account.translationScope||input.requestId!==request.headers.get('Idempotency-Key'))return json({detail:'The account or request changed. Review the current quote. Nothing was sent.'},409);
 if(!await featureAdmissionLimit(env,account))return json({detail:'Too many new requests. Please try again shortly; saved translations are kept.'},429);
 const service=new TranslationCredits(env,{provider:provider||((text,target)=>translateWithGoogle(text,target,env.GOOGLE_TRANSLATION_SERVICE_ACCOUNT_JSON,{environment:env.READER_MODE}))});
 const operation=service.request(account,input);ctx?.waitUntil(operation.catch(()=>{}));
 try{const result=await operation;return json(result,result.status);}catch{return json({detail:'Translation admission could not be confirmed. Check the same request; no automatic retry was made.'},409);}
}
// Server-only standard NMT adapter. Durable admission precedes every call.
// Failure metadata contains only a bounded stage/status, never provider text or credentials.
export async function translateWithGoogle(text,target,credential,{fetcher=(...a)=>globalThis.fetch(...a),signal,environment='staging'}={}){
 validateTranslation(text,target);
 let account;try{account=JSON.parse(credential);if(account.project_id!==PROJECT||account.client_email!==(environment==='production-public'?'p2s-translation-production@paste-to-speech.iam.gserviceaccount.com':environment==='staging'?'p2s-translation-staging@paste-to-speech.iam.gserviceaccount.com':null))throw Error();}catch{throw Object.assign(Error('Translation credential does not match its deployment.'),{translationNotDispatched:true,translationStage:'authorization'});}
 let token;try{if(signal?.aborted)throw Error('Canceled before dispatch');token=await translationAccessToken(credential,{fetcher});}catch{throw Object.assign(Error('Translation authorization failed before text was sent.'),{translationNotDispatched:true,translationStage:'authorization'});}
 let response;try{response=await fetcher(`https://translate.googleapis.com/v3/projects/${PROJECT}/locations/global:translateText`,{method:'POST',redirect:'manual',signal:signal||AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({contents:[text],targetLanguageCode:target,mimeType:'text/plain',model:`projects/${PROJECT}/locations/global/models/general/nmt`})});}catch{throw Object.assign(Error('Translation transport outcome is unresolved.'),{translationStage:'provider_transport'});}
 if(!response.ok){
  let detail;try{detail=JSON.parse(new TextDecoder().decode(await readBounded(response,64000))).error;}catch{}
  const codes=['PERMISSION_DENIED','UNAUTHENTICATED','NOT_FOUND','INVALID_ARGUMENT','RESOURCE_EXHAUSTED','UNAVAILABLE','INTERNAL','FAILED_PRECONDITION'];
  const reasons=['SERVICE_DISABLED','BILLING_DISABLED','IAM_PERMISSION_DENIED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','CONSUMER_INVALID'];const reason=detail?.details?.find(value=>reasons.includes(value?.reason))?.reason;
  throw Object.assign(Error('Translation did not complete. The provider outcome needs reconciliation before any retry.'),{translationRejected:[400,401,403,413,422].includes(response.status),translationStage:'provider_http',translationStatus:response.status,...(codes.includes(detail?.status)?{translationCode:detail.status}:{}),...(reason?{translationReason:reason}:{})});
 }
 let body;try{body=JSON.parse(new TextDecoder().decode(await readBounded(response,1000000)));}catch{throw Object.assign(Error('The provider response could not be verified.'),{translationStage:'provider_response',translationStatus:response.status});}
 if(body.translations?.length!==1||typeof body.translations[0].translatedText!=='string'||!body.translations[0].translatedText.trim())throw Object.assign(Error('A complete translation was not returned.'),{translationStage:'provider_response',translationStatus:response.status});
 return {text:body.translations[0].translatedText,target,sourceLanguage:body.translations[0].detectedLanguageCode||null};
}
