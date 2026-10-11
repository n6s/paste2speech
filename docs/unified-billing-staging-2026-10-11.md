# Unified credits staging rollout — October 11, 2026

Roger approved a fresh unified wallet on staging: $10 USD buys 1,000 credits,
speech uses one credit per 1,000 cleaned characters counted exactly, OCR uses two
credits per page, and Summary remains free. The separate sandbox product was
explicitly approved later. Production billing, balances and live catalog are not
approved for cutover. Production UI promotion remains commit `4d6943f`, Worker
`f0fb5756-50c5-4ca6-9289-abbbf21fa6a9`.

One credit is 1,000 integer units. Speech reserves one unit per Unicode character
in its submitted section plan, charges successful sections only, and releases
unused units atomically. OCR reserves 2,000 units per independently verified
page; complete validated saved output charges the whole document, and failed or
uncertain work releases the customer hold. Cached OCR and prepared audio replay
are free. Existing provider budgets, permits, consent and uncertainty controls
are retained. Summary has no financial wallet operations or paid fallback.

`staging-migrations/0010_unified_wallet.sql` is additive and is deliberately absent
from the production migration directory. Old purchases, refunds, grants, usage,
identities and balances survive unchanged. Immutable wallet provenance on each
speech reservation and OCR attempt routes old in-flight settlements back to the
original ledger. New work uses only the fresh wallet; no legacy balance is copied.
The isolated, idempotent owner test grant is 100 credits (100,000 units), not a
production grant or customer purchase.

The new catalog is sandbox only:

- Product: `pro_01m4ntya23sa7g6mr4kv7yepyc`, PasteToSpeech — Shared credit pack.
- Price: `pri_01m4nv10a0b8nq3tpnp78shzbj`, USD 10.00, one-time, quantity exactly one.
- Tax category matches the existing speech product: Standard digital goods.
  The base price excludes applicable tax; final checkout total shows tax.
- No subscription, automatic refill, scheduled credit expiry or discount entry.
  Refunds proportionally revoke integer units; spent credits become debt that
  blocks new work and is covered by releases or a subsequent purchase.

A separate named `unified-v1` instance of the existing PAYMENTS Durable Object
binding serializes transaction creation and reconciliation. Separate versioned
orders, grants, payment commands, refund events and webhook intake prevent old
SKUs or deliveries from creating shared credits. Raw-body HMAC verification,
remote transaction and complete adjustment reads, duplicate event keys, delayed
webhook retry and lost-acknowledgement recovery reuse the existing integration.
No new binding, secret, API credential or persistent access grant is needed.

The unified capacity view counts spendable shared balances, all shared holds,
pending shared orders and existing legacy OCR holds. Legacy balances remain in
their original view but cannot admit new work while the fresh wallet is active.
The original `ocr_capacity` view and legacy purchase guards are unchanged. The
cumulative provider ceiling and owner permit still gate every new OCR dispatch;
credits cannot expand those limits. Neither capacity nor financial history is
restored from an old backup during rollback.

Validation artifacts are under `work/unified-billing-staging-2026-10-11/`:
private before/after backups, exact original-row preservation checks, isolated
accounting tests, a built-browser proof with intercepted Paddle/API/provider
requests, release logs, hosted evidence and sandbox checkout evidence. Local
checks cover exact fractions, cross-provider contention, idempotency and lost
acknowledgements, partial success, refunds/debt, immutable history, capacity,
zero-credit free Summary, explicit consent and responsive cost/balance UI.
Actual sandbox checkout uses only [Paddle's documented test cards](https://developer.paddle.com/sdks/sandbox).
No real payment/refund or paid provider call is part of validation.

Before any future production cutover, recheck account ownership, old purchasers,
refunds, balances, debt and open work against the live app and Paddle. Review live
SKU/terms, funding/capacity and the zero-opening-wallet decision with Roger, then
obtain explicit production billing deployment approval. The current stage-only
flag fails closed outside the staging/sandbox environment. Do not copy sandbox
IDs, grants or credentials into production or replay historical purchases.

## Sandbox end-to-end verification

The official Paddle 4242 test card completed sandbox transaction
`txn_01m4nwgddwpq9ww70zkqv65qf2`: USD 10.00 subtotal, zero tax, one-time.
Exactly one purchase grant added 1,000 credits. Nine observed signed Paddle
notifications processed successfully. The USD 1.00 partial refund removed 100
credits at 16:30 UTC; the existing USD 9.00 remainder request was approved at
16:40 UTC and removed the remaining 900 credits. Both approvals reconciled via
background webhook before reopening billing. No refund request was repeated.
Repeated account refreshes and remote snapshots retained exactly one grant and
two refund events totaling 1,000 credits removed.

The final wallet had 96.057 available credits, zero holds and zero debt:
100 test credits + 1,000 purchased - 1,000 refunded - 3.943 live speech credits.
The 3.943-credit usage comes from five separately recorded live WaveNet jobs
between 16:29:37 and 16:30:08 UTC, with 51 successful sections and 3,943 submitted
characters. These are billable provider requests, distinct from our cached test
job `9c9c7658-4fad-4317-8613-524b61ee6b5a`, which has no reservation. The five jobs
were recorded sequentially while our checks ran; the ledger does not identify
the initiating person/client or whether they belong to one logical reading.
Do not attribute that activity to Roger personally or to synthetic tests.
All existing records and this additional live usage remain preserved.

The hosted Chrome smoke check displayed the exact 0.004-credit estimate for
four cleaned characters, free Summary, eight cached audio sections ready for
offline listening, and a whole-file 2-credit/one-page OCR consent notice with
submission disabled before consent. The old expired OCR fixture correctly
blocked automatic retry. No live OCR or speech provider request was made by
these smoke checks. Synthetic local accounting/browser tests cover completion,
failure/release, uncertainty, cache replay, cross-provider contention and debt.

The account status now supplies a specific unavailable-checkout reason so a
correctly configured catalog with full processing capacity says purchases are
temporarily paused and existing credits remain available. Catalog setup,
account eligibility and payment pauses remain distinct; pending purchases can
still reconcile when capacity is full. Regression tests check that the capacity
message does not enable checkout, create an order or change a balance.

A required playback parity check reproduced a completed-file handoff race: a
late event from the old buffered audio could consume the pending saved position
before the replacement file loaded. Full-file playback now waits for its own
metadata before applying that position. The parity fixture deliberately sends
an old-source pause event during the switch and verifies the saved place in both
built variants. Only staging is deployed; production remains on its earlier
approved UI release.
