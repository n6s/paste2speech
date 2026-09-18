export class LocalKokoro {
 constructor(progress=()=>{}) { this.progress=progress;this.sequence=0;this.worker=null;this.ready=false; }
 cancel() {
  this.worker?.terminate();this.worker=null;this.ready=false;
  this.pending?.reject(new DOMException('Cancelled','AbortError'));this.pending=null;
 }
 async run(type,payload={},signal) {
  if(signal?.aborted) throw new DOMException('Cancelled','AbortError');
  if(this.pending) throw Error('A voice operation is already running.');
  if(!this.worker){
   this.worker=new Worker(new URL('kokoro-worker.js',location.href),{type:'module'});
   this.worker.onmessage=({data})=>{
    const p=this.pending;if(!p||p.id!==data.id)return;
    if(data.progress!==undefined){this.progress(`Downloading voice model · ${data.progress}%`);return;}
    this.pending=null;
    if(data.error)p.reject(Error(data.error));else {this.ready=true;p.resolve(data);}
   };
   this.worker.onerror=()=>{this.pending?.reject(Error('This browser could not start Kokoro. Choose Browser voices or retry.'));this.pending=null;this.worker?.terminate();this.worker=null;this.ready=false;};
  }
  const abort=()=>this.cancel();signal?.addEventListener('abort',abort,{once:true});
  try{return await new Promise((resolve,reject)=>{const id=++this.sequence;this.pending={id,resolve,reject};this.worker.postMessage({id,type,...payload});});}
  finally{signal?.removeEventListener('abort',abort);}
 }
 async request(text,settings,signal) {
  const {pcm}=await this.run('synthesize',{text,voice:settings.voice,speed:settings.rate},signal);
  return {format:[1,0,1,0,192,93,0,0,128,187,0,0,2,0,16,0],pcm:new Uint8Array(pcm)};
 }
 async removeDownloads(){
  this.cancel();
  if(!globalThis.caches)return;
  for(const name of await caches.keys()){
   if(name.startsWith('paste2speech-')) await caches.delete(name);
   else if(name==='transformers-cache'){
    const cache=await caches.open(name);
    for(const request of await cache.keys())if(request.url.includes('/onnx-community/Kokoro-82M-v1.0-ONNX/'))await cache.delete(request);
   }
  }
 }
}
