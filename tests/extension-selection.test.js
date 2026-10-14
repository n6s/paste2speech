import test from 'node:test';
import assert from 'node:assert/strict';
import {createMenuSelectionHandler} from '../extension/selection.js';
const info = {menuItemId: 'read', selectionText: 'First paragraph Second paragraph', frameId: 7};
const structured = {plain: 'First paragraph\n\nSecond paragraph', text: 'First paragraph\n\nSecond paragraph'};
test('menu captures immediately in the clicked frame before delivery, without wider host access', async () => {
  const events = [];
  const handler = createMenuSelectionHandler({scripting: {executeScript(options) {
    events.push('capture'); assert.deepEqual(options.target, {tabId: 12, frameIds: [7]});
    assert.equal(typeof options.func, 'function'); assert.deepEqual(options.args, [2_000_000]);
    return Promise.resolve([{result: structured}]);
  }}}, async text => { events.push('send'); assert.equal(text, structured.text); });
  const pending = handler(info, {id: 12});
  assert.deepEqual(events, ['capture']);
  await pending; assert.deepEqual(events, ['capture', 'send']);
});
test('restricted pages, absent tabs, stale selections and capture failures preserve menu snapshot', async () => {
  const outputs=[];
  for (const executeScript of [() => {throw Error('restricted');}, () => Promise.reject(Error('restricted')),
    () => [], () => [{result: {plain: 'Changed selection', text: 'Changed selection'}}], () => [{result: null}]]) {
    await createMenuSelectionHandler({scripting: {executeScript}}, text => outputs.push(text))(info,{id: 1});
  }
  await createMenuSelectionHandler({}, text => outputs.push(text))(info,undefined);
  assert.deepEqual(outputs, Array(6).fill(info.selectionText));
});
test('consecutive captures start at invocation and preserve click order even if later capture finishes first', async () => {
  const captures=[], delivered=[];
  const handler=createMenuSelectionHandler({scripting:{executeScript:()=>new Promise(resolve=>captures.push(resolve))}},text=>delivered.push(text));
  const first=handler({menuItemId:'read',selectionText:'First'}, {id:1});
  const second=handler({menuItemId:'read',selectionText:'Second'}, {id:1});
  assert.equal(captures.length,2);
  captures[1]([{result:{plain:'Second',text:'Second\n'}}]);
  await Promise.resolve(); assert.deepEqual(delivered,[]);
  captures[0]([{result:{plain:'First',text:'First\n'}}]);
  await Promise.all([first,second]); assert.deepEqual(delivered,['First\n','Second\n']);
});
test('menu capture bounds, irrelevant menu and timeout keep delivery recoverable', async () => {
  const delivered=[];
  const send=text=>{delivered.push(text);return {ok:true};};
  const handler=createMenuSelectionHandler({scripting:{executeScript:()=>[{result:{oversize:true}}]}},send);
  await handler({...info,menuItemId:'other'},{id:1}); assert.equal(delivered.length,0);
  assert.match((await handler(info,{id:1})).error,/too large/); assert.equal(delivered.length,0);
  await createMenuSelectionHandler({scripting:{executeScript:()=>new Promise(()=>{})}},send)(info,{id:1});
  assert.equal(delivered[0],info.selectionText);
});
