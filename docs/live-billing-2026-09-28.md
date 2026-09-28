# Controlled live billing launch — September 28, 2026

Roger authorized the staged launch: verify payout/catalog/copy, enable signed
live notifications, allow one real purchase/refund check for his verified account,
and open customer purchasing only after that proof passes. The current checkpoint
keeps PUBLIC_LAUNCH_OPEN=0 and LAUNCH_TEST_EMAIL=rogerpbrown@gmail.com.

Paddle payout settings visibly reported saved (USD bank transfer, $100 threshold).
Live catalog verified $10 USD, one-time, 1,000,000 characters. Default payment URL
is https://pastetospeech.com/api/billing, approved; descriptor is PASTESPEAK.
Google's current published WaveNet rate is $4/million characters after the free
allowance (https://cloud.google.com/text-to-speech/pricing).

The older public candidate needed current progressive playback, long readings,
captioned MP4 export and quota-maintenance flags preserved. Public-mode progressive
requests retain customer eligibility and atomic provider-budget controls; fixture
controls stay staging-only. Pricing, terms and account copy now match the reader.
The public release command checks staging commit/assets and runs browser parity,
then verifies production metadata and asset digests after deployment.

Fresh private production backup: work/live-billing-20260928/before.sql. Restore,
integrity and foreign keys passed; zero open reservations, zero orders, aggregate
balance 14,628 characters. All 15 migrations already applied; no schema change.
Retain existing accounts, identities, credit and usage. Never restore this backup
over later financial records. Public cost ceilings remain 2.5m characters/day and
12.5m/month. Keep deployment's existing RETIRE_BEFORE cutoff fixed.

Use the shared checkout for this launch. Once production-public is deployed,
continue with release:reader:public; the historical trial release command is not
a rollback path for paid accounts. To pause, turn off ENABLE_PAYMENTS and
ENABLE_LIVE_SYNTHESIS in the public configuration and deploy compatible code,
keeping email, account recovery, webhook intake and reconciliation available.

## Deployed checkpoint

Commit 7996c547b50dc946d2d296faa109a451972eb3f0 passed 227 tests,
browser parity and Resume checks. Staging version
593d6577-fb45-48cd-96e9-424452607e35 and production version
cda866bf-d6b8-4d6e-9ca4-b631aa8b2ddb deployed; served metadata and every
release asset digest verified. Public checkout remains gated.

Existing live destination ntfset_01m35ct3p29vxze92gt4tmwfdd activated,
retaining its URL, secret and 12 subscribed events. Opening Roger's checkout
created txn_01m3n4rsa3djc82vyehgew9rph (order
574919a6-9feb-4526-9c69-d42e71df1d7b). Two actual signed notifications were
accepted and processed with zero failed attempts. Order remains pending;
balance remains 14,628. No payment or refund has been made by the agent.
Checkout currently displays $10.75, subject to final billing-location tax.

Next: Roger completes the live checkout after reviewing its final total;
verify exactly one million-character grant and duplicate delivery safety;
perform the approved capped speech/refund proof before opening public purchasing.
Do not create another order while this pending checkout exists.
