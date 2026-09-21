# Private sandbox payment recovery

A service-owned task checks Paddle at startup and every 60 seconds after a scan.
No browser callback, open tab, or incoming public webhook is required. Each scan
checks up to 50 recorded transactions, oldest checked first. With larger volumes
or slow API calls a complete round takes longer. Restarting the workstation catches
up from the durable ledger. This worker only reads Paddle; it never issues refunds.

For a completed transaction it verifies the server-created order, exact pack, price,
currency and quantity, then reads every page of adjustments before changing credit.
The grant and any existing refund are applied in one SQLite transaction. Repeated
checks and simultaneous browser refreshes cannot grant or revoke allowance twice.
Canceled checkouts release the pending-order slot for a new purchase.

Approved refunds, credits and chargebacks remove characters proportional to their
pretax subtotal divided by the original pretax subtotal. Tax-only adjustments remove
no speech allowance. Amounts are summed before rounding up to a whole character,
and removal is capped at one pack. Pending or rejected refunds do not remove credit.
A reversed original adjustment no longer removes credit; reversal notification rows
are not counted again. Chargeback warnings are informational, not approved refunds.

An already-spent allowance becomes a character shortfall, not a money charge. New
packs and unused reservation releases first cover that shortfall. A running reading
checks before each next section and stops if the account has a shortfall. A section
already being synthesized may finish and is still counted. Restart recovery releases
unused reservations through the same accounting path, so refunded allowance cannot
be resurrected. Existing downloaded audio is not removed.

Failed API checks preserve existing balances, show a delay notice, and retry. Refund
updates are therefore eventual: an offline workstation or Paddle outage delays
recognition. A purchase is never newly credited when its adjustments could not be
read completely. No raw Paddle responses, credentials or customer details enter logs.

The private pilot still permits Roger's explicitly selected non-allowance mode;
this is not the public paid-service enforcement boundary. Public rollout still needs
public hosting, signed Paddle webhooks plus reconciliation, refund policy/support,
and per-account usage views. No webhook endpoint or public deployment is added here.
An ambiguous transaction-creation timeout before its ID is saved still needs operator
recovery; this scan only recovers transactions already bound to a local order.

## Validation

Tests cover closed-browser recovery, restart, repeat/concurrent processing, partial
and full refunds, already-refunded purchases, tax-inclusive pricing, pagination,
failed reads, canceled purchases, chargeback reversal, and generation reservations.
Read-only checks against the actual sandbox API also use an isolated ledger copy.
Those read-only checks do not create or refund a payment.

On 2026-09-21 a separate end-to-end sandbox test refunded the full $10.75 on
transaction `txn_01m32j4k6c1gehf69y39nxkzgf`, adjustment
`adj_01m32m3tkbqrmdv6k0psdqc2jt`. While pending approval, the allowance stayed at
6,000,000. After Paddle approved, the background service removed 3,000,000
without manual reconciliation. The signed-in reader then displayed 3,000,000.
The next background check preserved that balance, confirming no duplicate
deduction. No real money moved.
