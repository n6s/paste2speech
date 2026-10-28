import {safeTerminalFailure,safeCancellation} from './ocr-terminal-diagnostics.js';
// Owner staging diagnostics reuse the existing private feedback queue and R2 binding.
import {OCR_SOURCE_DENIAL_REASONS} from './ocr-source.js';
import {digest} from '../prepared/ledger.js';
import {readBounded} from '../prepared/google.js';
import {validTicket} from '../worker.js';
import {safeProviderRequestId,PROVIDER_ERROR_CATEGORIES,PROVIDER_ERROR_CODES} from './ocr-provider-diagnostics.js';
export const SCAN_FEEDBACK_POLICY='private-scan-review-7-days-v1';
export const SCAN_ATTACHMENT_TTL=7*86400000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const routes=['native_paste','paste_button','clear_paste_play','paste_screenshot','file_upload','screenshot_picker','unknown'];
const codes=['scan_incomplete','no_readable_text','saved_unavailable','upload_failed','clipboard_unavailable'];
const json=(v,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export function validScanReport(v){
 return v&&Object.keys(v).every(k=>['ticket','jobId','clientBuild','inputRoute','errorCode','note','includeScan','consentPolicy','metadata'].includes(k))&&
 (v.jobId===null||UUID.test(v.jobId))&&/^(?:[a-f0-9]{40}|development)$/.test(v.clientBuild||'')&&routes.includes(v.inputRoute)&&codes.includes(v.errorCode)&&
 typeof v.note==='string'&&v.note.length<=1000&&typeof v.includeScan==='boolean'&&v.consentPolicy===SCAN_FEEDBACK_POLICY&&validScanMetadata(v.metadata);
}
export function validScanMetadata(m){
 const stages=['clipboard_read','input_validation','config_check','upload_initialization','upload_transfer','quote_confirmation','acceptance','processing','saved_retrieval'];
 return m&&(m.repeatOutcome===undefined||['blocked_previous','awaiting_explicit_retry','new_retry_requested'].includes(m.repeatOutcome))&&(m.relatedUploadId===undefined||UUID.test(m.relatedUploadId))&&(m.clientFailureObservedAt===undefined||Number.isSafeInteger(m.clientFailureObservedAt)&&m.clientFailureObservedAt>=0)&&(m.clipboardOutcome===undefined||['missing','unavailable','denied','failed','multiple'].includes(m.clipboardOutcome))&&!Array.isArray(m)&&Object.keys(m).every(k=>['repeatOutcome','relatedUploadId','clientFailureObservedAt','clipboardOutcome','rawBasename','filenameTruncated','mime','bytes','width','height','stage','browser','os','settings'].includes(k))&&
 (m.filenameTruncated===undefined||typeof m.filenameTruncated==='boolean')&&typeof m.rawBasename==='string'&&m.rawBasename.length<=1024&&!/[\/]/.test(m.rawBasename)&&!/^[A-Za-z]:\\/.test(m.rawBasename)&&typeof m.mime==='string'&&m.mime.length<=120&&
 Number.isSafeInteger(m.bytes)&&m.bytes>=0&&m.bytes<=1000000000000&&['width','height'].every(k=>m[k]===null||Number.isSafeInteger(m[k])&&m[k]>0&&m[k]<=1000000)&&stages.includes(m.stage)&&
 typeof m.browser==='string'&&m.browser.length<=100&&typeof m.os==='string'&&m.os.length<=100&&m.settings&&!Array.isArray(m.settings)&&Object.keys(m.settings).every(k=>['rememberScanChoice','storageConsentChecked','hadEditorText'].includes(k))&&Object.values(m.settings).every(v=>typeof v==='boolean');
}
async function ownerAccount(env,token,now){return env.LEDGER.prepare("SELECT a.id,i.email FROM sessions s JOIN accounts a ON a.id=s.account JOIN identities i ON i.account=a.id WHERE s.token_hash=? AND s.kind='verified' AND s.expires>? AND a.enabled=1").bind(await digest(token||''),now).first();}
const integer=v=>Number.isSafeInteger(v)?v:null;
const safeCode=(v,allowed)=>allowed.includes(v)?v:null;
const sourceOutcomes=['started','streaming','unavailable','complete','length_mismatch','expired','revoked','read_failed','cancelled'];
function safeSourceResponse(v){if(!v)return null;const one=r=>({httpStatus:integer(r.httpStatus),expectedBytes:integer(r.expectedBytes),bytesEnqueued:integer(r.bytesEnqueued),streamComplete:r.streamComplete===true,outcome:safeCode(r.outcome,sourceOutcomes),startedAt:integer(r.startedAt),finishedAt:integer(r.finishedAt)});return {...one(v),reusedGetDenied:integer(v.reusedGetDenied),readLimit:safeCode(v.readLimit,[1,3]),reservedBytes:integer(v.reservedBytes),maxReservedBytes:integer(v.maxReservedBytes),grantExpiresAt:integer(v.grantExpiresAt),accessClosed:typeof v.accessClosed==='boolean'?v.accessClosed:null,accessClosedAt:integer(v.accessClosedAt),events:Array.isArray(v.events)?v.events.slice(0,20).map(e=>({sequence:integer(e.sequence),at:integer(e.at),kind:safeCode(e.kind,['admitted','denied','access_closed','revoked']),reason:safeCode(e.reason,OCR_SOURCE_DENIAL_REASONS)})):[],eventsDropped:integer(v.eventsDropped),reads:Array.isArray(v.reads)?v.reads.slice(0,3).map(r=>({...one(r),active:r.active===true})):null};}
async function evidence(env,account,id,now){
 if(!id)return {jobId:null,attemptAvailable:false};
 const row=await env.LEDGER.prepare('SELECT u.*,j.state jobState,j.created acceptedAt,j.updated,j.dispatched,j.consumed,j.released,j.units,j.source_hash,j.recovery_of,j.document_hash jobHash FROM ocr_job_uploads u LEFT JOIN ocr_jobs j ON j.id=u.id WHERE u.id=? AND u.account=?').bind(id,account).first();
 if(!row)return {jobId:null,reportedClientJobId:id,attemptAvailable:false};
 let status=null;try{const response=await env.OCR_JOBS.get(env.OCR_JOBS.idFromName(id)).fetch('https://ocr/status',{headers:{'X-Ocr-Owner':account}});if(response.ok)status=await response.json();}catch{}
 return {jobId:id,previousJobId:UUID.test(row.recovery_of||'')?row.recovery_of:null,attemptAvailable:true,model:row.model,mime:row.mime,bytes:row.bytes,pages:integer(row.pages),originalHash:row.source_hash||row.jobHash||row.document_hash||null,
  uploadStartedAt:integer(row.started),acceptedAt:integer(row.acceptedAt),dispatchJournalAt:integer(row.dispatched),updatedAt:integer(row.updated),
  state:safeCode(row.jobState||row.state,['awaiting-upload','verified','held','ready','failed','uncertain','canceled','expired']),
  terminalFailure:safeTerminalFailure(status?.terminalFailure),cancellation:safeCancellation(status?.cancellation),failureStage:safeCode(status?.failureStage,['dispatch','source_handoff','provider_request','result_validation']),providerHttpStatus:integer(status?.providerHttpStatus),sourceLinkUsedAt:integer(status?.sourceLinkUsedAt),
  dispatchBuild:/^[a-f0-9]{40}$/.test(status?.dispatchBuild||'')?status.dispatchBuild:null,providerRequestStartedAt:integer(status?.providerRequestStartedAt),providerResponseAt:integer(status?.providerResponseAt),providerRequestId:safeProviderRequestId(status?.providerRequestId),providerError:status?.providerError&&PROVIDER_ERROR_CATEGORIES.includes(status.providerError.category)?{category:status.providerError.category,classificationSource:safeCode(status.providerError.classificationSource,['provider_code','message_pattern','http_status_only']),code:safeCode(status.providerError.code,PROVIDER_ERROR_CODES),bodyState:safeCode(status.providerError.bodyState,['unavailable','oversized','parsed','unreadable','timeout'])}:null,sourceResponse:safeSourceResponse(status?.sourceResponse),originalCloudflareRayId:null,credits:{held:row.jobState==='held'?row.units/1000:0,used:row.consumed===null?null:(row.consumed||0)*2,released:row.released===null?null:(row.released||0)*2},capturedAt:now};
}
export async function scanFeedbackResponse(request,env,{token,accessIdentity=null,now=Date.now,ctx={waitUntil(){}}}={}){
 if(env.READER_MODE!=='staging'||env.OCR_DURABLE_JOBS!=='1'||!env.AUDIO)return json({},404);
 const url=new URL(request.url),parts=url.pathname.split('/'),id=parts[3],time=now();
 // This route grants the existing verified Access owner only the opted-in report bundle.
 // It cannot read ordinary OCR sources, results, accounts or ledgers.
 if(id){
  if(request.method!=='GET'||!UUID.test(id)||parts.length>5||parts[4]&&parts[4]!=='attachment')return json({},404);
  if(!accessIdentity||accessIdentity.email!==env.OWNER_EMAIL)return json({},403);
  const row=await env.LEDGER.prepare('SELECT id,created_at,context FROM feedback WHERE id=?').bind(id).first();
  const context=row?JSON.parse(row.context):null,scan=context?.scanReport;
  if(!scan||scan.reportId!==id)return json({},404);
  if(!parts[4])return json({id,createdAt:row.created_at,scanReport:scan});
  const a=scan.attachment;if(!a||a.expires<=time)return json({detail:'Diagnostic attachment expired or unavailable.'},410);
  const owner=await env.LEDGER.prepare('SELECT account FROM ocr_job_uploads WHERE id=?').bind(scan.jobId).first();if(!owner)return json({},410);
  return env.OCR_JOBS.get(env.OCR_JOBS.idFromName(scan.jobId)).fetch('https://ocr/diagnostic/'+id,{headers:{'X-Ocr-Owner':owner.account}});
 }
 if(request.method!=='POST')return json({},405);
 const account=await ownerAccount(env,token,time);if(!account||account.email!==env.OWNER_EMAIL)return json({detail:'Sign in with your verified staging account to send feedback.'},403);
 if(env.FEEDBACK_LIMIT&&!(await env.FEEDBACK_LIMIT.limit({key:account.id})).success)return json({detail:'Please wait before sending another report.'},429);
 try{
  if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({detail:'Reports contain diagnostics and private references, not file uploads.'},415);
  const value=JSON.parse(new TextDecoder().decode(await readBounded(request,16000)));
  if(!validScanReport(value)||!UUID.test(value.ticket?.id||'')||!await validTicket(value.ticket,env.FEEDBACK_SECRET))return json({detail:'Review the report and scan-inspection consent before sending.'},400);
  const reportId=value.ticket.id,prior=await env.LEDGER.prepare('SELECT context FROM feedback WHERE id=?').bind(reportId).first();
  if(prior){const scan=JSON.parse(prior.context).scanReport;if(scan?.reportId!==reportId)return json({},409);return json({saved:true,reportId,attachmentIncluded:!!scan.attachment},202);}
  const attempt=await evidence(env,account.id,value.jobId,time);if(!attempt)return json({detail:'The scan attempt is unavailable on this account.'},404);
  let attachment=null,attachmentUnavailableReason=null;
  if(value.includeScan){
   if(!attempt.attemptAvailable)attachmentUnavailableReason='upload_not_initialized';
   else {let source;try{const r=await env.OCR_JOBS.get(env.OCR_JOBS.idFromName(value.jobId)).fetch('https://ocr/diagnostic-retain',{method:'POST',headers:{'X-Ocr-Owner':account.id,'Content-Type':'application/json'},body:JSON.stringify({reportId,expires:time+SCAN_ATTACHMENT_TTL})});if(!r.ok)throw Error();source=await r.json();}catch{return json({detail:'The stored original could not be checked. No replacement was uploaded. Try Send feedback again, or send error information only.'},503);}
    if(source.available)attachment={storage:'original_reference',mime:source.mime,bytes:source.bytes,sha256:source.sha256,originalHashMatch:source.sha256?source.sha256===attempt.originalHash:null,expires:source.expires,consentPolicy:SCAN_FEEDBACK_POLICY};
    else attachmentUnavailableReason=source.reason||'original_already_deleted_or_upload_incomplete';
   }
  }
  let serverBuildAtReport=null;try{const r=await env.ASSETS.fetch(new Request(url.origin+'/release.json'));const release=await r.json();if(/^[a-f0-9]{40}$/.test(release.commit))serverBuildAtReport=release.commit;}catch{}
  const scanReport={version:1,reportId,environment:'staging',clientBuild:value.clientBuild,serverBuildAtReport,inputRoute:value.inputRoute,errorCode:value.errorCode,...attempt,clientMetadata:value.metadata,inspectionConsent:value.includeScan,consentPolicy:SCAN_FEEDBACK_POLICY,attachment,attachmentUnavailableReason};
  await env.LEDGER.prepare('INSERT INTO feedback(id,created_at,message,email,digest,context) VALUES(?,?,?,?,?,?)').bind(reportId,time,'Scan problem: '+value.errorCode+'.'+(value.note.trim()?' User note: '+value.note.trim():''),'',await digest('scan-report:'+reportId),JSON.stringify({environment:'test',scanReport})).run();
  return json({saved:true,reportId,attachmentIncluded:!!attachment,attachmentExpires:attachment?.expires||null,attachmentUnavailableReason},202);
 }catch{return json({detail:'Feedback could not be saved. Nothing was automatically retried. You can choose Send feedback again.'},503);}
}
