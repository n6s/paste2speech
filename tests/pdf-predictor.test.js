import test from 'node:test';import assert from 'node:assert/strict';import{predictedPdf}from'./helpers/pdf-predictor-fixture.js';
import{decodeXrefPredictor}from'../cloudflare/reader/pdf-predictor.js';import{verifiedLargePdfPages,verifiedPdfPages}from'../cloudflare/reader/pdf-admission.js';
// Entirely generated blank pages: no customer PDF bytes or document text.
test('bounded PNG xref predictors decode byte rows including Up and Paeth',()=>{
 const expected=[100,100,100];for(const [filter,row]of [[0,[100,100,100]],[1,[100,0,0]],[2,[100,100,100]],[3,[100,50,50]],[4,[100,0,0]]])for(const predictor of [10+filter,15])assert.deepEqual([...decodeXrefPredictor(Uint8Array.from([filter,...row]),{predictor,columns:3,width:3})],expected);
 assert.deepEqual([...decodeXrefPredictor(Uint8Array.from([2,1,2,3,2,3,3,3]),{predictor:12,columns:3,width:3})],[1,2,3,4,5,6]);
});
test('standard predicted xref with compressed page objects verifies three generated pages',async()=>{
 const bytes=await predictedPdf();assert.equal(await verifiedLargePdfPages(bytes),3);assert.equal(await verifiedPdfPages(bytes),3);
 await assert.rejects(verifiedLargePdfPages(await predictedPdf(11)),'mismatched fixed filter must reject');
});
test('predictor bounds, malformed rows and unsupported formats fail closed',()=>{
 for(const options of [{predictor:2},{predictor:9},{predictor:16},{predictor:12,columns:4},{predictor:12,columns:0},{predictor:12,colors:3},{predictor:12,bits:16},{predictor:12,width:25}])assert.throws(()=>decodeXrefPredictor(Uint8Array.from([2,1,2,3]),{columns:3,width:3,...options}));
 for(const data of [[5,1,2,3],[2,1,2],[1,1,2,3]])assert.throws(()=>decodeXrefPredictor(Uint8Array.from(data),{predictor:12,columns:3,width:3}));
 assert.throws(()=>decodeXrefPredictor(new Uint8Array(2*1024*1024+1),{width:3}));
});
