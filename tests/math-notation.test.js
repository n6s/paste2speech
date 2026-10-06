import test from 'node:test';import assert from 'node:assert/strict';
import {mathSpans,transformMath} from '../public/math-notation.js';
import {cleanText,defaults,chunkText,readingCharacters} from '../public/text.js';
import {reconstruct,exportText,plain} from '../public/document-reconstruct.js';
import {sourceCounts} from '../cloudflare/prepared/ledger.js';import {captions} from '../cloudflare/prepared/mp3.js';
const skip={...defaults,math:true},off={...defaults,math:false};
const formulas=[String.raw`\(x_{1}+y_{2}=z^2\)`,String.raw`\[\frac{1}{\frac{x+1}{y}}\]`,String.raw`$x^2$`,String.raw`$$\frac{a}{b}$$`,String.raw`\begin{aligned}x &= 2\\x^2 &= 4\end{aligned}`,String.raw`\begin{array}{cc}x & y\\x^2 & y^2\end{array}`];
test('balanced explicit LaTeX is omitted only when selected; source and default cleanup stay intact',()=>{
 for(const math of formulas){assert.equal(mathSpans(math).length,1);assert.equal(cleanText(math,skip),'');assert.equal(cleanText(math,off),math);assert.equal(transformMath(math).restore(transformMath(math).text),math);}
 const text=`Before. ${formulas[0]} After.\n\n${formulas[1]}\n\nEnd.`;assert.equal(cleanText(text,skip),'Before. After.\n\nEnd.');assert.equal(text.includes(formulas[1]),true);
});
test('currency, escaped dollars, code, URLs, plain symbols and malformed delimiters cannot become math skips',()=>{
 const inputs=[String.raw`Costs $5 and $10, or $1,000.50.`,String.raw`Costs $5 + tax and $10.`,String.raw`Escaped \$x^2\$ remains.`,String.raw`https://example.test/$x^2$`,String.raw`www.example.test/\(x\)`,String.raw`\(x_{1}\]`,String.raw`\[\frac{1}{2}`,String.raw`\(x_{1\)`,String.raw`$x^2`,String.raw`\begin{array}{cc}x&y`,String.raw`\begin{array}x\end{aligned}`,String.raw`x_{1}+y_{2}=z^2`,String.raw`\frac{a}{b}`,'`$x^2$`','``\(x\)``','```tex\n$x^2$\n```','~~~tex\n\\[x\\]\n~~~','    $x^2$'];
 for(const input of inputs){assert.equal(mathSpans(input).length,0,input);assert.equal(transformMath(input,true).text,input,input);}
 assert.equal(mathSpans('Unclosed code\n```tex\n$x^2$').length,0);
 assert.equal(cleanText('`$x^2$` and \\(y\\)',{...skip,code:false}),'$x^2$ and');
});
test('balanced nested environments and braces are retained or skipped without flattening their original layout',()=>{
 const math=String.raw`\begin{array}{cc}
    \frac{x_{1}}{y_{2}} & \begin{aligned}x&=2\\y&=3\end{aligned}\\
    x^2 & y^2
\end{array}`;
 assert.equal(cleanText(math,off),math);assert.equal(cleanText(math,skip),'');const raw={pages:[{index:0,blocks:[{type:'text',content:`Before.\n${math}\nAfter.`}]}]},snapshot=JSON.stringify(raw),result=reconstruct(raw);
 for(const markdown of [false,true])assert.ok(exportText(result.articles,markdown).includes(math));assert.equal(JSON.stringify(raw),snapshot);
 assert.equal(plain(String.raw`x_{1}+y_{2}=z^2`),String.raw`x_{1}+y_{2}=z^2`);assert.equal(plain('_emphasis_ and **bold**'),'emphasis and bold');
});
test('skipped math uses the same cleaned chunks for captions, browser speech and character allowance',()=>{
 const original=`Read this. ${formulas[0]} Then stop.`,cleaned=cleanText(original,skip),chunks=chunkText(cleaned),counts=readingCharacters(original,chunks);
 assert.equal(chunks.join(' '),'Read this. Then stop.');assert.deepEqual(sourceCounts(chunks),chunks.map(c=>[...c].length));assert.equal(counts.submitted,sourceCounts(chunks).reduce((a,b)=>a+b,0));assert.equal(counts.before,[...original].length);
 const vtt=captions(chunks,{starts:chunks.map((_,i)=>i),duration:chunks.length});assert.doesNotMatch(vtt,/x_|y_|z\^/);assert.match(vtt,/Read this/);
});
test('sentinel-like source and long escaped inputs do not collide or lose original notation',()=>{
 const text='\uE0100\uE011 '+formulas[0];assert.equal(cleanText(text,off),text);assert.equal(transformMath('\\'.repeat(100000)+'(x)',true).text,'\\'.repeat(100000)+'(x)');
});
