/** Summary text stays in this tab. No request is made while editing. */
export function setupSummary({getText,setText,setMode,fetcher=fetch}){
 const button=document.createElement('button');button.id='summary-mode';button.type='button';button.textContent='Summary';button.setAttribute('aria-pressed','false');document.querySelector('.mode-controls').classList.add('has-summary');document.querySelector('.mode-controls').append(button);
 const panel=document.createElement('section');panel.id='summary-view';panel.hidden=true;panel.setAttribute('aria-label','Summary mode');panel.innerHTML=`<h2>Summarize your text</h2><p>Your original stays available. Review the summary for omissions before using it.</p><p id="summary-source"></p><label class="summary-consent"><input id="summary-consent" type="checkbox"> Send this text to Cloudflare Workers AI to make a summary.</label><button id="summarize" type="button">Summarize</button><button id="summary-cancel" type="button" hidden>Cancel</button><p id="summary-status" role="status" aria-live="polite"></p><label for="summary-result">Summary · editable</label><textarea id="summary-result" rows="8" placeholder="Your summary will appear here." disabled></textarea><button id="summary-use" type="button" disabled>Use summary in reader</button><button id="summary-restore" type="button" disabled>Restore original</button>`;
 document.getElementById('edit-view').after(panel);
 const el=id=>panel.querySelector('#'+id);let version=0,controller=null,source=getText(),original=null,resultSource=null,usingResult=false,usingSummary=false,ready=false,busy=false;
 const status=message=>{el('summary-status').textContent=message;};
 const update=()=>{el('summary-source').textContent=`Source: ${source.length.toLocaleString()} characters · maximum 12,000 UTF-8 bytes`;el('summarize').disabled=!!controller||busy||!ready||!source.trim()||new TextEncoder().encode(source).length>12000||!el('summary-consent').checked;el('summary-use').disabled=!!controller||resultSource!==source||!el('summary-result').value.trim();el('summary-restore').disabled=original===null;};
 const cancel=()=>{version++;controller?.abort();controller=null;el('summary-cancel').hidden=true;update();};
 button.onclick=()=>setMode('summary');el('summary-consent').onchange=update;el('summary-result').oninput=update;
 el('summary-cancel').onclick=()=>{cancel();status('Canceled. A request already sent may still finish on the server; no automatic retry is made.');};
 el('summarize').onclick=async()=>{
  if(el('summarize').disabled)return;
  const submitted=source,key=crypto.randomUUID(),current=++version;original??=submitted;controller=new AbortController();el('summary-cancel').hidden=false;update();status('Making a summary…');
  try{
   const response=await fetcher('/api/summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:submitted,consent:true,requestId:key}),signal:controller.signal});const data=await response.json();if(current!==version||getText()!==submitted)return;if(!response.ok)throw Error(data.detail||'Summary unavailable.');if(typeof data.summary!=='string'||!data.summary.trim()||data.summary.length>8000)throw Error('The summary response was invalid.');
   el('summary-result').value=data.summary;el('summary-result').disabled=false;resultSource=submitted;status('Summary ready. Edit it if needed, then use it in the reader.');
  }catch(error){if(current===version)status(error.name==='AbortError'?'Canceled.':error.message||'Summary failed. No automatic retry was made.');}
  finally{if(current===version){controller=null;el('summary-cancel').hidden=true;update();}}
 };
 el('summary-use').onclick=()=>{if(el('summary-use').disabled)return;usingResult=true;usingSummary=true;setText(el('summary-result').value);usingResult=false;};
 el('summary-restore').onclick=()=>{if(original===null)return;cancel();usingResult=true;setText(original);usingResult=false;source=getText();usingSummary=false;status('Original restored.');update();};
 fetcher('/api/summary/config').then(async response=>{if(!response.ok)throw Error();const config=await response.json();ready=config.available===true;status(ready?'Ready. Nothing is sent until you consent and press Summarize.':config.detail||'Summary inference is paused.');update();}).catch(()=>{status('Summary availability could not be checked. Nothing was sent.');update();});
 update();
 return {setBusy(value){busy=value;if(value)cancel();update();},clearSource(){cancel();usingSummary=false;original=null;resultSource=null;el('summary-result').value='';el('summary-result').disabled=true;el('summary-consent').checked=false;update();},setVisible(visible){panel.hidden=!visible;button.setAttribute('aria-pressed',String(visible));update();},sourceChanged(){const next=getText();if(next===source)return;cancel();source=next;el('summary-consent').checked=false;if(!usingResult&&!usingSummary){original=null;resultSource=null;el('summary-result').value='';el('summary-result').disabled=true;el('summary-consent').checked=false;status(ready?'Source changed. Consent again to summarize this text.':'Summary inference is paused pending a capped budget approval.');}update();}};
}
