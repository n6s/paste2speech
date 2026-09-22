import {ProgressivePlayer} from './progressive-player.js';
import {sections} from './chunks.js';
const $=id=>document.getElementById(id),clock=n=>`${Math.floor((n||0)/60)}:${String(Math.floor((n||0)%60)).padStart(2,'0')}`;
let config,shown=[],cached=false,busy=false;
const player=new ProgressivePlayer((p,message)=>{
 $('status').textContent=message||({preparing:`Preparing the full reading… ${p.starts.length} of ${p.chunks.length} sections ready.`,playing:'Playing',paused:'Paused',ready:'Ready — press Resume to play.',done:'Finished',failed:'Preparation failed. Your account shows any returned credit.',idle:'Ready for text.',buffering:'Loading audio…'}[p.state]||p.state);
 const active=!!p.id||p.state==='preparing';$('pause').disabled=!active;$('resume').disabled=!p.id||p.serverFailed;$('stop').disabled=!active;
 $('previous').disabled=!p.complete;$('next').disabled=!p.complete;$('seek').disabled=!p.complete;
 $('seek').max=p.duration||1;$('seek').value=p.audio.currentTime||0;$('time').textContent=clock(p.audio.currentTime)+' / '+clock(p.duration);
 $('downloads').hidden=!p.complete;$('mp3').href=p.id?`/api/readings/${p.id}/download/mp3`:'#';$('vtt').href=p.id?`/api/readings/${p.id}/download/vtt`:'#';
 if(JSON.stringify(shown)!==JSON.stringify(p.chunks)){$('reading').replaceChildren(...p.chunks.map((text,index)=>{const element=document.createElement('p');element.textContent=text;element.onclick=()=>p.move(index-p.index);return element;}));shown=[...p.chunks];}
 [...$('reading').children].forEach((element,index)=>element.classList.toggle('current',index===p.index));
},{fetcher:async(url,options={})=>{
 if(options.method==='POST'&&new URL(url).pathname==='/api/readings'){
  const id=crypto.randomUUID();options.headers={...options.headers,'Idempotency-Key':id};
  // A lost acknowledgement must not cause a second charge. Check only the
  // known job; never resend a synthesis request automatically.
  try{const response=await fetch(url,options);if(response.status!==503)return response;}catch(error){if(error.name==='AbortError')throw error;}
  const status=await fetch(`/api/readings/${id}`);if(status.ok)return Response.json({id});
  throw Error('Preparation could not be confirmed. Check your account before starting again.');
 }return fetch(url,options);
}});
const settings=()=>({voice:$('voice').value,rate:Number($('rate').value),provider:'google',delivery:'complete'});
$('play').onclick=async()=>{if(busy)return;busy=true;$('play').disabled=true;try{
 const chunks=config.local&&cached?config.fixtures[$('voice').value].map(s=>s.text):sections($('text').value);
 await player.start(chunks,settings());
}catch(error){$('status').textContent=error.message;}finally{busy=false;$('play').disabled=false;}};
$('text').oninput=()=>{cached=false;};$('voice').onchange=()=>{if(cached)loadSample();};
$('pause').onclick=()=>player.pause();$('resume').onclick=()=>player.resume(settings());$('stop').onclick=()=>player.stop();
$('previous').onclick=()=>player.move(-1);$('next').onclick=()=>player.move(1);$('seek').onchange=()=>player.seekTo(Number($('seek').value));$('rate').onchange=()=>player.setRate($('rate').value);
function loadSample(){cached=true;$('text').value=config.fixtures[$('voice').value].map(s=>s.text).join('\n\n');}
$('sample').onclick=loadSample;
try{
 const session=await fetch('/api/billing/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!session.ok)throw Error('Could not start your account session.');
 const response=await fetch('/api/reader');if(!response.ok)throw Error('Reader configuration unavailable.');config=await response.json();
 if(config.local){$('notice').textContent='Private local test · cached sample audio only · no spending or email delivery';$('sample').hidden=false;loadSample();}
 else if(!config.liveEnabled){$('notice').textContent='Private reader · speech generation is disabled pending staging approval.';$('play').disabled=true;}
}catch(error){$('status').textContent=error.message;$('play').disabled=true;}
