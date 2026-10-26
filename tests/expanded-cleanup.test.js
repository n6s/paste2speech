import test from 'node:test';import assert from 'node:assert/strict';import{cleanText,defaults,chunkText}from'../public/text.js';
const options={...defaults,emoji:true,tables:false,code:false};
test('decorative repeated triangles/arrow variants are contextual, not a Unicode purge',()=>{
 for(const source of ['▶️▶️ Important update','▸▸ Next story','➡️ Read this article','→ Read this article'])assert.ok(!/[▶▸➡→\uFE0F]/u.test(cleanText(source,options)));
 assert.equal(cleanText('Read this ▸ next section',options),'Read this next section');
 assert.equal(cleanText('Gum disease ➜ kidney health.',options),'Gum disease to kidney health.');
 assert.equal(cleanText('Préparer le texte ➜ écouter la suite',options),'Préparer le texte to écouter la suite');
 assert.equal(cleanText('café, naïve, 中文, العربية, Δx, −12, $50, well-being.',options),'café, naïve, 中文, العربية, Δx, −12, $50, well-being.');
});
test('headings and whole-line emphasis wrappers lose markup without stripping semantic hashes/operators',()=>{
 for(const [source,want]of [['*** # Heading ***','Heading'],['**** Heading ****','Heading'],['##Title','Title'],['##\u00a0Title','Title'],['Use **bold** and *italic*.','Use bold and italic.']])assert.equal(cleanText(source,options),want);
 for(const source of ['a * b * c','2 ** 3 ** 4','12 ** 3 ** 24','-2.5 ** 3 ** 10','x → y','x → 0','Δx → Δy','C# and #hashtag #123','before | after','negative -12 and well-being'])assert.equal(cleanText(source,options),source);
});
test('retained short/aligned/ragged tables speak every cell with row and cell pauses',()=>{
 const source='| Name | Amount |\n| :- | -: |\n| café | -$12 |\n| 中文 | €50 | extra |';
 const want='Name; Amount\n\ncafé; -$12\n\n中文; €50; extra';assert.equal(cleanText(source,options),want);assert.deepEqual(chunkText(want),['Name; Amount','café; -$12','中文; €50; extra']);
 assert.equal(cleanText(source,{...options,tables:true}),'');assert.equal(cleanText(source,{...options,markdown:false}),source);
 assert.equal(cleanText('a | b\n-12 | 20',options),'a | b -12 | 20');
});
test('code, math and unselected switches remain intact; saved versions retain former speech',()=>{
 for(const source of ['`Read this → next section`','\\(Read this → next section\\)','```\n##Title\na * b * c\n```'])assert.ok(cleanText(source,options).includes(source.startsWith('```')?'a * b * c':source.startsWith('`')?'Read this → next section':source));
 const legacy='| A | B |\n| - | - |\n| 1 | 2 |';assert.equal(cleanText(legacy,options,{expanded:false}),legacy.replace(/\n/g,' '));
 assert.equal(cleanText('▸▸ Next story',{...options,markdown:false,emoji:false}),'▸▸ Next story');
});
