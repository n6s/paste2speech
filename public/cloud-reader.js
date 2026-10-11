import {formatCredits,sharedCredits} from './credit-units.js';
import {balanceCapacity,SHARED_BALANCE_EXPLANATION,CAPACITY_ASSUMPTION} from './balance-capacity.js';
// Cloudflare transport for the shared reader. Browser speech never uses this.
const settledReadings=new Set();
export function naturalVoiceGuidance(config){
 if(!config.account)return {message:'Sign in with a verified email to use natural voices for your own text.',link:'Sign in'};
 if(config.account.verified===false && config.accessAllowed===false)return {message:'Verify your email to use natural voices for your own text.',link:'Open your account'};
 if(sharedCredits(config.account)){if(config.account.shortfall)return {message:'Your shared balance needs attention before using paid cloud voices.',link:'Balance & usage'};if(!config.eligible)return {message:'Paid cloud voices use your shared balance. Browser voices are free.',link:'Balance & usage'};return {message:'Paid cloud voices are ready. Creating new audio uses your shared balance.',link:'Balance & usage'};}
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
 const details=document.createElement('details');details.id='speech-cost-details';details.hidden=true;
 const title=document.createElement('summary');title.textContent='This reading · cost details';
 const estimate=document.createElement('p');estimate.id='speech-cost-estimate';estimate.className='hint';details.append(title,estimate);const balanceHelp=document.getElementById('balance-help');if(balanceHelp)balanceHelp.append(details);else document.getElementById('account-summary').after(details);
 const updateEstimate=()=>{details.hidden=!sharedCredits(account)||getEngine()!=='google';if(!details.hidden){const characters=getCostCharacters();estimate.textContent=`This reading holds ${formatCredits(characters)} credits for ${characters.toLocaleString()} cleaned characters. Only successfully prepared sections use credits. Creating summaries uses no credits; making paid-voice audio from a summary uses the usual speech credits.`;}};
 const renderBalance=()=>{const summary=document.getElementById('account-summary'),help=document.getElementById('shared-balance-help');summary.textContent=account?sharedCredits(account)?balanceCapacity(account.balance):`${account.balance.toLocaleString()} characters available`:'Browser voices are free · Natural voices use speech credit';if(help){const shared=sharedCredits(account);balanceHelp.hidden=!shared;document.getElementById('balance-label').hidden=!shared;help.textContent=SHARED_BALANCE_EXPLANATION;document.getElementById('balance-assumption').textContent=CAPACITY_ASSUMPTION;}};
 window.addEventListener('shared-balance-change',event=>{if(sharedCredits(account)&&sharedCredits(event.detail)){account={...account,balance:event.detail.balance,held:event.detail.held,debt:event.detail.debt};renderBalance();}});
 window.addEventListener('reading-cost-change',updateEstimate);
 const update=async()=>{
  try{
   const response=await fetch('/api/reader');if(!response.ok)throw Error();
   const config=await response.json();account=config.account;updateEstimate();
   renderBalance();
   const note=document.getElementById('upgrade-note'),guidance=naturalVoiceGuidance(config);
   const link=document.createElement('a');link.href='/api/billing';link.textContent=guidance.link;
   note.replaceChildren(document.createTextNode(guidance.message+' '),link);note.hidden=getEngine()!=='google';
  }catch{
   account=null;updateEstimate();if(balanceHelp)balanceHelp.hidden=true;const label=document.getElementById('balance-label');if(label)label.hidden=true;
   document.getElementById('account-summary').textContent='Account status unavailable · browser voices remain free';
   const note=document.getElementById('upgrade-note');note.textContent='Account status is unavailable. Free samples remain available; check your account before starting a paid reading.';note.hidden=getEngine()!=='google';
  }
 };
 document.getElementById('engine').addEventListener('change',update);
 window.addEventListener('focus',update);window.addEventListener('speech-credit-change',update);void update();
}
