// Cloudflare transport for the shared reader. Browser speech never uses this.
const settledReadings=new Set();
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
 const response=await fetch(url,options);
 if(options.method==='DELETE')window.dispatchEvent(new Event('speech-credit-change'));
 else if(response.ok && /\/api\/readings\/[^/]+$/.test(new URL(url).pathname)){
  const status=await response.clone().json();
  if(['ready','failed','cancelled'].includes(status.state)&&!settledReadings.has(String(url))){
   settledReadings.add(String(url));window.dispatchEvent(new Event('speech-credit-change'));
  }
 }
 return response;
}
export function setupCloudReader({player,getEngine}){
 const seek=document.getElementById('seek');
 seek.addEventListener('pointercancel',()=>{delete seek.dataset.dragging;});
 seek.addEventListener('input',()=>{seek.dataset.dragging='true';seek.setAttribute('aria-valuetext',`Section ${Number(seek.value)+1} of ${player.chunks.length}`);});
 seek.addEventListener('change',()=>{
  delete seek.dataset.dragging;
  const target=player.starts[Number(seek.value)];
  if(Number.isFinite(target))player.seekTo(target);
 });
 const update=async()=>{
  try{
   const response=await fetch('/api/reader');if(!response.ok)throw Error();
   const config=await response.json();
   document.getElementById('account-summary').textContent=config.account ? `${config.account.balance.toLocaleString()} characters available` : 'Browser voices are free · WaveNet uses speech credit';
   document.getElementById('upgrade-note').hidden=getEngine()!=='google'||config.eligible;
  }catch{document.getElementById('account-summary').textContent='Account status unavailable · browser voices remain free';}
 };
 document.getElementById('engine').addEventListener('change',update);
 window.addEventListener('focus',update);window.addEventListener('speech-credit-change',update);void update();
}
