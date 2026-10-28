import test from 'node:test';import assert from 'node:assert/strict';
import {validateTranslation,translationIdentity,foreignLanguageHint,confidentTranslationLanguage} from '../public/translation-contract.js';
import {translationResponse,translateWithGoogle} from '../cloudflare/reader/translation.js';
test('translation source/target identity is exact, scoped and Unicode-counted without truncation',async()=>{
 assert.equal(validateTranslation('😀'.repeat(30000),'en').characters,30000);
 assert.throws(()=>validateTranslation('😀'.repeat(30001),'en'));assert.throws(()=>validateTranslation('hello','../bad'));assert.throws(()=>validateTranslation(' ','en'));
 const key=await translationIdentity('Original\nsource.','en','a');assert.equal(key,await translationIdentity('Original\nsource.','en','a'));
 for(const [text,target,scope]of [['Original source.','en','a'],['Original\nsource.','es','a'],['Original\nsource.','en','b']])assert.notEqual(key,await translationIdentity(text,target,scope));
});
test('local language hint declines short, English and ambiguous text; never sends content',()=>{
 assert.equal(foreignLanguageHint('Hola mundo'),null);assert.equal(foreignLanguageHint('The text is for you and your family. This is the source that we would read. '.repeat(4)),null);
 assert.equal(foreignLanguageHint('Este es el texto para los lectores. Las palabras de nuestro idioma tambien son muy importantes porque esta es una historia. '.repeat(3)),'es');
 assert.equal(foreignLanguageHint('La de una para. '.repeat(10)),null);
});
test('staging availability is honest; every POST is stopped before body, credentials or billing even with flags',()=>{
 const env={READER_MODE:'staging',TRANSLATION_UI:'1',TRANSLATION_LIVE_APPROVED:'1',TRANSLATION_PRICE_CREDITS_PER_1000:'4'};
 const request={url:'https://fixture/api/translation',method:'POST',get body(){throw Error('Must not read source');},json(){throw Error('Must not parse source');}};
 assert.equal(translationResponse(request,env).status,503);
 for(const READER_MODE of ['production-public','production-trial'])assert.equal(translationResponse(request,{...env,READER_MODE}).status,404);
});
test('availability quotes the approved price but never advertises live or free translation',async()=>{
 const response=translationResponse(new Request('https://fixture/api/translation/config'),{READER_MODE:'staging',TRANSLATION_UI:'1'});const c=await response.json();assert.equal(c.enabled,false);assert.equal(c.priceCreditsPer1000,4);assert.equal(c.reason,'live_testing_not_approved');
 const blocked=await translationResponse(new Request('https://fixture/api/translation',{method:'POST'}),{READER_MODE:'staging',TRANSLATION_UI:'1'}).json();assert.equal(blocked.dispatched,false);assert.equal(blocked.creditsUsed,0);
});
test('server-only standard NMT adapter uses scoped OAuth and exact complete plain text, never retries',async()=>{
 const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',key.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
 const credential=JSON.stringify({type:'service_account',project_id:'paste-to-speech',client_email:'p2s-translation-staging@paste-to-speech.iam.gserviceaccount.com',private_key:pem});
 const source='Título\n\nTexto íntegro <sin HTML> & símbolos.\nÚltima línea.',calls=[];
 const fetcher=async(url,options)=>{calls.push(url);assert.equal(options.method,'POST');if(url==='https://oauth2.googleapis.com/token'){
  const jwt=new URLSearchParams(options.body).get('assertion');const claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url'));assert.equal(claims.scope,'https://www.googleapis.com/auth/cloud-translation');return Response.json({access_token:'synthetic-token',token_type:'Bearer',expires_in:3600});
 }assert.equal(url,'https://translate.googleapis.com/v3/projects/paste-to-speech/locations/global:translateText');assert.equal(options.redirect,'manual');const b=JSON.parse(options.body);assert.deepEqual(b.contents,[source]);assert.equal(b.targetLanguageCode,'en');assert.equal(b.mimeType,'text/plain');assert.match(b.model,/\/models\/general\/nmt$/);return Response.json({translations:[{translatedText:'Full synthetic translation.\nLast line.',detectedLanguageCode:'es'}]});};
 assert.deepEqual(await translateWithGoogle(source,'en',credential,{fetcher}),{text:'Full synthetic translation.\nLast line.',target:'en',sourceLanguage:'es'});assert.equal(calls.length,2);
 await assert.rejects(translateWithGoogle(source,'bad',credential,{fetcher}));assert.equal(calls.length,2);
 await assert.rejects(translateWithGoogle(source,'en',credential.replace('paste-to-speech"','wrong-project"'),{fetcher}));assert.equal(calls.length,2);
 let dispatched=0;await assert.rejects(translateWithGoogle(source,'en',credential,{fetcher:async(url,o)=>{if(url.includes('oauth2'))return fetcher(url,o);dispatched++;return new Response('{}',{status:503});}}));assert.equal(dispatched,1);
 let failure;try{await translateWithGoogle(source,'en',credential,{fetcher:async(url,o)=>{if(url.includes('oauth2'))return fetcher(url,o);return Response.json({error:{status:'PERMISSION_DENIED',message:'PRIVATE PROVIDER BODY',details:[{reason:'SERVICE_DISABLED',metadata:{secret:'MUST NOT COPY'}}]}},{status:403});}});}catch(error){failure=error;}
 assert.equal(failure.translationStage,'provider_http');assert.equal(failure.translationStatus,403);assert.equal(failure.translationCode,'PERMISSION_DENIED');assert.equal(failure.translationReason,'SERVICE_DISABLED');assert.doesNotMatch(JSON.stringify(failure),/PRIVATE PROVIDER|MUST NOT COPY/);
});

