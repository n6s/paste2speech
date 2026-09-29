// Render the local production build with original sample copy. No remote pages,
// real account details, speech generation, or native browser UI are involved.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, mkdir, copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const output='dist/chrome-extension/store';await mkdir(output,{recursive:true});
execFileSync('convert',['-background','#f7f5ef','docs/chrome-web-store/promo.svg',`PNG24:${output}/promo-440x280.png`]);
await copyFile('extension/icon-128.png',`${output}/icon-128.png`);
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{}');return;}
  try{
    const file=path==='/'?'index.html':path.slice(1);
    if(file.includes('..'))throw Error('Invalid path');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');
    res.end(await readFile('work/production-reader/site/'+file));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(origin);
 await page.locator('#text').fill('A little less screen time.\n\nHighlight a passage on a webpage, right-click, and choose Read with PasteToSpeech. Your selection opens in the reader using your saved voice and playback speed.\n\nPause whenever you like. Adjust the speed, choose a voice, and continue at your own pace.\n\nSend another selection when you are ready for something new. The extension reuses its reader tab, so your next reading is always easy to find.');
 await page.locator('#read-mode').click();
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`${output}/screenshot-reader-1280x800.png`});
 await page.locator('#play').scrollIntoViewIfNeeded();
 await page.screenshot({path:`${output}/screenshot-controls-1280x800.png`});
 console.log(`Store images written to ${output}; real local reader UI, no speech or account requests to remote services.`);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
