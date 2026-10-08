# OCR billing sandbox checkpoint — October 8, 2026

Roger approved local implementation and a Paddle sandbox catalog for a one-time
$10 USD pack of 500 OCR page credits. No automatic refill or renewal and no
scheduled purchased-credit expiry. Failed/incomplete extraction uses zero
customer credits. Live catalog, migrations, deployment, real payment, paid OCR
and expanded credentials remain outside this approval.

## Catalog created and visibly verified

Paddle sandbox, Roger Brown account:

- Product: `pro_01m4dzha8772sp5eezdtz2c0cz`, **PasteToSpeech — OCR page pack**, active.
- Price: `pri_01m4dzmjgsjt3feew9j7maj8w5`, **500 OCR page credits**, active.
- Base price: 1000 USD cents, one-time, no trial, quantity minimum/maximum 1.
- No country overrides. Tax mode: account default. Sandbox tax category: SaaS.
  Live eligibility, tax presentation and applicable merchant economics still
  require verification; this sandbox category does not settle live tax policy.

Catalog proof: `/home/roger/Documents/Codex/2026-10-08/task-2/ocr-sandbox-catalog.jpg`.
No sandbox transaction or customer charge was submitted through the dashboard.

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
Cloudflare edge Access still needs a narrowly configured webhook bypass before
actual Paddle delivery can reach that endpoint. No Access change was made.

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

Normal staging config records the sandbox IDs and new Durable Object binding,
but `OCR_RETAIL_SANDBOX=0` and `ENABLE_OCR_PAYMENTS=0`. Production configs,
production migrations and public UI are unchanged. No deployment happened.

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
- `node tests/ocr-retail.test.js`: 23/23 cases passed with actual SQLite SQL
  and mocked Paddle/OCR. Purchase -> 500 pages -> two held/saved/used pages ->
  free replay -> full approved refund -> two pages of OCR debt -> later grant
  covering debt is proven; speech remains 12,345 throughout.
- Coverage includes catalog/environment/amount mismatch; paid-but-unconfirmed
  state; independent pending orders; duplicate webhooks/grants; concurrent holds;
  malformed/partial/failed OCR; private cache at zero balance; expired receipts;
  lost admission/completion acknowledgements; refund during dispatch; proportional
  rounding and reversed adjustments; serialized checkout/recovery.
- Local staging and public builds passed. Encoder sources were copied from the
  existing verified local cache; no source downloads were needed.
- `node tests/ocr-retail-browser.mjs`: passed keyboard checkout, separate balances,
  draft policy copy, explicit page consent, mock settlement, zero-balance replay
  and unchanged speech. All external APIs were intercepted. Screenshots are
  `work/ocr-billing-proof/account.png` and `work/ocr-billing-proof/import.png`.
- Existing document browser regressions compare local staging/public readers.
  Both staging and public checks passed: existing owner OCR flows, Clear/late-response, clipboard, expiry, keyboard/mobile/ARIA and the unchanged public local-PDF flow.

## Proof gaps and exact next scope

**The local simulations are not a completed hosted Paddle sandbox checkout.**
The catalog was created in real Paddle sandbox, but no hosted Worker runs this
branch and no real sandbox event was delivered to its new handler. A hosted proof
needs approval to apply the new staging-only SQL and Durable Object migration,
release this branch to private staging, enable its OCR sandbox flags, configure
an authenticated sandbox webhook using existing securely managed credentials,
and configure a narrow Cloudflare Access bypass for that signed endpoint. No new
credentials/access were created. If the existing sandbox notification secret is
not already held securely by staging, Roger must securely supply/configure it;
do not display it in chat. A sandbox test checkout/refund costs no real money.

For the safest next proof, add a staging-only synthetic OCR fixture mode and use
synthetic input; do not enable real Mistral dispatch merely to prove payments.
That staging fixture would require its own reviewed deployment scope but zero
provider spend. An actual Mistral call remains separately approval-gated; propose
one synthetic 1-page call only with explicit consent, retaining the 8-cent
business reservation and cumulative $10 sandbox ceiling. Its actual invoice
cost/tax is not established by the published estimate.

**PDF admission needs independent server page counting before live launch.**
The reader currently obtains the whole-file count with PDF.js locally and sends
that count. The sandbox backend bounds dispatch to 1–10 requested pages and
verifies matching saved provider output; it does not independently establish
that those are all pages in the submitted PDF. A forged count can select a
prefix. Do not claim whole-file server enforcement until a bounded server PDF
parser is added/tested. The first retail image flow does not have this PDF gap.

After hosted sandbox proof and policy review, separately approve a live catalog,
verified live tax/fee/refund presentation, provider credential availability,
production schema/business budget, customer admission, updated terms and staged
then public deployment. This branch deliberately rejects production OCR retail.
