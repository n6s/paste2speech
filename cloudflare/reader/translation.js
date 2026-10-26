import {TRANSLATION_LANGUAGES,TRANSLATION_MAX_CHARACTERS,validateTranslation} from '../../public/translation-contract.js';
import {readBounded,translationAccessToken} from '../prepared/google.js';
import {TranslationCredits,TRANSLATION_RATE} from './translation-credits.js';
const PROJECT='paste-to-speech';
// Staging translation is approved; production remains excluded.
// A temporary proof-only flag additionally caps dispatches during agent testing.
const LIVE_IMPLEMENTATION_APPROVED=true;
export function translationResponse(request,env,account=null,{ctx}={}){
 if(env.READER_MODE!=='staging'||env.TRANSLATION_UI!=='1')return Response.json({}, {status:404});
 const path=new URL(request.url).pathname;
 if(LIVE_IMPLEMENTATION_APPROVED&&env.TRANSLATION_LIVE_APPROVED==='1'&&env.TRANSLATION_BILLING_SCHEMA==='1')return liveTranslationResponse(request,env,account,{ctx});
 if(request.method==='GET'&&path==='/api/translation/config')return Response.json({enabled:false,reason:'live_testing_not_approved',detail:`Translation is ready for staging review. The approved price is ${TRANSLATION_RATE} credits per 1,000 source characters, prorated. Live Google translation is not enabled yet. No text is sent and no credits are used.`,priceCreditsPer1000:TRANSLATION_RATE,maxCharacters:TRANSLATION_MAX_CHARACTERS,languages:TRANSLATION_LANGUAGES,scope:account?.translationScope||null},{headers:{'Cache-Control':'no-store'}});
 return Response.json({code:'live_testing_not_approved',dispatched:false,creditsUsed:0,detail:'Translation is not enabled yet. Nothing was sent to Google and no credits were used.'},{status:503,headers:{'Cache-Control':'no-store'}});
}
// Prepared integration seam, tested with synthetic wallets/provider injection.
// The public router above cannot reach this until separate live-test approval.
export async function liveTranslationResponse(request,env,account,{ctx,provider}={}){
 const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(env.READER_MODE!=='staging'||env.TRANSLATION_UI!=='1')return json({},404);
 if(!account?.translationVerified||account.email!==env.OWNER_EMAIL||account.enabled!==1)return json({detail:'Sign in with the staging owner account. Nothing was sent.'},403);
 if(request.method==='GET'&&new URL(request.url).pathname==='/api/translation/config')return json({enabled:true,scope:account.translationScope,priceCreditsPer1000:TRANSLATION_RATE,maxCharacters:TRANSLATION_MAX_CHARACTERS,languages:TRANSLATION_LANGUAGES,...(env.TRANSLATION_LIVE_TEST_BUDGET==='1'?{limitedLiveTest:true}:{})});
 if(request.method!=='POST'||new URL(request.url).pathname!=='/api/translation')return json({},405);
 let input;try{input=JSON.parse(new TextDecoder().decode(await readBounded(request,256000)));}catch{return json({detail:'Translation input is invalid or too large. Nothing was sent.'},422);}
 if(input.scope!==account.translationScope||input.requestId!==request.headers.get('Idempotency-Key'))return json({detail:'The account or request changed. Review the current quote. Nothing was sent.'},409);
 const service=new TranslationCredits(env,{provider:provider||((text,target)=>translateWithGoogle(text,target,env.GOOGLE_TRANSLATION_SERVICE_ACCOUNT_JSON))});
 const operation=service.request(account,input);ctx?.waitUntil(operation.catch(()=>{}));
 try{const result=await operation;return json(result,result.status);}catch{return json({detail:'Translation admission could not be confirmed. Check the same request; no automatic retry was made.'},409);}
}
// Server-only adapter, deliberately not reachable from the gated HTTP handler.
// Future durable admission must precede this call, with no blind provider retry.
export async function translateWithGoogle(text,target,credential,{fetcher=(...a)=>globalThis.fetch(...a),signal}={}){
 validateTranslation(text,target);
 let account;try{account=JSON.parse(credential);if(account.project_id!==PROJECT||account.client_email!=='p2s-translation-staging@paste-to-speech.iam.gserviceaccount.com')throw Error();}catch{throw Object.assign(Error('Translation credential does not match staging.'),{translationNotDispatched:true});}
 let token;try{if(signal?.aborted)throw Error('Canceled before dispatch');token=await translationAccessToken(credential,{fetcher});}catch{throw Object.assign(Error('Translation authorization failed before text was sent.'),{translationNotDispatched:true});}
 const response=await fetcher(`https://translation.googleapis.com/v3/projects/${PROJECT}/locations/global:translateText`,{method:'POST',redirect:'error',signal:signal||AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({contents:[text],targetLanguageCode:target,mimeType:'text/plain',model:`projects/${PROJECT}/locations/global/models/general/nmt`})});
 if(!response.ok)throw Object.assign(Error('Translation did not complete. The provider outcome needs reconciliation before any retry.'),{translationRejected:[400,401,403,413,422].includes(response.status)});
 const body=JSON.parse(new TextDecoder().decode(await readBounded(response,1000000)));
 if(body.translations?.length!==1||typeof body.translations[0].translatedText!=='string'||!body.translations[0].translatedText.trim())throw Error('A complete translation was not returned.');
 return {text:body.translations[0].translatedText,target,sourceLanguage:body.translations[0].detectedLanguageCode||null};
}
