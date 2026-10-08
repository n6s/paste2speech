// Synthetic metadata only; never derived from a personal PDF.
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';
export async function outlinePdf(entries=600){
 const doc=await PDFDocument.create();for(let i=0;i<5;i++)doc.addPage();
 const outline=doc.context.obj({Type:'Outlines',Count:entries}),root=doc.context.register(outline),items=[];
 for(let i=0;i<entries;i++){const item=doc.context.obj({Title:PDFString.of('Synthetic section'),Dest:[doc.getPages()[i%5].ref,'Fit'],Parent:root});items.push({item,ref:doc.context.register(item)});}
 items.forEach(({item},i)=>{if(i)item.set(PDFName.of('Prev'),items[i-1].ref);if(i+1<items.length)item.set(PDFName.of('Next'),items[i+1].ref);});
 outline.set(PDFName.of('First'),items[0].ref);outline.set(PDFName.of('Last'),items.at(-1).ref);doc.catalog.set(PDFName.of('Outlines'),root);
 return doc.save({useObjectStreams:false});
}
