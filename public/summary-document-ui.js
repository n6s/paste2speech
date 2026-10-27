import{summaryDocumentStatus}from'./summary-document-status.js';
import{summarySourceFits}from'./summary-limits.js';
import{saveSummaryDraft,readSummaryDraft,clearSummaryDraft}from'./summary-document-draft.js';
import{planSummaryDocument,SUMMARY_DOCUMENT_VERSION,summaryStage}from'./summary-document-plan.js';
import{showProcessing,hideProcessing}from'./processing-indicator.js';
const number=n=>Number(n.toFixed(3)).toLocaleString('en-US',{maximumFractionDigits:3});
/** Staging-only controller, activated by an authenticated document-schema config. */
export function setupSummaryDocuments({getText,setText,setMode,fetcher=fetch,config}){
 const el=id=>document.getElementById(id),button=el('summary-mode'),panel=el('summary-view'),result=el('summary-result'),select=el('summary-length');
 let source=getText(),original=null,resultSource=null,resultKey=null,displayedDocument=null,displayedPartial=false,using=false,usingSummary=false,busy=false,externalBusy=false,epoch=0,planning=null,job=null,plan=null,planKey=null,exception=null,scope=config.consentScope,available=config.available===true;
 const saved=new Map(),notes=new Map();
 const key=()=>JSON.stringify([scope,source,select.value]);
 const status=text=>{el('summary-status').textContent=text;};
 const update=()=>{button.disabled=externalBusy||!source.trim()||!available;button.title=!available?'Summary availability is being checked':'';el('summarize').disabled=button.disabled;el('summary-use').disabled=busy||resultSource!==source||!result.value.trim();el('summary-restore').disabled=original===null;el('summary-cancel').hidden=!busy;el('summary-cancel').textContent='Pause';};
 const request=async(action,data={})=>{const response=await fetcher('/api/summary/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,scope,version:SUMMARY_DOCUMENT_VERSION,...data})});const value=await response.json();if(!response.ok)throw Error(value.detail||'Summary could not be checked. Saved work is kept.');return value;};
 const documentStatus=summaryDocumentStatus;
 const show=(text,doc,{cached=false,partial=false}={})=>{result.value=text;result.disabled=!text;resultSource=source;resultKey=key();displayedDocument=doc;displayedPartial=partial;el('summary-output-label').textContent=(partial?'Summary so far':'Summary')+' · '+select.value[0].toUpperCase()+select.value.slice(1)+(partial&&doc.maps?' · '+Math.min(doc.next,doc.maps)+' of '+doc.maps+' parts':'');el('summary-use').textContent=partial?'Use partial summary in reader':'Use summary in reader';status(cached?'Saved summary · no new charge.':documentStatus(doc));};
 const partial=()=>[...notes.entries()].filter(([i])=>i<plan.maps).sort((a,b)=>a[0]-b[0]).map(([i,text])=>plan.maps>1?`Section ${i+1}\n${text}`:text).join('\n\n');
 const pause=()=>{planning?.abort();planning=null;const id=['active','pausing'].includes(job?.state)?job.id:null,submitted=source,preset=job?.preset||select.value,currentScope=scope,stopped=++epoch;busy=false;hideProcessing('summary-documents');if(id)void(async()=>{try{let data=await request('pause',{id});for(let poll=0;poll<125;poll++){if(epoch!==stopped||getText()!==submitted||select.value!==preset||scope!==currentScope)return;job=data.document;if(!job)return;if(job.state!=='pausing'){for(let i=0;i<Math.min(job.next,plan.maps);i++){const saved=await request('result',{id,part:i});if(epoch!==stopped)return;if(saved.text)notes.set(i,saved.text);}if(notes.size)show(partial(),job,{partial:job.state!=='ready'});status(documentStatus(job));window.dispatchEvent(new Event('speech-credit-change'));return;}status(documentStatus(job));await new Promise(r=>setTimeout(r,500));if(epoch!==stopped)return;data=await request('status',{id});}if(epoch===stopped)status('Summary pause is awaiting confirmation. Saved work is kept; no new sections start here.');}catch{if(epoch===stopped)status('Pause could not be confirmed. No new sections will start in this tab. Saved work is kept.');}})();update();};
 const resetResult=()=>{result.value='';result.disabled=true;resultSource=null;resultKey=null;displayedDocument=null;displayedPartial=false;el('summary-result-style').textContent='';};
 const configure=data=>{if(data.consentScope!==scope){pause();saved.clear();scope=data.consentScope;original=null;usingSummary=false;resetResult();plan=null;planKey=null;job=null;notes.clear();}available=data.available===true||data.reason==='daily_quota';el('summary-action-disclosure').textContent='Choose Brief, Standard, or Detailed with ▼, then click Summary. Summaries start at 1 credit; longer or more detailed work can cost more. Reuse saved summaries for 24 hours at no extra charge. Completed sections are kept and charged once if you pause.';el('summary-limit-reason').textContent='';el('summary-source').hidden=true;el('summary-allowance').hidden=available;el('summary-allowance').textContent=data.detail||'Summary service is unavailable.';for(const small of document.querySelectorAll('.summary-choices small')){const value=small.closest('label').querySelector('input').value;small.textContent=value==='brief'?'A short overview':value==='standard'?'Main points and important qualifications':'Overview and source-ordered section detail';}update();};
 const start=async()=>{
  setMode('summary');if(busy||externalBusy)return;source=getText();if(!source.trim()||!available)return;
  if(usingSummary&&result.value.trim()){status(displayedPartial?documentStatus(displayedDocument)+' No new charge.':'Saved summary · no new charge.');return;}
  const cached=saved.get(key());if(cached){show(cached.text,cached.doc,{cached:true});update();return;}
  const run=++epoch,submitted=source,preset=select.value,currentScope=scope;busy=true;planning=new AbortController();showProcessing('summary-documents',run,'Summarizing…');status('Preparing summary…');update();
  const current=()=>run===epoch&&getText()===submitted&&scope===currentScope&&select.value===preset;
  try{
   const fresh=await fetcher('/api/summary/config').then(async r=>{if(!r.ok)throw Error('Summary availability could not be checked.');return r.json();});if(!current())return;
   if(!fresh.documents||fresh.documentVersion!==SUMMARY_DOCUMENT_VERSION||fresh.consentScope!==scope){configure(fresh);throw Error('Summary account or availability changed. Nothing was sent.');}configure(fresh);if(!available)throw Error(fresh.detail||'Summary service is unavailable.');
   if(summarySourceFits(submitted)){const legacy=await request('legacy',{text:submitted,preset});if(!current())return;if(legacy.blocked)throw Error(legacy.detail);if(legacy.text){original??=submitted;const doc={state:'ready',passes:1,creditsUsed:0};show(legacy.text,doc,{cached:true});saved.set(key(),{text:legacy.text,doc});return;}}
   if(planKey!==key()){const planned=await planSummaryDocument(submitted,preset,{signal:planning.signal});if(!current())return;plan=planned;planKey=key();notes.clear();job=null;exception=null;}
   if(!current())return;const identity={root:plan.root,maps:plan.maps,bytes:plan.bytes,preset,version:SUMMARY_DOCUMENT_VERSION};const quote=await request('quote',identity);if(!current())return;
   if(quote.shortfallUnits>0||quote.wallet?.debt){status(`Summary needs ${number(quote.shortfallUnits/1000)} more credits.`);const link=document.createElement('a');link.href='/billing.html';link.target='_blank';link.rel='noopener';link.textContent=' Add credits';el('summary-status').append(link);return;}
   // An exceptional price is shown before a second explicit click; ordinary jobs
   // retain the approved one-click flow with the general cost explanation in Info.
   if(quote.requiredUnits>6000&&exception!==key()){exception=key();status(`This longer summary can use up to ${number(quote.requiredUnits/1000)} credits. Click Summary to start.`);return;}
   const opened=await request('open',{...identity,requestId:crypto.randomUUID(),quoteUnits:quote.remainingUnits,restartExpired:quote.document?.state==='expired'});if(!current()){if(opened.document?.id)void request('pause',{id:opened.document.id});return;}job=opened.document;
   window.dispatchEvent(new Event('speech-credit-change'));original??=submitted;void saveSummaryDraft({scope,source:submitted,preset,expires:job.expires},current);notes.clear();
   // Only ready source notes are needed for partial delivery; saved internal merge
   // stages remain server-side and are never regenerated on resume.
   for(let i=0;i<Math.min(job.next,plan.maps);i++){const data=await request('result',{id:job.id,part:i});if(!current())return;if(data.text)notes.set(i,data.text);}
   if(job.state==='ready'){
    const final=await request('result',{id:job.id,part:plan.stages-1});if(!current())return;const text=preset==='detailed'&&plan.maps>1?`${final.text}\n\n${partial()}`:final.text;if(!text)throw Error('Saved summary is unavailable. No new work was requested.');show(text,job,{cached:true});saved.set(key(),{text,doc:job});return;
   }
   if(notes.size)show(partial(),job,{partial:true});
   while(current()&&job.state==='active'){
    const descriptor=summaryStage(plan.maps,preset,job.next),chunk=descriptor.kind==='map'?plan.chunks[job.next]:null;
    status(documentStatus(job));showProcessing('summary-documents',run,`Summarizing · pass ${job.next+1} of ${job.stages}…`);const data=await request('step',{id:job.id,...chunk?{text:chunk.text,proof:chunk.proof}: {}});if(!current())return;job=data.document;if(data.text&&data.part<plan.maps)notes.set(data.part,data.text);
    if(data.pending){status('Another Summary request is still finishing. Saved work is kept; click Summary to check again.');return;}
    if(job.state==='ready'){
     const final=data.text|| (await request('result',{id:job.id,part:plan.stages-1})).text;if(!current())return;
     const text=preset==='detailed'&&plan.maps>1?`${final}\n\n${partial()}`:final;if(!final)throw Error('Summary delivery could not be confirmed. Saved sections are kept.');show(text,job);saved.set(key(),{text,doc:job});while(saved.size>8)saved.delete(saved.keys().next().value);
    }else if(notes.size)show(partial(),job,{partial:true});else status(documentStatus(job));
    window.dispatchEvent(new Event('speech-credit-change'));
   }
   if(current()&&job.state!=='ready')status(documentStatus(job));
  }catch(e){if(current()){if(job?.state==='active')pause();status(e.name==='AbortError'?'Summary paused.':e.message||'Summary did not finish. Saved work is kept.');}}
  finally{if(run===epoch){busy=false;planning=null;hideProcessing('summary-documents',run);update();}}
 };
 button.onclick=start;el('summarize').onclick=start;el('summary-cancel').onclick=()=>{pause();status('Summary paused. Completed sections are kept; unused credits are released.');};
 select.onchange=()=>{pause();planKey=null;exception=null;job=null;notes.clear();status('Type changed. Your result is kept. Click Summary to use this type.');};
 result.oninput=()=>{const old=saved.get(resultKey);if(old)saved.set(resultKey,{...old,text:result.value});update();};
 el('summary-use').onclick=()=>{if(el('summary-use').disabled)return;using=true;usingSummary=true;setText(result.value);source=getText();using=false;update();};
 el('summary-restore').onclick=()=>{if(original===null)return;pause();using=true;setText(original);source=getText();using=false;usingSummary=false;status('Original restored.');update();};
 configure(config);
 const initial=epoch;if(!getText().trim())void readSummaryDraft(scope).then(draft=>{if(!draft||epoch!==initial||getText().trim()||draft.scope!==scope)return;using=true;select.value=draft.preset;setText(draft.source);source=getText();using=false;select.dispatchEvent(new Event('change',{bubbles:true}));status('Saved source restored. Click Summary to continue.');update();});
 return{configure,setBusy(value){externalBusy=value;if(value)pause();update();},clearSource(){clearSummaryDraft();pause();original=null;usingSummary=false;plan=null;planKey=null;job=null;notes.clear();resetResult();source=getText();update();},setVisible(visible){panel.hidden=!visible;button.setAttribute('aria-pressed',String(visible));update();},sourceChanged(){const next=getText();if(next===source)return;if(!using){clearSummaryDraft();pause();if(!usingSummary){original=null;resetResult();}planKey=null;job=null;notes.clear();exception=null;}source=next;update();}};
}
