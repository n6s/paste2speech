import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText, chunkText, defaults, readingCharacters} from '../public/text.js';
import {sourceCounts} from '../cloudflare/prepared/ledger.js';
test('reading count matches ledger including emoji and omitted chunk separators',()=>{
 const original='  Hello   👩‍💻.\n\nNext sentence.  ';
 const chunks=cleanText(original).split(/\n\s*\n/).flatMap(p=>chunkText(p));
 const count=readingCharacters(original,chunks);
 assert.equal(count.submitted,sourceCounts(chunks).reduce((a,b)=>a+b,0));
 assert.equal(count.saved,[...original].length-count.submitted);
 assert.ok(count.saved>0);
 assert.deepEqual(readingCharacters('',[]),{before:0,submitted:0,saved:0});
 assert.deepEqual(readingCharacters('$1',['one dollar']),{before:2,submitted:10,saved:0});
});
test('prose removes discretionary hyphens and BOMs, preserving meaningful Unicode and code',()=>{
 assert.equal(cleanText('co\u00adoperate \ufefftoday. 👩‍💻 café −5.'),'cooperate today. 👩‍💻 café −5.');
 const literal='```\na\u00adb\ufeff  c\n```';
 assert.ok(cleanText(literal,{...defaults,code:false}).includes('a\u00adb\ufeff  c'));
 const off=Object.fromEntries(Object.keys(defaults).map(k=>[k,false]));
 assert.equal(cleanText('a\u00adb',off),'a\u00adb');
});
