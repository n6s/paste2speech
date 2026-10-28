import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currentFeatureCopy} from '../cloudflare/reader/current-feature-copy.js';
import {SUMMARY_DOCUMENT_INFO} from '../public/summary-copy.js';
import {quoteSummaryDocument} from '../public/summary-document-plan.js';
import {TRANSLATION_RATE} from '../cloudflare/reader/translation-credits.js';
import {OCR_SOURCE_MAX_BYTES} from '../cloudflare/reader/ocr-source.js';
const flags={summaryDocuments:true,translationEnabled:true,durableOcr:true};
const source=surface=>readFileSync(`cloudflare/reader/unified-${surface==='account'?'account':surface}.html`,'utf8');
test('reviewed public pages state variable Summary pricing and current OCR limits without altering inactive variants',()=>{
 for(const surface of ['pricing','terms','account']){
  const original=source(surface),html=currentFeatureCopy(original,{surface,...flags});
  assert.equal(currentFeatureCopy(original,{surface}),original);
  assert.match(html,/start at 1 credit/);assert.match(html,/longer or more detailed work can cost more/);
  assert.match(html,/Completed sections are kept and charged/);assert.match(html,/unused reserved credits are returned/);
  assert.match(html,/fresh summary uses credits again/);assert.match(html,/24 hours after the request starts/);
  assert.match(html,/1,000 pages/);assert.match(html,/50,000,000 bytes/);
  assert.match(html,/confirmed safe to retry/);assert.match(html,/Running or unresolved attempts/);
  assert.doesNotMatch(html,/summaries (?:for free|uses no credits)|Creating summaries uses no credits|10 pages|6 MB|processing the same file again after expiry is currently blocked/i);
 }
 assert.equal(OCR_SOURCE_MAX_BYTES,50000000);
 assert.equal(quoteSummaryDocument({maps:1,bytes:100,preset:'brief'}).credits,1);
 assert.ok(quoteSummaryDocument({maps:5,bytes:300000,preset:'detailed'}).credits>1);
});
test('translation copy covers real tariff, provider, fractional source counting, saved partials and expiry',()=>{
 assert.equal(TRANSLATION_RATE,4);
 for(const surface of ['pricing','terms','account']){
  const html=currentFeatureCopy(source(surface),{surface,...flags});
  assert.match(html,/Google Cloud Translation/);assert.match(html,/4 credits per 1,000 source characters/);
  assert.match(html,/Unicode code points with fractional credits/);assert.match(html,/full price appears before you click Translate/);
  assert.match(html,/Completed portions are saved and charged once/);assert.match(html,/in-flight portion may still finish/);
  assert.match(html,/unused reserved credits are returned/);assert.match(html,/reopening them uses no more credits/);
 }
 const terms=currentFeatureCopy(source('terms'),{surface:'terms',...flags});
 assert.match(terms,/text you request is sent to Google Cloud Translation/);
 assert.match(terms,/stored privately in Cloudflare until 24 hours after the request starts/);
 assert.match(terms,/including completed portions of an interrupted job/);
 assert.match(terms,/generated section notes and results are stored until their expiry/);
 assert.doesNotMatch(terms,/the Summary service does not store source or output/);
 // Existing payment/refund/privacy safeguards are unchanged by copy slots.
 for(const text of ['eligible transactions may also show a withdrawal option','Do Not Track and Global Privacy Control','This site does not store your card number'.toLowerCase()])assert.ok(terms.toLowerCase().includes(text.toLowerCase()));
});
test('late legacy build substitutions cannot restore flat/free claims in reviewed surfaces',()=>{
 for(const surface of ['pricing','terms','account']){
  const legacy=source(surface).replaceAll('Creating summaries uses no credits','Each accepted summary uses 1 shared credit ($0.01)').replace('create summaries for free','create summaries for 1 credit each').replace('Browser voices and summaries — free','Free browser voices · summaries 1 credit each');
  const html=currentFeatureCopy(legacy,{surface,...flags});
  assert.doesNotMatch(html,/Each accepted summary uses 1 shared credit|summaries 1 credit each|Creating summaries uses no credits/);
 }
 assert.match(SUMMARY_DOCUMENT_INFO,/start at 1 credit/);assert.doesNotMatch(SUMMARY_DOCUMENT_INFO,/free|1 credit each/);
 assert.throws(()=>currentFeatureCopy('missing',{surface:'pricing',...flags}),/Missing reviewed copy slot/);
});
