import {PdfAdmissionError,largePdfAdmissionMessage} from './pdf-admission.js';

// Fixed vocabulary only: never retain filenames, source text, tokens or raw errors.
export const OCR_FAILURE_KEY='ocr-terminal-failure-v1';
export const OCR_CANCELLATION_KEY='ocr-cancellation-v1';
export const OCR_CANCEL_DETAIL='Canceled before completion. Unused customer holds are released.';
const messages={
 scan_incomplete:'Scanning did not complete. No automatic provider retry was made.',
 admission_unconfirmed:'Admission could not be confirmed. No provider call was made.',
 settlement_unconfirmed:'The result could not be settled. Customer holds were released; no provider retry was made.',
 scanning_paused:'Scanning paused before provider dispatch. No provider call was made.',
 upload_expired:'The upload expired before acceptance. No provider call or customer charge was made.',
 upload_setup:'Another scan is active or upload setup could not be confirmed.',
 upload_verification:'The whole upload could not be verified. No OCR call or customer charge was made.',
 ...Object.fromEntries(['complexity','encrypted','pages','incomplete','structure'].map(code=>['pdf_'+code,largePdfAdmissionMessage(new PdfAdmissionError(code))]))
};
const phases=['upload','verifying','verified','accepting','accepted','dispatched','finalizing','failed','uncertain','expired'];
const stages=['dispatch','source_handoff','provider_request','result_validation'];
export function terminalFailure(m,state,detail,now){
 const code=Object.keys(messages).find(code=>messages[code]===detail)||'scan_incomplete';
 return {version:1,recordedAt:now,state:['failed','uncertain','expired'].includes(state)?state:'uncertain',phase:phases.includes(m.phase)?m.phase:null,stage:stages.includes(m.failureStage)?m.failureStage:null,code,detail:messages[code]};
}
export function safeTerminalFailure(value){
 if(value?.version!==1||!Number.isSafeInteger(value.recordedAt)||!Object.hasOwn(messages,value.code)||!['failed','uncertain','expired'].includes(value.state))return null;
 return {...terminalFailure({phase:value.phase,failureStage:value.stage},value.state,messages[value.code],value.recordedAt),code:value.code};
}
export function safeCancellation(value){
 if(value?.version!==1||!Number.isSafeInteger(value.firstAt)||!Number.isSafeInteger(value.lastAt)||value.lastAt<value.firstAt||!Number.isSafeInteger(value.requests)||value.requests<1||value.requests>1000000)return null;
 return {version:1,firstAt:value.firstAt,lastAt:value.lastAt,requests:value.requests};
}
