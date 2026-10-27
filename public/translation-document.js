// Document planning is local. Provider pieces remain bounded; no source is truncated.
import {TRANSLATION_LANGUAGES,translationCharacters,translationWellFormed} from './translation-contract.js';
export const TRANSLATION_CHUNK_CODEPOINTS=5000;
export const translationHash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export async function planTranslationDocument(text,target,{signal}={}){
 if(typeof text!=='string'||!text.trim()||!translationWellFormed(text)||!Object.hasOwn(TRANSLATION_LANGUAGES,target))throw Error('Choose a supported language and valid source text.');
 const chunks=[];let at=0,total=0;
 while(at<text.length){signal?.throwIfAborted();let end=at,count=0;while(end<text.length&&count<TRANSLATION_CHUNK_CODEPOINTS){const cp=text.codePointAt(end);end+=cp>65535?2:1;count++;}
  if(end<text.length){const candidate=text.slice(at,end),paragraph=candidate.lastIndexOf('\n\n'),sentence=Math.max(candidate.lastIndexOf('. '),candidate.lastIndexOf('? '),candidate.lastIndexOf('! ')),space=candidate.lastIndexOf(' ');const cut=paragraph>=candidate.length/2?paragraph+2:sentence>=candidate.length/2?sentence+2:space>=candidate.length/2?space+1:0;if(cut)end=at+cut;}
  const value=text.slice(at,end),characters=translationCharacters(value);chunks.push({text:value,characters,hash:await translationHash(value)});total+=characters;at=end;
 }
 const manifest=chunks.map(({characters,hash})=>({characters,hash}));
 // This is an actual bounded manifest transport, not a provider document-size cap.
 if(new TextEncoder().encode(JSON.stringify(manifest)).length>900000)throw Error('The translation plan exceeds the current 1 MB request envelope. Your complete source is kept; split this exceptionally large document into files.');
 return {text,target,characters:total,hash:await translationHash(JSON.stringify(manifest)),chunks,manifest};
}
