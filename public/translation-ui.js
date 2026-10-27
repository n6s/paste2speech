import {showProcessing,hideProcessing} from './processing-indicator.js';
import {attachReaderPopover} from './reader-popover.js';
import {documentTranslationClient} from './translation-document-client.js';
import {TRANSLATION_LANGUAGES,TRANSLATION_MAX_CHARACTERS,translationCharacters,translationIdentity,foreignLanguageHint,confidentTranslationLanguage} from './translation-contract.js';

export function setupTranslation({getText,setText,setMode,getVoiceLanguage=()=>null,isBusy=()=>false,fetcher=fetch}){
 const modes=document.querySelector('.mode-controls');modes.classList.add('has-translation');
 const button=document.createElement('button');button.id='translate-mode';button.type='button';button.textContent='Translate';button.setAttribute('aria-pressed','false');modes.append(button);
 const suggestion=document.createElement('div');suggestion.id='translation-suggestion';suggestion.hidden=true;
 const suggest=document.createElement('button');suggest.type='button';suggest.textContent='Read this in English?';suggestion.append(suggest);modes.after(suggestion);
 const panel=document.createElement('section');panel.id='translation-view';panel.hidden=true;panel.setAttribute('aria-label','Translate mode');
 panel.innerHTML='<label for="translation-target">Translate into</label><select id="translation-target"></select><p id="translation-status" role="status" aria-live="polite"></p><label id="translation-result-label" for="translation-result">Translation</label><textarea id="translation-result" rows="10" readonly placeholder="Your translation will appear here."></textarea><div class="translation-actions"><button id="translation-copy" type="button" disabled>Copy translation</button><button id="translation-use" type="button" disabled>Use in reader</button><button id="translation-restore" type="button" disabled>Restore original</button><button id="translation-cancel" type="button" hidden>Cancel</button></div><p id="translation-voice" class="hint"></p>';
 document.getElementById('summary-view')?.after(panel);if(!panel.isConnected)document.getElementById('edit-view').after(panel);
 const voiceNotice=panel.querySelector('#translation-voice');suggestion.after(voiceNotice);
 // Match Summary's split action; selecting a target never starts paid work.
 const group=document.createElement('div');group.className='translation-split';button.before(group);group.append(button);
 const toggle=document.createElement('button');toggle.id='translation-options-toggle';toggle.textContent='▾';group.append(toggle);
 const options=document.createElement('div');options.id='translation-options';const optionPopup=attachReaderPopover(toggle,options,{label:'Translation language',info:false});
 const languageLabel=panel.querySelector('label[for="translation-target"]');options.append(languageLabel,panel.querySelector('#translation-target'));
 const info=document.createElement('button');info.id='translation-info';info.textContent='ⓘ';info.setAttribute('aria-label','Translation information');options.querySelector('.reader-popover-heading').append(info);
 const details=document.createElement('div');details.id='translation-info-details';details.innerHTML='<p>Google Cloud Translation translates the full source. Speech is priced separately.</p><p>Completed portions are saved for 24 hours and charged once. Pause releases unused credits after any in-flight portion finishes. Resume reuses saved work.</p><p>Your original and edits stay available. Translation does not start playback.</p>';attachReaderPopover(info,details,{label:'Translation information',anchor:toggle,returnFocus:toggle});
 const quote=document.createElement('p');quote.id='translation-action-quote';quote.className='hint';modes.after(quote);button.setAttribute('aria-describedby',quote.id);
 const box=document.createElement('div');box.id='translation-content-box';box.className='translation-content-box';box.append(panel.querySelector('#translation-result-label'),panel.querySelector('#translation-result'));panel.prepend(box);
 panel.querySelector('.translation-actions').append(panel.querySelector('#translation-cancel'));panel.querySelector('#translation-status').className='translation-result-status';

 const el=id=>document.getElementById('translation-'+id),target=el('target');
 for(const [code,name]of Object.entries(TRANSLATION_LANGUAGES).sort(([a,x],[b,y])=>a==='en'?-1:b==='en'?1:x.localeCompare(y,'en'))){const option=document.createElement('option');option.value=code;option.textContent=name;target.append(option);}try{target.value=localStorage.getItem('paste2speech.translation.target')||'en';}catch{target.value='en';}if(!target.value)target.value='en';
 let targetPending=false,actionOpening=false,config=null,scope=null,visible=false,busy=false,controller=null,epoch=0,source=getText(),result=null,original=null,applying=false;
 let documents=null;const documentEdits=[];const cache=new Map(),ids=new Map();let configRequest=0,retryOffer=null,checkingExisting=false,readOnlyTimer=null,pausedChecks=0;
 const status=message=>{el('status').textContent=message;};
 const sourceText=()=>original?.text??getText();
 let countedSource=null,countedCharacters=0;const characterCount=text=>{if(text!==countedSource){countedSource=text;countedCharacters=translationCharacters(text);}return countedCharacters;};
 const permitted=()=>config?.enabled===true&&typeof config.scope==='string'&&config.scope&&Number.isFinite(config.priceCreditsPer1000)&&config.priceCreditsPer1000>0;
 const languageName=()=>TRANSLATION_LANGUAGES[target.value]||target.value;
 const credits=value=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:3});
 const targetCue=()=>`Click Translate to translate into ${languageName()}.`;
 const labelResult=()=>{const actual=result?TRANSLATION_LANGUAGES[result.target]||result.target:languageName();el('result-label').textContent=`Translation · ${actual}${result?.edited?' · your edits':result?.partial?' · partial':''}`;el('result').placeholder=targetCue();};
 const knownLanguages=new Map();
 let evidenceSource=null,evidenceLanguage=null;const sourceLanguage=()=>{const text=sourceText(),known=knownLanguages.get(text);if(known)return known;if(text!==evidenceSource){evidenceSource=text;evidenceLanguage=confidentTranslationLanguage(text);}return evidenceLanguage;};
 const alreadyTarget=()=>sourceLanguage()===target.value;
 const update=()=>{
  if(busy)showProcessing('translation',epoch,'Translating…');else hideProcessing('translation');
  const text=sourceText(),count=characterCount(text),oversized=!config?.documents&&count>TRANSLATION_MAX_CHARACTERS;
  button.disabled=!busy&&(isBusy()||!text.trim()||oversized&&!alreadyTarget()||!alreadyTarget()&&(!permitted()||config?.documents&&['blocked','pausing'].includes(documents?.current?.state)));
  button.textContent='Translate';button.setAttribute('aria-busy',String(busy));button.setAttribute('aria-label',`Translate to ${languageName()}`);toggle.setAttribute('aria-label',`Translation language: ${languageName()} selected`);
  el('cancel').textContent=config?.documents?'Pause translation':'Cancel';el('cancel').hidden=!busy;el('copy').disabled=!result;el('use').disabled=!result||busy||isBusy();el('restore').disabled=!(original||result&&result.source===getText())||busy||isBusy();labelResult();
  quote.hidden=!text.trim()||!!result&&!result.partial&&result.source===text&&result.target===target.value;quote.textContent=alreadyTarget()?`Already in ${languageName()} · no credits`:!config?'Checking translation availability…':!permitted()?config.detail||'Translation is unavailable.':`${languageName()} · ${count.toLocaleString()} characters · ${credits(count*config.priceCreditsPer1000/1000)} credits${result?.partial?' total':''}`;
  if(oversized&&!alreadyTarget())status('This text exceeds the available request limit. Your full source is kept.');
 };
 const cancel=()=>{clearTimeout(readOnlyTimer);pausedChecks=0;const paused=documents?.pause().catch(()=>{});epoch++;controller?.abort();controller=null;busy=false;update();return paused;};
 const showResult=value=>{result=value;el('result').value=value.text;el('result').lang=value.target;el('result').dir='auto';status(value.noOp?`Already in ${languageName()}.`:value.cached?'Saved translation · no new charge.':Number.isFinite(value.creditsUsed)?`Translated ${characterCount(value.source).toLocaleString()} characters for ${credits(value.creditsUsed)} credits.`:'Translation ready.');if(!value.noOp&&!value.edited){knownLanguages.set(value.text,value.target);while(knownLanguages.size>3)knownLanguages.delete(knownLanguages.keys().next().value);}update();};
 const availability=async()=>{
  const checkId=++configRequest;const response=await fetcher('/api/translation/config',{cache:'no-store'});if(!response.ok)throw Error('Translation availability could not be checked. Your text is unchanged.');
  const next=await response.json();if(checkId!==configRequest)throw new DOMException('Superseded availability check','AbortError');if(scope!==null&&scope!==next.scope){targetPending=false;original=null;source=getText();cache.clear();ids.clear();knownLanguages.clear();documentEdits.length=0;documents=null;retryOffer=null;checkingExisting=false;result=null;el('result').value='';}
  scope=next.scope??null;config=next;return next;
 };
 const makeDocuments=(n,text,language,owner,inspection=false)=>{const client=documentTranslationClient({fetcher,onBillingChange:()=>window.dispatchEvent(new Event('speech-credit-change')),scope:()=>owner,verifyScope:async()=>{if(n!==epoch)throw new DOMException('Translation changed','AbortError');await availability();if(scope!==owner)throw Error('Your account changed. No prior-account translation is shown.');},valid:()=>n===epoch&&text===sourceText()&&language===target.value&&scope===owner,onProgress:({document,text:translated,partial})=>{
  if(translated){result={text:translated,target:language,source:text,partial,creditsUsed:document.creditsUsed,cached:client.inspection};el('result').value=translated;el('result').lang=language;el('result').dir='auto';if(!partial){knownLanguages.set(translated,language);while(knownLanguages.size>3)knownLanguages.delete(knownLanguages.keys().next().value);}}
  const count=document.state==='ready'?document.characters:Math.round(document.creditsUsed*1000/4);
  if(document.detail)status(document.detail);else if(document.state==='ready')status(client.inspection||document.creditsUsed===0?'Saved translation · no new charge.':`Translated ${count.toLocaleString()} characters for ${credits(document.creditsUsed)} credits.`);else status(`${document.state==='active'?'Translating':'Paused'} · ${count.toLocaleString()} characters · ${credits(document.creditsUsed)} credits used.`);update();
 }});client.inspection=inspection;return client;};
 const check=async()=>{const request=configRequest+1;try{await availability();update();if(config.documents&&!busy&&!targetPending&&sourceText().trim()&&!alreadyTarget()){const n=epoch,text=sourceText(),language=target.value;const edited=result&&!result.partial&&result.source===text&&result.target===language?result:documentEdits.find(r=>r.source===text&&r.target===language);if(edited){showResult(edited);return;}documents=makeDocuments(n,text,language,scope,true);const inspected=await documents.inspect(text,language);if(n===epoch){update();if(inspected?.state==='pausing'&&pausedChecks++<8){clearTimeout(readOnlyTimer);readOnlyTimer=setTimeout(()=>{if(n===epoch&&!busy&&visible)void check();},Math.min(2000,250*2**pausedChecks));}}}}catch(e){if(e.name==='AbortError'||request!==configRequest)return;status(e.message);update();}};
 button.onclick=()=>{optionPopup.close(false);actionOpening=true;setMode('translate');actionOpening=false;if(!busy)void translate();};suggest.onclick=()=>{target.value='en';setMode('translate');};
 target.onchange=()=>{optionPopup.close(true);try{localStorage.setItem('paste2speech.translation.target',target.value);}catch{}cancel();targetPending=true;documents=null;retryOffer=null;checkingExisting=false;status(targetCue());update();};
 el('cancel').onclick=()=>{const paused=cancel(),n=epoch;void Promise.resolve(paused).then(()=>{if(n===epoch&&visible&&!busy&&config?.documents)void check();});status(config?.documents?'Paused · saved work is kept.':'Stopped waiting · your text is kept.');};
 const translate=async()=>{
  if(busy||isBusy())return;targetPending=false;clearTimeout(readOnlyTimer);pausedChecks=0;
  if(alreadyTarget()){showResult({text:sourceText(),target:target.value,source:sourceText(),noOp:true});return;}
  const text=sourceText(),language=target.value,n=++epoch;busy=true;controller=new AbortController();const signal=controller.signal;update();status('Checking translation…');
  try{
   const quotedScope=scope,quotedRate=config?.priceCreditsPer1000;await availability();
   if(n!==epoch||signal.aborted||text!==sourceText()||language!==target.value)return;
   if(!permitted())throw Error(config.detail||'Translation is not enabled. Nothing was sent.');
   if(quotedScope!==scope||quotedRate!==config.priceCreditsPer1000)throw Error('Your account or price changed. Review the updated terms, then press Translate. Nothing was sent.');
   if(config.documents){const edited=result&&!result.partial&&result.source===text&&result.target===language?result:documentEdits.find(r=>r.source===text&&r.target===language);if(edited){showResult(edited);return;}documents=makeDocuments(n,text,language,quotedScope,true);const saved=await documents.inspect(text,language,signal);if(n!==epoch||signal.aborted)return;if(saved?.state==='ready'){status('Saved translation · no new charge.');return;}if(saved?.state==='blocked')throw Error(saved.detail);if(scope!==quotedScope||config.priceCreditsPer1000!==quotedRate)throw Error('Your account or price changed. Review the quote, then press Translate.');documents.inspection=false;await documents.run(text,language,signal);return;}
   if(translationCharacters(text,TRANSLATION_MAX_CHARACTERS)>TRANSLATION_MAX_CHARACTERS)throw Error('The source is too large. Nothing was shortened or sent.');
   const key=await translationIdentity(text,language,scope);if(n!==epoch)return;
   if(cache.has(key)){const saved=cache.get(key);saved.cached=true;showResult(saved);return;}
   if(!ids.has(key)){if(ids.size>=100)throw Error('Translation request history is full in this tab. Your text is kept; no new request was made.');ids.set(key,crypto.randomUUID());}
   const retryOf=retryOffer?.source===text&&retryOffer.target===language&&retryOffer.scope===scope?retryOffer.id:null;if(retryOf)ids.set(key,crypto.randomUUID());retryOffer=null;checkingExisting=true;
   status('Translating the complete source…');
   const response=await fetcher('/api/translation',{method:'POST',signal,headers:{'Content-Type':'application/json','Idempotency-Key':ids.get(key)},body:JSON.stringify({text,target:language,scope,priceCreditsPer1000:quotedRate,requestId:ids.get(key),...(retryOf?{retryOf}:{})})});
   const value=await response.json();window.dispatchEvent(new Event('speech-credit-change'));if(n!==epoch||signal.aborted||sourceText()!==text)return;
   if(value.pending||response.status===202){status(value.detail||'Translation is still processing. Check the same request again; no second translation is started.');return;}
   if(!response.ok){if(value.retryEligible&&value.id){retryOffer={source:text,target:language,scope,id:value.id};checkingExisting=false;}throw Error(value.detail||'Translation could not be confirmed. No automatic retry was made.');}
   if(typeof value.text!=='string'||!value.text.trim()||value.target!==language)throw Error('A complete translation was not returned. Your original is unchanged.');
   await availability();if(n!==epoch||signal.aborted)return;if(scope!==quotedScope||sourceText()!==text)throw Error('Your account changed while translation finished. Reopen it from the original account; your text is unchanged.');
   checkingExisting=false;const saved={text:value.text,target:language,source:text,creditsUsed:value.creditsUsed,cached:value.cached===true};cache.set(key,saved);while(cache.size>3)cache.delete(cache.keys().next().value);showResult(saved);
  }catch(e){if(n===epoch)status(e.name==='AbortError'?'Request interrupted. Your original is unchanged.':e.message);}
  finally{if(n===epoch){busy=false;controller=null;update();}}
 };
 el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('result').value);status(targetPending?'Translation copied. '+targetCue():'Translation copied.');}catch{el('result').focus();el('result').select();status('Select and copy the translation using your browser.');}};
 el('use').onclick=()=>{
  if(!result||busy||isBusy())return;
  if(original){status('Your translated text is already in the editor. Its edits are kept. Restore the original before replacing it.');return;}
  if(getText()!==result.source){status('The source changed. Your edits are kept; request a translation of the current source.');return;}
  original={text:getText(),applied:result.text};applying=true;try{setText(result.text);}finally{applying=false;}
  const voice=getVoiceLanguage(),matches=voice&&voice.split('-')[0].toLowerCase()===result.target.split('-')[0];
  el('voice').textContent=matches?'Your current voice matches the target language. Press Play when ready.':`Choose a voice for ${TRANSLATION_LANGUAGES[result.target]} before pressing Play. The voice has not been changed and playback has not started.`;update();
 };
 el('restore').onclick=()=>{
  if(busy||isBusy())return;if(!original){if(result&&getText()===result.source){setMode('edit');document.getElementById('text')?.focus();status('Original shown. Your translation is kept.');}return;}const before=getText(),text=original.text;
  if(before!==original.applied){el('result').value=before;result.text=before;result.edited=true;if(config?.documents){documentEdits.unshift(result);documentEdits.length=Math.min(3,documentEdits.length);}el('result-label').textContent='Translation · your edits';status('Original restored. Your edited translation is kept above for copying.');}
  else status('Original restored. Translation remains available above.');
  original=null;applying=true;try{setText(text);}finally{applying=false;}source=text;update();
 };
 window.addEventListener('focus',()=>{if(!busy)void check();});
 suggestion.hidden=!foreignLanguageHint(source);update();void check();
 return {
  setVisible(value){visible=value;panel.hidden=!value;button.setAttribute('aria-pressed',String(value));suggestion.hidden=value||!!original||!foreignLanguageHint(getText());if(value){source=sourceText();update();if(!actionOpening&&!busy)void check();}},
  sourceChanged(){if(applying)return;const next=getText();if(next===source){update();return;}source=next;cancel();targetPending=false;documents=null;if(!original){retryOffer=null;checkingExisting=false;result=null;el('result').value='';el('voice').textContent='';status('');}suggestion.hidden=visible||!!original||!foreignLanguageHint(next);update();if(visible)void check();},
  clearSource(){cancel();targetPending=false;retryOffer=null;checkingExisting=false;original=null;result=null;cache.clear();documentEdits.length=0;el('result').value='';el('voice').textContent='';suggestion.hidden=true;source=getText();status('');update();}
 };
}
