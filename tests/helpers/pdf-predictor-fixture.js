import assert from 'node:assert/strict';import{deflateSync,inflateSync}from'node:zlib';import{PDFDocument}from'pdf-lib';
// Generated blank PDF only; never reads a user file.
export async function predictedPdf(predictor=12){
 const doc=await PDFDocument.create();for(let i=0;i<3;i++)doc.addPage([100,100]);const bytes=Buffer.from(await doc.save({useObjectStreams:true})),text=bytes.toString('latin1'),type=text.lastIndexOf('/Type /XRef'),object=[...text.slice(0,type).matchAll(/\d+ 0 obj/g)].at(-1).index,start=text.indexOf('stream\n',type)+7,dict=text.slice(object,start),length=Number(dict.match(/\/Length (\d+)/)[1]),width=dict.match(/\/W \[([^\]]+)\]/)[1].trim().split(/\s+/).map(Number).reduce((a,b)=>a+b,0),raw=inflateSync(bytes.subarray(start,start+length));
 assert.equal(raw.length%width,0);const encoded=Buffer.alloc(raw.length+raw.length/width);for(let src=0,dst=0;src<raw.length;){encoded[dst++]=2;for(let x=0;x<width;x++,src++)encoded[dst++]=(raw[src]-(src>=width?raw[src-width]:0))&255;}
 const zipped=deflateSync(encoded),updated=dict.replace('/Type /XRef',`/Type /XRef /DecodeParms << /Predictor ${predictor} /Columns ${width} >>`).replace(`/Length ${length}`,`/Length ${zipped.length}`);
 return Buffer.concat([bytes.subarray(0,object),Buffer.from(updated,'latin1'),zipped,bytes.subarray(start+length)]);
}
