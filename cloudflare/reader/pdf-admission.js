import {PDFParser,PDFObjectStreamParser,PDFXRefStreamParser,PDFRawStream,PDFName,PDFNumber,PDFArray,PDFDict,PDFRef} from 'pdf-lib';
import {readBounded} from '../prepared/google.js';
export class PdfAdmissionError extends Error {constructor(code){super(code);this.code=code;}}
export function pdfAdmissionMessage(error){const messages={complexity:'This PDF has too much structural metadata for safe page verification. Export a new unencrypted PDF with 1–10 pages and try again.',encrypted:'This PDF is encrypted. Save an unencrypted copy before using cloud OCR.',pages:'Cloud OCR accepts PDFs with 1–10 pages. Split this document locally before choosing it again.',incomplete:'This PDF is incomplete. Download or export a complete copy and try again.',structure:'The PDF page structure could not be verified safely. Try exporting a new unencrypted PDF, then choose that copy.'};return error instanceof PdfAdmissionError?messages[error.code]||messages.structure:null;}
const name=PDFName.of,endobj=new TextEncoder().encode('endobj');
const integer=(value,max)=>{const n=value instanceof PDFNumber?value.asNumber():NaN;if(!Number.isSafeInteger(n)||n<0||n>max)throw Error('Invalid PDF structure');return n;};
// Pin pdf-lib 1.17.1. Its default page traversal trusts /Count and recursively
// follows Kids. Instead, bound parsing, decompress only structural streams with
// streaming limits, then independently walk the actual page tree. Image/content
// streams are never decompressed or rendered for admission.
export async function verifiedPdfPages(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>6*1024*1024||bytes.length<16)throw Error('Invalid PDF');
 const text=new TextDecoder('latin1').decode(bytes.subarray(Math.max(0,bytes.length-2048)));
 if(!/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(new TextDecoder().decode(bytes.subarray(0,8)))||!/[\r\n]%%EOF\s*$/.test(text))throw new PdfAdmissionError('incomplete');
 // Parser steps count dictionary fields and integers, not just objects.
 // 16K admits ordinary outline metadata while retaining strict page/resource bounds.
 const budget={nodes:0,depth:0,inflated:0,deadline:Date.now()+2000};
 const check=()=>{if(++budget.nodes>16384||Date.now()>budget.deadline){budget.failure='complexity';throw new PdfAdmissionError('complexity');}};
 function bound(parser){const rawInt=parser.parseRawInt;if(rawInt)parser.parseRawInt=function(){check();return rawInt.call(this);};const original=parser.parseObject;parser.parseObject=function(){check();if(++budget.depth>64){budget.depth--;throw Error('PDF nesting limit');}try{return original.call(this);}finally{budget.depth--;}};return parser;}
 async function structuralStream(stream){
  if(stream.dict.has(name('DecodeParms')))throw Error('Unsupported structural PDF predictor');
  let filter=stream.dict.lookup(name('Filter'));if(filter instanceof PDFArray){if(filter.size()!==1)throw Error('Unsupported PDF filters');filter=filter.lookup(0);}
  let data=stream.contents;
  if(filter){if(filter!==name('FlateDecode'))throw Error('Unsupported structural PDF compression');data=await readBounded({body:new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))},2*1024*1024);}
  if(data.length>2*1024*1024||(budget.inflated+=data.length)>4*1024*1024||Date.now()>budget.deadline)throw Error('PDF structural expansion limit');
  const dict=stream.dict.clone();dict.delete(name('Filter'));dict.delete(name('DecodeParms'));return PDFRawStream.of(dict,data);
 }
 const parser=bound(PDFParser.forBytesWithOptions(bytes,100,true,false));
 // Ambiguous duplicate definitions (including incremental revisions) are
 // rejected rather than choosing objects differently from the provider.
 const assign=parser.context.assign.bind(parser.context);parser.context.assign=(ref,object)=>{if(parser.context.lookup(ref))throw Error('Duplicate PDF object');assign(ref,object);};
 // Do not silently recover a missing/invalid trailer Root from arbitrary objects.
 parser.maybeRecoverRoot=function(){if(!this.context.trailerInfo.Root)throw Error('Missing PDF root');};
 parser.parseIndirectObject=async function(){
  check();const ref=this.parseIndirectObjectHeader();this.skipWhitespaceAndComments();const object=this.parseObject();this.skipWhitespaceAndComments();if(!this.matchKeyword(endobj))throw Error('Incomplete PDF object');
  if(object instanceof PDFRawStream){
   const type=object.dict.lookup(name('Type'));
   if(type===name('ObjStm')){
    const count=integer(object.dict.lookup(name('N')),2048),first=integer(object.dict.lookup(name('First')),2*1024*1024);if(!count||budget.nodes+count>16384)throw Error('PDF object limit');
    const safe=await structuralStream(object);if(first>=safe.contents.length)throw Error('Invalid PDF object stream');
    const sub=bound(PDFObjectStreamParser.forStream(safe,this.shouldWaitForTick));
    // Validate offsets before the library parses individual object bodies.
    const headers=sub.parseOffsetsAndObjectNumbers();if(sub.bytes.offset()>first||headers.some(({objectNumber:id,offset},i)=>!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(offset)||offset<0||first+offset>=safe.contents.length||i&&offset<=headers[i-1].offset)||new Set(headers.map(h=>h.objectNumber)).size!==count)throw Error('Invalid PDF object offsets');
    sub.bytes.moveTo(0);await sub.parseIntoContext();return ref;
   }
   if(type===name('XRef')){
    integer(object.dict.lookup(name('Size')),4096);const widths=object.dict.lookup(name('W'));if(!(widths instanceof PDFArray)||widths.size()!==3)throw Error('Invalid PDF xref');const width=Array.from({length:3},(_,i)=>integer(widths.lookup(i),8)).reduce((a,b)=>a+b,0);if(!width)throw Error('Invalid PDF xref width');
    const index=object.dict.lookup(name('Index'));let entries=integer(object.dict.lookup(name('Size')),4096);if(index){if(!(index instanceof PDFArray)||index.size()%2||index.size()>128)throw Error('Invalid PDF xref index');entries=0;for(let i=0;i<index.size();i+=2){integer(index.lookup(i),4096);entries+=integer(index.lookup(i+1),4096);}}if(entries>4096)throw Error('PDF xref limit');
    const safe=await structuralStream(object);if(safe.contents.length!==entries*width)throw Error('Incomplete PDF xref');PDFXRefStreamParser.forStream(safe).parseIntoContext();return ref;
   }
  }
  this.context.assign(ref,object);return ref;
 };
 let context;try{context=await parser.parseDocument();}catch(error){throw new PdfAdmissionError(budget.failure||'structure');}if(context.trailerInfo.Encrypt)throw new PdfAdmissionError('encrypted');
 const root=context.lookup(context.trailerInfo.Root);if(!(root instanceof PDFDict)||root.lookup(name('Type'))!==name('Catalog'))throw Error('Invalid PDF catalog');
 const seen=new Set();let visited=0;
 function walk(ref,parent,depth=0){
  if(!(ref instanceof PDFRef)||seen.has(ref.toString())||++visited>256||depth>32)throw Error('Invalid PDF page tree');seen.add(ref.toString());
  const dict=context.lookup(ref);if(!(dict instanceof PDFDict))throw Error('Missing PDF page');
  if(parent&&dict.get(name('Parent'))?.toString()!==parent.toString())throw Error('Invalid PDF page parent');
  if(!parent&&dict.has(name('Parent')))throw Error('Invalid PDF page root');
  const type=dict.lookup(name('Type'));if(type===name('Page'))return 1;
  if(type!==name('Pages'))throw Error('Invalid PDF page type');
  const kids=dict.lookup(name('Kids'));if(!(kids instanceof PDFArray)||kids.size()<1||kids.size()>10)throw Error('Invalid PDF page children');
  let count=0;for(let i=0;i<kids.size();i++){count+=walk(kids.get(i),ref,depth+1);if(count>10)throw new PdfAdmissionError('pages');}
  if(integer(dict.lookup(name('Count')),10)!==count)throw Error('Inconsistent PDF page count');return count;
 }
 const pages=walk(root.get(name('Pages')),null);if(pages<1||pages>10)throw new PdfAdmissionError('pages');return pages;
}
