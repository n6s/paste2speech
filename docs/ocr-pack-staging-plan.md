# OCR Pack staging plan

Status: proposed design only, October 6, 2026. Agreed offer: **$10 USD for
500 OCR page credits**, one credit per cloud-processed page, separate from
speech-character credit. No catalog object, customer charge, balance migration
or production deployment is authorized by this document.

The completed staging release is `eb5137dced0eb1686b2c1395e58b8e3262cec452`,
Worker `008a9399-3263-4d34-8fff-bf0d2fead7a3`: timing/recovery guidance and
page-based owner provider-cost reservations. Its cumulative $10 safety ceiling
carries all $5 of prior reservations, leaving $5 room. That experiment ledger is
**business cost control**, not the proposed customer OCR page balance.

## Existing implementation and constraints

- [`modes.js`](../cloudflare/reader/modes.js) `paymentConfig` defines a single
  $10 / 1,000,000-character speech offer. No OCR retail offer exists.
- [`payments-do.js`](../cloudflare/reader/payments-do.js) serializes payment
  creation/reconciliation, recovers uncertain creates and validates customer
  access; its purchase capacity gate currently checks speech capacity.
- [`providers.js`](../cloudflare/reader/providers.js) creates an order-bound
  Paddle transaction, fetches transaction state and paginated adjustments.
- [`prepared/payments.js`](../cloudflare/prepared/payments.js) and the existing
  speech `payment_apply` SQL trigger validate/apply grants and refund revocations.
  [`prepared/ledger.js`](../cloudflare/prepared/ledger.js) pending-order queries
  currently assume one speech purchase per account, not independent offers.
- [`document-ocr-owner.js`](../cloudflare/reader/document-ocr-owner.js) admits
  verified owners only, caps cloud files at 6 MiB, requests at most ten PDF pages
  or one image, validates pinned model/page indices/usage, writes private cache
  before confirming readiness, and forbids automatic retries. Cache identity
  includes account, identical input bytes and pinned model; TTL is 24 hours from
  completion. Its current strict response gate does not support partial success.
- No merchant-specific Paddle fee schedule/net payout, refund treatment of fees,
  tax treatment, catalog approval or OCR product eligibility has been verified.
  Published OCR API estimates do not establish actual invoiced cost or profit.

## Smallest staging implementation

1. **Separate page ledger.** Add staging-only OCR tables for account balance and
   refund debt, orders, immutable grant/adjustment events, extraction holds and
   page usage. Keep speech `accounts.balance`, grants, reservations and refund
   debt unchanged. Holds, usage and releases operate atomically and have unique
   account/attempt/page keys. Keep business-cost reservations in their existing
   ledger; failed provider calls never consume customer page credits.
2. **Typed OCR offer and orders.** Add a distinct sandbox catalog mapping for
   `OCR Pack`, amount 1000 USD cents, 500 pages. Server selects the allowlisted
   offer; client cannot choose arbitrary quantity, price or grant amount. OCR
   pending-order lookup is independent of speech orders. Reuse serialization,
   signed webhook verification, provider snapshots, pagination and uncertain
   creation recovery, with explicit OCR routing. OCR purchases check OCR service
   availability, not speech capacity. A completed, verified sandbox transaction
   grants 500 pages once; pending/paid-but-unconfirmed states grant nothing.
3. **OCR preflight.** Try local PDF extraction first; usable local extraction
   consumes no OCR credits. Check same-account exact-input/model cache before
   balance or provider admission; a saved replay consumes no credits. State the
   requested cloud page count, page hold, remaining page balance and separate
   speech cost before consent. Current importer submits the whole bounded PDF
   when local extraction is unsuitable, so all submitted PDF pages count; do not
   imply only its difficult pages count. An image counts as one page. Insufficient
   balance blocks cloud submission; never silently truncate or auto-buy.
