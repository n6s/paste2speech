import {options} from './model.js';
export {MseReading} from './reading.js';
// Tailscale terminates TLS and preserves Host on its loopback HTTP hop.
// Wrangler also normalizes a same-origin Origin header to the HTTP hop.
// Accept only these two exact spellings, never an arbitrary forwarded origin.
const origins=new Map([['http://127.0.0.1:8790','http://127.0.0.1:8790'],['https://pop-os.tailbd091c.ts.net:8443','https://pop-os.tailbd091c.ts.net:8443'],['http://pop-os.tailbd091c.ts.net:8443','https://pop-os.tailbd091c.ts.net:8443']]);
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const cookie=request=>request.headers.get('Cookie')?.match(/(?:^|;\s*)mse_proof=([a-f0-9-]{36})(?:;|$)/)?.[1];
export default {async fetch(request,env){
  const url=new URL(request.url),externalOrigin=origins.get(url.origin);
  if(env.MSE_LOCAL_PROOF!=='1'||env.ENABLE_LIVE_SYNTHESIS!=='0'||!externalOrigin)return json({detail:'Private local experiment only'},403);
  if(!['GET','HEAD','POST','DELETE'].includes(request.method))return json({},405);
  if(['POST','DELETE'].includes(request.method)&&![externalOrigin,url.origin].includes(request.headers.get('Origin')))return json({detail:'Origin rejected'},403);
  let owner=cookie(request);
  if(url.pathname==='/api/session'&&request.method==='POST'){
    owner ||= crypto.randomUUID();
    return new Response('{}',{headers:{'Content-Type':'application/json','Cache-Control':'no-store',
      'Set-Cookie':`mse_proof=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${externalOrigin.startsWith('https:')?'; Secure':''}`}});
  }
  if(url.pathname.startsWith('/api/')){
    if(!owner)return json({detail:'Test session required'},401);
    if(url.pathname==='/api/readings'&&request.method==='POST'){
      if(Number(request.headers.get('Content-Length')||0)>1024)return json({},413);
      const reader=request.body?.getReader();let size=0,chunks=[];
      if(!reader)return json({},400);
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024){await reader.cancel();return json({},413);}chunks.push(value);}
      let input;try{input=options(JSON.parse(await new Blob(chunks).text()));}catch{return json({detail:'Only fixed cached tests are accepted'},422);}
      const id=crypto.randomUUID();
      return env.JOBS.get(env.JOBS.idFromName(id)).fetch(new Request('http://job/create',{method:'POST',
        headers:{'Content-Type':'application/json','X-Proof-Owner':owner,'X-Reading-Id':id},body:JSON.stringify(input)}));
    }
    const match=/^\/api\/readings\/([a-f0-9-]{36})(\/sections\/\d+|\/audio|\/download\/(?:mp3|vtt))?$/.exec(url.pathname);
    if(!match)return json({},404);
    if(!['GET','HEAD','DELETE'].includes(request.method)||request.method==='DELETE'&&match[2])return json({},405);
    const headers=new Headers({'X-Proof-Owner':owner});if(request.headers.has('Range'))headers.set('Range',request.headers.get('Range'));
    return env.JOBS.get(env.JOBS.idFromName(match[1])).fetch(new Request('http://job'+(match[2]||'/status'),{method:request.method,headers}));
  }
  const asset=await env.ASSETS.fetch(request),headers=new Headers(asset.headers);
  headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
  return new Response(asset.body,{status:asset.status,headers});
}};