test('invalid Unicode is rejected before identity or provider serialization; valid astral characters count once',async()=>{
 for(const text of ['bad\uD800','bad\uDC00','\uD800x\uDC00']){assert.throws(()=>validateTranslation(text,'en'));await assert.rejects(translationIdentity(text,'en','scope'));}
 assert.equal(validateTranslation('a😀é','en').characters,3);
 assert.equal(foreignLanguageHint('x'.repeat(2000000)),null);
});

test('live staging activation still requires verified owner and the migrated billing schema',async()=>{
 const env={READER_MODE:'staging',TRANSLATION_UI:'1',TRANSLATION_LIVE_APPROVED:'1',TRANSLATION_BILLING_SCHEMA:'1',OWNER_EMAIL:'owner@example.invalid'};
 const r=await translationResponse(new Request('https://fixture/api/translation/config'),env);assert.equal(r.status,403);
 for(const mode of ['production-public','production-trial'])assert.equal((await translationResponse(new Request('https://fixture/api/translation/config'),{...env,READER_MODE:mode})).status,404);
});

test('Esperanto and Igbo are accepted NMT targets independently from speech voices',()=>{
 for(const target of ['eo','ig'])assert.equal(validateTranslation('A complete sentence.',target).target,target);
});

test('same-language no-op evidence declines short, mixed scripts and ambiguous foreign passages',()=>{
 const english='This is the text that we have for you and your readers. These are the words that they can read with their friends, and this is not a request for a different language.';
 assert.equal(confidentTranslationLanguage(english),'en');
 assert.equal(confidentTranslationLanguage('Este es el texto para los lectores. Las palabras de nuestro idioma tambien son muy importantes porque esta es una historia. '.repeat(3)),'es');
 assert.equal(confidentTranslationLanguage('This short text.'),null);
 assert.equal(confidentTranslationLanguage(english+' La internacia lingvo estas facila.'),null);
 assert.equal(confidentTranslationLanguage(english+' 你好世界。'),null);
 assert.equal(confidentTranslationLanguage(english+' Este es el texto para los lectores. Las palabras de nuestro idioma tambien son muy importantes.'),null);
 assert.equal(confidentTranslationLanguage('x + y = 4; $12.50'),null);
 assert.equal(confidentTranslationLanguage(english.repeat(60)+' Este es otro idioma.'),null,'a prefix cannot establish a whole long document language');
});

test('production accepts only its dedicated translation identity; neither deployment accepts the other credential',async()=>{
 const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',key.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
 const credential=who=>JSON.stringify({type:'service_account',project_id:'paste-to-speech',client_email:`p2s-translation-${who}@paste-to-speech.iam.gserviceaccount.com`,private_key:pem});let calls=0;
 const fetcher=async url=>{calls++;return url.includes('oauth2')?Response.json({access_token:'synthetic-only',token_type:'Bearer',expires_in:3600}):Response.json({translations:[{translatedText:'Synthetic complete output.',detectedLanguageCode:'es'}]});};
 await assert.rejects(translateWithGoogle('Una frase completa.','en',credential('staging'),{environment:'production-public',fetcher}));
 await assert.rejects(translateWithGoogle('Una frase completa.','en',credential('production'),{fetcher}));assert.equal(calls,0);
 assert.equal((await translateWithGoogle('Una frase completa.','en',credential('production'),{environment:'production-public',fetcher})).text,'Synthetic complete output.');assert.equal(calls,2);
});
