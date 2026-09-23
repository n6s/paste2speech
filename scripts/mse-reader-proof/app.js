import {MsePlayer} from './player.js';
const $=id=>document.getElementById(id);let rendered;
const player=new MsePlayer($('audio'),p=>{
  $('state').textContent=`${p.state}${p.status?` · ${p.status.completed}/${p.status.total} sections prepared · ${p.next} appended`:''}`;
  $('error').textContent=p.error||'';
  const ranges=p.ranges(),end=ranges.at(-1)?.[1]||0;
  $('seek').disabled=!end;$('seek').max=Math.max(0,end-.001);$('seek').value=p.audio.currentTime;
  $('position').textContent=`${p.audio.currentTime.toFixed(2)} / ${(p.status?.duration||0).toFixed(2)} seconds ${p.finalized?'(complete)':'(available so far)'}`;
  $('buffered').textContent='Buffered: '+(ranges.map(([a,b])=>`${a.toFixed(2)}–${b.toFixed(2)} s`).join(', ')||'waiting');
  if(rendered!==p.texts){rendered=p.texts;$('text').replaceChildren(...(p.texts||[]).map((text,i)=>{const el=document.createElement('p');el.textContent=text;el.dataset.index=i;return el;}));}
  for(const el of $('text').children)el.classList.toggle('active',Number(el.dataset.index)===p.index&&!!p.job);
  for(const kind of ['mp3','vtt']){$(kind).hidden=p.status?.state!=='ready';if(p.job)$(kind).href=`/api/readings/${p.job}/download/${kind}`;}
});
window.proof=player;
$('capability').textContent=player.capability.mp3?'Browser reports MP3 MSE support. Actual decoding is checked during playback.':'MP3 MSE is unavailable here. Use the full-preparation comparison.';
$('settings').onsubmit=event=>{event.preventDefault();void player.start({voice:$('voice').value,concurrency:Number($('concurrency').value),scenario:$('scenario').value},$('mode').value);};
$('pause').onclick=()=>player.pause();$('resume').onclick=()=>player.resume();$('stop').onclick=()=>player.stop();
$('rate').onchange=()=>player.setRate($('rate').value);$('seek').oninput=()=>player.seek($('seek').value);
$('diagnostics').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(player.diagnostics(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`mse-reader-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('visibilitychange',()=>player.log('visibility',{visibility:document.visibilityState}));
window.addEventListener('online',()=>player.log('online'));window.addEventListener('offline',()=>player.log('offline'));
