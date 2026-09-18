import { gpuPrecision, validAudio, prepareGPU } from './gpu-policy.js';
import { env, StyleTextToSpeech2Model, AutoTokenizer, Tensor } from '@huggingface/transformers';
import { phonemize } from '../vendor/phonemize.js';
import dictionary from '../shared/pronunciations.json';
import { MODEL, REVISION, VOICES } from './model.js';
import { spokenText, speechPhrases, pronunciationSegments, splitPhonemes } from './speech-rules.js';
env.allowLocalModels=false;
env.useBrowserCache=true;
env.backends.onnx.wasm.wasmPaths = new URL('./',self.location.href).href;
env.backends.onnx.wasm.numThreads=1;
let loadMs=0,probeMs=0;
let model, tokenizer, backend = 'CPU · q8', gpuFailed = false;
async function dispose() {
 const previous=model;model=null;
 try { await previous?.dispose(); } catch(error) { console.warn('Kokoro cleanup failed',error); }
}
const voices=new Map();
async function init(id, useGPU = false, precision = 'auto') {
 if(model&&tokenizer) return;
 const progress_callback=p=>{ if(p.status==='progress') postMessage({id,progress:Math.round(p.progress||0)}); };
 const started=performance.now();
 let dtype='q8', device='wasm';
 if(useGPU && !gpuFailed) { dtype=await gpuPrecision(self.navigator.gpu,precision); device='webgpu'; }
 backend=device==='webgpu'?`GPU · ${dtype}`:'CPU · q8';
 [model,tokenizer]=await Promise.all([
  StyleTextToSpeech2Model.from_pretrained(MODEL,{revision:REVISION,dtype,device,progress_callback}),
  AutoTokenizer.from_pretrained(MODEL,{revision:REVISION}),
 ]);
 loadMs=Math.round(performance.now()-started);
}
async function voiceData(voice) {
 if(voices.has(voice)) return voices.get(voice);
 const url=`https://huggingface.co/${MODEL}/resolve/${REVISION}/voices/${voice}.bin`;
 let cache; try {cache=await caches.open('paste2speech-voices');}catch{}
 let response=await cache?.match(url);
 if(!response) { response=await fetch(url); if(!response.ok) throw Error('download'); try{await cache?.put(url,response.clone());}catch{} }
 const data=new Float32Array(await response.arrayBuffer());
 if(data.length!==130560) throw Error('voice');
 voices.set(voice,data); return data;
}
function quiet(audio,leading) {
 let n=0; while(n<audio.length && Math.abs(audio[leading?n:audio.length-1-n])<=0.0001)n++;return n;
}
async function synthesize(text,voice,speed) {
 if(!VOICES.some(v=>v.id===voice)) throw Error('voice');
 const data=await voiceData(voice), arrays=[];let previousPause=0,previousTrailing=0;
 for(const [phrase,pause] of speechPhrases(spokenText(text))) {
  let ps='';
  for(const segment of pronunciationSegments(phrase,voice[0],dictionary)) {
   ps+=segment.phonemes ?? ((/^\s/.test(segment.text)?' ':'')+await phonemize(segment.text,voice[0]) + (/\s$/.test(segment.text)?' ':''));
  }
  const phraseParts=[];
  for(const input_ids of splitPhonemes(ps,tokenizer)) {
   const offset=Math.min(509,Math.max(0,input_ids.dims.at(-1)-2))*256;
   const {waveform}=await model({input_ids,style:new Tensor('float32',data.slice(offset,offset+256),[1,256]),speed:new Tensor('float32',[speed],[1])});
   if(!waveform.data.length || !waveform.data.every(Number.isFinite))throw Error('Invalid audio output');
   phraseParts.push(new Float32Array(waveform.data));
  }
  let audio=new Float32Array(phraseParts.reduce((s,p)=>s+p.length,0)), pos=0;
  for(const p of phraseParts){audio.set(p,pos);pos+=p.length;}
  let leading=quiet(audio,true);const trailing=quiet(audio,false);
  if([1200,3600].includes(previousPause)&&arrays.length&&leading<audio.length) {
   let excess=Math.max(0,previousTrailing+leading-previousPause);
   const trimEnd=Math.min(excess,Math.max(0,previousTrailing-120));
   if(trimEnd){ arrays[arrays.length-1]=arrays.at(-1).slice(0,-trimEnd);previousTrailing-=trimEnd;excess-=trimEnd; }
   const trimStart=Math.min(excess,Math.max(0,leading-120)); if(trimStart){audio=audio.slice(trimStart);leading-=trimStart;}
  }
  const gap=Math.max(0,previousPause-previousTrailing-leading);
  if(gap)arrays.push(new Float32Array(gap));
  arrays.push(audio);previousPause=pause;previousTrailing=trailing;
 }
 const pcm=new Int16Array(arrays.reduce((s,a)=>s+a.length,0));let offset=0;
 for(const a of arrays)for(const v of a)pcm[offset++]=Math.round(Math.max(-1,Math.min(1,v))*32767);
 return pcm.buffer;
}
async function prepare(id, useGPU) {
 if(useGPU && !gpuFailed) {
  const ready=await prepareGPU(self.navigator.gpu,async precision=>{
   postMessage({id,status:`Trying GPU · ${precision}…`});
   probeMs=0;
   await init(id,true,precision);
   const started=performance.now();
   const sample=await synthesize('This is a short voice test.','af_heart',1);
   probeMs=Math.round(performance.now()-started);
   if(!validAudio(sample))throw Error('GPU sample failed');
  },dispose);
  if(ready)return;
  gpuFailed=true;
 }
 await init(id,false);
}

