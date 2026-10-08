# OCR billing sandbox checkpoint — October 8, 2026

Roger approved local implementation and a Paddle sandbox catalog for a one-time
$10 USD pack of 500 OCR page credits. No automatic refill or renewal and no
scheduled purchased-credit expiry. Failed/incomplete extraction uses zero
customer credits. Roger subsequently approved staging migration/deployment, the signed webhook and
narrow Access exception, and one hosted synthetic sandbox purchase/refund proof.
Live catalog, production migration/deployment and paid provider OCR remain outside
this approval.

## Catalog created and visibly verified

Paddle sandbox, Roger Brown account:

- Product: `pro_01m4dzha8772sp5eezdtz2c0cz`, **PasteToSpeech — OCR page pack**, active.
- Price: `pri_01m4dzmjgsjt3feew9j7maj8w5`, **500 OCR page credits**, active.
- Base price: 1000 USD cents, one-time, no trial, quantity minimum/maximum 1.
- No country overrides. Tax mode: account default. Sandbox tax category: SaaS.
  Live eligibility, tax presentation and applicable merchant economics still
  require verification; this sandbox category does not settle live tax policy.

Catalog proof: `/home/roger/Documents/Codex/2026-10-08/task-2/ocr-sandbox-catalog.jpg`.
One official-test-card sandbox transaction was completed during the hosted proof;
no real payment was made.

## Local implementation

Branch `feature/ocr-page-billing-sandbox`; isolated worktree at
`/home/roger/Documents/Codex/2026-10-08/task-2/ocr-billing`.

`0006_ocr_retail.sql` is deliberately under **staging-migrations**, never the
production migration directory. It adds separate OCR orders, grants, refund
journals, balances/debt, page holds, immutable page usage/settlement and business
reservations. Speech balances, orders, holds and grants remain separate.

A separate OCR Durable Object reuses the existing serialized payment coordinator,
recovery alarms and paginated Paddle snapshots. Purchases use the allowlisted
sandbox product/price, 500-page entitlement, one item and one-time USD amount.
Verified completion grants once; paid/pending snapshots grant nothing. OCR
purchase admission uses OCR service/business capacity independently of speech.
Webhook events enter two independently processed queues; signed sandbox intake
can bypass the application's Access-cookie check only at the configured origin.
The approved exact-path Access exception and signed webhook are installed.
Sibling routes and the alias remain protected; Worker rejects descendants.

The account UI shows separate OCR pages and checkout. The importer uses local
PDF text first, displays requested page holds before explicit consent, validates
pinned model/page indices/usage, saves output privately, then settles all requested
pages atomically. Saved replay precedes balance/provider admission and costs zero.
Failed, incomplete or uncertain output releases customer holds while retaining
business reservations; stale holds expire after five minutes. A lost completion
acknowledgement recovers the durable ready receipt. Refund during dispatch closes
holds and prevents a late response from charging. Retries remain blocked for the
same account/input/model even after content expiry. Receipts remain in the ledger.

Sandbox business cost control has a separate cumulative $10 ceiling and reserves
8 cents per attempt, covering the existing ten-page margin estimate. It does not
alter or replenish the owner experiment's existing ledger/ceiling. This is a
safety allowance, not measured provider spend or guaranteed maximum invoice.

Staging now runs with both retail/payment flags enabled and synthetic provider
mode. Deployed code is commit `50edfd8`, Worker version
`dad16bbc-8f7e-46ce-8a11-b2df99f0dabc`. Production remains unchanged.

## Draft policies, pending live approval

- A valid blank page within a readable complete result currently counts; an
  entirely unreadable/blank result fails without customer debit. This is a
  sandbox default, not a live promise about blank pages.
- After the 24-hour content cache expires, retained receipts block another
  same-input/model attempt. Decide whether an explicitly requested fresh
  extraction costs credits or is absorbed by the business before enabling it.
- Proportional approved refunds currently revoke `ceil(refunded principal /
  original principal * 500)`, capped at 500. OCR debt tracks pages already spent;
  future OCR grants first cover that debt. Pending/rejected/reversed adjustments
  are handled idempotently. Increased revocation closes active OCR holds;
  speech credit/debt is untouched. Refund entitlement and these integer/debt
  policies require approval against actual Paddle terms before live launch.

## Verification

- `npm test`: all 38 test files passed, including the new OCR test file.
- `node tests/ocr-retail.test.js`: 29/29 cases passed with actual SQLite SQL
  and mocked Paddle/OCR. Purchase -> 500 pages -> two held/saved/used pages ->
  free replay -> full approved refund -> two pages of OCR debt -> later grant
  covering debt is proven; speech remains 12,345 throughout.
- Coverage includes catalog/environment/amount mismatch; paid-but-unconfirmed
  state; independent pending orders; duplicate webhooks/grants; concurrent holds;
  malformed/partial/failed OCR; private cache at zero balance; expired receipts;
  lost admission/completion acknowledgements; refund during dispatch; proportional
  rounding and reversed adjustments; serialized checkout/recovery.
