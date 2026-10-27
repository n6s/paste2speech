// Synthetic lifecycle fixture: no app routes, credentials or providers.
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const server=createServer((_req,res)=>res.end('fixture'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
writeFileSync(process.argv[2],JSON.stringify({port:server.address().port,pid:process.pid}));
