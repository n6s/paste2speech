// Public, prerecorded samples are independent of accounts and prepared readings.
export function setupVoicePreviews({pauseReading, audio = new Audio(), root = document}) {
 const panel=root.getElementById('voice-preview-panel');
 if(!panel)return {stop(){}};
 const buttons=[...panel.querySelectorAll('[data-preview-src]')];
 const status=root.getElementById('voice-preview-status');
 let active=null,serial=0;
 audio.preload='none';audio.playbackRate=1;
 function resetButtons(){for(const button of buttons){button.textContent=`▶ ${button.dataset.previewLabel}`;button.setAttribute('aria-label',`Play ${button.dataset.previewLabel} sample`);button.setAttribute('aria-pressed','false');}}
 function stop(message=''){
  if(!active){status.textContent=message;return;}
  serial++;audio.pause();audio.removeAttribute('src');audio.load();active=null;resetButtons();status.textContent=message;
 }
 function fail(){if(active)stop('This sample could not play. Select a voice to try again.');}
 audio.addEventListener('ended',()=>{if(active)stop('Sample finished. Choose another voice to compare.');});
 audio.addEventListener('error',fail);
 for(const button of buttons)button.addEventListener('click',async()=>{
  if(active===button){stop('Sample stopped.');return;}
  stop();pauseReading();active=button;const request=serial;
  audio.src=button.dataset.previewSrc;audio.playbackRate=1;
  button.textContent=`■ ${button.dataset.previewLabel}`;button.setAttribute('aria-label',`Stop ${button.dataset.previewLabel} sample`);button.setAttribute('aria-pressed','true');
  status.textContent=`Loading ${button.dataset.previewLabel} sample…`;
  try{await audio.play();if(request===serial)status.textContent=`Playing ${button.dataset.previewLabel} sample.`;}
  catch{if(request===serial)fail();}
 });
 panel.addEventListener('toggle',()=>{if(!panel.open)stop();});
 window.addEventListener('pagehide',()=>stop());
 resetButtons();return {stop};
}
