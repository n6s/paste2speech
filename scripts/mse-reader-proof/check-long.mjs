import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const origin=process.env.MSE_PROOF_ORIGIN||'https://pop-os.tailbd091c.ts.net:8443';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const page=await browser.newPage({viewport:{width:412,height:915}});
try{
 await page.goto(origin);await page.selectOption('#scenario','long');await page.click('#start');
 await page.waitForFunction(()=>proof.audio.currentTime>.1,null,{timeout:20000});
 const source=await page.evaluate(()=>proof.audio.src);await page.click('#pause');
 await page.screenshot({path:'work/mse-reader-proof/results/phone-layout.png'});
 console.log('Long tailnet test started; continuing to append while paused.');
 await page.waitForFunction(()=>proof.finalized||proof.fatal,null,{timeout:240000});
 assert.equal(await page.evaluate(()=>proof.error),'');
 const report=await page.evaluate(()=>proof.diagnostics());
 assert.equal(report.status.total,64);assert.equal(report.events.filter(e=>e.type==='append').length,64);
 assert.equal(await page.evaluate(()=>proof.audio.src),source);
 const pre=report.events.find(e=>e.type==='before-end-of-stream');assert.ok(Math.abs(pre.bufferedEnd-report.status.duration)<.000001);
 assert.equal(await page.evaluate(()=>proof.audio.paused),true);
 await page.evaluate(()=>proof.seek(proof.status.duration-2));await page.click('#resume');
 await page.waitForFunction(()=>proof.state==='done',null,{timeout:6000});
 await writeFile('work/mse-reader-proof/results/long-tailnet.json',JSON.stringify(await page.evaluate(()=>proof.diagnostics()),null,2));
 console.log(`PASS long tailnet: 64 sections, ${report.status.duration}s, unchanged source, background preparation while paused, final playback.`);
 await page.click('#stop');
}finally{await browser.close();}
