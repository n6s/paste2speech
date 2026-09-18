import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage();const events=[];
 page.on('response',r=>{if(r.url().endsWith('/api/events'))events.push(r.status());});
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:8787/');
 await page.locator('#text').fill('PRIVATE READING MUST NOT BE SUBMITTED');
 await page.locator('#voice-settings > summary').click();
 await page.getByText('Clean up before reading',{exact:true}).click();
 await page.locator('#clean-joinLines').uncheck();
 await page.locator('#clean-emoji').check();
 await page.locator('#feedback > summary').click();
 await page.locator('[name=message]').fill(process.env.FEEDBACK_TEST_MESSAGE||'Local integration test: the feedback form works.');
 const submission=page.waitForRequest(r=>r.url().endsWith('/api/feedback')&&r.method()==='POST');
 await page.locator('#feedback-form button[type=submit]').click();
 const data=(await submission).postDataJSON();
 assert.ok(!JSON.stringify(data).includes('PRIVATE READING'));
 assert.equal(data.context.cleanup.joinLines,false);
 assert.equal(data.context.cleanup.emoji,true);
 assert.equal(Object.keys(data.context.cleanup).length,7);
 await page.waitForFunction(()=>document.querySelector('#feedback-status').textContent.includes('Thank you'));
 assert.ok(events.includes(204));
 await page.screenshot({path:'work/feedback-preview.png',fullPage:true});
 console.log('Feedback form saved report without reading content; usage event accepted');
 const privateContext=await browser.newContext();await privateContext.addInitScript(()=>Object.defineProperty(navigator,'globalPrivacyControl',{value:true}));
 const quiet=await privateContext.newPage();let tracking=0;quiet.on('request',r=>{if(r.url().endsWith('/api/events'))tracking++;});await quiet.goto(process.env.TEST_URL||'http://127.0.0.1:8787/');await quiet.waitForLoadState('networkidle');assert.equal(tracking,0);
 console.log('Global Privacy Control suppresses browser analytics');
}finally{await browser.close();}
