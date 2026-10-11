// Synthetic valid PDF structure; no private or externally sourced document.
import {PDFDocument,PDFRawStream,PDFDict,PDFName,PDFString,PDFHexString} from 'pdf-lib';
export async function largePdf({pages=1000,bytes=0,compressed=false,metadataString=0,hexString=false}={}){
 const pdf=await PDFDocument.create();for(let i=0;i<pages;i++)pdf.addPage();
 if(metadataString)pdf.catalog.set(PDFName.of('SyntheticTitle'),hexString?PDFHexString.of('a'.repeat(metadataString)):PDFString.of('a'.repeat(metadataString)));
 let stream;if(bytes){stream=PDFRawStream.of(PDFDict.withContext(pdf.context),new Uint8Array(0));pdf.catalog.set(PDFName.of('Metadata'),pdf.context.register(stream));}
 let result=await pdf.save({useObjectStreams:compressed});if(bytes){stream.contents=new Uint8Array(bytes-result.length-7);result=await pdf.save({useObjectStreams:compressed});stream.contents=new Uint8Array(stream.contents.length+bytes-result.length);result=await pdf.save({useObjectStreams:compressed});if(result.length!==bytes)throw Error('Synthetic size mismatch');}return result;
}