4. **One durable attempt, one settlement.** Reserve the requested customer pages
   atomically before provider dispatch. Preserve the existing dispatch checkpoint
   and duplicate-request exclusion. After validated output is saved privately,
   apply successful page usage, close/release the hold and mark the receipt ready
   in one D1 transaction. Never decrement credit merely because the provider
   accepted a request or returned HTTP 200. A lost acknowledgement is recovered
   from durable receipt/usage state, without a second debit or provider call.
   Failed/invalid/unconfirmed attempts do not bill the customer; release their
   customer hold while retaining the business-cost reservation and attempt audit.
   An uncertain attempt cannot be automatically retried just because that hold
   was released. If a closed unconfirmed attempt later produces a saved result,
   do not surprise-debit the customer: absorb it as business cost.
5. **Clear accounting in the reader/account UI.** Show separate speech-character
   and OCR-page balances and purchase buttons. Example: “4 pages extracted;
   4 OCR credits used; 496 remaining.” Cached/local reuse says “0 OCR credits
   used.” Clear does not erase financial history; status/re-upload recovery never
   creates a new payment or OCR attempt. Server owns price/count/usage decisions.
   Expired receipts remain visible even when their document content is gone.

## Policy decisions before implementation

| Decision | Recommended staging default to review |
| --- | --- |
| Purchased credit expiry | No scheduled credit expiry, matching the speech pack; content cache still expires after 24 hours. This policy has not yet been approved. |
| Repeat after cache expiry | Keep the old receipt, make no automatic request/debit, and explain that no saved content remains. Decide whether an explicitly requested new extraction uses new credits or is absorbed as business cost. Neither is silently implied by “free cache replay.” |
| Refunds/chargebacks | Support proportional unused-credit refunds, subject to verified Paddle terms and applicable requirements. Keep OCR refund debt separate; consume refund snapshots idempotently and never revoke speech credit. Decide integer page rounding and handling after pages have been spent. |
| Blank/poor-confidence pages | Disclose whether a submitted blank page counts. Recommend charging only for valid, durably saved page output, with low-confidence results labelled; confidence is not a guarantee of accuracy. Decide treatment of a valid blank page before promising a count. |
| Partial results | Initially preserve the current all-requested-pages success gate: full validated success costs N pages; rejected/incomplete output costs zero customer credits. If partial success is later approved, persist per-page outcomes and show “X of N pages saved; X credits used; N−X released.” Never hide missing pages or resubmit them automatically. |
| Page selection and mixed PDFs | Initially keep the explicit whole-file cloud count (up to ten pages). Selective cloud processing of poor pages and user-selected ranges are later scope, not assumed features. |
| Cached model changes | Identity includes pinned OCR model; a changed model is not the same cached extraction. Require explicit consent/policy for any fresh attempt. |

The price and separate unit are agreed; the defaults above are review proposals,
not implemented customer terms. Actual Paddle merchant fees, refund constraints,
tax presentation and product/price eligibility remain external unknowns. A live
catalog action requires a concrete reviewed setup and separate authorization.

## Verification and rollout gates

Use synthetic documents and mocked Paddle/OCR calls first. Verify concurrent
holds and insufficient balances; duplicate webhooks/returns; successful grants
once; stale or mismatched catalog/environment/amount snapshots rejected; failed
and uncertain OCR releases without customer debit; partial/invalid outputs;
cache at zero balance; expired-cache consent; lost commit acknowledgement;
refund/debt reconciliation; independent pending purchases; and byte-for-byte
unchanged speech balances throughout OCR activity. Reuse keyboard/mobile/ARIA,
Clear, late-response, elapsed-time and read-only status checks. No private uploads
or paid provider calls are needed for this development gate.

After policy review: implement and test locally, prepare a sandbox-only catalog
request for approval, then stage with payments behind an OCR-specific flag.
Exercise sandbox transactions using explicit test authorization and verify
hosted assets/accounting. Public access, production migration, live catalog and
customer charging remain separate future approval gates. Do not disable the
existing owner safety ceiling as a side effect of introducing retail credit.
