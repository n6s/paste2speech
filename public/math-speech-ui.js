import {explicitMathSpans,assembleMathPreview,MATH_PREVIEW_LIMITS} from './math-speech-spans.js';
export function setupMathSpeechPreview({getText,getSkip,createWorker=()=>new Worker('/math-speech-worker.js',{type:'module'})}){
 const panel=document.createElement('details');panel.id='math-wording-preview';panel.innerHTML='<summary>Math wording preview · staging</summary><p class="hint">English wording for explicit LaTeX or MathML. Preview only: Play and exports still use the existing text cleanup. <a href="/math-speech-licenses.txt" target="_blank" rel="noopener noreferrer">Math library licenses</a>.</p><button id="math-wording-start" type="button">Preview wording</button><button id="math-wording-cancel" type="button" hidden>Cancel preview</button><p id="math-wording-status" role="status" aria-live="polite"></p><label for="math-wording-result">Suggested wording · review before speech</label><textarea id="math-wording-result" rows="8" readonly></textarea><button id="math-wording-copy" type="button" disabled>Copy wording</button>';
 document.getElementById('options').append(panel);const el=id=>panel.querySelector('#math-wording-'+id);let worker=null,timer=null,epoch=0,source=getText();
 const finish=()=>{clearTimeout(timer);timer=null;worker?.terminate();worker=null;el('start').disabled=false;el('cancel').hidden=true;};
 const invalidate=message=>{epoch++;finish();el('result').value='';el('copy').disabled=true;if(message)el('status').textContent=message;};
 el('cancel').onclick=()=>invalidate('Preview cancelled. Your original is unchanged.');
 el('start').onclick=()=>{
  invalidate();const n=epoch,text=getText(),skip=getSkip();let spans;source=text;
  try{spans=explicitMathSpans(text);}catch(error){el('status').textContent=error.message;return;}
  const show=(results,engine='')=>{
   if(n!==epoch||getText()!==text||getSkip()!==skip)return;
   const preview=assembleMathPreview(text,spans,results,{skip});el('result').value=preview.text;el('copy').disabled=!preview.text;
   const failed=preview.formulas.filter(f=>f.warning).length;
   el('status').textContent=skip?'Skip math notation is on. Explicit formulas are omitted from this preview; ordinary text is kept.':!spans.length?'No balanced explicit math notation found. Ordinary text and inline math are unchanged.':`${spans.length} formula${spans.length===1?'':'s'} previewed.${failed?' '+failed+' unsupported or malformed formula'+(failed===1?' is':'s are')+' kept exactly as written.':''} Preview only; not used by Play.`;
   finish();
  };
  if(skip||!spans.length){show([]);return;}
  el('start').disabled=true;el('cancel').hidden=false;el('status').textContent='Preparing local math wording…';
  try{
   worker=createWorker();timer=setTimeout(()=>{if(n===epoch)invalidate('Math wording took too long. The worker was stopped; your original is unchanged.');},MATH_PREVIEW_LIMITS.timeout);
   worker.onmessage=event=>{if(n!==epoch||event.data?.id!==n)return;if(event.data.error){invalidate(event.data.error);return;}show(event.data.results,event.data.engine||'');};
   worker.onerror=event=>{event.preventDefault?.();if(n===epoch)invalidate('The local math engine is unavailable. Your original is unchanged; existing Skip math notation remains available.');};
   worker.postMessage({id:n,formulas:spans.map(({kind,body,display})=>({kind,body,display}))});
  }catch{invalidate('The local math engine could not be loaded. Your original is unchanged.');}
 };
 el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('result').value);el('status').textContent='Wording copied. It has not been applied to the reader.';}catch{el('result').focus();el('result').select();el('status').textContent='Select and copy the wording using your browser.';}};
 return {sourceChanged(){const next=getText();if(next!==source){source=next;invalidate('Source changed. Preview again when ready.');}},optionsChanged(){invalidate('Cleanup choice changed. Preview again to apply it.');}};
}
