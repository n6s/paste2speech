import {clipboardMarkdown} from './paste.js';
// Both APIs remain permission-controlled. Never follow a denial or cancellation
// with another read, and never repeat either method during one button action.
const readBlocked=error=>['NotAllowedError','SecurityError','AbortError'].includes(error?.name);
const errorName=error=>['Error','TypeError','NotAllowedError','AbortError','NotFoundError','SecurityError','NotSupportedError','DataError'].includes(error?.name)?error.name:'OtherError';
export const isLocalClipboardReference=text=>/^\s*(?:content:\/\/\S+|file:\/\/\S+\.(?:png|jpe?g|webp)(?:[?#]\S*)?)\s*$/i.test(text||'');
export async function clipboardPayload(clipboard,observe,{guardImages=false}={}){
 const verified=payload=>{if(guardImages&&isLocalClipboardReference(payload.text))throw Error('clipboard-image-unavailable');return payload;};
 const note=(stage,text,details={})=>{try{observe?.(stage,text,details);}catch{}};
 let payload,richError;
 if(clipboard?.read){
  try{payload=await richClipboardPayload(clipboard,note,guardImages);}catch(error){
   note('clipboard-rich-error',null,{name:errorName(error)});
   if(readBlocked(error)||['multiple-images','clipboard-image-unavailable'].includes(error.message))throw error;
   richError=error;
  }
  if(payload?.image||payload?.text?.trim())return verified(payload);
 }
 if(clipboard?.readText){
  note('clipboard-readText-start',null,{reason:!clipboard.read?'rich-unavailable':richError?'rich-failed':'rich-empty'});
  const text=await clipboard.readText();
  note('clipboard-readText-result',text);
  return verified({text,image:null,hasImage:payload?.hasImage||false});
 }
 if(richError)throw richError;
 if(payload)return payload;
 throw Error('Clipboard access unavailable');
}
// Prefer actual text for mixed contents. Image bytes are needed only when no
// text representation was supplied; an image result keeps its existing flow.
async function richClipboardPayload(clipboard,observe,guardImages){
 let imageMarkup=false;
 const note=(stage,text,details={})=>{try{observe?.(stage,text,details);}catch{}};
 note('clipboard-read-start');
 const items=Array.from(await clipboard.read());
 note('clipboard-read-result',null,{items:items.map((item,index)=>({index,formats:item.types.filter(type=>['text/plain','text/html','image/png','image/jpeg','image/webp'].includes(type))}))});
 const images=items.map(item=>({item,mime:['image/png','image/jpeg','image/webp'].find(type=>item.types.includes(type))||item.types.find(type=>type.startsWith('image/'))})).filter(entry=>entry.mime);
 const plainReads=new Map();
 const readPlain=item=>{if(!plainReads.has(item))plainReads.set(item,(async()=>{const index=items.indexOf(item);note('clipboard-plain-start',null,{item:index});const text=await (await item.getType('text/plain')).text();note('clipboard-plain-result',text,{item:index});return text;})());return plainReads.get(item);};
 for(const item of items){
  let plain;
  if(item.types.includes('text/plain')){
   try{plain=await readPlain(item);}catch(error){if(readBlocked(error)||!item.types.includes('text/html'))throw error;}
  }
  if(item.types.includes('text/html')){
   // A single clipboard read can return HTML and plain text as separate items.
   // Pair representations before accepting HTML that may have empty link labels.
   let companion=plain;
   if(!companion?.trim())for(const candidate of items){
    if(!candidate.types.includes('text/plain'))continue;
    try{const text=await readPlain(candidate);if(text.trim()){companion=text;break;}}catch(error){if(readBlocked(error))throw error;}
   }
   try{const index=items.indexOf(item);note('clipboard-html-start',null,{item:index});const html=await (await item.getType('text/html')).text();note('clipboard-html-result',html,{item:index});const text=clipboardMarkdown(html,companion);if(guardImages&&!text?.trim()&&/<(?:img|svg|picture)\b/i.test(html))imageMarkup=true;note('clipboard-html-import',text,{item:index});if(text?.trim()){note('clipboard-selected-html-import',text);return {text,image:null,hasImage:images.length>0};}}catch(error){note('clipboard-html-error',null,{name:errorName(error)});if(readBlocked(error))throw error;}
  }
  if(plain?.trim()){
   note('clipboard-selected-plain',plain);
   return {text:plain,image:null,hasImage:images.length>0};
  }
 }
 if(images.length>1)throw Error('multiple-images');
 if(!images.length){if(imageMarkup)throw Error('clipboard-image-unavailable');return {text:'',image:null,hasImage:false};}
 const {item,mime}=images[0];let blob;try{blob=await item.getType(mime);}catch(error){if(guardImages&&!readBlocked(error))throw Error('clipboard-image-unavailable');throw error;}const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]||'image';
 return {text:'',image:new File([blob],`Clipboard image.${ext}`,{type:mime}),hasImage:true};
}
