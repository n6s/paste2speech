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

## Paid purchase and approved refund request

Roger completed checkout and authorized the exact $10.75 refund after being told
of the $1.04 processing fee. Paddle transaction is completed; subtotal $10.00,
tax $0.75, total $10.75. Exactly one transaction-keyed grant of 1,000,000
characters exists; account balance increased from 14,628 to 1,014,628.
Eight signed transaction events processed with no failed attempts, and zero
open reservations. The browser also reports purchase verified.

The stored API key cannot create adjustments (403); no API refund was created.
The authorized full-amount refund was submitted once through Paddle's dashboard.
Adjustment adj_01m3n5563jypwwwbc159tx9tgn has total 1075 USD cents and
pending_approval status. Paddle labels the item-based adjustment partial even
though it covers the complete $10.75 transaction total. UI reports Full refund
requested. Nine signed events now processed without failures or pending intake.
Credit correctly remains 1,014,628, revoked=0 while approval is pending.

Public launch remains closed. Next read this existing adjustment, never submit
a duplicate. Once approved, verify exactly 1,000,000 characters revoked and no
unrelated balance changes. Still outstanding: explicit notification replay,
capped production speech/download smoke check and final public launch promotion.

## Refund approved and reconciled

Paddle adjustment adj_01m3n5563jypwwwbc159tx9tgn is now approved for
$10.75; retained processing fee is confirmed $1.04. Production reconciliation
revoked exactly 1,000,000 characters and restored the original 14,628 balance.
All ten signed events processed with zero failed attempts and zero pending
events; zero open reservations. No manual balance changes were used.
The purchase/refund accounting proof passes. Explicit notification replay and
the capped production speech/download smoke check still precede public opening.


## Final launch checks

Replayed original transaction.completed notification ntf_01m3n51vyz78j7ytx2k43cwc25
through Paddle. Replay ntf_01m3n5myrftkf1dz7fj4zwnre7 reports Delivered.
Refund remained revoked by 1,000,000 characters; exactly one original grant remains.
Production WaveNet read 90 characters across two sections successfully; balance
is 14,538, with zero open reservations. Export produced a six-second MP4;
browser player loaded it (readyState 4) with an English captions track.
Direct automation file download timed out; the normal recording link and
embedded preview succeeded. No second provider generation was needed for export.

Roger authorized opening purchasing after these checks. Set PUBLIC_LAUNCH_OPEN=1
and update pricing copy, preserving budget limits, verified-email requirements,
private staging, financial history and current playback features.

## Public purchasing open

Release 50aa35cfd71c4cb865756ba6fb82306741efc8b5 passed all 227 tests and
browser parity/Resume checks, deployed to staging first and then production.
Production Worker version b49410e8-2ba7-41b1-ba08-16a6e6f77fcd serves the
verified release metadata and matching asset digests. Live settings read-back
confirms PUBLIC_LAUNCH_OPEN=1, ENABLE_PAYMENTS=1, ENABLE_LIVE_SYNTHESIS=1,
production-public mode and live Paddle. Anonymous checkout still requires sign-in.
Pricing visibly says speech packs are available now. Roger independently observed
the new URL in downloaded MP4 metadata. No further payments or refunds were made.
