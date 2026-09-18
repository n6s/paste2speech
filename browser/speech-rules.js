import { timeSpeech } from './time-speech.js';
import { currencyNumberWords } from '../public/text.js';
export function spokenText(text) {
 return text.split(/((?:https?:\/\/|www\.)[^\s]+)/gi).map(part => {
  if (/^(?:https?:\/\/|www\.)/i.test(part)) return part;
  part = timeSpeech(part);
  part = part.replace(/(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)[ \t]*[-‑–]?[ \t]*(lbs?|sq\.?[ \t]*[-‑–]?[ \t]*ft|ft)\b(\.?)/gi,
   (m,n,u,d,offset,whole) => `${n} ${/^lb/i.test(u) ? (Number(n.replaceAll(',','')) === 1 ? 'pound':'pounds') : /^sq/i.test(u) ? 'square feet':'feet'}${/^\s*[a-z]/.test(whole.slice(offset+m.length)) ? '' : d}`);
  part = part.replace(/(?<![\w.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\w|,\d|\.\w)/g,m=>currencyNumberWords(m)||m);
  return part.replace(/(?<![\w.])(\d+)\.(\d+)(?!\w|\.\w)/g,(_,a,b)=>`${a} point ${[...b].map(d=>['zero','one','two','three','four','five','six','seven','eight','nine'][d]).join(' ')}`);
 }).join('');
}
export function speechPhrases(text) {
 const boundaries = new Map();
 const add=(end,pause)=>boundaries.set(end,Math.max(boundaries.get(end)||0,pause));
 for(const m of text.matchAll(/:(?=\s|$)/g)) add(m.index+m[0].length,6000);
 for(const m of text.matchAll(/—+/g)) add(m.index+m[0].length,3600);
 for(const m of text.matchAll(/(?:^[ \t]*|\b[Cc][Oo][Rr][Rr][Ee][Cc][Tt][ \t]+[Aa][Nn][Ss][Ww][Ee][Rr]:[ \t]*)[A-Z]\)(?=\s+\S)/g)) add(m.index+m[0].length,3600);
 const stack=[], pairs={'“':'”','‘':'’','"':'"'};
 for(let i=0;i<text.length;i++) {
  const c=text[i], before=text[i-1]||'', after=text[i+1]||'';
  if ('‘’'.includes(c)&&/\w/.test(before)&&/\w/.test(after)) continue;
  if(stack.length && c===stack.at(-1)[1]) {
   const [start]=stack.pop();
   if(!stack.length && /[\p{L}\p{N}]/u.test(text.slice(start+1,i))) {
    let end=i+1; while(end<text.length && ',.;:!?…'.includes(text[end])) end++;
    if(start && text.slice(0,start).trim()) add(start,1200);
    if(text.slice(end).trim()) add(end,1200);
   }
  } else if(pairs[c] && !/\w/.test(before)) stack.push([i,pairs[c]]);
 }
 const result=[]; let start=0;
 for(const [end,pause] of [...boundaries].sort((a,b)=>a[0]-b[0])) {
  const phrase=text.slice(start,end).replaceAll('—',' ').trim();
  if(phrase) result.push([phrase,pause]); else if(result.length) result.at(-1)[1]=Math.max(result.at(-1)[1],pause);
  start=end;
 }
 const tail=text.slice(start).replaceAll('—',' ').trim(); if(tail) result.push([tail,0]);
 return result;
}
// Convert Misaki's compact vowel symbols to the eSpeak/ONNX vocabulary.
export function browserPhonemes(value) { return value.replaceAll('A','eɪ').replaceAll('O','oʊ').replaceAll('Q','ɒ').replaceAll('r','ɹ'); }
export function pronunciationSegments(text, dialect, dictionary) {
 const result=[];
 for(const part of text.split(/((?:https?:\/\/|www\.)[^\s]+)/gi)) {
  if(/^(?:https?:\/\/|www\.)/i.test(part)) { result.push({text:part}); continue; }
  const pattern=new RegExp(`\\b(${Object.keys(dictionary[dialect]).join('|')})(['’]s)?\\b`,'gi');
  let start=0;
  for(const m of part.matchAll(pattern)) {
   if(m.index>start) result.push({text:part.slice(start,m.index)});
   const base=browserPhonemes(dictionary[dialect][m[1].toLowerCase()]);
   const possessive=/[szʃʒʧʤ]$/.test(base)?'ɪz':/[ptkfθ]$/.test(base)?'s':'z';
   result.push({phonemes:base+(m[2]?possessive:'')});
   start=m.index+m[0].length;
  }
  if(start<part.length) result.push({text:part.slice(start)});
 }
 return result;
}
export function splitPhonemes(phonemes, tokenizer) {
 const pieces=[]; let remaining=phonemes;
 while(remaining) {
  const all=tokenizer(remaining,{truncation:false}).input_ids;
  if(all.dims.at(-1)<=511) { pieces.push(all); break; }
  let end=Math.min(remaining.length-1,480);
  while(tokenizer(remaining.slice(0,end),{truncation:false}).input_ids.dims.at(-1)>511) end--;
  const boundary=remaining.lastIndexOf(' ',end); if(boundary>0) end=boundary;
  pieces.push(tokenizer(remaining.slice(0,end),{truncation:false}).input_ids);
  remaining=remaining.slice(end).trimStart();
 }
 return pieces;
}
