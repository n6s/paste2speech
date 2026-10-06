import test from 'node:test';
import assert from 'node:assert/strict';
import {discardLegacyPositions} from '../public/reader-reload.js';
test('reload retires only legacy cursors and preserves paid IDs and unrelated tab storage',()=>{
 const values=new Map([['paste2speech.position.one','valid'],['paste2speech.video.one','paid IDs'],['paste2speech.position.two','malformed'],['unrelated','keep']]);
 const storage={get length(){return values.size},key:i=>[...values.keys()][i],removeItem:k=>values.delete(k)};
 discardLegacyPositions(storage);discardLegacyPositions(storage);assert.deepEqual([...values],[['paste2speech.video.one','paid IDs'],['unrelated','keep']]);
});
test('blocked tab storage cannot prevent a fresh idle player',()=>{
 assert.doesNotThrow(()=>discardLegacyPositions({get length(){throw Error('blocked')}}));
 assert.doesNotThrow(()=>discardLegacyPositions({length:1,key:()=> 'paste2speech.position.old',removeItem(){throw Error('blocked')}}));
});
