// Cloudflare transport for the shared reader. Browser speech never uses this.
export async function cloudFetch(url,options={}) {
 if(options.method==='POST'&&new URL(url).pathname==='/api/readings'){
  const session=await fetch('/api/billing/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!session.ok)throw Error('Could not open your account. Browser voices remain available.');
  const id=crypto.randomUUID();
  // Preserve a late create acknowledgement so Stop can cancel the known job.
  options={...options,signal:AbortSignal.timeout(15000),headers:{...options.headers,'Idempotency-Key':id}};
  try{
   const response=await fetch(url,options);
   if(response.status===402){document.getElementById('upgrade-note').hidden=false;}
   if(response.status!==503)return response;
  }catch(error){if(error.name==='AbortError')throw error;}
  const status=await fetch(`/api/readings/${id}`);
  if(status.ok)return Response.json({id});
  throw Error('Preparation could not be confirmed. Check your account before starting again.');
 }
 return fetch(url,options);
}
export function setupCloudReader({player,getEngine}){
 document.getElementById('seek').addEventListener('input',event=>player.seekTo(Number(event.target.value)));
 const update=async()=>{
  try{
   const response=await fetch('/api/reader');if(!response.ok)throw Error();
   const config=await response.json();
   document.getElementById('account-summary').textContent=config.account ? `${config.account.balance.toLocaleString()} characters available` : 'Browser voices are free · WaveNet uses speech credit';
   document.getElementById('upgrade-note').hidden=getEngine()!=='google'||config.eligible;
  }catch{document.getElementById('account-summary').textContent='Account status unavailable · browser voices remain free';}
 };
 document.getElementById('engine').addEventListener('change',update);
 window.addEventListener('focus',update);void update();
}
