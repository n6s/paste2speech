import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true});
try {
 const page = await browser.newPage({viewport:{width:393,height:851},isMobile:true});
 const errors=[], external=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://paste-test.invalid/**',route=>{external.push(route.request().url());return route.abort();});
 await page.addInitScript(()=>{
  const synth=new EventTarget();synth.getVoices=()=>[];synth.cancel=()=>{};synth.speak=utterance=>window.lastSpoken=utterance.text;
  Object.defineProperty(window,'speechSynthesis',{value:synth});
  window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 });
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8766/');
 const paste = async (html,plain='fallback') => {
  await page.locator('#text').focus();
  return page.evaluate(({html,plain})=>{
   const data=new DataTransfer();if(html!==null)data.setData('text/html',html);data.setData('text/plain',plain);
   const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
   document.querySelector('#text').dispatchEvent(event);
   return event.defaultPrevented;
  },{html,plain});
 };
 const html='<h2>September Edition A</h2><p><strong>Q1 ·</strong> You find a site.</p><h2>August Edition B</h2><p>Q1 · You get a message.</p><h2>August Edition A</h2><p>Q1 · You check in for a flight.</p>';
 assert.equal(await paste(html),true);
 const markdown=await page.locator('#text').inputValue();
 assert.equal(markdown,'## September Edition A\n\n**Q1 ·** You find a site.\n\n## August Edition B\n\nQ1 · You get a message.\n\n## August Edition A\n\nQ1 · You check in for a flight.');
 assert.deepEqual(await page.locator('.reading-paragraph').allTextContents(),['September Edition A','Q1 · You find a site.','August Edition B','Q1 · You get a message.','August Edition A','Q1 · You check in for a flight.']);
 await page.locator('#read-mode').click();
 await page.locator('#play').click();
 assert.equal(await page.locator('#status').textContent(),'Reading aloud');
 await page.locator('#edit-mode').click();
 await page.locator('#text').evaluate(el=>el.setSelectionRange(0,el.value.length));
 await paste('<p>Replacement paragraph.</p>');
 assert.equal(await page.locator('#status').textContent(),'Ready when you are');
 assert.equal(await page.locator('#text').inputValue(),'Replacement paragraph.');
 await page.keyboard.press('Control+z');
 assert.equal(await page.locator('#text').inputValue(),markdown);
 await page.locator('#text').fill('Before selected after');
 await page.locator('#text').evaluate(el=>el.setSelectionRange(7,15));
 await paste('<b>new</b>');
 assert.equal(await page.locator('#text').inputValue(),'Before **new** after');
 const previous=await page.locator('#text').inputValue();
 for(const html of [null,'','<img src="https://paste-test.invalid/empty.png">','x'.repeat(2_000_001)]) {
  assert.equal(await paste(html),false);
  // Synthetic events don't perform browser default insertion; not cancelling
  // confirms we delegate fallback to the native paste action.
  assert.equal(await page.locator('#text').inputValue(),previous);
 }
 await page.locator('#text').fill('');
 await paste('<div>First<br>wrapped line</div><div><b>Separate label</b></div><ol start="3"><li>First item</li><li>Second <i>item</i><ul><li>Nested</li></ul></li></ol><p><a href="https://example.com/article">Source</a></p>');
 const structured=await page.locator('#text').inputValue();
 assert.ok(structured.includes('First\nwrapped line\n\n**Separate label**'));
 assert.ok(structured.includes('3. First item\n4. Second *item*'));
 assert.ok(structured.includes('  - Nested'));
 assert.ok(structured.includes('[Source](https://example.com/article)'));
 await page.locator('#text').fill('');
 await paste('<table role="presentation"><tr><td><h2>Tools</h2><p>Useful tool.</p></td></tr></table><table><tr><th>Name</th><th>Count</th></tr><tr><td>A</td><td>2</td></tr></table>');
 assert.ok((await page.locator('#text').inputValue()).includes('## Tools\n\nUseful tool.'));
 assert.ok((await page.locator('#preview').textContent()).includes('Useful tool.'));
 assert.ok(!(await page.locator('#preview').textContent()).includes('Name'));
 await page.locator('#text').fill('');
 await paste('<style>@import "https://paste-test.invalid/style";</style><script>window.pasteExecuted=true</script><iframe src="https://paste-test.invalid/frame"></iframe><img src="https://paste-test.invalid/image" onerror="window.pasteExecuted=true"><p onclick="window.pasteExecuted=true">Safe <a href="javascript:alert(1)">link</a>.</p><p hidden>Hidden text</p><div style="display:none">Invisible</div>');
 assert.equal(await page.locator('#text').inputValue(),'Safe link.');
 assert.equal(await page.evaluate(()=>window.pasteExecuted),undefined);
 assert.equal(await page.locator('#preview script, #preview img, #preview iframe').count(),0);
 assert.deepEqual(external,[]);
 await page.locator('#text').fill('');
 await paste('<pre><code>const x = 1;\n\n\n  ~100 &lt; 200\n```</code></pre><p>Use <code>$300M</code> literally.</p>');
 assert.equal(await page.locator('#text').inputValue(), '````\nconst x = 1;\n\n\n  ~100 < 200\n```\n````\n\nUse `$300M` literally.');
 assert.equal(await page.locator('#preview').textContent(),'Use $300M literally.');
 await page.locator('#text').fill('');
 await paste('<p>Literal &lt;script&gt; and **not emphasis**.</p>');
 assert.equal(await page.locator('#preview').textContent(),'Literal <script> and **not emphasis**.');
 assert.equal(await page.locator('#preview script').count(),0);
 // Spaces between formatted elements must never acquire Markdown escapes.
 for (const space of [' ', '  ', '&nbsp;', '\n  ']) {
  await page.locator('#text').fill('');
  await paste('<p><strong>Why:</strong>'+space+'<em>A professional</em></p>');
  assert.equal(await page.locator('#text').inputValue(),'**Why:** *A professional*');
  assert.equal(await page.locator('#preview').textContent(),'Why: A professional');
 }
 await page.locator('#read-mode').click();
 await page.locator('#play').click();
 assert.equal(await page.evaluate(()=>window.lastSpoken),'Why: A professional');
 await page.locator('#edit-mode').click();
 await page.locator('#text').fill('');
 await paste('<p><strong>Why:</strong> <em>A professional</em></p><p>Path: C:\\Users\\Roger</p>');
 assert.equal(await page.locator('#preview').textContent(),'Why: A professional\n\nPath: C:\\Users\\Roger');
 await page.locator('#text').fill('');
 await paste('<p># literal heading marker</p>');
 assert.equal(await page.locator('#text').inputValue(),'\\# literal heading marker');
 assert.equal(await page.locator('#preview').textContent(),'# literal heading marker');
 // Exercise insertion fallback on browsers lacking native undo-friendly insertText.
 await page.evaluate(()=>{document.execCommand=()=>false;});
 await page.locator('#text').fill('Old');await page.locator('#text').evaluate(el=>el.select());
 await paste('<h3>Fallback insertion</h3>');
 assert.equal(await page.locator('#text').inputValue(),'### Fallback insertion');
 assert.equal(await page.locator('#preview').textContent(),'Fallback insertion');
 assert.deepEqual(errors,[]);
 console.log('Rich-paste checks passed: headings, preview, lists, emphasis, links, tables, selection, undo, playback reset, plain fallback, and inert external content. Actual mobile clipboard formats still need device confirmation.');
} finally {await browser.close();}
