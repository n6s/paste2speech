import {documentType,DOCUMENT_LIMIT,validateDocumentBytes,OCR_MODEL} from './document-format.js';
import {reconstruct,exportText} from './document-reconstruct.js';
export function setupDocumentImport({input,status,cancel,getText,accept,onBusy,pauseReading,fetcher=fetch}) {
 const root=input.closest('details');root.querySelector('summary').textContent='Open document';root.querySelector('label[for="pdf-file"]').textContent='Choose PDF or image';input.accept='.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
 status.textContent='PDFs are checked on this device first. Images and unsuitable PDFs need cloud OCR. Nothing is uploaded without your agreement.';
 const cloud=document.createElement('div');cloud.hidden=true;cloud.id='document-cloud';
 const notice=document.createElement('p');notice.id='document-privacy';
 const label=document.createElement('label'),consent=document.createElement('input');consent.type='checkbox';consent.id='document-consent';consent.setAttribute('aria-describedby','document-privacy');label.append(consent,' I agree to send this document to Mistral for paid OCR.');
 const run=document.createElement('button');run.type='button';run.id='document-ocr';run.textContent='Use cloud OCR';run.disabled=true;cloud.append(notice,label,run);root.append(cloud);
 const exports=document.createElement('div');exports.hidden=true;exports.id='document-exports';
 const notes=document.createElement('details'),summary=document.createElement('summary'),noteText=document.createElement('p');summary.textContent='Extraction details';noteText.id='document-notes';notes.append(summary,noteText);root.append(exports,notes);notes.hidden=true;
 let sequence=0,controller,busy=false,pending,imported;const cache=new Map();
 const check=document.createElement('button');check.type='button';check.id='document-check';check.textContent='Check OCR status';root.append(check);
 const elapsed=document.createElement('span');elapsed.id='document-elapsed';elapsed.setAttribute('aria-live','off');root.insertBefore(elapsed,status.nextSibling);
 const reconstructed=raw=>{if(raw.model!==OCR_MODEL||!Array.isArray(raw.pages)||raw.pages.length>100)throw Error('Cloud OCR returned an unsupported result. Your existing text is unchanged.');const result=reconstruct(raw);if(!result.articles.length)throw Error('No readable text was returned. Your existing text is unchanged.');return {result,data:{text:exportText(result.articles).trim(),markdown:exportText(result.articles,true),pages:raw.pages.length}};};
 check.onclick=async()=>{const previous=getText(),request=sequence;check.disabled=true;try{const response=await fetcher('/api/ocr/status');const state=await response.json();if(!response.ok)throw Error(state.detail||'OCR status could not be checked.');status.textContent=state.detail+(state.elapsedSeconds!=null?` ${state.elapsedSeconds} seconds since admission.`:'');if(state.state==='ready'){const response=await fetcher('/api/ocr/result');if(!response.ok)throw Error((await response.json()).detail||'The saved result could not be loaded.');const {result,data}=reconstructed(await response.json());if(request===sequence&&getText()===previous){diagnostics(result.notes);load(data,{name:'October 2026 Spanish Fork newsletter.pdf'});}}}catch(error){status.textContent=error.message;}finally{check.disabled=false;}};
 const setBusy=value=>{busy=value;root.setAttribute('aria-busy',String(value));root.setAttribute('aria-busy',String(value));root.setAttribute('aria-busy',String(value));input.disabled=value;cancel.hidden=!value;check.disabled=value;onBusy(value);run.disabled=value||!pending||!consent.checked;};
 const diagnostics=value=>{notes.hidden=false;noteText.textContent=value.join(' ');};
 const load=(data,file)=>{if(!data.text.trim())throw Error('No readable text was returned. Your existing text is unchanged.');accept(data);imported={...data,name:file.name};exports.hidden=false;status.textContent=`Loaded ${file.name}${data.pages?` · ${data.pages} pages`:''}. Press Play when ready.`;cloud.hidden=true;pending=null;};
 const download=markdown=>{
  const text=getText(),value=markdown&&imported&&text===imported.text?imported.markdown:text;
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([value],{type:markdown?'text/markdown;charset=utf-8':'text/plain;charset=utf-8'}));
  link.href=url;link.download=(imported?.name||'document').replace(/\.[^.]+$/,'').replace(/[\x00-\x1f/\\]/g,'_')+(markdown?'.md':'.txt');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 for(const markdown of [false,true]){const b=document.createElement('button');b.type='button';b.textContent=markdown?'Download Markdown (.md)':'Download text (.txt)';b.onclick=()=>download(markdown);exports.append(b);}
 consent.onchange=()=>{run.disabled=busy||!pending||!consent.checked;};
 cancel.onclick=()=>{controller?.abort();pending=null;cloud.hidden=true;};
 input.addEventListener('change',async()=>{
  const file=input.files[0];if(!file)return;const request=++sequence,previous=getText();pending=null;cloud.hidden=true;consent.checked=false;
  controller?.abort();controller=new AbortController();pauseReading();setBusy(true);status.textContent=`Checking ${file.name} on this device…`;
  try{
   const type=documentType(file);if(file.size>DOCUMENT_LIMIT)throw Error('Choose a document smaller than 20 MB.');
   validateDocumentBytes(new Uint8Array(await file.slice(0,12).arrayBuffer()),type.mime);
   let native;
   if(type.kind==='pdf'){
    const {extractPdf}=await import('./pdf.js');native=await extractPdf(file,controller.signal,{maxCharacters:1000000,assessQuality:true});
    diagnostics(native.diagnostics.map(p=>`Page ${p.page}: ${p.reasons.length?p.reasons.join(', '):p.blank?'blank':'local text accepted'}.`));
    if(!native.needsOcr){if(request===sequence&&getText()===previous)load({text:native.text,markdown:native.text,pages:native.pages},file);return;}
   }else diagnostics(['An image needs OCR to extract its text.']);
   if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
   if(cache.has(hash)){if(request===sequence&&getText()===previous)load(cache.get(hash),file);return;}
   const response=await fetcher('/api/ocr/config',{signal:controller.signal});if(!response.ok){const detail=await response.json().catch(()=>null);throw Error((detail?.detail||'Cloud OCR availability could not be checked.')+' Nothing was uploaded.');}
   const config=await response.json();if(request!==sequence||getText()!==previous)return;
   if(!config.enabled){status.textContent='This document needs OCR. Cloud OCR is not enabled yet. Nothing was uploaded; your existing text is unchanged.';return;}
   if(config.model!==OCR_MODEL||typeof config.costNotice!=='string'||!config.costNotice.trim())throw Error('Cloud OCR is unavailable until its cost and privacy setup is confirmed. Nothing was uploaded.');
   if(config.approvedDocument&&(type.kind!=='pdf'||config.approvedDocument.sha256!==hash||config.approvedDocument.bytes!==file.size))throw Error('This private OCR trial accepts only the approved October 2026 Spanish Fork newsletter PDF. Nothing was uploaded.');
   pending={file,type,hash,previous};notice.textContent=`Cloud OCR sends this file to Mistral (${OCR_MODEL}). ${config.costNotice} Speech playback is a separate action.`;cloud.hidden=false;status.textContent='Cloud OCR is needed. Agree to the upload and cost notice, then choose Use cloud OCR.';
  }catch(error){if(request===sequence)status.textContent=error.name==='AbortError'?'Import cancelled. Your existing text is unchanged.':error.message;}
  finally{if(request===sequence){setBusy(false);input.value='';}}
 });
 run.onclick=async()=>{
  if(busy||!pending||!consent.checked)return;const attempt=pending,request=sequence;pending=null;controller=new AbortController();setBusy(true);status.textContent='Extracting document text. This may take up to 90 seconds; no exact progress percentage is available.';const started=performance.now();elapsed.textContent=' 0 seconds elapsed.';const ticker=setInterval(()=>{elapsed.textContent=` ${Math.floor((performance.now()-started)/1000)} seconds elapsed.`;},1000);
  try{
   const form=new FormData();form.append('file',attempt.file);form.append('consent','true');form.append('model',OCR_MODEL);
   const response=await fetcher('/api/ocr',{method:'POST',body:form,signal:controller.signal});
   if(!response.ok){const detail=await response.json().catch(()=>null);throw Error(detail?.detail||'Cloud OCR failed. No automatic retry; your existing text is unchanged.');}
   const {result,data}=reconstructed(await response.json());
   cache.set(attempt.hash,data);if(request!==sequence||controller.signal.aborted||getText()!==attempt.previous)return;
   diagnostics(result.notes);load(data,attempt.file);
  }catch(error){if(request===sequence)status.textContent=error.name==='AbortError'?'Import cancelled. Your existing text is unchanged.':error.message;}
  finally{clearInterval(ticker);elapsed.textContent='';if(request===sequence){cloud.hidden=true;setBusy(false);}}
 };
 return {get busy(){return busy;}};
}
