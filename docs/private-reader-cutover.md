# Production cutover proposal — approval required

Do not execute this checklist as part of private staging work.

## Preconditions

- Complete the feature matrix and focused mobile acceptance, including sentence
  joins, rich clipboard paste, Clear/Paste & Play and Edit/Read switching.
- Resolve live email delivery and exercise sandbox purchase/reconciliation,
  partial/full refunds, debt recovery and fresh-browser identity recovery.
- Confirm the production provider account, Paddle live product/price/client key,
  approved origin/checkout settings, verified email sender and Cloudflare plan.
  Current payment adapter deliberately accepts sandbox credentials/endpoints only.
  A reviewed live adapter/configuration and production limits are required before
  cutover; do not repoint staging secrets or silently accept live keys.
- Reconcile existing entitlements: imported private pilots retain a server-only
  legacy entitlement; ordinary customers always use verified speech credit.

## Migration and route switch

1. Obtain separate approval for production credentials, live-data migration,
   quotas and route cutover. Record current Worker version and routes.
2. Quiesce Python speech admissions and purchases, finish or cancel reservations,
   and reconcile pending payments. Take an owner-only SQLite backup with a hash.
3. Run the offline converter on that explicit snapshot into a new protected file.
   Verify every account balance, debt, identity, outstanding order, purchase/refund
   state, legacy entitlement and session mapping against the source. Never import
   into the staging database and never log tokens or customer content.
4. Create a new empty production database/bucket. Apply schema once and import
   converted records without re-crediting historical grants. Verify counts and
   per-account invariants before allowing writes.
5. Deploy the production build with its own secrets, caps, expiry rules and
   payment coordinator. Keep admissions disabled until authentication and routing
   checks pass. Switch only the approved hostname, then perform small approved
   functional checks; monitor errors, reservations, usage and reconciliation.
6. Leave the old service quiesced for rollback until the reconciliation window
   completes. Never run two payment/credit writers against divergent ledgers.

## Rollback

Before any new transactions, restore the captured route/version and unchanged
snapshot. After new purchases or speech debits, first stop new admissions and
reconcile/export those changes; do not restore a stale balance snapshot. Retain
all audit data needed to account for provider attempts and payment adjustments.
Staging feedback and test payments are never promoted into production.

## Synthetic rehearsal evidence

`python -m unittest tests/test_reader_migration.py` passes both conversion and
rejection cases against synthetic snapshots. Source hashes remain unchanged;
exact balance and legacy identity/session checks are enforced by the converter.
No customer snapshot has been read or imported during this work.
