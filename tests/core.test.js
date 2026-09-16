import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, chunkText, defaults, joinWrappedLines } from '../public/text.js';
import { Player } from '../public/player.js';

test('cleans a representative ChatGPT answer', () => {
 const input = '# Hello\n\n**Read this** [source](https://example.com) citeturn0search0\n\n```js\nsecret();\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- Goodbye.';
 assert.equal(cleanText(input), 'Hello\n\nRead this source\n\nGoodbye.');
});
test('handles unfinished fences, alternate fences and indented code', () => {
 assert.equal(cleanText('Before\n```js\nunclosed'), 'Before');
 assert.equal(cleanText('Before\n~~~py\nprint(1)\n~~~\nAfter'), 'Before\n\nAfter');
 assert.equal(cleanText('Before\n    code()\nAfter'), 'Before\n\nAfter');
});
test('preserves content when all cleanup switches are off', () => {
 const input = '# Heading\n**bold** https://example.com\n```js\nx()\n```\n|a|b|\n|---|---|\n|1|2|\n😀';
 assert.equal(cleanText(input, Object.fromEntries(Object.keys(defaults).map(k => [k,false]))), input);
});
test('emoji removal keeps numbers and other language text', () => {
 assert.equal(cleanText('Hello 👨‍👩‍👧‍👦 👍🏽 🇺🇸 1️⃣ 123 café 日本語', {...defaults, emoji:true}), 'Hello 123 café 日本語');
});
test('references removed without erasing ordinary bracketed prose', () => {
 assert.equal(cleanText('Fact 【12†source】 [aside] turn2search3 [^1]\n[^1]: footnote'), 'Fact [aside]');
});
test('table option preserves ordinary pipe prose', () => { assert.equal(cleanText('Choose A | B'), 'Choose A | B'); });
test('chunking preserves words and bounds long tokens and emoji', () => {
 for (const text of ['One sentence. '.repeat(300), 'word '.repeat(1000), 'x'.repeat(1000), '😀'.repeat(300)]) {
  const chunks = chunkText(text);
  assert.ok(chunks.every(c => c.length <= 180 && c.length > 0));
  assert.equal(chunks.join('').replace(/\s/g,''), text.replace(/\s/g,''));
  assert.ok(chunks.every(c => !/[\uD800-\uDBFF]$/.test(c)));
 }
 assert.deepEqual(chunkText('   '), []);
});
function setup() {
 const synth = { spoken: [], cancel() {}, speak(u) { this.spoken.push(u); } };
 class Utterance { constructor(text) { this.text=text; } }
 return { synth, player: new Player(synth, Utterance) };
}
test('plays all chunks sequentially then completes', () => {
 const {synth,player:p}=setup(); p.start(['one','two'], {rate:1});
 synth.spoken[0].onend(); assert.equal(synth.spoken[1].text,'two');
 synth.spoken[1].onend(); assert.equal(p.state,'done');
});
test('pause resumes last word and ignores late callbacks', () => {
 const {synth,player:p}=setup(); p.start(['first second','third'],{rate:1});
 const old=synth.spoken[0]; old.onboundary({name:'word',charIndex:6}); p.pause();
 old.onend(); old.onerror({error:'canceled'}); assert.equal(p.index,0); assert.equal(p.state,'paused');
 p.resume({rate:1.3}); assert.equal(synth.spoken[1].text,'second'); assert.equal(synth.spoken[1].rate,1.3);
 p.stop(); synth.spoken[1].onend(); assert.equal(p.state,'idle'); assert.equal(p.index,0);
});
test('pause without boundary events repeats chunk; voice errors allow retry', () => {
 const {synth,player:p}=setup(); p.start(['one two'],{rate:1}); p.pause(); p.resume({rate:1});
 assert.equal(synth.spoken[1].text,'one two'); synth.spoken[1].onerror({error:'network'});
 assert.equal(p.state,'paused'); p.resume({rate:1}); assert.equal(synth.spoken[2].text,'one two'); p.stop();
});
test('a stalled engine preserves the current chunk for retry', t => {
 t.mock.timers.enable({apis:['setTimeout']});
 const {synth,player:p}=setup(); p.start(['one two'],{rate:1});
 t.mock.timers.tick(30001); assert.equal(p.state,'paused'); assert.equal(p.index,0);
 synth.spoken[0].onend(); assert.equal(p.index,0);
 p.resume({rate:1}); assert.equal(synth.spoken[1].text,'one two'); p.stop();
});
test('new playback ignores callbacks from replaced text', () => {
 const {synth,player:p}=setup(); p.start(['old'],{rate:1}); const old=synth.spoken[0];
 p.start(['new','next'],{rate:1}); old.onend(); assert.equal(p.index,0);
 assert.equal(synth.spoken.at(-1).text,'new'); p.stop();
});
test('start at a chosen chunk reads to the end and stop resets', () => {
 const {synth,player:p}=setup(); p.start(['first','second','third'],{rate:1},1);
 assert.equal(synth.spoken[0].text,'second'); assert.equal(p.index,1);
 synth.spoken[0].onend(); assert.equal(synth.spoken[1].text,'third');
 synth.spoken[1].onend(); assert.equal(p.state,'done');
 p.stop(); assert.equal(p.index,0);
});

test('joins PDF hard wraps but keeps sentences and blank paragraphs', () => {
 const input = 'A column wraps\nover several\nshort lines.\nNext sentence,\nwith a clause;\nand more.\n\nNew paragraph\nends here!';
 const expected = 'A column wraps over several short lines.\nNext sentence, with a clause; and more.\n\nNew paragraph ends here!';
 assert.equal(joinWrappedLines(input), expected);
 assert.equal(cleanText(input, {...defaults, joinLines: true}), expected);
 assert.equal(cleanText(input), input);
 assert.equal(joinWrappedLines(expected), expected);
 assert.equal(joinWrappedLines('He said “Done.”\r\nNext\r\n line?\r\nYes.'), 'He said “Done.”\nNext line?\nYes.');
 assert.equal(joinWrappedLines('one\n \t\n two'), 'one\n \t\n two');
 assert.equal(joinWrappedLines(''), '');
});
