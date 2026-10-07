import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstruct,exportText,readingText} from '../public/document-reconstruct.js';
import {cleanText,defaults,chunkText} from '../public/text.js';
const dates=['Oct. 13 - College & Career Fair and FAFSA Night','Oct. 15-16 - Fall Break, no classes','Oct. 20 - Board Meeting','Oct. 22- School Community Council meeting','Oct. 23 - Sadie Hawkins Dance'];
const heading='UCAS COLLEGE FAIR & FAFSA NIGHT';
const raw=blocks=>({pages:[{index:0,blocks}]});
test('UCAS date rows and following heading survive within one OCR text region, exports and cleanup',()=>{
 const source=raw([{type:'title',content:'IMPORTANT DATES'},{type:'text',content:dates.join('\n')+'\n'+heading,confidence_scores:{minimum_content_confidence_score:.6}}]);
 const snapshot=JSON.stringify(source),result=reconstruct(source),expected=dates.join('\n\n')+'\n\n'+heading;
 assert.equal(result.articles[0].text,expected);
 for(const markdown of [false,true])assert.ok(exportText(result.articles,markdown).includes(expected));
 for(const joinLines of [false,true]){
  const cleaned=cleanText(exportText(result.articles,true),{...defaults,joinLines});
  assert.ok(cleaned.includes(expected));
  const chunks=cleaned.split(/\n\s*\n/).filter(Boolean).flatMap(p=>chunkText(p));
  assert.ok(chunks.includes(dates.at(-1)));assert.ok(chunks.includes(heading));
 }
 assert.ok(result.notes.some(n=>n.includes('uncertain')));
 assert.doesNotMatch(readingText(result.articles[0]),/uncertain|minimum score/);
 assert.equal(JSON.stringify(source),snapshot);
});
test('separate OCR blocks and page boundaries survive missing terminal punctuation',()=>{
 for(const source of [raw([{type:'text',content:dates.at(-1)},{type:'text',content:heading}]),{pages:[{index:0,blocks:[{type:'text',content:dates.at(-1)}]},{index:1,blocks:[{type:'text',content:heading}]}]}]){
  assert.equal(reconstruct(source).articles[0].text,dates.at(-1)+'\n\n'+heading);
 }
});
test('normal wrapped prose and acronym lines remain prose; existing paragraphs stay separate',()=>{
 for(const [input,expected] of [['The ordinary sentence wraps\nonto the next line.','The ordinary sentence wraps onto the next line.'],['We support\nNHS\nthrough ordinary volunteer work.','We support NHS through ordinary volunteer work.'],['Oct. 23 - A single dated sentence\ncontinues on its next line.','Oct. 23 - A single dated sentence continues on its next line.'],['A paragraph.\n\nAnother wrapped\nparagraph.','A paragraph.\n\nAnother wrapped paragraph.'],['Hyphenated inter-\nnational text.','Hyphenated international text.']]){
  assert.equal(reconstruct(raw([{type:'text',content:input}])).articles[0].text,expected);
 }
});
