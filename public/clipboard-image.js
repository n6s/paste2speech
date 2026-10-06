const imageFile=file=>file?.type?.startsWith('image/')||!file?.type&&/\.(?:png|jpe?g|webp)$/i.test(file?.name||'');
export function pastedImages(data){
 const items=Array.from(data?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
 return (items.length?items:Array.from(data?.files||[])).filter(imageFile);
}
// Clipboard bytes are read only by a foreground user gesture. All document
// validation and explicit paid-upload consent stay in the existing importer.
export function setupClipboardImage({root,target,importFile,getBusy,status,read=()=>navigator.clipboard.read(),canRead=()=>globalThis.isSecureContext&&document.hasFocus()&&typeof navigator.clipboard?.read==='function'}){
 const button=document.createElement('button');button.type='button';button.id='document-paste-image';button.textContent='Paste screenshot';
 const hint=document.createElement('p');hint.id='document-clipboard-hint';hint.textContent='A saved screenshot must also be copied before it can be pasted. Choose file works for saved images.';button.setAttribute('aria-describedby',hint.id);root.append(button,hint);
 let sequence=0,reading=false;const render=()=>{button.disabled=reading||getBusy();};
 const load=async files=>{
  root.open=true;
  if(getBusy()){status.textContent='A document is being processed. Clear it before opening another image.';return;}
  if(!files.length){status.textContent='No image was found. Copy a screenshot, or use Choose file.';return;}
  if(files.length!==1){status.textContent='Paste one image at a time, or use Choose file.';return;}
  await importFile(files[0]);
 };
 target?.addEventListener('paste',event=>{
  let files;try{files=pastedImages(event.clipboardData);}catch{status.textContent='The pasted image could not be opened. Use Choose file.';return;}
  if(!files.length)return;
  event.preventDefault();event.stopImmediatePropagation();void load(files);
 },{capture:true});
 button.onclick=async()=>{
  if(reading||getBusy())return;
  if(!canRead()){status.textContent='Clipboard image paste is unavailable here. Use Choose file, or paste a copied image into the text box.';return;}
  const request=++sequence;reading=true;render();status.textContent='Checking the clipboard for an image…';
  try{
   const items=await read();if(request!==sequence)return;
   const candidates=Array.from(items).map(item=>({item,mime:['image/png','image/jpeg','image/webp'].find(mime=>item.types.includes(mime))||item.types.find(mime=>mime.startsWith('image/'))})).filter(c=>c.mime);
   if(candidates.length!==1){await load(candidates);return;}
   const {item,mime}=candidates[0],blob=await item.getType(mime);if(request!==sequence)return;
   const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]||'image';
   await load([new File([blob],`Clipboard image.${ext}`,{type:mime})]);
  }catch{if(request===sequence)status.textContent='Clipboard access was denied or could not be completed. Use Choose file, or paste a copied image into the text box.';}
  finally{if(request===sequence){reading=false;render();}}
 };
 return {setBusy:render,clear(){sequence++;reading=false;render();}};
}
