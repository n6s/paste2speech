import test from 'node:test';
import assert from 'node:assert/strict';
import {readPosition,writePosition,forgetPosition} from '../public/reading-position.js';
function storage(){const m=new Map();return {m,getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
test('tab cursors round-trip exact section offsets without reading text and forget explicitly',()=>{
 const s=storage();writePosition('identity',2,3.25,s);assert.equal(readPosition('identity',3,s).offset,3.25);assert.equal(readPosition('identity',3,s).index,2);assert.equal(readPosition('other',3,s),null);forgetPosition('identity',s);assert.equal(readPosition('identity',3,s),null);
});
test('malformed, out-of-range and expired cursors cannot restore',()=>{
 const s=storage();for(const p of [{version:2,index:0,offset:1,updated:Date.now()},{version:1,index:9,offset:1,updated:Date.now()},{version:1,index:-1,offset:1,updated:Date.now()},{version:1,index:0,offset:-1,updated:Date.now()},{version:1,index:0,offset:1,updated:Date.now()-86400001}]){s.setItem('paste2speech.position.identity',JSON.stringify(p));assert.equal(readPosition('identity',3,s),null);}s.setItem('paste2speech.position.identity','bad JSON');assert.equal(readPosition('identity',3,s),null);
});
test('blocked cursor storage never interrupts playback code',()=>{
 const s={getItem(){throw Error('blocked')},setItem(){throw Error('full')},removeItem(){throw Error('blocked')}};assert.doesNotThrow(()=>writePosition('identity',0,1,s));assert.equal(readPosition('identity',1,s),null);assert.doesNotThrow(()=>forgetPosition('identity',s));
});
