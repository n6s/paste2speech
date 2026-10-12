export const OCR_MODEL='mistral-ocr-4-1';
// Pinned published OCR price with a 2x safety margin, rounded upward in cents.
export function ocrReservationCents(pages){if(!Number.isInteger(pages)||pages<1||pages>10)throw Error('Invalid OCR page count.');return Math.max(1,Math.ceil(pages*8/10));}
export const DOCUMENT_LIMIT=20*1024*1024;
export const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOC_MIME='application/msword';
export function documentType(file,{allowWord=false}={}) {
 const mime=String(file.type||'').toLowerCase(),name=String(file.name||'').toLowerCase();
 if(mime==='application/pdf'||!mime&&name.endsWith('.pdf'))return {kind:'pdf',mime:'application/pdf'};
 if(allowWord&&name.endsWith('.docx')&&['','application/octet-stream','application/zip','application/x-zip-compressed',DOCX_MIME].includes(mime))return {kind:'word',format:'docx',mime:DOCX_MIME};
 if(allowWord&&name.endsWith('.doc')&&['','application/octet-stream',DOC_MIME,'application/x-msword','application/vnd.ms-word'].includes(mime))return {kind:'word',format:'doc',mime:DOC_MIME};
 const images={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
 if(images[mime])return {kind:'image',mime};
 if(!mime){if(/\.jpe?g$/.test(name))return {kind:'image',mime:'image/jpeg'};if(name.endsWith('.png'))return {kind:'image',mime:'image/png'};if(name.endsWith('.webp'))return {kind:'image',mime:'image/webp'};}
 throw Error(allowWord?'Choose a PDF, DOCX Word file, PNG, JPEG or WebP image. Legacy DOC needs conversion to DOCX or PDF.':'Choose a PDF, PNG, JPEG or WebP image.');
}
export function validateDocumentBytes(bytes,mime) {
 if(!bytes.length||bytes.length>DOCUMENT_LIMIT)throw Error('Choose a document smaller than 20 MB.');
 const at=(n,s)=>[...s].every((c,i)=>bytes[n+i]===c.charCodeAt(0));
 const valid=mime==='application/pdf'?at(0,'%PDF-'):mime==='image/png'?bytes[0]===137&&at(1,'PNG\r\n\x1a\n'):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/webp'?at(0,'RIFF')&&at(8,'WEBP'):mime===DOCX_MIME?at(0,'PK\x03\x04'):mime===DOC_MIME?[208,207,17,224,161,177,26,225].every((b,i)=>bytes[i]===b):false;
 if(!valid)throw Error('The file contents do not match a supported document format.');
}
