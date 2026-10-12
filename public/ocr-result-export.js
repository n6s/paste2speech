import {assembleOcrPage} from './ocr-table-resources.js';
import {plain} from './document-reconstruct.js';
// Preserve provider content while expanding its embedded table references. Page markers and separately
// extracted headers/footers make the complete scan comparable to the original.
export function* ocrExportParts(pages,markdown=false){
 for(const [position,originalPage] of pages.entries()){
  const page=assembleOcrPage(originalPage).page;
  const number=Number.isInteger(page.index)?page.index+1:position+1;
  const body=typeof page.markdown==='string'?page.markdown:(page.blocks||[]).map(block=>String(block.content||'')).join('\n\n');
  yield `${position?'\n\n':''}${markdown?`<!-- Page ${number} -->`:`[Page ${number}]`}\n\n`;
  if(page.header)yield `${markdown?'<!-- Header -->':'[Header]'}\n${markdown?page.header:plain(page.header)}\n\n`;
  yield markdown?body:plain(body);
  if(page.footer)yield `\n\n${markdown?'<!-- Footer -->':'[Footer]'}\n${markdown?page.footer:plain(page.footer)}`;
 }
}
export function ocrExportBlob(pages,markdown=false){return new Blob(Array.from(ocrExportParts(pages,markdown)),{type:markdown?'text/markdown;charset=utf-8':'text/plain;charset=utf-8'});}
