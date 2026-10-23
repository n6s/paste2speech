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
  assert.ok(chunks.every(c => c.length <= 500 && c.length > 0));
  assert.equal(chunks.join('').replace(/\s/g,''), text.replace(/\s/g,''));
  assert.ok(chunks.every(c => !/[\uD800-\uDBFF]$/.test(c)));
 }
 assert.deepEqual(chunkText('   '), []);
});
test('early punctuation never forces a split inside a normal word', () => {
 const text = 'Intro: ' + 'stubborn inflation and resilient consumer spending '.repeat(8);
 const chunks = chunkText(text);
 assert.deepEqual(chunks.flatMap(c => c.split(/\s+/)), text.trim().split(/\s+/));
 assert.ok(chunks.every(c => c.length <= 500));
});
test('article labels and headings stay separate and inflation stays intact', () => {
 const input = 'Spotify\nApple Podcasts\n\n1. Fed raises rates for first time since 2023\n   The Federal Reserve raised interest rates Wednesday for the first time in more than three years as stubborn inflation and resilient consumer spending complicate its efforts to stabilize prices.';
 const cleaned = cleanText(input, {...defaults, joinLines: false});
 const chunks = chunkText(cleaned);
 assert.deepEqual(chunks.slice(0, 3), ['Spotify', 'Apple Podcasts', '1. Fed raises rates for first time since 2023']);
 assert.deepEqual(chunks.flatMap(c => c.split(/\s+/)), cleaned.split(/\s+/));
 assert.equal(chunks.length, 4);
 assert.equal(chunks[3], cleaned.split('\n').at(-1));
 assert.deepEqual(chunkText('Heading\nBody.'), ['Heading', 'Body.']);
});
test('sentences retain quotes, decimals, abbreviations, and line boundaries', () => {
 assert.deepEqual(chunkText('Heading\n\n“Ready?” “Yes!” The U.S. economy grew 3.5 percent. Use e.g. apples and pears. Done.'),
  ['Heading', '“Ready?”', '“Yes!”', 'The U.S. economy grew 3.5 percent.', 'Use e.g. apples and pears.', 'Done.']);
 assert.deepEqual(chunkText('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
 assert.deepEqual(chunkText('A\rB\r\nC'), ['A', 'B', 'C']);
});
test('long sentences prefer late clauses, then word boundaries', () => {
 const text = 'alpha beta gamma, delta epsilon zeta eta theta iota kappa lambda.';
 assert.equal(chunkText(text, 40)[0], 'alpha beta gamma,');
 const earlyClause = 'Hi, alpha beta gamma delta epsilon zeta eta theta.';
 assert.equal(chunkText(earlyClause, 40)[0], 'Hi, alpha beta gamma delta epsilon zeta');
 for (const input of [text, earlyClause, 'word '.repeat(300), '😀'.repeat(600), 'x'.repeat(1200)]) {
  for (const limit of [39, 180, 500]) {
   const parts = chunkText(input, limit);
   assert.ok(parts.every(p => p.length > 0 && p.length <= limit && !/[\uD800-\uDBFF]$/.test(p)));
   assert.equal(parts.join('').replace(/\s/g, ''), input.replace(/\s/g, ''));
  }
 }
 assert.throws(() => chunkText('text', 1), RangeError);
});
test('older browsers fall back to bounded punctuation and word chunks', t => {
 const original = Intl.Segmenter;
 Intl.Segmenter = undefined;
 t.after(() => { Intl.Segmenter = original; });
 assert.deepEqual(chunkText('Heading\nOne. Two.'), ['Heading', 'One. Two.']);
 const input = 'Intro: ' + 'ordinary words '.repeat(80);
 const parts = chunkText(input);
 assert.ok(parts.every(p => p.length <= 500));
 assert.deepEqual(parts.flatMap(p => p.split(/\s+/)), input.trim().split(/\s+/));
});
test('protects predictable abbreviations without swallowing real sentence endings', () => {
 for (const title of ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Rev.', 'Fr.', 'Sr.', 'Jr.']) {
  assert.deepEqual(chunkText(`${title} Smith arrived. Then left.`), [`${title} Smith arrived.`, 'Then left.']);
 }
 assert.deepEqual(chunkText('J. R. Smith arrived. I. Next section.'), ['J. R. Smith arrived.', 'I.', 'Next section.']);
 assert.deepEqual(chunkText('Jan. 5 was cold. No. 4 arrived.'), ['Jan. 5 was cold.', 'No. 4 arrived.']);
 assert.deepEqual(chunkText('We visited the U.S. Then left. Meet at 5 p.m. Tomorrow works. We bought fruit, etc. Then ate.'),
  ['We visited the U.S.', 'Then left.', 'Meet at 5 p.m.', 'Tomorrow works.', 'We bought fruit, etc.', 'Then ate.']);
 assert.deepEqual(chunkText('Dr.\nSmith arrived.'), ['Dr.', 'Smith arrived.']);
 const long = 'Dr. Smith ' + 'walked slowly '.repeat(100) + 'home.';
 assert.deepEqual(chunkText(long).flatMap(p => p.split(/\s+/)), long.split(/\s+/));
 assert.ok(chunkText(long).every(p => p.length <= 500));
});
test('quoted initials and titles stay together without merging the next sentence', () => {
 const first = 'Protect single uppercase initials followed by another initial or a capitalized name, so “J. R. Smith” stays together.';
 const second = 'Exclude the standalone pronoun “I.”';
 assert.deepEqual(chunkText(`${first} ${second}`), [first, second]);
 for (const [open, close] of [['“', '”'], ['"', '"'], ['‘', '’'], ["'", "'"], ['(', ')'], ['[', ']']]) {
  for (const name of ['J. R. Smith', 'Dr. Smith']) {
   const sentence = `We greeted ${open}${name}${close} today.`;
   assert.deepEqual(chunkText(`${sentence} Then left.`), [sentence, 'Then left.']);
  }
 }
});
test('fallback ignores protected punctuation when choosing a preferred break', t => {
 const original = Intl.Segmenter;
 Intl.Segmenter = undefined;
 t.after(() => { Intl.Segmenter = original; });
 for (const title of ['Dr.', 'J.', 'Jan.', 'No.']) {
  const next = ['Jan.', 'No.'].includes(title) ? '5' : 'Smith';
  const input = `Some ordinary words ${title} ${next} walked slowly along the street today`;
  assert.equal(chunkText(input, 45)[0], input.slice(0, 46).slice(0, input.slice(0, 46).lastIndexOf(' ')));
 }
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
test('fresh speech unpauses the native engine after cancellation and on retry', () => {
 const {synth,player:p}=setup();let resumes=0;
 synth.paused=true;synth.resume=()=>{resumes++;synth.paused=false;};
 synth.speak=u=>{assert.equal(synth.paused,false);synth.spoken.push(u);};
 p.start(['short fresh text'],{rate:1});assert.equal(resumes,1);
 const old=synth.spoken[0];old.onerror({error:'synthesis-failed'});assert.equal(p.state,'paused');
 synth.paused=true;p.resume({rate:1});assert.equal(resumes,2);assert.equal(synth.spoken.length,2);
 old.onend();old.onerror({error:'synthesis-failed'});assert.equal(p.state,'playing');assert.equal(p.index,0);
 p.stop();synth.paused=true;p.start(['different short text'],{rate:1});assert.equal(resumes,3);p.stop();
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
 assert.equal(cleanText(input, {...defaults, joinLines: false}), input);
 assert.equal(joinWrappedLines(expected), expected);
 assert.equal(joinWrappedLines('He said “Done.”\r\nNext\r\n line?\r\nYes.'), 'He said “Done.”\nNext line?\nYes.');
 assert.equal(joinWrappedLines('one\n \t\n two'), 'one\n \t\n two');
 assert.equal(joinWrappedLines(''), '');
});

const keepContent = {...defaults, code: false, tables: false, joinLines: true};
test('Markdown headings create boundaries before prose joining', () => {
 const input = 'Before\n# Title ##\nA wrapped\nparagraph\nUnderlined\n===\nMore\nwords.';
 assert.equal(cleanText(input, keepContent), 'Before\n\nTitle\n\nA wrapped paragraph\n\nUnderlined\n\nMore words.');
 assert.equal(cleanText('# Title\nBody\nwrap', {...keepContent, joinLines:false}), 'Title\n\nBody\nwrap');
 assert.equal(cleanText('Title\n---\nBody', keepContent), 'Title\n\nBody');
 assert.equal(cleanText('# Title\nBody\nwrap', {...keepContent, markdown:false}), '# Title\n\nBody wrap');
});
test('list items, nested items, numbers and task status survive joining', () => {
 const input = '- First\n  continuation\n    - Nested\n      continuation\n- [ ] Pending\n- [X] Finished\n3. Third\n   continuation';
 assert.equal(cleanText(input, keepContent), 'First continuation\n\nNested continuation\n\nUnchecked: Pending\n\nChecked: Finished\n\n3. Third continuation');
 assert.equal(cleanText('- First\n  continuation\n- Second', {...keepContent, joinLines:false}), 'First\ncontinuation\n\nSecond');
 assert.deepEqual(chunkText(cleanText('1. First\n2. Second', keepContent)), ['1. First', '2. Second']);
 assert.equal(cleanText('- First\n  continuation\n- Second', {...keepContent, markdown:false}), '- First continuation\n\n- Second');
});
test('retained tables read rows with pauses and preserve empty cells and escaped pipes', () => {
 const input = 'Before\n| Name | Status | Note |\n| --- | :---: | ---: |\n| Alice | | A\\|B |\n| Bob | Ready | |\nAfter';
 assert.equal(cleanText(input, keepContent), 'Before\n\nName; Status; Note\n\nAlice; ; A|B\n\nBob; Ready; \n\nAfter');
 assert.deepEqual(chunkText(cleanText(input, keepContent)), ['Before','Name; Status; Note','Alice; ; A|B','Bob; Ready;','After']);
 assert.equal(cleanText('A | B\n--- | ---\nx | y', keepContent), 'A; B\n\nx; y');
 const ambiguous = '| A | B |\n| --- | --- |\n| one | two | three |';
 assert.equal(cleanText(ambiguous, keepContent), ambiguous);
 const inlineCode = '| A | B |\n| --- | --- |\n| `x|y` | z |';
 assert.equal(cleanText(inlineCode, keepContent), inlineCode);
 assert.equal(cleanText(input, {...keepContent, markdown:false}), input.replace('Before\n','Before\n\n').replace('\nAfter','\n\nAfter'));
 assert.equal(cleanText(input, {...keepContent, tables:true}), 'Before\n\nAfter');
 assert.equal(cleanText('Choose A | B\nnext line', keepContent), 'Choose A | B next line');
});
test('retained code is opaque to every prose cleanup option', () => {
 const body = '    **bold**  https://example.com\n\t# heading 😀\n\n\nturn1search0\n- item';
 for (const fence of ['```js','~~~~python']) {
  const closing = fence.startsWith('`') ? '````' : '~~~~';
  const input = `Before\n${fence}\n${body}\n${closing}\nAfter`;
  assert.equal(cleanText(input, {...keepContent, emoji:true}), `Before\n\n${body}\n\nAfter`);
  assert.equal(cleanText(input, {...keepContent, markdown:false}), `Before\n\n${fence}\n${body}\n${closing}\n\nAfter`);
  assert.equal(cleanText(input, {...keepContent, code:true}), 'Before\n\nAfter');
 }
 assert.equal(cleanText('```js\n  unfinished\n x', keepContent), '  unfinished\n x');
 assert.equal(cleanText('```\n\n  x\n\n```', keepContent), '\n  x\n');
 assert.equal(cleanText('Before\n    x  =  1\n\ty()\nAfter', keepContent), 'Before\n\n    x  =  1\n\ty()\n\nAfter');
});
test('all switches off preserve literal whitespace, structures and content', () => {
 const input = '  # Heading\n\n- [ ] Task\n  continuation\n```\n  x  =  1\n```\n| A | B |\n| --- | --- |\n| x | y |\n';
 assert.equal(cleanText(input, Object.fromEntries(Object.keys(defaults).map(key => [key,false]))), input);
});
test('removing blocks does not join neighboring prose', () => {
 const input = 'Before\n```\nx\n```\nAfter\n| A | B |\n| --- | --- |\n| x | y |\nEnd';
 assert.equal(cleanText(input, {...defaults, joinLines:true}), 'Before\n\nAfter\n\nEnd');
 assert.equal(joinWrappedLines('# Heading\nwrapped\nprose'), '# Heading\n\nwrapped prose');
});

test('nested list items are not removed as indented code', () => {
 assert.equal(cleanText('- Parent\n    - Child\n      continuation', {...defaults, joinLines:true}), 'Parent\n\nChild continuation');
});
test('table URL cleanup works even when Markdown syntax is retained', () => {
 const input = '| A | B |\n| --- | --- |\n| https://example.com | kept |';
 assert.equal(cleanText(input, {...keepContent, markdown:false}), '| A | B |\n| --- | --- |\n| | kept |');
});


test('newsletter all-caps titles stay separate while body wraps join', () => {
 const title = 'TOGETHER WITH UNWRAP';
 const body = "🚒 See what's burning before it becomes your next fire drill";
 const input = `${title}\n${body}`;
 assert.equal(defaults.joinLines, true);
 assert.equal(cleanText(input), `${title}\n\n${body}`);
 assert.deepEqual(chunkText(cleanText(input)), [title, body]);
 assert.equal(cleanText(input, {...defaults, emoji:true}), `${title}\n\n${body.slice(3)}`);
 assert.equal(cleanText(input, {...defaults, joinLines:false}), input);
 assert.equal(joinWrappedLines(`Intro ends here.\n${input}\nwith a wrapped continuation`), `Intro ends here.\n\n${title}\n\n${body} with a wrapped continuation`);
 assert.equal(joinWrappedLines('NASA\nResearch continues'), 'NASA Research continues');
 assert.equal(joinWrappedLines('THIS IS WRAPPED\nALL CAPS PROSE'), 'THIS IS WRAPPED ALL CAPS PROSE');
 assert.equal(cleanText('```\n'+input+'\n```', {...defaults, code:false}), input);
 assert.equal(joinWrappedLines(joinWrappedLines(input)), `${title}\n\n${body}`);
});


test('single all-caps newsletter headings split before emoji-led titles', () => {
 const input = 'GOOGLE\n🧠 Google DeepMind starts an AGI think tank';
 const expected = 'GOOGLE\n\n🧠 Google DeepMind starts an AGI think tank';
 assert.equal(cleanText(input), expected);
 assert.equal(joinWrappedLines(input), expected);
 assert.deepEqual(chunkText(cleanText(input)), ['GOOGLE', '🧠 Google DeepMind starts an AGI think tank']);
 assert.equal(cleanText(input, {...defaults, emoji:true}), expected.replace('🧠 ', ''));
 assert.equal(cleanText(input, {...defaults, joinLines:false}), input);
 assert.equal(cleanText('NASA\nResearch continues'), 'NASA Research continues');
 assert.equal(cleanText('Google\n🧠 Research continues'), 'Google 🧠 Research continues');
 assert.equal(cleanText('GOOGLE\n🧠 ALL CAPS CONTINUATION'), 'GOOGLE 🧠 ALL CAPS CONTINUATION');
 assert.equal(cleanText('```\n' + input + '\n```', {...defaults, code:false}), input);
 assert.equal(cleanText(cleanText(input)), expected);
});

test('newsletter Markdown becomes two clean prose paragraphs', async () => {
 const {readFile} = await import('node:fs/promises');
 const input = await readFile(new URL('./fixtures/newsletter-tools.md', import.meta.url), 'utf8');
 const item = 'Incogni - Remove your personal data from the web so scammers and identity thieves can’t access it. Use code RUNDOWN to get 55% off*';
 assert.equal(cleanText(input), 'Trending AI Tools\n\n' + item);
 assert.equal(cleanText(input, {...defaults, joinLines:false}), 'Trending AI Tools\n\n' + item);
 const plain = '🛠️ Trending AI Tools\n\n🔒 ' + item;
 assert.equal(cleanText(plain), plain);
 assert.equal(cleanText(plain, {...defaults, emoji:true}), 'Trending AI Tools\n\n' + item);
 assert.equal(cleanText(input, Object.fromEntries(Object.keys(defaults).map(k => [k,false]))), input);
});

test('short empty layout tables vanish without joining neighboring blocks', () => {
 for (const separator of ['-', ':-', '-:', ':-:']) {
  const table = '| &nbsp; |\n| '+separator+' |';
  assert.equal(cleanText('Before\n'+table+'\nAfter'), 'Before\n\nAfter');
  assert.ok(cleanText(table, {...defaults, tables:false}).includes('|'));
 }
 assert.equal(cleanText('| A |\n| - |'), '| A | | - |');
 assert.equal(cleanText('| |\n| - |\n| data |'), '| | | - | | data |');
 assert.equal(cleanText('Before\n| |\n| - |\n# Heading\n- Item\n  continuation'), 'Before\n\nHeading\n\nItem continuation');
});

test('entities decode once as literal text, without creating Markdown', () => {
 assert.equal(cleanText('**A&nbsp;B** &amp; &quot;yes&quot; &apos;no&apos; &#x35;&#53; &#x1F9E0;'), 'A B & "yes" \'no\' 55 🧠');
 assert.equal(cleanText('&#42;&#42;literal&#42;&#42;'), '**literal**');
 assert.equal(cleanText('&#35; Heading\n&#45; item'), '# Heading - item');
 assert.equal(cleanText('&gt; literal &lt;b&gt;tag&lt;/b&gt;'), '> literal <b>tag</b>');
 assert.equal(cleanText('&amp;lt; &unknown; &#x110000; &#xD800; &#0;'), '&lt; &unknown; &#x110000; &#xD800; &#0;');
 assert.equal(cleanText('&amp;lt;', {...defaults, emoji:true}), '&lt;');
 assert.equal(cleanText('**&#65;**', {...defaults, markdown:false}), '**A**');
 const code = '```\n&#65; **literal**\n```';
 assert.equal(cleanText(code, {...defaults, code:false}), '&#65; **literal**');
 assert.equal(cleanText(code, {...defaults, code:false, markdown:false}), code);
});

test('measurement sentence stays intact for speech-only pronunciation handling', () => {
 const sentence = 'It can lift 50 lb. and reach 7.2-ft. shelves, with its battery giving 90 min runtime on just 9 min of charge — fast enough, Agility says, for 20+ hours of work per day.';
 assert.equal(cleanText('- ' + sentence), sentence);
 assert.deepEqual(chunkText(sentence), [sentence]);
});

test('approximation tildes become about only in prose before numbers', () => {
 const text = 'Waymo is partnering with taxi-app giant GO and nearly century-old operator Nihon Kotsu, starting with a small fleet before scaling to \\~100 vehicles.';
 assert.equal(cleanText(text), text.replace('\\~100', 'about 100'));
 for (const value of ['~100', '~ 100', '~\t100', '~7.2', '~100%']) {
  assert.equal(cleanText('Approximately (' + value + ').'), 'Approximately (about ' + value.replace(/^~\s*/, '') + ').');
 }
 for (const text of ['~/Documents', '/tmp/~100', '~100/file', 'name~100', 'x = ~mask', '~word', '~~100~~']) {
  assert.ok(!cleanText(text).includes('about'));
 }
 const urls = 'https://example.com/~100 www.example.com/~100';
 assert.equal(cleanText(urls, {...defaults,urls:false}), urls);
 assert.equal(cleanText('**~100** and *~ 100*'), 'about 100 and about 100');
 assert.equal(cleanText('`~100` and ~100'), '~100 and about 100');
 assert.equal(cleanText('`\\~100` and ~100'), '\\~100 and about 100');
 assert.equal(cleanText('```\n~100\n```', {...defaults,code:false}), '~100');
 assert.equal(cleanText('    ~100', {...defaults,code:false}), '    ~100');
 assert.equal(cleanText('~100', {...defaults,markdown:false}), '~100');
});

test('newsletter dollar suffixes become exact currency words', () => {
 const examples = [
  ['$300M', 'three hundred million dollars'],
  ['$1.78M', 'one point seven eight million dollars'],
  ['$140.2M', 'one hundred forty point two million dollars'],
  ['$2.5B', 'two point five billion dollars'],
  ['$88M', 'eighty eight million dollars'],
  ['\\~$48M', 'about forty eight million dollars'],
  ['$8.5B', 'eight point five billion dollars'],
  ['$20B', 'twenty billion dollars'],
  ['$1B', 'one billion dollars'],
  ['$7.6B', 'seven point six billion dollars'],
  ['$1.4B', 'one point four billion dollars'],
  ['$337M', 'three hundred thirty seven million dollars'],
  ['$138B', 'one hundred thirty eight billion dollars'],
  ['$10M', 'ten million dollars'],
 ];
 for (const [input, expected] of examples) {
  assert.equal(cleanText(input), expected);
  assert.equal(cleanText('Raised **'+input+'**.'), 'Raised '+expected+'.');
 }
 assert.equal(cleanText('~ $48M and ~$100'), 'about forty eight million dollars and about $100');
 assert.equal(cleanText('$1.02B'), 'one point zero two billion dollars');
 assert.equal(cleanText('$1,079M'), 'one thousand seventy nine million dollars');
 assert.equal(cleanText('$2025M'), 'two thousand twenty five million dollars');
 assert.equal(cleanText('$0M'), 'zero million dollars');
 assert.equal(cleanText('$1000000000000000000M'), '$1000000000000000000M');
});

test('currency expansion preserves code, URLs, identifiers and bare units', () => {
 const text = '300 MB 300M 2B $300MB $10Million a$10M $10M_test $10M/path $1,20M $1.2.3M';
 assert.equal(cleanText(text), text);
 const urls = 'https://example.com/$10M www.example.com/~$48M';
 assert.equal(cleanText(urls, {...defaults,urls:false}), urls);
 assert.equal(cleanText('`$300M` and $300M'), '$300M and three hundred million dollars');
 assert.equal(cleanText('`\\~$48M`'), '\\~$48M');
 assert.equal(cleanText('```\n$300M\n~$48M\n```', {...defaults,code:false}), '$300M\n~$48M');
 assert.equal(cleanText('    $300M', {...defaults,code:false}), '    $300M');
 assert.equal(cleanText('$300M', {...defaults,markdown:false}), '$300M');
});

test('plain newsletter question labels preserve the preceding heading', () => {
 const entries = [
  ['September Edition A', 'Q1 \u00a0·\u00a0 You find a site offering the iPhone 18 Pro at 30% off retail with "limited pre-order slots." The site looks professional, has reviews, and accepts Apple Pay. What should you check before paying?'],
  ['August Edition B', 'Q1 \u00a0·\u00a0 You get a WhatsApp message from an unknown number: "Hi, sorry to bother you — I think I have the wrong number, but since we\'re talking, I work in crypto investments and have a great opportunity if you\'re interested." What is this?'],
  ['August Edition A', 'Q1 \u00a0·\u00a0 You are about to check in for a flight and get a text: "Your booking requires urgent confirmation. Click here or your seat will be released in 30 minutes." The link leads to a page that looks exactly like the airline\'s site. What do you do?'],
 ];
 const source = entries.map(([heading,question]) => heading+'\n'+question).join('\n\n');
 const expected = entries.flatMap(([heading,question]) => [heading,question.replace(/[ \u00a0]+/g,' ')]).join('\n\n');
 assert.equal(cleanText(source), expected);
 assert.equal(cleanText(source, {...defaults,markdown:false}), expected);
 assert.equal(cleanText(expected), expected);
 assert.equal(cleanText('September Edition A\n**Q1 ·** A wrapped\nquestion continues here.\nQ2 · A second\nquestion.'), 'September Edition A\n\nQ1 · A wrapped question continues here.\n\nQ2 · A second question.');
 assert.equal(joinWrappedLines('Heading\nQ12 · Wrapped\nquestion'), 'Heading\n\nQ12 · Wrapped question');
 assert.equal(cleanText('Ordinary prose\nmentions Q1 · inline'), 'Ordinary prose mentions Q1 · inline');
 assert.equal(cleanText('Results from\nQ1 grew steadily.'), 'Results from Q1 grew steadily.');
 assert.equal(cleanText('Heading\nQ1 · Question', {...defaults,joinLines:false}), 'Heading\nQ1 · Question');
 assert.equal(cleanText('```\nHeading\nQ1 · Code\n```', {...defaults,code:false}), 'Heading\nQ1 · Code');
});

test('answer labels become separate paragraphs without losing their letters', () => {
 const question = 'Q2 · Someone you met online mentions an investment. What is the clearest red flag?';
 const options = ['A) They met you online rather than in person', 'B) Building trust over weeks then steering the relationship toward a financial opportunity is the exact playbook of a romance investment scam', 'C) They are talking about crypto, which is inherently risky', 'D) They offered to help you personally rather than sending a link'];
 const answer = '**Correct Answer: B)** Building trust over weeks is the playbook.';
 const why = '**Why:** Romance investment scams often start with attention.';
 const result = cleanText([question,...options,answer,why].join('\n'));
 assert.deepEqual(result.split('\n\n'), [question,...options,'Correct Answer: B) Building trust over weeks is the playbook.\nWhy: Romance investment scams often start with attention.']);
 assert.deepEqual(cleanText('A) First wrapped\n  answer\nB) Second choice').split('\n\n'),['A) First wrapped answer','B) Second choice']);
 assert.equal(cleanText('A)\u00a0First\nB)\u00a0Second'), 'A) First\n\nB) Second');
 assert.equal(cleanText('The company (founded in 2020)\nmakes robots.'),'The company (founded in 2020) makes robots.');
 assert.equal(cleanText('```\nA) code\nB) code\n```',{...defaults,code:false}),'A) code\nB) code');
 const unchanged=Object.fromEntries(Object.keys(defaults).map(k=>[k,false]));
 assert.equal(cleanText('A) First\nB) Second',unchanged),'A) First\nB) Second');
});

test('named ChatGPT links preserve prose labels independently of URL/reference toggles',()=>{
 const a='National Weather Service Grand Junction office',b='Salt Lake City forecast office',start='For updated conditions, the most useful resources are the ';
 for(const kind of ['link','cite'])for(const markdown of [true,false])for(const citations of [true,false])for(const urls of [true,false]){
  const input=start+`${kind}https://example.invalid/a${a} and the ${kind}https://example.invalid/b${b}.`;
  const options={...defaults,markdown,citations,urls},output=cleanText(input,options);
  const expected=markdown||citations||urls?start+a+(urls?'':' (https://example.invalid/a)')+' and the '+b+(urls?'':' (https://example.invalid/b)')+'.':input;
  assert.equal(output,expected);assert.ok(chunkText(output).join(' ').includes(a));assert.ok(chunkText(output).join(' ').includes(b));
 }
 assert.equal(cleanText('[Office](https://example.invalid/a)'),'Office');
 assert.equal(cleanText('[Office](https://example.invalid/a)',{...defaults,urls:false}),'Office (https://example.invalid/a)');
 assert.equal(cleanText('Fact citeturn0search0.'),'Fact .');
 assert.equal(cleanText('Before linknot-a-urlName after',{...defaults,citations:false}),'Before linknot-a-urlName after');
 assert.equal(cleanText('Before linkhttps://example.invalid/aName',{...defaults,citations:false}),'Before linkName');
});
test('named link labels retain Unicode, punctuation and literal code without becoming live markup',()=>{
 const input='See linkhttps://example.invalid/forecast?q=a&b=2Grand Junction &amp; Salt Lake — café [office].';
 assert.equal(cleanText(input),'See Grand Junction & Salt Lake — café [office].');
 assert.equal(cleanText(input,{...defaults,urls:false}),'See Grand Junction & Salt Lake — café [office] (https://example.invalid/forecast?q=a&b=2).');
 const literal='linkhttps://example.invalid/aLabel';assert.equal(cleanText('`'+literal+'`'),literal);assert.equal(cleanText('```\n'+literal+'\n```',{...defaults,code:false}),literal);
});
test('explicit browser section start overrides Pause and word offset while late callbacks stay retired',()=>{
 const {synth,player:p}=setup();p.start(['First sentence.','Second sentence.'],{rate:1});const old=synth.spoken[0];old.onboundary({name:'word',charIndex:6});p.pause();p.start(p.chunks,{rate:1},1);assert.equal(p.state,'playing');assert.equal(p.index,1);assert.equal(p.offset,0);assert.equal(synth.spoken.at(-1).text,'Second sentence.');old.onend();assert.equal(p.index,1);p.stop();
});
