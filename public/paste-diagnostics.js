// Staging-only, opt-in evidence. Source text is never retained in the report.
export const WEATHER_SOURCE='For updated conditions, the most useful resources are the [National Weather Service Grand Junction office](https://www.weather.gov/gjt/?utm_source=chatgpt.com) and the [Salt Lake City forecast office](https://www.weather.gov/slc/?utm_source=chatgpt.com).';
const knownSentences=[WEATHER_SOURCE,
 'For updated conditions, the most useful resources are the National Weather Service Grand Junction office and the Salt Lake City forecast office.',
 'For updated conditions, the most useful resources are the and the .',
 'For updated conditions, the most useful resources are the  and the .'];
export function pasteSignature(text){
 if(typeof text!=='string')return null;
 return {characters:text.length,grandJunctionLabel:text.includes('National Weather Service Grand Junction office'),saltLakeLabel:text.includes('Salt Lake City forecast office'),grandJunctionDestination:text.includes('weather.gov/gjt'),saltLakeDestination:text.includes('weather.gov/slc'),referenceMarkers:(text.match(/\uE200/g)||[]).length,knownWeatherSentence:knownSentences.find(sentence=>text.includes(sentence))||null};
}
function weatherAnchorSignature(html){
 if(typeof html!=='string'||html.length>2_000_000)return null;
 const template=document.createElement('template');template.innerHTML=html;const anchors=[];
 for(const anchor of template.content.querySelectorAll('a[href]')){
  let url;try{url=new URL(anchor.getAttribute('href'));}catch{continue;}
  if(!['weather.gov','www.weather.gov'].includes(url.hostname)||!/^\/(gjt|slc)\/?$/.test(url.pathname))continue;
  const content=pasteSignature(anchor.textContent),children=Array.from(anchor.querySelectorAll('[hidden],[aria-hidden="true"],[style]'));
  anchors.push({office:url.pathname.includes('gjt')?'grandJunction':'saltLake',exactSourceDestination:['https://www.weather.gov/gjt/?utm_source=chatgpt.com','https://www.weather.gov/slc/?utm_source=chatgpt.com'].includes(url.href),content,hidden:anchor.hidden,ariaHidden:anchor.getAttribute('aria-hidden')==='true',hiddenChildren:children.filter(child=>child.hidden||child.getAttribute('aria-hidden')==='true'||child.style.display==='none'||child.style.visibility==='hidden').length});if(anchors.length===4)break;
 }
 return anchors;
}
export function setupPasteDiagnostics({target,preview,getOptions,build,onStateChange,fetchRelease=()=>fetch('/release.json',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(6000)})}){
 const panel=document.createElement('details');panel.id='paste-check';
 panel.innerHTML='<summary>Troubleshoot this paste</summary><p class="hint">1. Copy the weather sentence from ChatGPT. 2. Start a check. 3. Use either your keyboard paste or Clear, Paste &amp; Play. 4. Copy report. This check skips speech playback. The report contains counts, event timing and checks for the two known office labels. It never includes your document, clipboard HTML, other URLs or account details. Nothing is uploaded. Reload discards the report.</p><button type="button" id="paste-check-start">Start paste check</button> <button type="button" id="paste-check-copy" disabled>Copy report</button> <button type="button" id="paste-check-discard">Discard report</button><p id="paste-check-status" class="hint" role="status">Off. Nothing is being recorded.</p><label for="paste-check-report">Local diagnostic report</label><textarea id="paste-check-report" readonly rows="8"></textarea>';
 target.closest('.card').append(panel);
 const el=id=>panel.querySelector('#paste-check-'+id);
 let active=false,report=null,started=0,lastTime=0,generation=0;
 const render=()=>{el('report').value=report?JSON.stringify(report,null,2):'';el('copy').disabled=!report;};
 function record(stage,text,details={}){
  if(!active||!report)return;
  const now=performance.now();
  if(report.events.length>=120){report.truncated=true;return;}
  const entry={stage,sinceStartMs:Math.round(now-started),sincePreviousMs:Math.round(now-lastTime),...details,text:pasteSignature(text)};
  if(['paste-event-html','clipboard-html-result'].includes(stage))entry.weatherAnchors=weatherAnchorSignature(text);
  report.events.push(entry);lastTime=now;render();
 }
 function stop(){active=false;el('start').textContent='Start paste check';onStateChange?.();}
 el('start').onclick=async()=>{
  if(active){record('stop-editor',target.value);record('stop-preview',preview.textContent);report.final={editor:pasteSignature(target.value),preview:pasteSignature(preview.textContent)};stop();el('status').textContent='Stopped. Copy or discard the local report.';return;}
  const run=++generation;started=lastTime=performance.now();
  report={format:'paste-evidence-1',runningBuild:build,servedBuild:null,versionCheck:'pending',environment:{android:/Android/.test(navigator.userAgent),chromeMajor:/Chrome\/(\d+)/.exec(navigator.userAgent)?.[1]||null,clipboardRead:typeof navigator.clipboard?.read==='function',clipboardReadText:typeof navigator.clipboard?.readText==='function'},cleanup:{...getOptions()},events:[]};active=true;el('start').textContent='Stop paste check';el('status').textContent='Checking locally. Playback is paused for this check. Paste into Edit, or use Clear, Paste & Play.';onStateChange?.();record('start-editor',target.value);record('start-preview',preview.textContent);
  try{const response=await fetchRelease();if(!response.ok)throw Error();const release=await response.json();if(generation!==run||!report)return;report.servedBuild=/^[a-f0-9]{40}$/.test(release.commit)?release.commit:null;report.versionCheck=report.servedBuild===build?'match':'mismatch';if(report.versionCheck==='mismatch')el('status').textContent='This tab runs a different build from the current release. Copy this report before reloading; reloading may discard your editor text.';}catch{if(generation===run&&report)report.versionCheck='unavailable';}render();
 };
 el('copy').onclick=async()=>{
  if(active){record('copy-editor',target.value);record('copy-preview',preview.textContent);report.final={editor:pasteSignature(target.value),preview:pasteSignature(preview.textContent)};stop();}
  try{await navigator.clipboard.writeText(el('report').value);el('status').textContent='Report copied. Share it only if you want to. No document or clipboard HTML is included.';}catch{el('status').textContent='Copy unavailable. Select and copy the report below.';}
 };
 el('discard').onclick=()=>{++generation;stop();report=null;render();el('status').textContent='Report discarded. Nothing is being recorded.';};
 for(const type of ['paste','beforeinput','input','compositionstart','compositionend'])target.addEventListener(type,event=>{
  if(!active)return;
  if(type==='paste'){
   record('paste-event-plain',event.clipboardData?.getData('text/plain'));
   record('paste-event-html',event.clipboardData?.getData('text/html'),{formats:Array.from(event.clipboardData?.types||[]).filter(value=>['text/plain','text/html','Files'].includes(value))});
  }
  record(type+'-data',event.data,{inputType:/^(insert|delete|history|format)[A-Za-z]{1,50}$/.test(event.inputType||'')?event.inputType:null,composing:event.isComposing===true,trusted:event.isTrusted});record(type+'-editor-before',target.value);
  queueMicrotask(()=>{record(type+'-editor-after',target.value);record(type+'-preview-after',preview.textContent);});
 },true);
 target.addEventListener('focus',()=>record('editor-focus',target.value),true);
 return {record,get active(){return active;},mark(stage,text){if(!active)return null;const time=performance.now();record(stage,text);return time;}};
}
