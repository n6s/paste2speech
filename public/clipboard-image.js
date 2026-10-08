import {clipboardMarkdown} from './paste.js';
const imageFile=file=>file?.type?.startsWith('image/')||!file?.type&&/\.(?:png|jpe?g|webp)$/i.test(file?.name||'');
export function pastedImages(data){
 const items=Array.from(data?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
 return (items.length?items:Array.from(data?.files||[])).filter(imageFile);
}
// Clipboard bytes are read only by a foreground user gesture. All document
// validation and explicit paid-upload consent stay in the existing importer.
export function setupClipboardImage({root,target,importFile,getBusy,status,read=()=>navigator.clipboard.read(),canRead=()=>globalThis.isSecureContext&&document.hasFocus()&&typeof navigator.clipboard?.read==='function'}){
 const button=document.createElement('button');button.type='button';button.id='document-paste-image';button.textContent='Paste screenshot';
 const hint=document.createElement('p');hint.id='document-clipboard-hint';hint.textContent='Paste works when your browser can read the copied image. On phones, Choose file is the reliable way to open a saved screenshot.';button.setAttribute('aria-describedby',hint.id);const sources=root.querySelector('.document-sources');if(sources){sources.prepend(button);root.insertBefore(hint,status);}else root.append(button,hint);
 const pasteHint=document.createElement('p');pasteHint.id='document-paste-hint';pasteHint.className='hint';pasteHint.textContent='Paste text or an image into the text box, or use Clear, Paste & Play. That button plays text; images open OCR options. Nothing is uploaded for OCR until you agree. If your phone does not provide the image, use Choose file for the saved screenshot.';target?.after(pasteHint);if(target)target.setAttribute('aria-describedby',[target.getAttribute('aria-describedby'),pasteHint.id].filter(Boolean).join(' '));
 let sequence=0,reading=false;const render=()=>{button.disabled=reading||getBusy();};
 const cancelRead=()=>{sequence++;reading=false;render();};
 target?.addEventListener('input',cancelRead);
 const load=async files=>{
  root.open=true;
  if(getBusy()){status.textContent='A document is being processed. Clear it before opening another image.';return;}
  if(!files.length){status.textContent='Your browser did not provide an image from the clipboard. A screenshot may still be in your phone’s clipboard. Use Choose file to select the saved screenshot, or try pasting it into the text box.';return;}
  if(files.length!==1){status.textContent='Paste one image at a time, or use Choose file.';return;}
  await importFile(files[0]);
 };
 target?.addEventListener('paste',event=>{
  cancelRead();
  if(getBusy()){event.preventDefault();event.stopImmediatePropagation();root.open=true;status.textContent='A document is being processed. Clear it before pasting another image or text.';return;}
  let files,text;
  try{files=pastedImages(event.clipboardData);if(files.length)text=event.clipboardData?.getData('text/plain')||clipboardMarkdown(event.clipboardData?.getData('text/html'));}catch{status.textContent='The pasted image could not be opened. Use Choose file.';return;}
  if(!files.length)return; // The editor retains its normal text/HTML paste and undo behavior.
  if(text){root.open=true;status.textContent='This paste includes text and an image. Keeping the text paste; to extract the image too, paste it by itself or use Choose file. Nothing was uploaded.';return;}
  event.preventDefault();event.stopImmediatePropagation();void load(files);
 },{capture:true});
 button.onclick=async()=>{
  if(reading||getBusy())return;
  if(!canRead()){status.textContent='Clipboard image paste is unavailable here. Use Choose file, or paste a copied image into the text box.';return;}
  const request=++sequence,previous=target?.value;reading=true;render();status.textContent='Checking the clipboard for an image…';
  try{
   const items=await read();if(request!==sequence||target?.value!==previous)return;
   const candidates=Array.from(items).map(item=>({item,mime:['image/png','image/jpeg','image/webp'].find(mime=>item.types.includes(mime))||item.types.find(mime=>mime.startsWith('image/'))})).filter(c=>c.mime);
   if(candidates.length!==1){await load(candidates);return;}
   const {item,mime}=candidates[0],blob=await item.getType(mime);if(request!==sequence||target?.value!==previous)return;
   const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]||'image';
   await load([new File([blob],`Clipboard image.${ext}`,{type:mime})]);
  }catch{if(request===sequence)status.textContent='Clipboard access was denied or could not be completed. Use Choose file, or paste a copied image into the text box.';}
  finally{if(request===sequence){reading=false;render();}}
 };
 return {setBusy:render,clear:cancelRead};
}
