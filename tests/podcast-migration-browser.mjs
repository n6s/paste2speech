import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = process.env.READER_SITE || "work/private-reader/site", release = JSON.parse(await readFile(root + "/release.json"));
await mkdir("work/reading-history", { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    const file = path === "/" ? "index.html" : path.slice(1);
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/html");
    res.end(await readFile(root + "/" + file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const requests = [], errors = [];
let accountScope="native-fixture";
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push({ path: url.pathname, method: request.method() });
    let body = url.pathname === "/api/reader" ? { eligible: true, accessAllowed: true, account: { balance: 0, creditRequired: true } } : url.pathname === "/api/ocr/jobs/config" ? { enabled: false, durable: true, consentScope: accountScope } : {};
    return route.fulfill({ status: url.pathname === "/api/events" ? 204 : url.pathname === "/api/ocr/jobs/config" && !accountScope ? 401 : 200, contentType: "application/json", body: url.pathname === "/api/events" ? "" : JSON.stringify(body) });
  });
  await context.addInitScript(() => {
    window.__readingCount=async()=>{const db=await new Promise(r=>{const q=indexedDB.open("paste2speech-device-audio-v1");q.onsuccess=()=>r(q.result);});const n=await new Promise(r=>{const q=db.transaction("readings").objectStore("readings").getAll();q.onsuccess=()=>r(q.result.filter(record=>record.scope===(localStorage.getItem("paste2speech.device-audio.scope")||localStorage.getItem("paste2speech.browser-history.scope"))).length);});db.close();return n;};
    const synth = new EventTarget();
    window.__spoken = [];
    window.__nativeVoices = [{ name: "Native A", voiceURI: "native-a", lang: "en-US", localService: true }, { name: "Native B", voiceURI: "native-b", lang: "en-GB", localService: true }];
    synth.getVoices = () => __nativeVoices;
    synth.cancel = () => {
    };
    synth.speak = (u) => {
      __spoken.push(u);
      queueMicrotask(() => u.onstart?.());
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth });
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    window.clipboardText = "";
    Object.defineProperty(navigator, "clipboard", { value: { readText: async () => {if(window.holdClipboard)await new Promise(resolve=>window.releaseQueuedClipboard=()=>{window.holdClipboard=false;resolve();});return clipboardText;} } });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  page.setDefaultTimeout(10000);await page.goto(origin+'/billing.html');
  await page.evaluate(async()=>{
    const scope='native-fixture',now=Date.now();
    localStorage.setItem('paste2speech.settings',JSON.stringify({engine:'browser',voice:'native-a',rate:1}));localStorage.setItem('paste2speech.device-audio.latest.'+scope,'legacy-unread');
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('paste2speech-device-audio-v1',4);q.onupgradeneeded=()=>{for(const name of ['jobs','sections','readings','positions','removed','usage','references','lifecycle'])if(!q.result.objectStoreNames.contains(name))q.result.createObjectStore(name);};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    const sign=async value=>({...value,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('')});
    const base={version:2,engine:'browser',scope,voice:'native-a',records:[],parts:[],statuses:[],createdAt:now,updated:now,options:{engine:'browser',voice:'native-a',rate:1,cleanup:{}}};
    const unread=await sign({...base,id:'legacy-unread',generation:'unread-generation',text:'Legacy unread source.',chunks:['Legacy unread source.']});
    const finished=await sign({...base,id:'legacy-finished',generation:'finished-generation',text:'Legacy finished source.',chunks:['Legacy finished source.'],finishedAt:now});
    const position=await sign({scope,id:unread.id,generation:unread.generation,index:0,offset:7,rate:1,playbackEngine:'browser',playbackVoice:'native-a',updated:now});
    const legacy=await sign({scope,id:'temporary-playlist',order:[unread.id,finished.id],retired:[],pending:[]});
    await new Promise(resolve=>{const tx=db.transaction(['readings','positions','usage'],'readwrite');tx.objectStore('readings').put(unread,[scope,unread.id]);tx.objectStore('readings').put(finished,[scope,finished.id]);tx.objectStore('positions').put(position,[scope,unread.id]);tx.objectStore('usage').put(legacy,[scope,'temporary-playlist']);tx.oncomplete=resolve;});db.close();
  });
  await page.goto(origin);if(await page.getByRole('button',{name:'Dismiss guide',exact:true}).isVisible())await page.getByRole('button',{name:'Dismiss guide',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#text').value==='Legacy unread source.'&&document.querySelectorAll('#queue-items li').length===1);
  assert.equal(await page.evaluate(()=>__spoken.length),0,'migration restores paused');
  const stored=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('paste2speech-device-audio-v1');q.onsuccess=()=>r(q.result);});const read=(name,key)=>new Promise(r=>{const q=db.transaction(name).objectStore(name).get(key);q.onsuccess=()=>r(q.result);});const scope='native-fixture',out={modern:await read('usage',[scope,'podcast-playlist']),legacy:await read('usage',[scope,'temporary-playlist']),played:await read('lifecycle',[scope,'legacy-finished']),position:await read('positions',[scope,'legacy-unread']),finishedCache:await read('readings',[scope,'legacy-finished'])};db.close();return out;});
  assert.deepEqual(stored.modern.order,['legacy-unread']);assert.deepEqual(stored.legacy.retired,[]);assert.ok(stored.finishedCache);assert.equal(stored.played.finishedAt,null);assert.ok(stored.played.playedAt);assert.equal(stored.position.offset,7);
  await page.click('#play');await page.waitForFunction(()=>__spoken.length>0);assert.equal(await page.evaluate(()=>__spoken.at(-1).text),'unread source.');
  assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.path.startsWith('/api/readings')).length,0);console.log(JSON.stringify({legacyUnfinishedMigrates:true,completedExcludedWithoutCacheDeletion:true,oldJournalUnchanged:true,bookmarkPreserved:true,noAutoplay:true,realProviderCalls:0}));await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
