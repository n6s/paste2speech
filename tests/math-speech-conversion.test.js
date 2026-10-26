import test from 'node:test';import assert from 'node:assert/strict';
import{convertMathSpeech,createMathSpeechCache}from'../public/math-speech-conversion.js';
import{explicitMathSpans}from'../public/math-speech-spans.js';
const samples=[String.raw`\(x^2 + 5x + 6 = (x + 2)(x + 3)\)`,String.raw`\((x + 3)^2 = x^2 + 6x + 9\)`,String.raw`\(1^2 = 1 \quad 6^2 = 36\)`,String.raw`\(\frac{x + 1}{2} = 4\)`,String.raw`\(\sqrt{x + 1} = 3\)`,String.raw`\(x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}\)`];
test('all reported parenthesized formulas reach the shared conversion boundary unchanged',async()=>{
 const source=samples.join('\n')+'\nWorkbook costs $12.50 and pencil costs $2.00. Normal x^2 + 1 stays.';let message,terminated=0;
 const result=await convertMathSpeech(source,{createWorker:()=>({postMessage(value){message=value;queueMicrotask(()=>this.onmessage({data:{id:1,results:value.formulas.map((_,i)=>({speech:'Formula '+i}))}}));},terminate(){terminated++;}})});
 assert.equal(message.formulas.length,6);assert.deepEqual(message.formulas.map(f=>f.body),samples.map(s=>s.slice(2,-2)));assert.match(result.text,/Workbook costs \$12.50 and pencil costs \$2.00/);assert.match(result.text,/Normal x\^2 \+ 1 stays/);assert.equal(terminated,1);assert.equal(explicitMathSpans(source).length,6);
});
test('skip requires no worker; aborted and incomplete results cannot become speech',async()=>{
 const text=samples[0];const skipped=await convertMathSpeech(text,{skip:true,createWorker(){throw Error('must not load');}});assert.equal(skipped.text,' ');
 const controller=new AbortController();let terminated=0;const pending=convertMathSpeech(text,{signal:controller.signal,createWorker:()=>({postMessage(){},terminate(){terminated++;}})});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(terminated,1);
 await assert.rejects(convertMathSpeech(text,{createWorker:()=>({postMessage(){queueMicrotask(()=>this.onmessage({data:{id:1,results:[]}}));},terminate(){}})}),/incomplete/);
});
test('engine timeout fails closed rather than silently submitting raw paid text',async()=>{
 await assert.rejects(convertMathSpeech(samples[0],{timeout:5,createWorker:()=>({postMessage(){},terminate(){}})}),/too long/);
});

test('indented explicit delimiters convert but fenced and inline code remain literal',()=>{
 assert.equal(explicitMathSpans('    '+samples[0]).length,1);
 assert.equal(explicitMathSpans('```latex\n'+samples[0]+'\n```').length,0);
 assert.equal(explicitMathSpans('`'+samples[0]+'`').length,0);
});

test('conversion cache deduplicates and restores exact saved wording without loading worker',async()=>{
 let calls=0;const cache=createMathSpeechCache(async text=>{calls++;return {text:'SPOKEN '+text,formulas:[]};});
 const a=await cache.prepare('$x$',false),b=await cache.prepare('$x$',false);assert.equal(a,b);assert.equal(calls,1);
 cache.seed('original',false,'verified saved prose');assert.equal((await cache.prepare('original',false)).text,'verified saved prose');assert.equal(calls,1);cache.seed('other',false,'other prose');cache.cancel();assert.equal(cache.ready('other',false),null);
});

test('doubled clipboard delimiters convert only bounded explicit math outside literal code',()=>{
 const source=String.raw`\\(x^2 + 1 = 2\\)`;assert.equal(explicitMathSpans(source)[0]?.body,'x^2 + 1 = 2');
 assert.equal(explicitMathSpans('`'+source+'`').length,0);
 assert.equal(explicitMathSpans(String.raw`\\(ordinary prose\\)`).length,0);
});
