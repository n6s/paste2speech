import test from 'node:test';import assert from 'node:assert/strict';import {explicitMathSpans,assembleMathPreview} from '../public/math-speech-spans.js';import {cleanText} from '../public/text.js';
test('explicit OCR delimiters and MathML are recognized; ordinary inline math stays literal',()=>{
 const source=String.raw`Difference $a^2 - b^2$. Polynomial $ax^2 + bx + c$. Multiply $a \cdot c$, add $b$. $$1^2=1 \quad 6^2=36$$. Normal x^2 + 2x + 1 and 1/2x stay unchanged.`;
 const spans=explicitMathSpans(source);assert.equal(spans.length,5);const preview=assembleMathPreview(source,spans,spans.map(()=>({speech:'MATH'})));assert.match(preview.text,/Normal x\^2 \+ 2x \+ 1 and 1\/2x stay unchanged/);assert.equal(source.includes('$ax^2 + bx + c$'),true);
 const xml='<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';assert.equal(explicitMathSpans('Before '+xml+' after.')[0].kind,'mathml');
});
test('currency, escaped delimiters, code fences, inline code and URL dollar content are preserved',()=>{
 for(const source of [String.raw`Pay $5 and $10. Pay $5 + $10. Escaped \$x\$ is literal.`, '`$x^2$`', '```tex\n$x^2$\n```', 'https://example.com/$x^2$'])assert.deepEqual(explicitMathSpans(source),[]);
});
test('skip wins in preview and preserves boundaries; failures retain exact notation; existing reader cleanup is unchanged',()=>{
 const source='Before $x^2$ after.\n\n$$x+1$$\n\nLast.',spans=explicitMathSpans(source);const skipped=assembleMathPreview(source,spans,[],{skip:true});assert.doesNotMatch(skipped.text,/x\^2|x\+1/);assert.match(skipped.text,/Before +after/);assert.match(skipped.text,/Last/);assert.equal(assembleMathPreview(source,spans,spans.map(()=>({warning:'Unsupported.'}))).text,source);
 assert.match(cleanText(source,{markdown:false,math:false}),/\$x\^2\$/);
});
test('malformed delimiters are not guessed and bounded source/formula counts fail without truncation',()=>{
 for(const source of ['$x^2',String.raw`$\frac{a}{b$`,'<math><mi>x</mi>'])assert.equal(explicitMathSpans(source).length,0);
 assert.throws(()=>explicitMathSpans('x'.repeat(100001)),/100,000/);assert.throws(()=>explicitMathSpans('$x$ '.repeat(65)),/64 formulas/);
});
