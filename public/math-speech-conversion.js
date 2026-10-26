import {explicitMathSpans,assembleMathPreview,MATH_PREVIEW_LIMITS} from './math-speech-spans.js';

// One bounded local conversion boundary for preview and reader preparation.
// No source mutation, network provider request, or billing operation occurs here.
export function convertMathSpeech(text,{skip=false,signal,createWorker=()=>new Worker('/math-speech-worker.js',{type:'module'}),timeout=MATH_PREVIEW_LIMITS.timeout}={}){
 return new Promise((resolve,reject)=>{
  let worker,timer,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(value);};
  const abort=()=>finish(new DOMException('Math wording cancelled.','AbortError'));
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  try{
   const spans=explicitMathSpans(text);
   if(skip||!spans.length){finish(null,assembleMathPreview(text,spans,[],{skip}));return;}
   worker=createWorker();
   timer=setTimeout(()=>finish(Error('Math wording took too long. Your original is unchanged.')),timeout);
   worker.onmessage=({data})=>{if(data?.id!==1)return;if(data.error){finish(Error(data.error));return;}if(!Array.isArray(data.results)||data.results.length!==spans.length){finish(Error('Math wording returned an incomplete result. Your original is unchanged.'));return;}finish(null,assembleMathPreview(text,spans,data.results));};
   worker.onerror=event=>{event.preventDefault?.();finish(Error('The local math engine is unavailable. Your original is unchanged.'));};
   worker.postMessage({id:1,formulas:spans.map(({kind,body,display})=>({kind,body,display}))});
  }catch(error){finish(error);}
 });
}

export function createMathSpeechCache(convert=convertMathSpeech){
 let entry=null;
 return {
  ready(text,skip){return entry?.text===text&&entry.skip===skip&&entry.value?entry.value:null;},
  seed(text,skip,spoken){if(typeof spoken==='string'&&spoken.length<=200000){entry?.controller?.abort();entry={text,skip,value:{text:spoken,formulas:[]}};}},
  cancel(){entry?.controller?.abort();entry=null;},
  async prepare(text,skip){
   if(entry?.text===text&&entry.skip===skip){if(entry.value)return entry.value;return entry.promise;}
   entry?.controller?.abort();const current={text,skip,controller:new AbortController()};entry=current;
   current.promise=convert(text,{skip,signal:current.controller.signal}).then(value=>{if(entry!==current)throw new DOMException('Source changed.','AbortError');current.value=value;return value;},error=>{if(entry===current)entry=null;throw error;});return current.promise;
  }
 };
}
