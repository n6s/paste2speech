import {BUILD_COMMIT} from './config.js';
export const SCAN_FEEDBACK_POLICY='private-scan-review-7-days-v1';
export {filenameBasename,scanPlatform,scanFileMetadata} from '../shared/scan-diagnostics.js';
import {scanPlatform} from '../shared/scan-diagnostics.js';
// No file bytes, editor content, clipboard reread, auth or URLs enter this form.
export function createScanFeedback({jobId=null,inputRoute='unknown',errorCode='scan_incomplete',metadata=null,fetcher=fetch}={}){
 if(metadata){metadata=structuredClone(metadata);metadata.clientFailureObservedAt=Date.now();}const details=document.createElement('details');details.id='scan-feedback';const heading=document.createElement('summary');heading.textContent='Report scan problem';
 const form=document.createElement('form'),notice=document.createElement('p'),label=document.createElement('label'),include=document.createElement('input');
 include.type='checkbox';include.id='scan-feedback-include';label.append(include,document.createTextNode(' Include my scan with this report'));
 notice.textContent='Send diagnostics to Roger, the developer: the exact filename (without folders), size/type, available image dimensions, paste/input method, scan settings, browser/OS, app version, error stage, matching attempt and credit outcome. No editor text, other clipboard contents, credentials or source links are sent. If selected and still available, the existing private Cloudflare original is available for inspection for at most 7 days, subject to earlier storage cleanup, by Roger’s existing OpenAI reviewer. Telegram receives findings and recommendations only. Diagnostics remain for 90 days. Deleted or never-uploaded scans produce metadata-only reports; no replacement upload or paid retry is requested.';
 const disclosure=document.createElement('p');disclosure.className='hint';disclosure.textContent=metadata?'Filename included: '+metadata.rawBasename+(metadata.filenameTruncated?' [limited to the first 1,024 characters]':''):'No filename is available for this saved attempt.';
 const noteLabel=document.createElement('label'),note=document.createElement('textarea');note.id='scan-feedback-note';note.maxLength=1000;note.rows=2;noteLabel.htmlFor=note.id;noteLabel.textContent='Optional note';
 const send=document.createElement('button');send.type='submit';send.textContent='Send feedback';const status=document.createElement('p');status.id='scan-feedback-status';status.setAttribute('role','status');
 let sending=false,ticket=null;
 form.onsubmit=async e=>{e.preventDefault();if(sending)return;sending=true;send.disabled=true;include.disabled=true;status.textContent='Sending feedback…';
  try{
   if(!ticket){const r=await fetcher('/api/feedback-ticket');if(!r.ok)throw Error();ticket=await r.json();}
   const report={ticket,jobId,clientBuild:BUILD_COMMIT,inputRoute,errorCode,note:note.value,includeScan:include.checked,consentPolicy:SCAN_FEEDBACK_POLICY,metadata:metadata||{rawBasename:'',mime:'',bytes:0,width:null,height:null,...scanPlatform(navigator),stage:'saved_retrieval',settings:{}}};
   const r=await fetcher('/api/scan-feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)}),value=await r.json();if(!r.ok)throw Error(value.detail||'Feedback could not be saved.');
   status.textContent='Feedback saved. Report '+value.reportId+'. '+(value.attachmentIncluded?'The existing scan stays private. Diagnostic access ends after 7 days; deletion is scheduled then. Storage cleanup may remove it sooner. ':value.attachmentUnavailableReason==='scan_still_active'?'The scan is still active; metadata only was saved. Normal scan processing continues. ':value.attachmentUnavailableReason?'The original is already unavailable; metadata only was saved. No replacement is needed. ':'Metadata only. ')+'Roger receives the findings and recommendation in Telegram.';ticket=null;include.checked=false;include.disabled=true;note.disabled=true;send.hidden=true;
  }catch(error){status.textContent=error.message||'Feedback could not be saved. Choose Send feedback to retry.';include.disabled=false;}
  finally{sending=false;send.disabled=false;}
 };
 form.append(notice,disclosure,label,noteLabel,note,send,status);details.append(heading,form);return details;
}
