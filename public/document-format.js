export const OCR_MODEL='mistral-ocr-4-1';
// Pinned published OCR price with a 2x safety margin, rounded upward in cents.
export function ocrReservationCents(pages){if(!Number.isInteger(pages)||pages<1||pages>10)throw Error('Invalid OCR page count.');return Math.max(1,Math.ceil(pages*8/10));}
export const DOCUMENT_LIMIT=20*1024*1024;
export function documentType(file) {
 const mime=String(file.type||'').toLowerCase(),name=String(file.name||'').toLowerCase();
 if(mime==='application/pdf'||!mime&&name.endsWith('.pdf'))return {kind:'pdf',mime:'application/pdf'};
 const images={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
 if(images[mime])return {kind:'image',mime};
 if(!mime){if(/\.jpe?g$/.test(name))return {kind:'image',mime:'image/jpeg'};if(name.endsWith('.png'))return {kind:'image',mime:'image/png'};if(name.endsWith('.webp'))return {kind:'image',mime:'image/webp'};}
 throw Error('Choose a PDF, PNG, JPEG or WebP image.');
}
export function validateDocumentBytes(bytes,mime) {
 if(!bytes.length||bytes.length>DOCUMENT_LIMIT)throw Error('Choose a document smaller than 20 MB.');
 const at=(n,s)=>[...s].every((c,i)=>bytes[n+i]===c.charCodeAt(0));
 const valid=mime==='application/pdf'?at(0,'%PDF-'):mime==='image/png'?bytes[0]===137&&at(1,'PNG\r\n\x1a\n'):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/webp'?at(0,'RIFF')&&at(8,'WEBP'):false;
 if(!valid)throw Error('The file contents do not match a supported document format.');
}
