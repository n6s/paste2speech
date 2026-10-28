import {readPdfRevisions} from './pdf-revisions.js';
import {PDFRawStream,PDFName,PDFNumber,PDFArray,PDFDict,PDFRef,PDFNull} from 'pdf-lib';
import {decodeXrefPredictor} from './pdf-predictor.js';
import {readBounded} from '../prepared/google.js';
export class PdfAdmissionError extends Error {constructor(code){super(code);this.code=code;}}
export function pdfAdmissionMessage(error){const messages={unsupported:'This PDF uses unsupported structural compression. Re-export it as a standard PDF, then choose that copy.',complexity:'This PDF has too much structural metadata for safe page verification. Export a new unencrypted PDF with 1–10 pages and try again.',encrypted:'This PDF is encrypted. Save an unencrypted copy before using cloud OCR.',pages:'Cloud OCR accepts PDFs with 1–10 pages. Split this document locally before choosing it again.',incomplete:'This PDF is incomplete. Download or export a complete copy and try again.',structure:'The PDF page structure could not be verified safely. Try exporting a new unencrypted PDF, then choose that copy.'};return error instanceof PdfAdmissionError?messages[error.code]||messages.structure:null;}
const name=PDFName.of;
const integer=(value,max)=>{const n=value instanceof PDFNumber?value.asNumber():NaN;if(!Number.isSafeInteger(n)||n<0||n>max)throw Error('Invalid PDF structure');return n;};
// Pin pdf-lib 1.17.1. Its default page traversal trusts /Count and recursively
// follows Kids. Instead, bound parsing, decompress only structural streams with
// streaming limits, then independently walk the actual page tree. Image/content
// streams are never decompressed or rendered for admission.
const SMALL_PDF_LIMITS={maxBytes:6*1024*1024,maxPages:10,nodes:16384,xref:4096,visited:256,timeoutMs:2000};
export const LARGE_PDF_LIMITS=Object.freeze({maxBytes:50000000,maxPages:1000,nodes:131072,xref:16384,visited:4096,timeoutMs:10000,tokenBytes:65536,textBytes:4*1024*1024});
export const verifiedPdfPages=bytes=>verifyPdfPages(bytes,SMALL_PDF_LIMITS);
export const verifiedLargePdfPages=(bytes,onStats)=>verifyPdfPages(bytes,LARGE_PDF_LIMITS,onStats);
export const largePdfAdmissionMessage=error=>pdfAdmissionMessage(error)?.replaceAll('1–10','1–1,000').replace('Split this document locally before choosing it again.','Choose a supported whole document within this limit.');
async function verifyPdfPages(bytes,limits,onStats){
 if(!(bytes instanceof Uint8Array)||bytes.length>limits.maxBytes||bytes.length<16)throw Error('Invalid PDF');
 const text=new TextDecoder('latin1').decode(bytes.subarray(Math.max(0,bytes.length-2048)));
 if(!/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(new TextDecoder().decode(bytes.subarray(0,8)))||!/[\r\n]%%EOF\s*$/.test(text))throw new PdfAdmissionError('incomplete');
 // Parser steps count dictionary fields and integers, not just objects.
 // 16K admits ordinary outline metadata while retaining strict page/resource bounds.
 const budget={nodes:0,depth:0,inflated:0,textBytes:0,deadline:Date.now()+limits.timeoutMs};
 const check=()=>{if(++budget.nodes>limits.nodes||Date.now()>budget.deadline){budget.failure='complexity';throw new PdfAdmissionError('complexity');}};
 function bound(parser){
  // pdf-lib's ByteStream.slice copies every content/image stream. The large
  // verifier is read-only, so retain bounded subarray views of its one source.
  if(limits.tokenBytes)parser.bytes.slice=function(start,end){return this.bytes.subarray(start,end);};
  // The large profile also bounds individual/aggregate strings before pdf-lib
  // allocates them; a 50 MB literal is not safe merely because node count is low.
  if(limits.tokenBytes)for(const [method,kind,max] of [['parseString','literal',limits.tokenBytes],['parseHexString','hex',limits.tokenBytes],['parseName','name',4096],['parseRawInt','number',64],['parseRawNumber','number',64]]){
   const original=parser[method];if(!original)continue;parser[method]=function(){
    let length=0,depth=0,escaped=false;for(;length<=max;length++){
     const c=this.bytes.peekAhead(length);if(c===undefined)break;
     if(kind==='literal'){if(!escaped){if(c===40)depth++;if(c===41&&--depth===0){length++;break;}}if(c===92)escaped=!escaped;else if(escaped)escaped=false;}
     else if(kind==='hex'){if(c===62){length++;break;}}
     else if(kind==='name'){if(length&&[0,9,10,12,13,32,40,41,60,62,91,93,123,125,47,37].includes(c))break;}
     else if(!(c>=48&&c<=57||[43,45,46].includes(c)))break;
    }
    if(length>max||(budget.textBytes+=length)>limits.textBytes){budget.failure='complexity';throw new PdfAdmissionError('complexity');}return original.call(this);
   };
  }
  const rawInt=parser.parseRawInt;if(rawInt)parser.parseRawInt=function(){check();return rawInt.call(this);};const original=parser.parseObject;parser.parseObject=function(){check();if(++budget.depth>64){budget.depth--;throw Error('PDF nesting limit');}try{return original.call(this);}finally{budget.depth--;}};return parser;}
 async function structuralStream(stream,width=null){
  let filter=stream.dict.lookup(name('Filter'));if(filter===PDFNull)filter=null;if(filter instanceof PDFArray){if(filter.size()!==1)throw new PdfAdmissionError('unsupported');filter=filter.lookup(0);}
  let data=stream.contents;
  if(filter){if(filter!==name('FlateDecode'))throw new PdfAdmissionError('unsupported');try{data=await readBounded({body:new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))},2*1024*1024);}catch(error){if(error.message==='Response too large')throw new PdfAdmissionError('complexity');throw error;}}
  if(data.length>2*1024*1024||(budget.inflated+=data.length)>4*1024*1024||Date.now()>budget.deadline)throw new PdfAdmissionError('complexity');
  let params=stream.dict.lookup(name('DecodeParms'));
  if(params instanceof PDFArray){if(params.size()!==1)throw new PdfAdmissionError('unsupported');params=params.lookup(0);}if(params===PDFNull)params=null;
  if(params){
   if(width==null||!(params instanceof PDFDict)||filter!==name('FlateDecode'))throw Error('Unsupported structural PDF predictor');
   const parameter=(key,fallback)=>params.has(name(key))?integer(params.lookup(name(key)),65536):fallback;
   data=decodeXrefPredictor(data,{predictor:parameter('Predictor',1),columns:parameter('Columns',1),colors:parameter('Colors',1),bits:parameter('BitsPerComponent',8),width});
  }
  const dict=stream.dict.clone();dict.delete(name('Filter'));dict.delete(name('DecodeParms'));return PDFRawStream.of(dict,data);
 }
 try{
  const view=await readPdfRevisions({bytes,limits,budget,check,bound,structuralStream});if(view.encrypted)throw new PdfAdmissionError('encrypted');await view.validateActive();
  const root=await view.resolve(view.root);if(!(root instanceof PDFDict)||await view.resolve(root.get(name('Type')))!==name('Catalog'))throw Error('Invalid PDF catalog');
  const seen=new Set();let visited=0;
  async function walk(ref,parent,depth=0){
   if(!(ref instanceof PDFRef)||seen.has(ref.toString())||++visited>limits.visited||depth>32)throw Error('Invalid PDF page tree');seen.add(ref.toString());
   const dict=await view.resolve(ref);if(!(dict instanceof PDFDict))throw Error('Missing PDF page');
   if(parent&&dict.get(name('Parent'))?.toString()!==parent.toString())throw Error('Invalid PDF page parent');if(!parent&&dict.has(name('Parent')))throw Error('Invalid PDF page root');
   const type=await view.resolve(dict.get(name('Type')));if(type===name('Page'))return 1;if(type!==name('Pages'))throw Error('Invalid PDF page type');
   const kids=await view.resolve(dict.get(name('Kids')));if(!(kids instanceof PDFArray)||kids.size()<1||kids.size()>limits.maxPages)throw Error('Invalid PDF page children');
   let count=0;for(let i=0;i<kids.size();i++){count+=await walk(kids.get(i),ref,depth+1);if(count>limits.maxPages)throw new PdfAdmissionError('pages');}
   if(integer(await view.resolve(dict.get(name('Count'))),limits.maxPages)!==count)throw Error('Inconsistent PDF page count');return count;
  }
  const pages=await walk(root.get(name('Pages')),null);if(pages<1||pages>limits.maxPages)throw new PdfAdmissionError('pages');
  if(typeof onStats==='function'){const buffers=new Set([bytes.buffer,...view.structuralBuffers]);for(const [,object]of view.context.enumerateIndirectObjects())if(object instanceof PDFRawStream)buffers.add(object.contents.buffer);onStats({nodes:budget.nodes,textBytes:budget.textBytes,inflatedBytes:budget.inflated,pages,revisions:view.revisionCount,xrefEntries:view.xrefEntries,sourceAndRawStreamBufferCount:buffers.size,sourceAndRawStreamBufferBytes:Array.from(buffers).reduce((n,b)=>n+b.byteLength,0)});}return pages;
 }catch(error){throw error instanceof PdfAdmissionError?error:new PdfAdmissionError(budget.failure||'structure');}
}
