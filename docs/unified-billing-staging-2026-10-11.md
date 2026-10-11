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
