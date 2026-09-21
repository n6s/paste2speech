// Independent browser sessions against the real auth endpoints and temporary ledger.
// Email delivery is captured locally; no email or payment provider is contacted.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'p2s-auth-'));
const origin='http://127.0.0.1:18769';
const proc=spawn('.venv/bin/python',['-m','tests.auth-browser-server',dir],{env:{...process.env,P2S_ORIGINS:origin},stdio:'inherit'});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/billing')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
 const one=await browser.newContext({viewport:{width:412,height:915}}),two=await browser.newContext();
 const errors=[];
 for(const ctx of [one,two])await ctx.route('https://cdn.paddle.com/**',r=>r.abort());
 const page=await one.newPage();page.on('pageerror',e=>errors.push(e.message));
 async function signin(p){
  await p.goto(origin+'/billing');
  await p.getByLabel('Email address',{exact:true}).fill('reader@example.com');
  await p.getByRole('button',{name:'Email me a sign-in link'}).click();
  await p.getByText(/Check your email/).waitFor();
  const {token}=JSON.parse(await readFile(join(dir,'email.json'),'utf8'));
  await p.goto(origin+'/billing/signin#'+token);
  await p.waitForFunction(()=>!location.hash);
  await p.getByRole('button',{name:'Confirm sign-in'}).click();
  await p.getByText('Signed in as reader@example.com',{exact:true}).waitFor();
  assert.equal(await p.locator('#balance').textContent(),'6,000,000 characters available');
  return token;
 }
 const token=await signin(page);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const other=await two.newPage();await signin(other);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await page.getByText('This browser’s credit is not linked to an email yet.',{exact:true}).waitFor();
 await other.reload();await other.getByText('6,000,000 characters available',{exact:true}).waitFor();
 await page.goto(origin+'/billing/signin#'+token);await page.getByRole('button',{name:'Confirm sign-in'}).click();
 await page.getByText(/This link expired/).waitFor();
 assert.deepEqual(errors,[]);
 console.log('Email sign-in: preserved credit, separate browser recovery, logout isolation, fragment removal, reuse rejection and mobile layout passed (fake email delivery).');
}finally{if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));await rm(dir,{recursive:true,force:true});}
