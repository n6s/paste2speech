import test from 'node:test';import assert from 'node:assert/strict';import {pastedImages} from '../public/clipboard-image.js';
test('paste event files support actual PNG/JPEG/WebP bytes without interpreting text or remote image URLs',()=>{
 for(const type of ['image/png','image/jpeg','image/webp']){const file=new File([new Uint8Array([1,2,3])],'image',{type});assert.deepEqual(pastedImages({files:[file]}),[file]);}
 assert.deepEqual(pastedImages({files:[],items:[{kind:'string',type:'text/html',getAsString(){throw Error('HTML must not be read or fetched');}}]}),[]);assert.deepEqual(pastedImages(null),[]);
});
test('paste event representations do not duplicate files; null items fall back to files and PDF is not intercepted',()=>{
 const image=new File(['synthetic'],'saved.png'),pdf=new File(['synthetic'],'file.pdf',{type:'application/pdf'});assert.deepEqual(pastedImages({items:[{kind:'file',getAsFile:()=>image}],files:[image]}),[image]);assert.deepEqual(pastedImages({items:[{kind:'file',getAsFile:()=>null}],files:[image,pdf]}),[image]);assert.deepEqual(pastedImages({files:[pdf]}),[]);
});
