import assert from 'node:assert/strict';
import {chromium} from 'playwright';
function pdf(text='Hello PDF reader.'){
 const stream=`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'];
 let out='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const start=out.length;out+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
 offsets.slice(1).forEach(o=>out+=`${String(o).padStart(10,'0')} 00000 n \n`);
 return Buffer.from(out+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage(),uploads=[],errors=[];
 page.on('request',r=>{if(r.method()==='POST'&&r.postData()?.includes('Hello PDF'))uploads.push(r.url());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:8787/');
 await page.locator('.pdf-import > summary').click();
 const upload=async(buffer)=>{await page.locator('#pdf-file').setInputFiles({name:'test.pdf',mimeType:'application/pdf',buffer});await page.waitForFunction(()=>!document.querySelector('#pdf-file').disabled);};
 await upload(pdf());assert.equal(await page.locator('#text').inputValue(),'Hello PDF reader.');assert.match(await page.locator('#pdf-status').textContent(),/2 pages.*1 pages/);
 await upload(pdf('                 '));assert.match(await page.locator('#pdf-status').textContent(),/No readable text/);assert.equal(await page.locator('#text').inputValue(),'Hello PDF reader.');
 await upload(Buffer.from('%PDF-broken'));assert.equal(await page.locator('#text').inputValue(),'Hello PDF reader.');
 await upload(Buffer.alloc(20*1024*1024+1));assert.match(await page.locator('#pdf-status').textContent(),/smaller than 20 MB/);
 assert.deepEqual(uploads,[]);assert.deepEqual(errors,[]);
 console.log('Public PDF extraction: real two-page file, blank/scanned-equivalent, malformed, oversize and no upload passed');
}finally{await browser.close();}
