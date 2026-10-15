import {showProcessingOutcome,hideProcessing} from './processing-indicator.js';
const messages={
 missing:['No screenshot received','Your browser did not provide an image. Choose your saved screenshot instead. Your text is unchanged.'],
 unavailable:['No screenshot received','Screenshot paste is unavailable here. Choose your saved screenshot instead. Your text is unchanged.'],
 denied:['No screenshot received','Your browser blocked screenshot paste. Choose your saved screenshot instead. Your text is unchanged.'],
 failed:['No screenshot received','The screenshot could not be read. Choose your saved screenshot instead. Your text is unchanged.'],
 multiple:['Choose one screenshot','The clipboard contains more than one image. Choose the screenshot you want to scan. Your text is unchanged.']
};
export function setupScreenshotRecovery({root,status,onDismiss,createReport}){
 const card=document.createElement('section');card.id='screenshot-recovery';card.className='screenshot-recovery';card.hidden=true;card.setAttribute('role','group');card.setAttribute('aria-labelledby','screenshot-recovery-title');card.setAttribute('aria-describedby','screenshot-recovery-message');
 const title=document.createElement('h3');title.id='screenshot-recovery-title';const message=document.createElement('p');message.id='screenshot-recovery-message';
 const actions=document.createElement('div');actions.className='screenshot-recovery-actions';const choose=document.createElement('button');choose.type='button';choose.id='screenshot-recovery-choose';choose.textContent='Choose screenshot';const dismiss=document.createElement('button');dismiss.type='button';dismiss.id='screenshot-recovery-dismiss';dismiss.className='quiet';dismiss.textContent='Dismiss';dismiss.onclick=onDismiss;actions.append(choose,dismiss);card.append(title,message,actions);root.querySelector('.document-sources').after(card);
 const input=document.createElement('input');input.type='file';input.id='document-screenshot-file';input.accept='.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';input.hidden=true;input.tabIndex=-1;root.append(input);
 const reportSlot=document.createElement('div');card.append(reportSlot);
 const visibleStatus=document.getElementById('document-visible-status');let announcement,activeOutcomeToken;
 return {choose,input,
  show(reason){reportSlot.replaceChildren();if(createReport)reportSlot.append(createReport(reason));const copy=messages[reason]||messages.failed;title.textContent=copy[0];message.textContent=copy[1];announcement=copy.join('. ');status.textContent=announcement;if(visibleStatus)visibleStatus.hidden=true;root.open=true;const report=reportSlot.firstChild;const displayed=showProcessingOutcome('scan-outcome',activeOutcomeToken=Symbol(),{message:copy[0],body:copy[1],credit:'No file uploaded. No credits used.',actionLabel:'Open saved screenshot',onAction:()=>choose.click(),extra:report,onDismiss});card.hidden=displayed;if(!displayed)card.scrollIntoView({block:'nearest'});},
  hide(){if(activeOutcomeToken)hideProcessing('scan-outcome',activeOutcomeToken);activeOutcomeToken=null;card.hidden=true;reportSlot.replaceChildren();if(status.textContent===announcement)status.textContent='';if(visibleStatus)visibleStatus.hidden=false;announcement=null;},
  setBusy(value){choose.disabled=value;input.disabled=value;}
 };
}
