import {mathSpans,mathCodeRanges} from './math-notation.js';
export const MATH_PREVIEW_LIMITS=Object.freeze({source:100000,formulas:64,tex:2048,mathml:8192,nodes:512,depth:32,timeout:8000});
export function explicitMathSpans(text){
 if(typeof text!=='string'||text.length>MATH_PREVIEW_LIMITS.source)throw Error('Math wording preview accepts at most 100,000 source characters. Your original is unchanged.');
 const code=mathCodeRanges(text),spans=mathSpans(text,{polynomial:true}).filter(span=>{
  const raw=text.slice(span.start,span.end);
  return !(raw.startsWith('$')&&!raw.startsWith('$$')&&/^\d/.test(raw.slice(1))&&/^\d/.test(text.slice(span.end)));
 }).map(span=>{const raw=text.slice(span.start,span.end);let body=raw;if(raw.startsWith('$$'))body=raw.slice(2,-2);else if(raw.startsWith('$'))body=raw.slice(1,-1);else if(raw.startsWith('\\(')||raw.startsWith('\\['))body=raw.slice(2,-2);return {...span,kind:'tex',body};});
 for(const match of text.matchAll(/<math\b[^>]*>[\s\S]*?<\/math\s*>/gi)){
  const start=match.index,end=start+match[0].length;if(code.some(r=>r.start<end&&r.end>start&&(r.kind!=='url'||r.start<=start))||spans.some(s=>s.start<end&&s.end>start))continue;
  spans.push({start,end,kind:'mathml',body:match[0],display:/display\s*=\s*["']block/.test(match[0])});
 }
 spans.sort((a,b)=>a.start-b.start);if(spans.length>MATH_PREVIEW_LIMITS.formulas)throw Error('Preview at most 64 formulas at once. Your complete original is kept.');return spans;
}
export function assembleMathPreview(text,spans,results,{skip=false}={}){
 let cursor=0,output='';const formulas=[];
 for(let i=0;i<spans.length;i++){
  const span=spans[i],result=results[i];output+=text.slice(cursor,span.start);
  const spoken=skip?(span.display?'\n\n':' '):result?.speech||text.slice(span.start,span.end);
  output+=spoken;formulas.push({notation:text.slice(span.start,span.end),speech:skip?'Skipped by your math-cleanup choice.':result?.speech||null,warning:skip?null:result?.warning||null});cursor=span.end;
 }
 return {text:output+text.slice(cursor),formulas,skip};
}
