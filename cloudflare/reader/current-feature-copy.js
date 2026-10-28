// Build-time copy only. Legacy variants retain their existing policies and text.
function slot(html,name,copy){
 const start=`<!-- ${name} -->`,end=`<!-- /${name} -->`,a=html.indexOf(start),b=html.indexOf(end,a);
 if(a<0||b<0)throw Error('Missing reviewed copy slot: '+name);
 return html.slice(0,a)+start+copy+end+html.slice(b+end.length);
}
const summary='<p>Summaries <strong>start at 1 credit</strong>; longer or more detailed work can cost more. The final charge is shown with the result. Completed sections are kept and charged if you pause or stop; unused reserved credits are returned. Saved results expire 24 hours after the request starts. Reopening them uses no more credits; requesting a fresh summary uses credits again.</p>';
const translation='<p>Translation uses Google Cloud Translation and costs <strong>4 credits per 1,000 source characters</strong>, including spaces and punctuation, counted as Unicode code points with fractional credits. The full price appears before you click Translate. Completed portions are saved and charged once; if you pause or stop, you can use those portions and unused reserved credits are returned. An in-flight portion may still finish. Saved results expire 24 hours after the request starts; reopening them uses no more credits.</p>';
const scanning='<p>Cloud scanning accepts supported unencrypted PDFs up to <strong>1,000 pages</strong> or PNG/JPEG/WebP images, up to <strong>50 MB</strong> (50,000,000 bytes). Readable PDF text is checked on your device first for free. Choosing an image or scanned PDF through Open file authorizes whole-file scanning by Mistral at 2 credits per page; pasted or dropped images keep their Upload and Scan controls. Processing requires enough available credits and remains subject to provider availability and file validation.</p>';
const scanRecovery='<p>Complete saved scans expire 24 hours after completion; reopening an available result uses no more credits. A failed scan can be retried only when the previous attempt is confirmed safe to retry. Running or unresolved attempts, including some expired attempts, can block another scan. There are no automatic paid retries. Download your extracted text before expiry.</p>';
export function currentFeatureCopy(html,{surface,summaryDocuments=false,translationEnabled=false,durableOcr=false}={}){
 if(summaryDocuments){
  if(surface==='pricing')html=slot(html,'feature-intro','<p>Browser voices and local text extraction are free. Cloud speech, scanning, summaries'+(translationEnabled?' and translation':'')+' use one prepaid balance.</p><h2>Free reading</h2><p>Paste text or open a readable PDF, DOCX or TXT file, then listen with a browser voice without buying credits.</p><h2>Summaries</h2>'+summary);
  if(surface==='terms'){
   html=slot(html,'summary-terms','<h2>Browser voices and summaries</h2><p>Browser voices, local text extraction and replay of available saved results use no credits.</p>'+summary+'<p>Summary sends the text you choose to Cloudflare AI. Processing may use several passes. Saved complete and partial results are private to your account. Source text is not saved by the Summary service; generated section notes and results are stored until their expiry. Financial and request records remain for accounting and recovery.</p>');
   html=html.replace(/Summary sends the current editor text to Cloudflare AI[\s\S]*?Contact support for account or privacy requests\./,'Typing or pasting does not start Summary or translation. Text is sent only when you request the corresponding action. Contact support for account or privacy requests.');
  }
  if(surface==='account')html=slot(html,'summary-account','<section id="summary-credit"><h2>Summaries</h2>'+summary+'<p>Cloudflare AI processes the selected text. Paid-voice playback is a separate charge; browser voices remain free.</p></section>');
  if(surface==='reader')html=html.replace('this operation saves only request metadata in our usage ledger.','generated Summary section notes and results are saved privately and expire 24 hours after the request starts. The Summary service does not save source text.').replace('Account and payment records retain balances and usage without reading text.','Financial records retain balances and numeric usage.');
  // Older build-time substitutions must never reintroduce a flat-price promise.
  html=html.replaceAll('Each accepted summary uses 1 shared credit ($0.01)','Summaries start at 1 credit; longer or more detailed work can cost more')
   .replace('Summary uses 1 credit ($0.01) per accepted result.','Summaries start at 1 credit; longer or more detailed work can cost more.')
   .replace('approximately 18.5 hours of listening <strong>or</strong> 500 scanned pages <strong>or</strong> 1,000 summaries, or a mix of these uses.','approximately 18.5 hours of listening <strong>or</strong> 500 scanned pages, or a mix of paid features.');
 }
 if(translationEnabled){
  const body='<h2>Translation</h2>'+translation+'<p>Listening with a browser voice is free. Cloud scanning and natural-voice audio are separate charges.</p>';
  if(['pricing','terms','account'].includes(surface))html=slot(html,'translation-copy',surface==='account'?'<section id="translation-credit">'+body+'</section>':body);
  html=html.replace('for cloud speech, scanning and summaries.','for cloud speech, scanning, summaries and translation.');
  if(surface==='terms')html=html.replace('<h2>Privacy</h2>','<h2>Privacy</h2><p>When you click Translate, the text you request is sent to Google Cloud Translation. For long documents, it is sent in portions. Translated results are stored privately in Cloudflare until 24 hours after the request starts, including completed portions of an interrupted job. The translation service does not save source text; numeric usage, request identities and financial records remain for billing and recovery.</p>');
  if(surface==='reader'||surface==='account')html=html.replace('One shared balance for cloud voices, scanning and summaries.','One shared balance for cloud voices, scanning, summaries and translation.').replace('Using cloud voices, scanning or summaries reduces the same balance.','Cloud voices, scanning, summaries and translation use the same balance.');
 }
 if(durableOcr){
  if(surface==='pricing')html=slot(html,'ocr-limits',scanning+scanRecovery);
  if(surface==='terms')html=slot(html,'ocr-terms','<p>Cloud scanning uses 2 credits per submitted page only when the whole file produces complete, validated output saved privately. Blank pages within an otherwise successful file count. Failed, incomplete or entirely blank results use no customer credits. Image files count as one page; PDF page counts are verified before charging.</p>'+scanning+scanRecovery);
  if(surface==='account')html=html.replace(/<details><summary>How scanning works<\/summary>[\s\S]*?<\/details>/,'<details><summary>How scanning works</summary>'+scanning+scanRecovery+'<p>Scanning and paid-voice playback are separate charges. Browser voices remain free.</p></details>');
 }
 return html;
}
