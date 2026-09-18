import { API_ORIGIN, RELEASE } from './config.js';
export function event(name,engine='none',category='none',duration=0){
 if(navigator.doNotTrack==='1'||navigator.globalPrivacyControl)return;
 fetch(API_ORIGIN+'/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:name,engine,category,duration:Math.min(300000,Math.max(0,Math.round(duration))),release:RELEASE}),keepalive:true}).catch(()=>{});
}
export function setupFeedback(){
 event('page_view');
 const form=document.getElementById('feedback-form'),status=document.getElementById('feedback-status');
 let ticket;
 form.addEventListener('submit',async e=>{
  e.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;status.textContent='Sending…';
  try{
   if(!ticket){const r=await fetch(API_ORIGIN+'/api/feedback-ticket');if(!r.ok)throw Error();ticket=await r.json();}
   const data=Object.fromEntries(new FormData(form));
   const response=await fetch(API_ORIGIN+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,ticket})});
   if(!response.ok)throw Error(response.status===429?'Please wait a few minutes before sending again.':'Could not send feedback. Please retry, or use email below.');
   status.textContent='Thank you! Your feedback has been saved.';form.reset();ticket=null;
  }catch(error){status.textContent=error.message||'Could not send. Please use email below.';ticket=null;}
  finally{button.disabled=false;}
 });
}
