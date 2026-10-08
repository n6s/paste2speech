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
- Full refund `adj_01m4e67m6v2hht6fqh2mrx3kt2` submitted once and approved
  automatically at16:50 UTC. Pending event left499 credits unchanged; approved
  signed event `evt_01m4e6r0325cdygdhv02gsek5m` processed and revoked500.
  Final OCR balance0/debt1, one grant, one usage, one refund journal delta-500.
  Speech balance607047 unchanged. No real payment or provider call occurred.
  Browser attachment to prior result tabs was interrupted after this proof;
  approved refund and final ledger were verified through read-only APIs.
  Free replay was verified before refund; post-refund hosted UI replay was not
  repeated. Local tests cover replay with exhausted/refunded allowance.

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

## Approved owner testing support (October 8, later checkpoint)

Roger approved local production-capable accounting and staging owner testing,
plus one exact nonprivate one-page Mistral request with an $0.08 maximum and a
separate cumulative $1 personal provider allowance. Production is untouched.
No live product or customer policies were approved.

Staging migration0007 preserves old credit, refunds and reservations. Capacity
reserves at least one conservative cent per outstanding page and each pending
500-page purchase; concurrent checkout cannot oversell that allowance. New
provider reservations use ceil(0.8*pages) cents (1–8), retained on failure or
uncertainty. Two durable owner permits separately enforce the exact one-call
proof and $1 personal allowance; there are no resets, refills or automatic retries.
The owner must choose personal files and agree to Mistral upload consent.

The reader displays available/held/spent OCR pages and the personal provider
allowance, updates after settlement/failure/replay, and only polls read-only
balance during pending work. Speech accounting remains separate.

Production schema0015 accepts sandbox/live catalogs and includes capacity
constraints but seeds no production budget. Public OCR approval/processing/payment
flags remain0. Local public configuration contains the future OCR binding only;
it was not deployed. Live activation still needs catalog IDs, secure Mistral
setup, approved policy copy, customer rollout and verified provider/webhook checks.

Local tests35 OCR cases/351 total and browser balance checks cover capacity,
concurrent provider limits, retained failure costs, cross-account isolation,
paused purchases with refund reconciliation, replay and separate speech state.

The exact proof fixture is tests/fixtures/ocr/live-provider-proof.pdf,12328bytes,
SHA25644b9cf5850e50b3f63ea7ad32fed772f680dd8b44c28d316d99905432209f81b.
It contains only: Synthetic OCR billing proof. No private document content.

Before new deployment, the account already had499 pages/debt0 from a second
Paddle sandbox transaction txn_01m4e80bhmqbr7mkd1ynnbq8jt; no additional purchase
is needed. Speech606985 at this checkpoint (Roger's own intervening usage);
the capacity migration preserved that value. Provider permits initially reserved0.

## Real provider proof completed

Owner staging release547cd89, Worker0560ef8b-bb33-42c5-9f91-ee35ea9d8bf0,
served metadata/assets verified. Exactly one approved real Mistral request for
the pinned nonprivate fixture succeeded. Attempt79f16e0f-16c5-4186-9aed-b504156b4086
is ready, pages1/consumed1/released0. OCR balance499→498; cumulative spent2
includes the earlier synthetic page. Speech606985 was unchanged by this proof.

One conservative cent was reserved from the separate8-cent proof permit,
max_calls1/calls1. Its enabled flag is now0. This is not a measured invoice;
current list estimate for the page was$0.004. The personal100-cent permit remains
enabled with reserved0/calls0 at completion. No personal document was uploaded
by the assistant. No new sandbox checkout was needed.

Clear/reopen of the same fixture loaded the saved real result with no new debit
or provider call; balance498 and both counters were unchanged. Raw text matched
the test image. Visible available/held/spent countdown is verified; replay now
preserves the provider-allowance label. This final refinement gets a staging-only
release. The production customer rollout gate is tested but remains disabled.

Proof: /home/roger/Documents/Codex/2026-10-08/task-2/ocr-real-provider-success.png.
Final local coverage36 OCR tests and352 total; full release checks are required
before the final refinement deploys. Live customer policies/catalog and public
activation remain pending separately.

## Pixel7 screenshot clipboard fallback

Roger reported that Paste screenshot returned “No image was found” after a screenshot action on Pixel7 Android. That exact branch means clipboard.read resolved without an image/* item; it does not establish an empty native clipboard. API absence/focus and read rejection have separate messages. The foreground click calls read immediately, and native image paste into the text box already uses the same validated importer.

Updated the hint and empty/image-unexposed message to explain browser exposure and direct the reader to Choose file for the saved screenshot. No Android user-agent block or native URI fetch was added. Chromium supports Android PNG/bitmap reading, subject to MIME and URI access; Android native clips can hold content-provider URIs. References: https://raw.githubusercontent.com/chromium/chromium/main/ui/android/java/src/org/chromium/ui/base/ClipboardImpl.java (getImageUri, getPng, hasImageMimeType); https://developer.android.com/develop/ui/views/touch-and-input/copy-paste . These sources do not identify the exact cause on Roger’s installed browser.

Mock browser validation covers PNG/JPEG/WebP, empty/text/URI types, permission denial, absent API, focus, multiple images, stale reads, native paste, and 390/320px saved-file fallback with zero OCR POSTs before consent. Desktop Chromium emulation verifies layout/logic only. Pixel7 browser/version and a real device retest remain needed to confirm clipboard behavior. Debugging made no real provider requests or private uploads; production remains untouched.

## Unified native paste

Roger requested one native paste target for text and images. The text box now visibly explains both paths and links its accessible description to that hint. Plain text retains browser selection insertion and undo; HTML retains the existing inert HTML-to-Markdown conversion. Image-only file/MIME paste opens the existing validated document OCR options with unchecked consent, without OCR dispatch or credit debit. The native file event works only when the browser actually supplies an image; Choose file remains available.

Previously image capture took precedence and could silently discard accompanying text. Mixed image/text now keeps the normal text paste (including selection replacement and existing HTML conversion), explains the mixed content, and asks for image-only paste or Choose file to extract the image separately. It does not silently discard text or fetch image URLs/native URIs. Busy imports reject both text and image paste; the HTML handler also respects readOnly. New input/native paste cancels an outstanding button clipboard read so it cannot import over newer work; existing importer result guards remain.

Mock browser checks passed for native PNG/JPEG/WebP, HTML-only/text-only, mixed plain/HTML with selection, image-only HTML representations, busy text/images, stale async reads after edits/new text/native image, multiple/unsupported inputs, consent, Clear, caches and phone-width fallback. No real Android clipboard result is claimed: Chrome Beta on Pixel7 still requires the pending device long-press Paste test. No real Mistral calls, private uploads, production deployment or speech billing changes.
