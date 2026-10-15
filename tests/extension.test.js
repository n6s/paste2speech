import test from 'node:test';
import assert from 'node:assert/strict';
import {createController, TTL, MAX_TEXT} from '../extension/controller.js';
import {setupExtensionHandoff} from '../public/extension-handoff.js';
function fixture(origin = 'https://pastetospeech.com') {
  let data = {}, next = 1, clock = 1000;
  const tabs = new Map(), deliveries = [], focused = [];
  const api = {
    runtime: {getURL: name => 'chrome-extension://test/' + name},
    storage: {session: {get: async () => structuredClone(data), set: async v => {data = structuredClone(v);}}},
    tabs: {
      create: async ({url}) => {const t = {id: next++, windowId: 1, url};tabs.set(t.id,t);return t;},
      query: async () => [...tabs.values()],
      get: async id => {if (!tabs.has(id)) throw Error('closed');return tabs.get(id);},
      update: async id => focused.push(id),
      sendMessage: async (id, value) => {deliveries.push({id, value});},
    }, scripting: {executeScript: async () => {}}, windows: {update: async () => {}},
  };
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
  const sequences=f.deliveries.map(d=>d.value.sequence);
  assert.ok(sequences[0]>=1000);assert.ok(sequences[0]<sequences[1]&&sequences[1]<sequences[2]);
  await c.message({type:'accepted',id:f.deliveries[0].value.id},f.sender(f.state().tabId));assert.equal(f.state().pending.text,'third');
});
test('closed/navigated tab recovery leaves unrelated tabs alone',async()=>{
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

test('discovers exact staging root, prefers pinned over saved/active reader, and preserves pin and URL', async()=>{
  const f=fixture('https://staging.pastetospeech.com'),c=f.create();
  await c.send('initial');const saved=f.state().tabId;
  const pinned={id:100,windowId:2,url:'https://staging.pastetospeech.com/?testing=1#reader',pinned:true};
  f.tabs.set(100,pinned);
  f.tabs.set(101,{id:101,windowId:1,url:'https://pastetospeech.com/',pinned:true});
  f.tabs.set(102,{id:102,windowId:1,url:'https://staging.pastetospeech.com/account',pinned:true});
  const updates=[];f.api.tabs.update=async(id,options)=>updates.push({id,options});
  let query;const originalQuery=f.api.tabs.query;f.api.tabs.query=async options=>{query=options;return originalQuery(options);};
  await c.send('explicit replacement');
  assert.equal(f.state().tabId,100);assert.equal(f.tabs.size,4);
  assert.deepEqual(query,{url:'https://staging.pastetospeech.com/*'});
  assert.deepEqual(updates,[{id:100,options:{active:true}}]);
  assert.equal(pinned.pinned,true);assert.equal(pinned.url,'https://staging.pastetospeech.com/?testing=1#reader');
  assert.equal(f.tabs.get(saved).url,'https://staging.pastetospeech.com/');
  assert.equal(f.deliveries.at(-1).id,100);
});
test('adopts existing unpinned root and keeps a valid saved reader unless a pinned reader exists',async()=>{
  const f=fixture(),c=f.create();
  f.tabs.set(100,{id:100,windowId:1,url:'https://pastetospeech.com/',pinned:false});
  await c.send('first');assert.equal(f.state().tabId,100);assert.equal(f.tabs.size,1);
  f.tabs.set(101,{id:101,windowId:1,url:'https://pastetospeech.com/',active:true});
  await c.send('second');assert.equal(f.state().tabId,100);assert.equal(f.tabs.size,2);
  f.tabs.get(100).pinned=true;f.tabs.get(101).pinned=true;
  await c.send('third');assert.equal(f.state().tabId,100);
});
test('stale owner rediscovers pinned root; wrong origins, routes and incognito remain untouched',async()=>{
  const f=fixture('https://staging.pastetospeech.com'),c=f.create();await c.send('first');
  const old=f.state().tabId;f.tabs.delete(old);
  const excluded=['https://pastetospeech.com/','https://staging.pastetospeech.com/other','https://staging.pastetospeech.com.evil.invalid/','https://staging.pastetospeech.com/account/../other'];
  excluded.forEach((url,index)=>f.tabs.set(100+index,{id:100+index,windowId:1,url,pinned:true}));
  f.tabs.set(110,{id:110,windowId:1,url:'https://staging.pastetospeech.com/',pinned:true,incognito:true});
  await c.send('second');assert.notEqual(f.state().tabId,old);assert.ok(f.state().tabId<100);
  f.tabs.get(f.state().tabId).url='https://example.com/';
  f.tabs.set(120,{id:120,windowId:1,url:'https://staging.pastetospeech.com/',pinned:true});
  await c.send('third');assert.equal(f.state().tabId,120);
  assert.deepEqual(excluded.map((url,index)=>f.tabs.get(100+index).url),excluded);
});
test('opening an adopted pinned reader does not deliver or overwrite text without a selection',async()=>{
  const f=fixture(),c=f.create();f.tabs.set(100,{id:100,windowId:1,url:'https://pastetospeech.com/',pinned:true});
  await c.message({type:'open'},f.popup);assert.equal(f.state().tabId,100);assert.equal(f.deliveries.length,0);assert.equal(f.tabs.size,1);
});
test('an existing reader missing its bridge gets a top-frame relay without navigation or new permissions',async()=>{
  const f=fixture(),c=f.create();f.tabs.set(100,{id:100,windowId:1,url:'https://pastetospeech.com/',pinned:true});
  let attached=false;const injections=[];const originalSend=f.api.tabs.sendMessage;
  f.api.tabs.sendMessage=async(...args)=>{if(!attached)throw Error('Receiving end does not exist');return originalSend(...args);};
  f.api.scripting.executeScript=async options=>{injections.push(options);attached=true;};
  await c.send('explicit replacement');
  assert.deepEqual(injections,[{target:{tabId:100,frameIds:[0]},files:['content.js']}]);
  assert.equal(f.deliveries.length,1);assert.equal(f.tabs.size,1);assert.equal(f.tabs.get(100).pinned,true);
});
test('bridge recovery refuses injection if adopted reader navigates away',async()=>{
  const f=fixture(),c=f.create();f.tabs.set(100,{id:100,windowId:1,url:'https://pastetospeech.com/',pinned:true});
  f.api.tabs.sendMessage=async()=>{f.tabs.get(100).url='https://example.com/';throw Error('navigated');};
  f.api.scripting.executeScript=async()=>assert.fail('Must not inject into unrelated route/origin');
  await c.send('retain pending');assert.equal(f.state().pending.text,'retain pending');assert.match(f.state().status,/Waiting for PasteToSpeech/);
});
test('loading readers wait for their normal bridge rather than injecting during navigation',async()=>{
  const f=fixture(),c=f.create();f.tabs.set(100,{id:100,windowId:1,url:'https://pastetospeech.com/',pinned:true,status:'loading'});
  const send=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async()=>{throw Error('not ready');};
  f.api.scripting.executeScript=async()=>assert.fail('Do not inject during navigation');
  await c.send('wait for ready');assert.equal(f.state().pending.text,'wait for ready');
  f.tabs.get(100).status='complete';f.api.tabs.sendMessage=send;
  await c.message({type:'ready'},f.sender(100));assert.equal(f.deliveries.at(-1).value.text,'wait for ready');
});
