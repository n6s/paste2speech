// Cloudflare transport for the shared reader. Browser speech never uses this.
const settledReadings=new Set();
export function naturalVoiceGuidance(config){
 if(!config.account)return {message:'Sign in with a verified email to use natural voices for your own text.',link:'Sign in'};
 if(config.account.verified===false && config.accessAllowed===false)return {message:'Verify your email to use natural voices for your own text.',link:'Open your account'};
 if(config.account.shortfall)return {message:'Your speech credit needs attention before you can use natural voices.',link:'Review your account'};
 if(config.accessAllowed===false)return {message:'Natural voices are currently unavailable for this account.',link:'Open your account'};
 if(!config.eligible)return {message:'Use natural voices for your own text with a speech pack.',link:'View speech packs'};
 return {message:`Natural voices are ready. ${config.account.balance.toLocaleString()} characters available.`,link:'View your account'};
}
export async function cloudFetch(url,options={}) {
 if(options.method==='POST'&&new URL(url).pathname==='/api/readings'){
  const session=await fetch('/api/billing/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!session.ok)throw Error('Could not open your account. Browser voices remain available.');
  const id=crypto.randomUUID();
  // Preserve a late create acknowledgement so Stop can cancel the known job.
  options={...options,signal:AbortSignal.timeout(15000),headers:{...options.headers,'Idempotency-Key':id}};
  try{
   const response=await fetch(url,options);
   if([402,403].includes(response.status)){
    window.dispatchEvent(new Event('speech-credit-change'));
    const detail=(await response.clone().json()).detail;
    if(/^(WaveNet is not available for this account yet|WaveNet needs sufficient speech credit)/.test(detail||''))return Response.json({detail:'Choose a free sample above, or open your account to use natural voices.'},{status:response.status});
   }
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
export function setupCloudReader({getEngine}){
 const update=async()=>{
  try{
   const response=await fetch('/api/reader');if(!response.ok)throw Error();
   const config=await response.json();
   document.getElementById('account-summary').textContent=config.account ? `${config.account.balance.toLocaleString()} characters available` : 'Browser voices are free · Natural voices use speech credit';
   const note=document.getElementById('upgrade-note'),guidance=naturalVoiceGuidance(config);
   const link=document.createElement('a');link.href='/api/billing';link.textContent=guidance.link;
   note.replaceChildren(document.createTextNode(guidance.message+' '),link);note.hidden=getEngine()!=='google';
  }catch{
   document.getElementById('account-summary').textContent='Account status unavailable · browser voices remain free';
   const note=document.getElementById('upgrade-note');note.textContent='Account status is unavailable. Free samples remain available; check your account before starting a paid reading.';note.hidden=getEngine()!=='google';
  }
 };
 document.getElementById('engine').addEventListener('change',update);
 window.addEventListener('focus',update);window.addEventListener('speech-credit-change',update);void update();
}
