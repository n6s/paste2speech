// Local workerd compatibility proof. No Google access, storage, or deployment.
import {assemble} from './assemble.mjs';
export default {async fetch(request){
  if(request.method!=='POST')return new Response('Local MP3 assembly proof');
  try {
    const lengths=JSON.parse(request.headers.get('X-Section-Lengths'));
    if(!Array.isArray(lengths) || !lengths.length || lengths.length>32 ||
       lengths.some(n=>!Number.isInteger(n)||n<1) || lengths.reduce((a,b)=>a+b,0)>4*1024*1024)
      throw Error('Invalid lengths');
    const reader=request.body.getReader(), blocks=[];let received=0;
    while(true){const {done,value}=await reader.read();if(done)break;received+=value.length;
      if(received>4*1024*1024){await reader.cancel();throw Error('Too large');}blocks.push(value);}
    if(received!==lengths.reduce((a,b)=>a+b,0))throw Error('Wrong length');
    const body=new Uint8Array(received);let offset=0;
    for(const b of blocks){body.set(b,offset);offset+=b.length;}
    offset=0;const parts=lengths.map(n=>{const p=body.subarray(offset,offset+n);offset+=n;return p;});
    const timeline=assemble(parts);
    return new Response(new ReadableStream({start(controller){for(const p of parts)controller.enqueue(p);controller.close();}}),
      {headers:{'Content-Type':'audio/mpeg','X-Audio-Duration':String(timeline.duration),'X-Section-Starts':JSON.stringify(timeline.starts)}});
  }catch{return new Response('Unsupported MP3 proof input',{status:400});}
}};
