import {formatCredits,sharedCredits} from './credit-units.js';
// Cloudflare transport for the shared reader. Browser speech never uses this.
const settledReadings=new Set();
export function naturalVoiceGuidance(config){
 if(!config.account)return {message:'Sign in with a verified email to use natural voices for your own text.',link:'Sign in'};
 if(config.account.verified===false && config.accessAllowed===false)return {message:'Verify your email to use natural voices for your own text.',link:'Open your account'};
 if(sharedCredits(config.account)){if(config.account.shortfall)return {message:'Your shared credits need attention before using natural voices.',link:'Review your account'};if(!config.eligible)return {message:'Natural voices use 1 credit per 1,000 characters, counted exactly. Browser voices and Summary are free.',link:'View shared credits'};return {message:`Natural voices are ready. ${formatCredits(config.account.balance)} shared credits available. Speech uses 1 credit per 1,000 characters, counted exactly. Summary is free.`,link:'View your account'};}
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
export function setupCloudReader({getEngine,getCostCharacters=()=>0}){
 let account=null;
 const estimate=document.createElement('p');estimate.id='speech-cost-estimate';estimate.className='hint';estimate.hidden=true;document.getElementById('account-summary').after(estimate);
 const updateEstimate=()=>{estimate.hidden=!sharedCredits(account)||getEngine()!=='google';if(!estimate.hidden)estimate.textContent=`This reading holds ${formatCredits(getCostCharacters())} credits for ${getCostCharacters().toLocaleString()} cleaned characters. Only successfully prepared sections use credits. Summary is free.`;};
 window.addEventListener('reading-cost-change',updateEstimate);
 const update=async()=>{
  try{
   const response=await fetch('/api/reader');if(!response.ok)throw Error();
   const config=await response.json();account=config.account;updateEstimate();
   document.getElementById('account-summary').textContent=config.account ? sharedCredits(config.account)?`${formatCredits(config.account.balance)} shared credits available · OCR 2/page · Summary free`:`${config.account.balance.toLocaleString()} characters available` : 'Browser voices are free · Natural voices use speech credit';
   const note=document.getElementById('upgrade-note'),guidance=naturalVoiceGuidance(config);
   const link=document.createElement('a');link.href='/api/billing';link.textContent=guidance.link;
   note.replaceChildren(document.createTextNode(guidance.message+' '),link);note.hidden=getEngine()!=='google';
  }catch{
   account=null;updateEstimate();
   document.getElementById('account-summary').textContent='Account status unavailable · browser voices remain free';
   const note=document.getElementById('upgrade-note');note.textContent='Account status is unavailable. Free samples remain available; check your account before starting a paid reading.';note.hidden=getEngine()!=='google';
  }
 };
 document.getElementById('engine').addEventListener('change',update);
 window.addEventListener('focus',update);window.addEventListener('speech-credit-change',update);void update();
}
