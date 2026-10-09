import {clipboardMarkdown} from './paste.js';
// Read once during the click gesture. Prefer actual text for mixed contents;
// image bytes are needed only when no text representation was supplied.
export async function clipboardPayload(clipboard){
 if(!clipboard?.read){
  if(clipboard?.readText)return {text:await clipboard.readText(),image:null,hasImage:false};
  throw Error('Clipboard access unavailable');
 }
 const items=Array.from(await clipboard.read());
 const images=items.map(item=>({item,mime:['image/png','image/jpeg','image/webp'].find(type=>item.types.includes(type))||item.types.find(type=>type.startsWith('image/'))})).filter(entry=>entry.mime);
 for(const item of items){
  let plain;
  if(item.types.includes('text/plain')){
   try{plain=await (await item.getType('text/plain')).text();}catch(error){if(!item.types.includes('text/html'))throw error;}
  }
  if(item.types.includes('text/html')){
   try{const text=clipboardMarkdown(await (await item.getType('text/html')).text(),plain);if(text?.trim())return {text,image:null,hasImage:images.length>0};}catch{}
  }
  if(plain?.trim()){
   return {text:plain,image:null,hasImage:images.length>0};
  }
 }
 if(images.length>1)throw Error('multiple-images');
 if(!images.length)return {text:'',image:null,hasImage:false};
 const {item,mime}=images[0],blob=await item.getType(mime),ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]||'image';
 return {text:'',image:new File([blob],`Clipboard image.${ext}`,{type:mime}),hasImage:true};
}
