import {showProcessingOutcome,hideProcessing} from './processing-indicator.js';
const credits=n=>Number.isInteger(n)&&n>=0;
const count=n=>n.toLocaleString()+(n===1?' credit':' credits');
export function scanCreditOutcome({job,receipt}={}){
 if(credits(job?.creditsReleased)&&job.creditsReleased>0)return count(job.creditsReleased)+' returned.'+(credits(job.creditsUsed)?' This scan used '+count(job.creditsUsed)+'.':'');
 if(credits(receipt?.receiptCredits))return 'Original scan: '+count(receipt.receiptCredits)+' used. Opening the saved result used no more credits.';
 if(credits(job?.creditsUsed))return 'This scan used '+count(job.creditsUsed)+'.';
 if(receipt?.cached===true&&receipt.creditsUsed===0)return 'Opening the saved result used no more credits. The original charge has not been confirmed here.';
 return 'The credit outcome has not been confirmed here. No automatic paid retry was made.';
}
export function setupScanVisibility({editor,onDismiss=()=>{}}){
 const placeholder=editor?.placeholder,mirror=document.getElementById('document-visible-status');let notice=false;
 const clear=()=>{hideProcessing('scan-outcome');if(mirror)mirror.hidden=false;if(notice&&editor){editor.placeholder=placeholder;notice=false;}onDismiss();};
 // Keep failures visible while the user edits; only explicit dismissal or a new attempt clears them.

 return {clear,
  failure({title='Scan did not finish',message,job,receipt,noReadable=false,onAction,actionLabel='Choose another file',report=null}){
   if(mirror)mirror.hidden=true;
   if(noReadable&&editor&&!editor.value){editor.placeholder='[No readable text was returned.]';notice=true;}
   const credit=scanCreditOutcome({job,receipt});showProcessingOutcome('scan-outcome',Symbol(),{message:title,body:message,credit,onAction,actionLabel,extra:report,onDismiss:clear});
  }
 };
}