function metrics(status,extra={}) { return {status,backend:backend.startsWith('GPU')?'gpu':'cpu',dtype:backend.split(' · ')[1],fallback:gpuFailed,loadMs,probeMs,...extra}; }
self.onmessage=async({data:{id,type,text,voice,speed,useGPU}})=>{
 const started=performance.now();
 try {
  if(type==='benchmark') {
   const results=[];
   for(const mode of ['q8','fp32','fp16']) {
    try {
     await dispose();gpuFailed=false;
     postMessage({id,status:`Comparing ${mode==='q8'?'CPU':'GPU'} · ${mode}…`});
     const start=performance.now();
     await init(id,mode!=='q8',mode);
     const loaded=performance.now();
     const first=await synthesize('This is a short voice test.','af_heart',1);
     const warmed=performance.now();
     const second=await synthesize('This is a short voice test.','af_heart',1);
     if(!validAudio(first)||!validAudio(second))throw Error('Audio check failed');
     results.push({backend:mode==='q8'?'cpu':'gpu',dtype:mode,status:'ok',loadMs:Math.round(loaded-start),firstMs:Math.round(warmed-loaded),repeatMs:Math.round(performance.now()-warmed),audioMs:Math.round(second.byteLength/48)});
    }catch(error){results.push({backend:mode==='q8'?'cpu':'gpu',dtype:mode,status:'failed'});}
   }
   await dispose();gpuFailed=false;
   postMessage({id,results});return;
  }
  if(!model) await prepare(id,useGPU);
  if(type==='load'){await voiceData(voice||'af_heart');postMessage({id,ready:true,backend,fallback:gpuFailed,metrics:metrics('ok')});return;}
  const generationStarted=performance.now();
  let pcm;
  try { pcm=await synthesize(text,voice,speed); }
  catch(error) {
   if(!backend.startsWith('GPU'))throw error;
   gpuFailed=true;await dispose();await init(id,false);
   pcm=await synthesize(text,voice,speed);
  }
  postMessage({id,pcm,backend,fallback:gpuFailed,metrics:metrics('ok',{generateMs:Math.round(performance.now()-generationStarted),audioMs:Math.round(pcm.byteLength/48),characters:text.length})},[pcm]);
 }catch(error){console.warn('Kokoro operation failed',error);postMessage({id,metrics:metrics('failed',{elapsedMs:Math.round(performance.now()-started)}),error:'Could not prepare Kokoro audio. Retry or choose Browser voices.'});}
};
