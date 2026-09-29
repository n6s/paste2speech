import test from 'node:test';
import assert from 'node:assert/strict';
import {createController, TTL, MAX_TEXT} from '../extension/controller.js';
import {setupExtensionHandoff} from '../public/extension-handoff.js';
function fixture() {
  let data = {}, next = 1, clock = 1000;
  const tabs = new Map(), deliveries = [], focused = [];
  const api = {
    runtime: {getURL: name => 'chrome-extension://test/' + name},
    storage: {session: {get: async () => structuredClone(data), set: async v => {data = structuredClone(v);}}},
    tabs: {
      create: async ({url}) => {const t = {id: next++, windowId: 1, url};tabs.set(t.id,t);return t;},
      get: async id => {if (!tabs.has(id)) throw Error('closed');return tabs.get(id);},
      update: async id => focused.push(id),
      sendMessage: async (id, value) => {deliveries.push({id, value});},
    }, windows: {update: async () => {}},
  };
  const origin = 'https://pastetospeech.com';
  const create = () => createController(api, origin, {now: () => clock, uuid: () => 'id-' + next + '-' + clock++});
  const sender = id => ({tab: {id}, frameId: 0, url: origin + '/'});
  const popup = {url: api.runtime.getURL('popup.html')};
  return {api, create, tabs, deliveries, focused, sender, popup, state: () => data.handoff, advance: ms => {clock += ms;}};
}
test('owns one reader, reuses it, validates acknowledgments and recovers after worker restart', async () => {
  const f=fixture();let c=f.create();
  await c.send('Hello 👋\n\nWorld');
  const {tabId,pending}=f.state();assert.equal(f.tabs.size,1);assert.equal(pending.text,'Hello 👋\n\nWorld');
  await c.message({type:'accepted',id:pending.id},f.sender(99));assert.ok(f.state().pending);
  await c.message({type:'accepted',id:pending.id},{...f.sender(tabId),frameId:2});assert.ok(f.state().pending);
  await c.message({type:'accepted',id:pending.id},{...f.sender(tabId),url:'https://evil.example/'});assert.ok(f.state().pending);
  c=f.create();await c.message({type:'ready'},f.sender(tabId));assert.equal(f.deliveries.at(-1).value.id,pending.id);
  await c.message({type:'accepted',id:pending.id},f.sender(tabId));assert.equal(f.state().pending,undefined);
  await c.send('Second selection');assert.equal(f.tabs.size,1);assert.equal(f.state().tabId,tabId);
});
test('rapid sends are serialized, latest wins, stale acknowledgment cannot clear it', async()=>{
  const f=fixture(),c=f.create();await Promise.all([c.send('first'),c.send('second'),c.send('third')]);
  assert.equal(f.tabs.size,1);assert.equal(f.state().pending.text,'third');
  assert.deepEqual(f.deliveries.map(d=>d.value.sequence),[1,2,3]);
  await c.message({type:'accepted',id:f.deliveries[0].value.id},f.sender(f.state().tabId));assert.equal(f.state().pending.text,'third');
});
test('closed/navigated tab recovery never takes over another existing tab',async()=>{
  const f=fixture(),c=f.create();await c.send('first');const old=f.state().tabId;
  f.tabs.get(old).url='https://example.com/';await c.send('second');assert.notEqual(f.state().tabId,old);assert.equal(f.tabs.get(old).url,'https://example.com/');
  const second=f.state().tabId;await c.removed(second);assert.equal(f.state().pending,undefined);
  f.tabs.delete(second);await c.send('third');assert.notEqual(f.state().tabId,second);
});
test('delivery failure retains text for retry; expiration removes it and never redelivers',async()=>{
  const f=fixture(),c=f.create(),send=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async()=>{throw Error('not ready');};
  await c.send('keep me');assert.equal(f.state().pending.text,'keep me');
  f.api.tabs.sendMessage=send;await c.message({type:'retry'},f.popup);assert.equal(f.deliveries.length,1);
  f.advance(TTL);await c.message({type:'retry'},f.popup);assert.equal(f.state().pending,undefined);assert.equal(f.deliveries.length,1);assert.match(f.state().status,/expired/);
});
test('blank and oversize selections preserve current pending text; long text is not truncated',async()=>{
  const f=fixture(),c=f.create();const text='a'.repeat(100_000);await c.send(text);
  assert.ok((await c.send(' \n')).error);assert.ok((await c.send('a'.repeat(MAX_TEXT+1))).error);
  assert.equal(f.state().pending.text,text);
  const denied=await c.message({type:'retry'},{url:'chrome-extension://other/popup.html'});assert.ok(denied.error);
  const status=await c.message({type:'status'},f.popup);assert.equal('text' in status,false);
});
test('reader bridge rejects untrusted/malformed/stale requests and acknowledges duplicates without replay',()=>{
  let listener;const replies=[],accepted=[];
  const host={location:{origin:'https://pastetospeech.com'},addEventListener:(_,fn)=>{listener=fn;},postMessage:m=>replies.push(m)};
  setupExtensionHandoff({host,accept:t=>accepted.push(t)});
  const base={bridge:'pastetospeech-extension',version:1,channel:'channel',type:'load',id:'a',sequence:1,created:Date.now(),text:'Hello 世界'};
  const send=(m={},event={})=>listener({source:host,origin:host.location.origin,data:{...base,...m},...event});
  send({}, {origin:'https://evil.example'});send({text:' '});send({version:2});send({created:Date.now()-TTL});send({sequence:0});assert.equal(accepted.length,0);
  send();send();assert.deepEqual(accepted,['Hello 世界']);assert.equal(replies.length,2);
  send({id:'b',sequence:2,text:'Newest'});send({id:'c',sequence:1,text:'Stale'});assert.deepEqual(accepted,['Hello 世界','Newest']);
});
test('reader reload after lost acknowledgment does not prepare the same request twice',()=>{
  let listener,stored;const accepted=[];
  const host={location:{origin:'https://pastetospeech.com'},sessionStorage:{getItem:()=>stored,setItem:(_,v)=>{stored=v;}},addEventListener:(_,fn)=>{listener=fn;},postMessage:()=>{}};
  const setup=()=>setupExtensionHandoff({host,accept:(text,options)=>accepted.push({text,...options})});
  const data={bridge:'pastetospeech-extension',version:1,channel:'c',type:'load',id:'x',sequence:1,created:Date.now(),text:'Read once'};
  setup();listener({source:host,origin:host.location.origin,data});setup();listener({source:host,origin:host.location.origin,data});
  assert.deepEqual(accepted,[{text:'Read once',autoplay:true},{text:'Read once',autoplay:false}]);assert.equal(stored.includes('Read once'),false);
});

import {Player} from '../public/player.js';
test('browser speech autoplay rejection gives an actionable Play fallback',()=>{
  let utterance,message;
  const synth={cancel(){},speak(u){utterance=u;}};
  const player=new Player(synth,class {constructor(text){this.text=text;}},(_,m)=>{message=m;});
  player.start(['Example'],{rate:1});utterance.onerror({error:'not-allowed'});
  assert.equal(player.state,'paused');assert.equal(message,'Press Play to start');
  player.resume({rate:1});assert.equal(player.state,'playing');player.stop();
});
