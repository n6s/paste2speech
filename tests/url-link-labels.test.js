import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText,defaults} from '../public/text.js';
for(const [label,host] of [
 ['https://Example.COM/deep/path?q=one&x=2#section','example.com'],
 ['http://example.com:8080/a','example.com'],['www.example.com/a','www.example.com'],
 ['example.com/path?q=x#y','example.com'],['//sub.example.com/a','sub.example.com'],
 ['https://例え.テスト/記事','xn--r8jz45g.xn--zckzah'],['https://[2001:db8::1]:8443/a','[2001:db8::1]'],
 ['https://display.example/a','display.example'],['https://name:password@real.example/a','real.example']
])test('URL-shaped link label speaks hostname: '+label,()=>{
 const source=`See [${label}](https://destination.example/path), then continue.`;
 for(const markdown of [true,false])assert.equal(cleanText(source,{...defaults,markdown}),`See ${host}, then continue.`);
 assert.ok(source.includes('https://destination.example/path'));
 assert.equal(cleanText(source,{...defaults,urls:false}),`See ${label} (https://destination.example/path), then continue.`);
});
test('human labels, email, malformed/non-web labels and literal code retain their meaning',()=>{
 for(const label of ['Read the full report','support@example.com','Example.com is useful','2026.10','ftp://files.example/a','not/a/url'])assert.equal(cleanText(`[${label}](mailto:support@example.com)`),label);
 assert.equal(cleanText('Email support@example.com. Plain example.com/path stays.'),'Email support@example.com. Plain example.com/path stays.');
 assert.equal(cleanText('`[https://example.com/a](https://example.com/a)`'),'[https://example.com/a](https://example.com/a)');
 assert.equal(cleanText('Before https://example.com/a after.'),'Before after.');
});
test('ChatGPT named references, reference-style Markdown and surrounding punctuation',()=>{
 assert.equal(cleanText('See linkhttps://destination.example/ahttps://label.example/path?x=1&y=2.'),'See label.example.');
 assert.equal(cleanText('[www.example.com/path][site]!\n\n[site]: https://example.com/path'),'www.example.com!');
 assert.equal(cleanText('([https://example.com/a%28b%29?x=1&amp;y=2#z](https://example.com/a)).'),' (example.com).'.trim());
 assert.equal(cleanText('[Report](https://example.com/a?x=1#z).'),'Report.');
});

test('saved speech-text version compatibility retains the former URL treatment',()=>{assert.equal(cleanText('Before [https://example.com/path](https://example.com/path) after.',defaults,{urlLabels:false}),'Before after.');});

test('legacy IPv6 labels retain the former parser result to match existing paid audio',()=>{assert.equal(cleanText('See [https://[2001:db8::1]:8443/a](https://destination.example/path), then continue.',defaults,{urlLabels:false,expanded:false}),'See [ then continue.');});

test('legacy reference-style URL labels keep their former speech identity',()=>{assert.equal(cleanText('See [www.example.com/path][site]! next.',defaults,{urlLabels:false,expanded:false}),'See [ next.');});