- Final aggregate checks after PDF/synthetic changes: 38 test files passed;
  OCR tests 29/29, OCR browser proof, staging/public document regressions, local
  workerd PDF proof and staging Worker deploy **dry run** passed.
- Local staging and public builds passed. Encoder sources were copied from the
  existing verified local cache; no source downloads were needed.
- `node tests/ocr-retail-browser.mjs`: passed keyboard checkout, separate balances,
  draft policy copy, explicit page consent, mock settlement, zero-balance replay
  and unchanged speech. All external APIs were intercepted. Screenshots are
  `work/ocr-billing-proof/account.png` and `work/ocr-billing-proof/import.png`.
- Existing document browser regressions compare local staging/public readers.
  Both staging and public checks passed: existing owner OCR flows, Clear/late-response, clipboard, expiry, keyboard/mobile/ARIA and the unchanged public local-PDF flow.

## Hosted sandbox proof

Applied staging-only SQL migration and deployed the OCR coordinator. New sandbox
notification destination `ntfset_01m4e4xm2j7sxgt9aapmexq4x1` subscribes to the four
transaction/adjustment events at the canonical webhook URL. Roger installed its
signing secret directly; it was never read or disclosed. Access app
`456b52d7-0fc2-49bd-a0ba-b4f2b099509d` covers the webhook path only; existing staging
app/policy are unchanged. Unsigned exact POST returns401; siblings and homepage
remain Access protected; descendants are rejected by Worker.

- Transaction `txn_01m4e5da2qw2vr2ggsexne5vsy` completed; exactly one grant of500.
  Sandbox total $10.75 includes $0.75 test tax. Live tax/fee policy is unverified.
- Official signed replay `ntf_01m4e5k6qsyak5t0v7e6j3r0bv` delivered. No second grant.
- Fixed image-only PDF, SHA256
  `89d350f1375f503173ed61fc341d95ec319d6f483d6a57c702a09469bcef72f2`,
  consumed one page after explicit synthetic consent. No Mistral call.
- Attempt `89392250-6973-4ce0-b5be-8b21f59ec383` ready, one usage row and settlement.
  Reopening the same file loaded saved output with zero further credits/provider
  calls. OCR balance499/debt0; speech607047 unchanged throughout.
- Full refund `adj_01m4e67m6v2hht6fqh2mrx3kt2` submitted once. Pending approval
  event processed; credits correctly remain499 until approval. Final outcome
  will be recorded below when Paddle's automatic sandbox approval completes.

Full staging release verification passed: unit suite345 checks across38 files,
local browser parity/resume/reload/document checks, served metadata and hashes.
Owner OCR reservation row count remained6. Synthetic business allowance reserved
8 cents; actual provider spend0.

## Sandbox branding and independent local UI refinement

Sandbox descriptor now `PASTESPEAK`, matching live; speech product name now
`PasteToSpeech — Speech pack`. Staging receipt copy matches. IDs, prices and
entitlements remain unchanged. Default checkout link stays staging-isolated.
Live settings were read only. Both account websites still show
`speak.rogerpbrown.com`; Paddle makes this field read-only and requires contacting
sellers@paddle.com to change it. No support message was sent.

Roger requested peer screenshot/file entry actions. The local branch now shows
[Paste screenshot] or [Choose file] at the top of Open document, without a bottom
duplicate. Native chooser behavior and paid consent are preserved. Browser tests
cover both input paths, busy/unsupported clipboard states, keyboard access and
aligned equal-height buttons at320/390px. This refinement is **not deployed**.
Screenshot: `/home/roger/Documents/Codex/2026-10-08/task-2/ocr-source-actions.png`.

**Independent server PDF admission is now implemented.** Before any hold or
provider reservation, the server independently parses the page tree and requires
client/server count agreement, 1–10 whole-file pages and at most 6 MiB. Parsing
bounds objects, numeric/xref entries, nesting, page-tree visits, time and structural
stream expansion. It rejects encrypted, truncated, malformed, cyclic, duplicate
or inconsistent structures. Incremental object redefinitions and unsupported
structural filters/predictors fail closed; complex valid PDFs may require a
future supported parser enhancement. Content/image streams are not rendered or
inflated for admission. Adversarial tests prove rejection leaves balances,
business reservations and provider call count unchanged. A local actual workerd
proof covers plain and compressed ten-page PDFs, the fixed one-page fixture and
malformed/over-limit rejection, without remote bindings or provider calls.

The isolated worktree shares Git history with `/home/roger/workarea/paste2speech`;
it is the same repository on `feature/ocr-page-billing-sandbox`, not a separate
source fork. Its changes have not been merged into canonical `main`.

After hosted sandbox proof and policy review, separately approve a live catalog,
verified live tax/fee/refund presentation, provider credential availability,
production schema/business budget, customer admission, updated terms and staged
then public deployment. This branch deliberately rejects production OCR retail.
