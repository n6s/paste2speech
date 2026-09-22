import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'}),page=await browser.newPage();
await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8790'?route.continue():route.abort());
const failures=[];page.on('pageerror',error=>failures.push(error.message));
await page.goto('http://127.0.0.1:8790/');await page.waitForFunction(()=>document.querySelector('#text').value.length>0);
await page.click('#play');await page.waitForFunction(()=>!document.querySelector('#downloads').hidden,{timeout:30000});
await page.click('#pause');await page.click('#next');
assert.equal(await page.locator('#reading .current').count(),1);
const result=await page.evaluate(async()=>{
 const mp3=await fetch(document.querySelector('#mp3').href),vtt=await fetch(document.querySelector('#vtt').href);return {mp3:mp3.status,bytes:(await mp3.arrayBuffer()).byteLength,vtt:(await vtt.text()).startsWith('WEBVTT'),time:document.querySelector('#time').textContent};
});assert.equal(result.mp3,200);assert.ok(result.bytes>10000);assert.ok(result.vtt);
await page.screenshot({path:'work/private-reader/reader.png',fullPage:true});
await page.click('a[href="/api/billing"]');await page.waitForFunction(()=>document.querySelector('#balance').textContent.includes('characters'));
await page.fill('#email','reader-'+Date.now()+'@example.invalid');await page.click('#send-link');await page.waitForFunction(()=>document.querySelector('#auth-message').textContent.includes('Check your email'));
const link=await page.evaluate(async()=>(await(await fetch('/api/test-mail')).json()).url);
await page.goto(link);await page.click('#confirm');await page.waitForURL('**/api/billing');await page.waitForFunction(()=>document.querySelector('#identity').textContent.includes('Signed in as'));
assert.deepEqual(failures,[]);console.log(JSON.stringify({result:'PASS',...result,checks:['full preparation','pause and section highlighting','complete MP3/VTT downloads','email confirmation and account recovery'],pageErrors:failures}));await browser.close();
