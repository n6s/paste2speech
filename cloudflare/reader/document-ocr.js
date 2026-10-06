import {OCR_MODEL,validateDocumentBytes} from '../../public/document-format.js';
// Provider request contract only. No outbound OCR is wired until a durable
// cost/admission policy and secure secret setup have been separately approved.
export function mistralOcrPayload(bytes,mime) {
 validateDocumentBytes(bytes,mime);
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 const url=`data:${mime};base64,${btoa(binary)}`;
 return {model:OCR_MODEL,document:mime==='application/pdf'?{type:'document_url',document_url:url}:{type:'image_url',image_url:url},include_blocks:true,include_image_base64:false,extract_footer:true,confidence_scores_granularity:'block',table_format:'markdown'};
}
export function documentOcrResponse(request,env) {
 const headers={'Cache-Control':'no-store'};
 if(env.READER_MODE!=='staging')return Response.json({}, {status:404,headers});
 if(request.method==='GET'&&new URL(request.url).pathname==='/api/ocr/config')return Response.json({enabled:false,model:OCR_MODEL,reason:'Cloud OCR is not enabled yet. Secure setup and a cost policy need approval.'},{headers});
 if(request.method!=='POST')return Response.json({}, {status:405,headers});
 // Reject before reading file bytes; feature flags or a secret alone cannot
 // accidentally authorize a paid provider call or consume speech credit.
 return Response.json({detail:'Cloud OCR is not enabled yet. Nothing was sent to Mistral.'},{status:503,headers});
}
