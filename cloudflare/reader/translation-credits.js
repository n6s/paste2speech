import {readerFeature,featureCustomer} from './reader-features.js';
import {TranslationDocuments} from './translation-documents.js';
import {assertUnifiedEnvironment,UnifiedWallet} from './unified-wallet.js';
import {translationIdentity,validateTranslation} from '../../public/translation-contract.js';
export const TRANSLATION_RATE=4;
export class TranslationCredits{
 constructor(env,{now=Date.now,provider,diagnose=event=>console.warn(JSON.stringify(event))}={}){this.env=env;this.db=env.LEDGER;this.now=now;this.provider=provider;this.diagnose=diagnose;this.wallet=new UnifiedWallet(this.db,env);}
 query(sql,...values){return this.db.prepare(sql).bind(...values);}
 async read(id,account){return this.query('SELECT * FROM translation_attempts WHERE id=? AND account=?',id,account).first();}
 async expire(){const time=this.now();await this.query("UPDATE translation_attempts SET state='expired',updated=?,retry_safe=CASE WHEN dispatched IS NULL THEN 1 ELSE 0 END WHERE state='held' AND deadline<?",time,time).run();await this.query("UPDATE translation_attempts SET state='expired',updated=?,result=NULL,retry_safe=1 WHERE state='ready' AND expires<=?",time,time).run();}
 async request(account,input){
  if(!readerFeature(this.env,'TRANSLATION_UI')||!featureCustomer(this.env,account,'translationVerified'))throw Error('Verified reader account required.');
  if(typeof this.provider!=='function')throw Error('Translation provider is disabled.');
  await assertUnifiedEnvironment(this.db,this.env);await this.expire();
  const {text,target,characters}=validateTranslation(input.text,input.target);
  if(input.priceCreditsPer1000!==TRANSLATION_RATE||!/^[-0-9a-f]{36}$/.test(input.requestId||''))throw Error('Review the exact translation price and request identity.');
  const fingerprint=await translationIdentity(text,target,account.id),units=characters*TRANSLATION_RATE;
  let row=await this.read(input.requestId,account.id);
  if(row&&row.fingerprint!==fingerprint)throw Error('Translation request identity was reused for different content.');
  if(!row)row=await this.query("SELECT * FROM translation_attempts WHERE account=? AND fingerprint=? ORDER BY created DESC,rowid DESC LIMIT 1",account.id,fingerprint).first();
  if(row?.state==='ready')return {status:200,id:row.id,text:row.result,target,cached:true,creditsUsed:0,originalCredits:row.consumed/1000};
  if(this.env.PAID_ADMISSIONS_PAUSED==='1')throw Error('New translation is paused. Saved results are kept.');
  if(row?.state==='held')return {status:202,id:row.id,pending:true,detail:'The same translation is already processing. No second request was dispatched.'};
  if(row){
   if(!row.retry_safe||input.retryOf!==row.id||input.requestId===row.id)return {status:409,id:row.id,retryEligible:!!row.retry_safe,detail:row.retry_safe?'The prior translation failed or expired. A new paid attempt needs an explicit request at the current quote.':'The prior provider outcome is unresolved. No automatic paid retry is allowed.'};
  }
  const time=this.now(),prior=row?.id||null;
  try{await this.query('INSERT INTO translation_attempts(id,account,fingerprint,target,characters,units,created,updated,deadline,expires,retry_of) VALUES(?,?,?,?,?,?,?,?,?,?,?)',input.requestId,account.id,fingerprint,target,characters,units,time,time,time+120000,time+86400000,prior).run();}
  catch(error){const existing=await this.query("SELECT id FROM translation_attempts WHERE account=? AND fingerprint=? AND state IN('held','ready')",account.id,fingerprint).first();if(existing)return this.request(account,{...input,requestId:existing.id});throw error;}
  const bounded=this.env.TRANSLATION_LIVE_TEST_BUDGET==='1';
  const budget=bounded?" AND (SELECT COUNT(*) FROM translation_attempts WHERE dispatched IS NOT NULL)<2 AND (SELECT COALESCE(SUM(characters),0) FROM translation_attempts WHERE dispatched IS NOT NULL)+?<=5000":"";
  const claimed=await this.query("UPDATE translation_attempts SET dispatched=?,updated=? WHERE id=? AND account=? AND state='held' AND dispatched IS NULL AND deadline>?"+budget,this.now(),this.now(),input.requestId,account.id,this.now(),...(bounded?[characters]:[])).run();
  if(bounded&&claimed.meta?.changes!==1){
   const row=await this.read(input.requestId,account.id);
   if(row?.state==='held'&&row.dispatched===null){await this.query("UPDATE translation_attempts SET state='failed',updated=?,retry_safe=1 WHERE id=? AND account=? AND state='held' AND dispatched IS NULL",this.now(),input.requestId,account.id).run();return {status:409,id:input.requestId,creditsUsed:0,detail:'The bounded staging translation test budget is exhausted or this input exceeds it. Nothing was sent; held credits were returned. Saved translations can still be reopened.'};}
  }
  if(claimed.meta?.changes!==1)return {status:202,id:input.requestId,pending:true,detail:'Translation dispatch is being reconciled. No second provider call was made.'};
  let phase='provider';
  try{
   const result=await this.provider(text,target);
   phase='provider_result';
   if(typeof result?.text!=='string'||!result.text.trim()||result.target!==target||Array.from(result.text).length>120000)throw Error('A complete usable translation was not returned.');
   phase='settlement';
   await this.query("UPDATE translation_attempts SET state='ready',result=?,updated=? WHERE id=? AND account=? AND state='held' AND deadline>=?",result.text,this.now(),input.requestId,account.id,this.now()).run();
   const saved=await this.read(input.requestId,account.id);if(saved?.state!=='ready')throw Error('Translation settlement could not be confirmed.');
   return {status:200,id:saved.id,text:saved.result,target,cached:false,creditsUsed:saved.consumed/1000};
  }catch(error){
   const saved=await this.read(input.requestId,account.id);if(saved?.state==='ready')return {status:200,id:saved.id,text:saved.result,target,cached:true,creditsUsed:0};
   const stages=['authorization','provider_transport','provider_http','provider_response','provider_result','settlement'];const failure={stage:stages.includes(error.translationStage)?error.translationStage:phase,...(Number.isInteger(error.translationStatus)&&error.translationStatus>=100&&error.translationStatus<=599?{httpStatus:error.translationStatus}:{})};for(const [key,allowed]of [['translationCode',['PERMISSION_DENIED','UNAUTHENTICATED','NOT_FOUND','INVALID_ARGUMENT','RESOURCE_EXHAUSTED','UNAVAILABLE','INTERNAL','FAILED_PRECONDITION']],['translationReason',['SERVICE_DISABLED','BILLING_DISABLED','IAM_PERMISSION_DENIED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','CONSUMER_INVALID']]])if(allowed.includes(error[key]))failure[key==='translationCode'?'code':'reason']=error[key];try{this.diagnose({event:'translation_attempt_failed',id:input.requestId,...failure});}catch{}
   const safe=error.translationNotDispatched===true||error.translationRejected===true;
   await this.query("UPDATE translation_attempts SET state=?,updated=?,retry_safe=? WHERE id=? AND account=? AND state='held'",safe?'failed':'uncertain',this.now(),safe?1:0,input.requestId,account.id).run();
   return {status:503,id:input.requestId,retryEligible:safe,creditsUsed:0,failure,detail:'Translation did not produce a usable saved result. Its held credits were released. No automatic retry was made.'};
  }
 }
}

export async function maintainTranslationCredits(env){if(readerFeature(env,'TRANSLATION_BILLING_SCHEMA')){await new TranslationCredits(env).expire();if(readerFeature(env,'TRANSLATION_DOCUMENT_SCHEMA'))await new TranslationDocuments(env).expire();}}
