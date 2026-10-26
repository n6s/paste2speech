import {TRANSLATION_LANGUAGES,TRANSLATION_MAX_CHARACTERS,translationCharacters,translationIdentity,foreignLanguageHint} from './translation-contract.js';

export function setupTranslation({getText,setText,setMode,getVoiceLanguage=()=>null,isBusy=()=>false,fetcher=fetch}){
 const modes=document.querySelector('.mode-controls');modes.classList.add('has-translation');
 const button=document.createElement('button');button.id='translate-mode';button.type='button';button.textContent='Translate';button.setAttribute('aria-pressed','false');modes.append(button);
 const suggestion=document.createElement('div');suggestion.id='translation-suggestion';suggestion.hidden=true;
 const suggest=document.createElement('button');suggest.type='button';suggest.textContent='Read this in English?';suggestion.append(suggest);modes.after(suggestion);
 const panel=document.createElement('section');panel.id='translation-view';panel.hidden=true;panel.setAttribute('aria-label','Translate mode');
 panel.innerHTML='<h2>Translate your text</h2><p>Your original stays available. Translation does not summarize or start playback.</p><label for="translation-target">Translate into</label><select id="translation-target"></select><p id="translation-source"></p><p id="translation-disclosure" class="hint"></p><button id="translation-start" type="button" disabled>Translate</button><button id="translation-cancel" type="button" hidden>Cancel</button><p id="translation-status" role="status" aria-live="polite"></p><label id="translation-result-label" for="translation-result">Translation</label><textarea id="translation-result" rows="10" readonly placeholder="Your translation will appear here."></textarea><div class="translation-actions"><button id="translation-copy" type="button" disabled>Copy translation</button><button id="translation-use" type="button" disabled>Use in reader</button><button id="translation-restore" type="button" disabled>Restore original</button></div><p id="translation-voice" class="hint"></p>';
 document.getElementById('summary-view')?.after(panel);if(!panel.isConnected)document.getElementById('edit-view').after(panel);
 const voiceNotice=panel.querySelector('#translation-voice');suggestion.after(voiceNotice);
 const el=id=>document.getElementById('translation-'+id),target=el('target');
 for(const [code,name]of Object.entries(TRANSLATION_LANGUAGES)){const option=document.createElement('option');option.value=code;option.textContent=name;target.append(option);}target.value='en';
 let config=null,scope=null,visible=false,busy=false,controller=null,epoch=0,source=getText(),result=null,original=null,applying=false;
 const cache=new Map(),ids=new Map();let configRequest=0,retryOffer=null,checkingExisting=false;
 const status=message=>{el('status').textContent=message;};
 const sourceText=()=>original?.text??getText();
 const permitted=()=>config?.enabled===true&&typeof config.scope==='string'&&config.scope&&Number.isFinite(config.priceCreditsPer1000)&&config.priceCreditsPer1000>0;
 const update=()=>{
  const text=sourceText(),count=translationCharacters(text,TRANSLATION_MAX_CHARACTERS),oversized=count>TRANSLATION_MAX_CHARACTERS;
  el('source').textContent=`${oversized?'More than 30,000':count.toLocaleString()} source characters · maximum 30,000. The whole source is kept.`;
  el('start').disabled=busy||isBusy()||!text.trim()||oversized||!permitted();
  el('cancel').hidden=!busy;el('copy').disabled=!result;el('use').disabled=!result||busy||isBusy();el('restore').disabled=!original||busy||isBusy();
  if(!config)el('disclosure').textContent='Checking translation availability. No text is sent while checking.';
  else if(!permitted())el('disclosure').textContent=config.detail||'Translation pricing and credit handling are not ready. No text is sent to Google.';
  else el('disclosure').textContent=`Translate the complete source with Google Cloud Translation: ${(count*config.priceCreditsPer1000/1000).toLocaleString(undefined,{maximumFractionDigits:3})} credits. Paid speech is separate. Nothing is sent until you press Translate.${config.limitedLiveTest?' Staging live-test limit: two requests and 5,000 source characters total. Saved results reopen without a new charge.':''}`;
  el('start').textContent=result?'Reopen translation':retryOffer?'Translate again':checkingExisting?'Check translation':'Translate';
  if(oversized)status('This text exceeds the first release’s 30,000-character limit. Nothing is shortened or sent. Copy a smaller excerpt into a separate tab.');
  else if(el('status').textContent.startsWith('This text exceeds'))status(permitted()?'Ready to translate. Nothing has been sent.':config?.detail||'Checking translation availability.');
 };
 const cancel=()=>{epoch++;controller?.abort();controller=null;busy=false;update();};
 const showResult=value=>{result=value;el('result-label').textContent=value.edited?'Translation · your edits':'Translation';el('result').value=value.text;el('result').lang=value.target;el('result').dir='auto';status('Translation ready. Review before using it.');update();};
 const availability=async()=>{
  const checkId=++configRequest;const response=await fetcher('/api/translation/config',{cache:'no-store'});if(!response.ok)throw Error('Translation availability could not be checked. Your text is unchanged.');
  const next=await response.json();if(checkId!==configRequest)throw new DOMException('Superseded availability check','AbortError');if(scope!==null&&scope!==next.scope){cache.clear();ids.clear();retryOffer=null;checkingExisting=false;result=null;el('result').value='';}
  scope=next.scope??null;config=next;return next;
 };
 const check=async()=>{const n=epoch;try{await availability();if(n===epoch)update();}catch(e){if(e.name==='AbortError')return;if(n===epoch){config={enabled:false,detail:e.message};update();status(e.message);}}};
 button.onclick=()=>setMode('translate');suggest.onclick=()=>{target.value='en';setMode('translate');};
 target.onchange=()=>{cancel();retryOffer=null;checkingExisting=false;result=null;el('result').value='';el('voice').textContent='';status('Choose Translate to request this language. Your original is unchanged.');update();};
 el('cancel').onclick=()=>{cancel();status('Stopped waiting. If already accepted, translation may finish and use the quoted credits once. Reopening checks the same request; your original is unchanged.');};
 el('start').onclick=async()=>{
  if(busy||isBusy())return;
  const text=sourceText(),language=target.value,n=++epoch;busy=true;controller=new AbortController();const signal=controller.signal;update();status('Checking the current translation terms…');
  try{
   const quotedScope=scope,quotedRate=config?.priceCreditsPer1000;await availability();
   if(n!==epoch||signal.aborted||text!==sourceText()||language!==target.value)return;
   if(!permitted())throw Error(config.detail||'Translation is not enabled. Nothing was sent.');
   if(quotedScope!==scope||quotedRate!==config.priceCreditsPer1000)throw Error('Your account or price changed. Review the updated terms, then press Translate. Nothing was sent.');
   if(translationCharacters(text,TRANSLATION_MAX_CHARACTERS)>TRANSLATION_MAX_CHARACTERS)throw Error('The source is too large. Nothing was shortened or sent.');
   const key=await translationIdentity(text,language,scope);if(n!==epoch)return;
   if(cache.has(key)){showResult(cache.get(key));return;}
   if(!ids.has(key)){if(ids.size>=100)throw Error('Translation request history is full in this tab. Your text is kept; no new request was made.');ids.set(key,crypto.randomUUID());}
   const retryOf=retryOffer?.source===text&&retryOffer.target===language&&retryOffer.scope===scope?retryOffer.id:null;if(retryOf)ids.set(key,crypto.randomUUID());retryOffer=null;checkingExisting=true;
   status('Translating the complete source…');
   const response=await fetcher('/api/translation',{method:'POST',signal,headers:{'Content-Type':'application/json','Idempotency-Key':ids.get(key)},body:JSON.stringify({text,target:language,scope,priceCreditsPer1000:quotedRate,requestId:ids.get(key),...(retryOf?{retryOf}:{})})});
   const value=await response.json();window.dispatchEvent(new Event('speech-credit-change'));if(n!==epoch||signal.aborted||sourceText()!==text)return;
   if(value.pending||response.status===202){status(value.detail||'Translation is still processing. Check the same request again; no second translation is started.');return;}
   if(!response.ok){if(value.retryEligible&&value.id){retryOffer={source:text,target:language,scope,id:value.id};checkingExisting=false;}throw Error(value.detail||'Translation could not be confirmed. No automatic retry was made.');}
   if(typeof value.text!=='string'||!value.text.trim()||value.target!==language)throw Error('A complete translation was not returned. Your original is unchanged.');
   await availability();if(n!==epoch||signal.aborted)return;if(scope!==quotedScope||sourceText()!==text)throw Error('Your account changed while translation finished. Reopen it from the original account; your text is unchanged.');
   checkingExisting=false;const saved={text:value.text,target:language,source:text};cache.set(key,saved);while(cache.size>3)cache.delete(cache.keys().next().value);showResult(saved);
  }catch(e){if(n===epoch)status(e.name==='AbortError'?'Request interrupted. Your original is unchanged.':e.message);}
  finally{if(n===epoch){busy=false;controller=null;update();}}
 };
 el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('result').value);status('Translation copied.');}catch{el('result').focus();el('result').select();status('Select and copy the translation using your browser.');}};
 el('use').onclick=()=>{
  if(!result||busy||isBusy())return;
  if(original){status('Your translated text is already in the editor. Its edits are kept. Restore the original before replacing it.');return;}
  if(getText()!==result.source){status('The source changed. Your edits are kept; request a translation of the current source.');return;}
  original={text:getText(),applied:result.text};applying=true;try{setText(result.text);}finally{applying=false;}
  const voice=getVoiceLanguage(),matches=voice&&voice.split('-')[0].toLowerCase()===result.target.split('-')[0];
  el('voice').textContent=matches?'Your current voice matches the target language. Press Play when ready.':`Choose a voice for ${TRANSLATION_LANGUAGES[result.target]} before pressing Play. The voice has not been changed and playback has not started.`;update();
 };
 el('restore').onclick=()=>{
  if(!original||busy||isBusy())return;const before=getText(),text=original.text;
  if(before!==original.applied){el('result').value=before;result.text=before;result.edited=true;el('result-label').textContent='Translation · your edits';status('Original restored. Your edited translation is kept above for copying.');}
  else status('Original restored. Translation remains available above.');
  original=null;applying=true;try{setText(text);}finally{applying=false;}source=text;update();
 };
 suggestion.hidden=!foreignLanguageHint(source);
 return {
  setVisible(value){visible=value;panel.hidden=!value;button.setAttribute('aria-pressed',String(value));suggestion.hidden=value||!!original||!foreignLanguageHint(getText());if(value){source=sourceText();update();void check();}},
  sourceChanged(){if(applying)return;const next=getText();if(next===source)return;source=next;cancel();if(!original){retryOffer=null;checkingExisting=false;result=null;el('result').value='';el('voice').textContent='';}suggestion.hidden=visible||!!original||!foreignLanguageHint(next);update();},
  clearSource(){cancel();retryOffer=null;checkingExisting=false;original=null;result=null;cache.clear();el('result').value='';el('voice').textContent='';suggestion.hidden=true;source=getText();update();}
 };
}
