import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',location.href).href;
export async function extractPdf(file,signal,{maxCharacters=1000000}={}) {
 const task=getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
 const cancel=()=>{void task.destroy();};signal.addEventListener('abort',cancel,{once:true});
 try {
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const doc=await task.promise;const pages=[];let emptyPages=0,total=0;
  for(let n=1;n<=doc.numPages;n++){
   if(signal.aborted)throw new DOMException('Cancelled','AbortError');
   const page=await doc.getPage(n),content=await page.getTextContent();
   const text=content.items.map(x=>typeof x.str==='string'?x.str+(x.hasEOL?'\n':' '):'').join('').trim();
   total+=text.length;if(total>maxCharacters)throw Error('Too much text. Try a smaller PDF or a section of it.');
   if(text)pages.push(text);else emptyPages++;page.cleanup();
  }
  if(!pages.length)throw Error('No readable text found. Scanned images need OCR, which this reader does not provide.');
  return {text:pages.join('\n\n'),pages:doc.numPages,emptyPages};
 } catch(e){
  if(signal.aborted)throw new DOMException('PDF import cancelled or timed out.','AbortError');
  if(e.name==='PasswordException')throw Error('Password-protected PDFs are not supported.');
  throw e;
 } finally {signal.removeEventListener('abort',cancel);await task.destroy();}
}
