// Shared, persistent processing and outcome status beside the reader content.
let indicator;
export function setupProcessingIndicator({delayMs=200}={}) {
 if(indicator)return indicator;
 const panel=document.createElement('aside');
 panel.id='processing-indicator';panel.hidden=true;panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');panel.setAttribute('aria-atomic','false');
 const modes=document.querySelector('.mode-controls');if(modes)modes.before(panel);else document.body.prepend(panel);
 const entries=new Map();
 const paint=()=>{
  const focused=document.activeElement,focusedRow=panel.contains(focused)?focused.closest('.processing-indicator-row'):null,focusedIndex=focusedRow?Array.from(focusedRow.querySelectorAll('button')).indexOf(focused):-1;
  panel.replaceChildren();let outcome=false;
  for(const [kind,entry] of entries)if(entry.visible){
   const row=document.createElement('div');row.className='processing-indicator-row';row.id='processing-'+kind;
   const copy=document.createElement('div'),title=document.createElement('strong'),note=document.createElement('span');title.textContent=entry.message;
   if(entry.outcome){
    outcome=true;row.classList.add('processing-outcome-row');const icon=document.createElement('span');icon.className='processing-outcome-icon';icon.setAttribute('aria-hidden','true');icon.textContent='⚠';row.append(icon);row.setAttribute('role','group');title.id=row.id+'-title';row.setAttribute('aria-labelledby',title.id);note.textContent=entry.body;
    copy.append(title,note);const credit=document.createElement('p');credit.className='processing-outcome-credit';credit.textContent=entry.credit;copy.append(credit);
    const actions=document.createElement('div');actions.className='processing-outcome-actions';if(entry.onAction){const action=document.createElement('button');action.type='button';action.textContent=entry.actionLabel;action.onclick=entry.onAction;actions.append(action);}
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Dismiss';dismiss.onclick=()=>{indicator.clear(kind,entry.token);entry.onDismiss?.();document.getElementById('edit-mode')?.focus({preventScroll:true});};actions.append(dismiss);copy.append(actions);if(entry.extra)copy.append(entry.extra);
   }else{const spinner=document.createElement('span');spinner.className='processing-spinner';row.append(spinner);note.textContent='You can keep using the reader.';copy.append(title,note);}
   row.append(copy);panel.append(row);
  }
  panel.classList.toggle('has-outcome',outcome);panel.removeAttribute('aria-hidden');panel.hidden=!panel.childElementCount;if(focusedRow){const target=focused.isConnected?focused:document.getElementById(focusedRow.id)?.querySelectorAll('button')[focusedIndex];target?.focus({preventScroll:true});}
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
  outcome(kind,token,details){const current=entries.get(kind);if(current)clearTimeout(current.timer);entries.set(kind,{token,...details,outcome:true,visible:true});paint();panel.scrollIntoView({block:'nearest'});},
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
export function showProcessingOutcome(kind,token,details){if(!indicator)return false;indicator.outcome(kind,token,details);return true;}
export function audioWaitMessage(player,{browser=false,creditPaused=false}={}){
 if(!player)return '';
 if(browser)return player.state==='playing'&&player.starting?'Starting your device voice…':'';
 if(creditPaused||player.status?.state==='credit-paused'||player.getVideoPreparation?.()?.error?.creditPaused)return '';
 if(player.wantPlay===false||['failed','disconnected','done'].includes(player.state))return '';
 if(player.state==='buffering')return 'Waiting for audio…';
 if(player.state==='preparing')return 'Preparing audio…';
 if(player.wantPlay&&(player.audio?.paused||['paused','ready'].includes(player.state))&&(player.id||player.job))return 'Starting audio…';
 return '';
}
