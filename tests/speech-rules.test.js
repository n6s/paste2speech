import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spokenText,speechPhrases,pronunciationSegments,splitPhonemes} from '../browser/speech-rules.js';
const dictionary=JSON.parse(readFileSync(new URL('../shared/pronunciations.json',import.meta.url)));
test('shared dictionary protects URLs, longer words and dialects',()=>{
 for(const dialect of ['a','b']){
  const segments=pronunciationSegments("Waymo's demos UBTECH robotaxi robotaxis. https://example.com/waymo waymore",dialect,dictionary);
  assert.equal(segments.filter(s=>s.phonemes).length,5);
  assert.ok(segments.filter(s=>s.text).map(s=>s.text).join('').includes('https://example.com/waymo waymore'));
  assert.ok(segments[0].phonemes.endsWith('z'));
  assert.ok(pronunciationSegments("UBTECH's",dialect,dictionary)[0].phonemes.endsWith('ks'));
  assert.ok(pronunciationSegments("demos's",dialect,dictionary)[0].phonemes.endsWith('zɪz'));
  assert.ok(segments.every(s=>!s.phonemes||!/[AOQr]/.test(s.phonemes)));
 }
});
test('speech-only expansions preserve URLs and quantities',()=>{
 assert.equal(spokenText('1:1, 1 lb, 2 lbs, 7.02-ft, 150,700-sq-ft.'),'one to one, 1 pound, 2 pounds, 7 point zero two feet, one hundred fifty thousand seven hundred square feet.');
 assert.equal(spokenText('https://x.test/1:1/7.02 1,079'),'https://x.test/1:1/7.02 one thousand seventy nine');
});
test('pause rules preserve outer quotes and answer labels',()=>{
 assert.deepEqual(speechPhrases('A) First: “hello.” Then—next.'),[['A)',3600],['First:',6000],['“hello.”',1200],['Then',3600],['next.',0]]);
});
test('token-safe splitting never truncates or drops non-whitespace characters',()=>{
 const tokenizer=(s)=>({input_ids:{dims:[1,[...s].length+2],text:s}});
 const input=('a'.repeat(600)+' hello ').repeat(3);
 const pieces=splitPhonemes(input,tokenizer);
 assert.ok(pieces.every(p=>p.dims[1]<=511));
 assert.equal(pieces.map(p=>p.text).join('').replaceAll(' ',''),input.replaceAll(' ',''));
});
