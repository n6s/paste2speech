// Visual status only: the existing audio and document live regions announce it.
let indicator;
export function setupProcessingIndicator({delayMs=200}={}) {
 if(indicator)return indicator;
 const panel=document.createElement('aside');
 panel.id='processing-indicator';panel.hidden=true;panel.setAttribute('aria-hidden','true');
 document.body.append(panel);
 const entries=new Map();
 const paint=()=>{
  panel.replaceChildren();
  for(const [kind,entry] of entries)if(entry.visible){
   const row=document.createElement('div');row.className='processing-indicator-row';row.id='processing-'+kind;
   const spinner=document.createElement('span');spinner.className='processing-spinner';
   const copy=document.createElement('div'),title=document.createElement('strong'),note=document.createElement('span');
   title.textContent=entry.message;note.textContent='You can keep using the reader.';
   copy.append(title,note);row.append(spinner,copy);panel.append(row);
  }
  panel.hidden=!panel.childElementCount;
 };
 indicator={
  update(kind,token,message){
   if(!message){this.clear(kind,token);return;}
   const current=entries.get(kind);
   if(current?.token===token){
    if(current.message!==message){current.message=message;paint();}
    return;
   }
   if(current)clearTimeout(current.timer);
   const entry={token,message,visible:current?.visible===true};entries.set(kind,entry);
   if(entry.visible)paint();
   else entry.timer=setTimeout(()=>{
    if(entries.get(kind)!==entry)return;
    entry.visible=true;paint();
   },delayMs);
  },
  clear(kind,token){
   const current=entries.get(kind);
   if(!current||token!==undefined&&current.token!==token)return;
   clearTimeout(current.timer);entries.delete(kind);paint();
  }
 };
 return indicator;
}
export function showProcessing(kind,token,message){indicator?.update(kind,token,message);}
export function hideProcessing(kind,token){indicator?.clear(kind,token);}
export function audioWaitMessage(player,{browser=false,creditPaused=false}={}){
 if(!player||creditPaused||player.status?.state==='credit-paused'||player.getVideoPreparation?.()?.error?.creditPaused)return '';
 if(browser)return player.state==='playing'&&player.starting?'Starting your device voice…':'';
 if(player.wantPlay===false||['failed','disconnected','done'].includes(player.state))return '';
 if(player.state==='buffering')return 'Waiting for audio…';
 if(player.state==='preparing')return 'Preparing audio…';
 if(player.wantPlay&&(player.audio?.paused||['paused','ready'].includes(player.state))&&(player.id||player.job))return 'Starting audio…';
 return '';
}
