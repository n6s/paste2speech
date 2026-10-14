import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {captureSelection} from '../extension/selection.js';
const server=createServer(async(req,res)=>{
  try { const name=new URL(req.url,'http://localhost').pathname.slice(1);
    if(!['paste.js','text.js','math-notation.js'].includes(name)){res.end('<!doctype html><title>Selection fixture</title>');return;}
    res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../public/'+name,import.meta.url)));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
let count=0;
try {
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
  const page=await browser.newPage();
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  const capture=async(html, selector='#selected')=>{
    await page.setContent(html);
    await page.evaluate(selector=>{const range=document.createRange();range.selectNodeContents(document.querySelector(selector));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);},selector);
    return page.evaluate(`(${captureSelection.toString()})(2000000)`);
  };
  const check=async(html,expected)=>{const result=await capture(`<div id="selected">${html}</div>`);assert.equal(result.text,expected);count++;return result;};
  await check('<p>First paragraph</p><p>Second paragraph</p>','First paragraph\n\nSecond paragraph');
  await check('First<br>Second<br><br>Third','First\nSecond\n\nThird');
  await check('<p>Hello <strong>bold</strong> and <a href="https://private.invalid/token">linked</a> text.</p>','Hello bold and linked text.');
  await check('<div>One <span>two</span><span>three</span> four</div>','One twothree four');
  await check('<p style="width:70px">Long prose wraps visually without introducing artificial line breaks.</p>','Long prose wraps visually without introducing artificial line breaks.');
  await check('<ul><li>First item</li><li>Second item</li></ul>','- First item\n- Second item');
  await check('<ol start="3"><li>First item</li><li value="8">Second item</li></ol>','3. First item\n8. Second item');
  await check('<ul><li>Parent<ul><li>Nested</li></ul></li><li>Sibling</li></ul>','- Parent\n  - Nested\n- Sibling');
  await check('<p>Before<span hidden>secret</span> after</p><p style="display:none">hidden secret</p><p>Visible</p>','Before after\n\nVisible');
  await check('<p>👋 Café &amp; 中文</p><p>Next</p>','👋 Café & 中文\n\nNext');
  await check('<p style="white-space:pre-line">First line\nSecond line</p>','First line\nSecond line');
  await check('<pre>  literal\n    indentation\nlast</pre>','  literal\n    indentation\nlast');
  // Range endpoints exclude content on either side, including partial text nodes.
  await page.setContent('<p id="selected">Unselected <b>picked words</b> unselected.</p>');
  await page.evaluate(()=>{const text=document.querySelector('b').firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,6);getSelection().removeAllRanges();getSelection().addRange(range);});
  assert.equal((await page.evaluate(`(${captureSelection.toString()})(2000000)`)).text,'picked');count++;
  // A selection wholly within an LI must retain its list boundary.
  await page.setContent('<ul><li id="selected">Only selected item</li><li>Excluded</li></ul>');
  await page.evaluate(()=>{const text=document.querySelector('#selected').firstChild;const range=document.createRange();range.selectNodeContents(text);getSelection().removeAllRanges();getSelection().addRange(range);});
  assert.equal((await page.evaluate(`(${captureSelection.toString()})(2000000)`)).text,'- Only selected item');count++;
  await page.setContent('<textarea>Ignored\nSelected line one\nSelected line two\nIgnored</textarea>');
  await page.locator('textarea').evaluate(element=>{element.focus();element.setSelectionRange(8,44);});
  const input=await page.evaluate(`(${captureSelection.toString()})(2000000)`);
  assert.equal(input.text,'Selected line one\nSelected line two\n');count++;
  await page.setContent('<input type="password" value="secret">');
  await page.locator('input').evaluate(element=>{element.focus();element.select();});
  assert.equal(await page.evaluate(`(${captureSelection.toString()})(2000000)`),null);count++;
  const oversized=await capture('<div id="selected">'+ 'a'.repeat(1001) +'</div>');
  assert.equal(oversized.text.length,1001);
  assert.deepEqual(await page.evaluate(`(${captureSelection.toString()})(1000)`),{oversize:true});count++;
  // Same paragraphs/lists reach reader cleanup as the rich Paste route.
  for(const html of ['<p>First paragraph.</p><p>Second paragraph.</p>', '<ul><li>First item</li><li>Second item</li></ul>', '<ol start="3"><li>One</li><li>Two</li></ol>']) {
    const selected=await capture(`<div id="selected">${html}</div>`);
    const parity=await page.evaluate(async({html,selected})=>{const {clipboardMarkdown}=await import('/paste.js');const {cleanText,defaults}=await import('/text.js');return {paste:cleanText(clipboardMarkdown(html,selected.plain),defaults),extension:cleanText(selected.text,defaults)};},{html,selected});
    assert.equal(parity.extension,parity.paste);count++;
  }
  console.log(`Selection capture: ${count} real Chrome checks passed (synthetic fixtures; no provider calls).`);
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
