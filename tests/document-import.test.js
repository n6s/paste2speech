import test from 'node:test';import assert from 'node:assert/strict';
import {assessNativePage,assessNativeDocument} from '../public/document-quality.js';
import {documentType,validateDocumentBytes,OCR_MODEL} from '../public/document-format.js';
import {reconstruct,exportText} from '../public/document-reconstruct.js';
import {documentOcrResponse,mistralOcrPayload} from '../cloudflare/reader/document-ocr.js';
test('native gate accepts short readable prose and blank decorative pages',()=>{const p={text:'Hello PDF reader.'};assert.equal(assessNativePage(p).needsOcr,false);assert.equal(assessNativeDocument([p,{text:''}]).needsOcr,false);});
test('native gate rejects nonempty corrupt text, image-only pages and risky column ordering per page',()=>{
 assert.equal(assessNativePage({text:'Some words '+String.fromCharCode(1,2,3)+' are present.'}).needsOcr,true);
 assert.equal(assessNativePage({text:'',hasImages:true}).needsOcr,true);
 const items=Array.from({length:12},(_,i)=>({str:'A substantial line of prose',transform:[1,0,0,1,i<6?40:400,700-i*20]}));
 assert.equal(assessNativePage({text:'Readable words in two columns.',items}).needsOcr,true);
 assert.equal(assessNativeDocument([{text:'A readable first page.'},{text:'bad'+String.fromCharCode(1,2,3)}]).needsOcr,true);
});
test('PDF/image routes are explicit and mismatched contents and URL-like inputs are rejected',()=>{
 assert.equal(documentType({name:'sample.pdf',type:''}).kind,'pdf');assert.equal(documentType({name:'sample.jpg',type:'image/jpeg'}).kind,'image');
 assert.throws(()=>documentType({name:'sample.svg',type:'image/svg+xml'}),/Choose/);assert.throws(()=>validateDocumentBytes(new TextEncoder().encode('<script>'), 'application/pdf'),/contents/);assert.throws(()=>documentType({name:'https://example.com/page',type:''}),/Choose/);
});
test('Mistral contract is pinned and accepts validated bytes rather than arbitrary remote URLs',()=>{
 const p=mistralOcrPayload(new TextEncoder().encode('%PDF-1.4 test'),'application/pdf');assert.equal(p.model,OCR_MODEL);assert.equal(p.document.type,'document_url');assert.ok(p.document.document_url.startsWith('data:application/pdf;base64,'));assert.equal(p.include_image_base64,false);assert.equal(p.include_blocks,true);
});
test('staging OCR remains disabled before body consumption even with flags or fake credentials; production route absent',async()=>{
 const r=new Request('https://reader.test/api/ocr',{method:'POST',body:'private document'});
 const response=await documentOcrResponse(r,{READER_MODE:'staging',ENABLE_DOCUMENT_OCR:'1',MISTRAL_API_KEY:'fake-test-only'},{verifyOwner:async()=>true});assert.equal(response.status,503);assert.equal(r.bodyUsed,false);
 const config=await (await documentOcrResponse(new Request('https://reader.test/api/ocr/config'),{READER_MODE:'staging'},{verifyOwner:async()=>true})).json();assert.equal(config.enabled,false);assert.equal(config.model,OCR_MODEL);
 assert.equal((await documentOcrResponse(r,{READER_MODE:'production-public'})).status,404);
});
test('ordered source prose, asides and labeled tables export without uncertainty narration or source mutation',()=>{
 const raw={model:OCR_MODEL,pages:[{index:0,footer:'Page 1',tables:[{id:'t',content:'| Event | Date |\n| --- | --- |\n| Picnic | 10/8 |'}],blocks:[{type:'title',content:'Community news'},{type:'text',content:'The source sentence continues'},{type:'text',content:'on its next line.'},{type:'aside_text',content:'Keep this sidebar.'},{type:'table',table_id:'t',content:'table',confidence_scores:{minimum_content_confidence_score:.5}}]}]};
 const snapshot=JSON.stringify(raw),result=reconstruct(raw);assert.match(exportText(result.articles),/continues on its next line/);assert.match(exportText(result.articles),/Event: Picnic; Date: 10\/8/);assert.match(exportText(result.articles,true),/## Community news/);assert.match(exportText(result.articles),/Keep this sidebar/);assert.doesNotMatch(exportText(result.articles),/uncertain|Page 1/);assert.ok(result.notes.length);assert.equal(JSON.stringify(raw),snapshot);
});
