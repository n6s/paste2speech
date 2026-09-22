# Public WaveNet release candidate — September 22, 2026

Public activation remains gated. The existing owner-only production trial is not
changed by preparing this release. The live merchant account is still in Paddle
website verification; live catalog and credentials are not available.

## Implemented offer and controls

$10 USD, one-time, 1,000,000 Unicode characters; taxes shown by Paddle. Verified
email before checkout, no signup credit, no scheduled credit expiration. Audio
access expires after 24 hours. Support handles proportional unused-credit refunds,
subject to Paddle requirements and consumer rights. Full preparation remains the
playback design, with existing 20,000-character input limits.

Public mode uses the existing production Worker, D1, R2 and account identity.
The separate `wrangler.public.jsonc` candidate leaves trial configuration intact.
`PUBLIC_LAUNCH_OPEN=0` restricts paid access to `LAUNCH_TEST_EMAIL`; both checkout
and synthesis also start disabled. Opening public access is an explicit final step.

Paddle environment, key prefix, token prefix and catalog must agree. New orders
snapshot the offer. Raw-body signed webhooks persist event IDs before acknowledgement;
a serialized coordinator fetches authoritative transactions/adjustments and grants
once. Lost creation responses recover from transaction webhooks; absent evidence
leaves the order pending for support, never resubmitted. Browser callbacks only
request reconciliation. Existing polling remains active with checkout disabled.

Daily and calendar-month UTC dispatch budgets are 2,500,000 and 12,500,000 submitted
characters: $10/$50 at Google's checked $4/million list rate, ignoring free usage.
Every section obtains an atomic durable admission immediately before its provider
call. Duplicate/uncertain admissions never retry the provider. Period rollover is
checked per section; unrelated concurrent readings can consume remaining capacity
and interrupt a preparation safely. Successful sections consume customer credit;
unstarted/failed sections release the remaining reservation. Budget and customer
credit are independent. Provider attempts are conservatively retained even if a
crash occurs before Google receives a request. These are not total cloud bill caps.

One open public preparation per account is enforced transactionally. Customer,
email, checkout and reading endpoints have rate limits. Public feedback continues
to use the original production feedback database and review mode.

## Verified evidence

- 175 Node tests, including public/trial durable execution with cached Google audio,
  ownership, Range, restart, dispatch budgets/rollover, concurrency, webhook
  signatures/deduplication, lost creation response, refund debt and chargebacks.
- Three synthetic offline migration tests; converter updated for additive columns.
- Local Worker API integration and integrated mobile-layout reader checks: complete
  cached preparation, 40 sentences, navigation/seek/speed, MP3/VTT, original text,
  email recovery and late cancellation. No paid API calls in these checks.
- Public account browser check uses mocked Paddle: verified-only buy button, live
  SDK mode, purchase handoff, reconciliation, capacity pause, retained credit and
  policy page. This is not proof of live checkout or real device playback.
- Production ledger exported to owner-only `work/public-launch-review/` storage.
  Snapshot SHA256: 3d85490e8e46e481ff36250ab188bb14bacee149de379e2d9ddac2809f05b370.
  Local additive migration preserves every original column/value in 26 tables;
  restored copy passes integrity and foreign-key checks. Refresh immediately before
  any production migration; this snapshot is not a rollback over new transactions.
- Live Cloudflare secret-name inspection: production has Google, Resend, sender and
  feedback bindings, no Paddle bindings. No secret values were printed.
- Paddle UI is at onboarding step 3, requesting pricing, terms, privacy and refund
  URLs. Domain verification and merchant approval are not established.

## Remaining release gates and exact procedure

1. Publish the pricing/policy pages in an approved trial-mode maintenance release
   before completing Paddle onboarding. After a fresh backup and drained owner
   reservations, apply additive migrations 0010–0011 and deploy the tested
   `release:reader:production` build: it includes `/pricing` and `/terms` while
   retaining owner-only WaveNet, its existing lifetime cap and disabled checkout.
   This resolves the onboarding dependency without opening paid public access.
   Finish Paddle onboarding after that approved publication. Pricing URL: `/pricing`; terms, privacy and refunds: `/terms`.
   Verify approved `speak.rogerpbrown.com` and its default payment link. Do not claim
   approval merely from a submitted onboarding form.
2. Create/verify the live one-time $10 USD catalog; record the actual product/price
   IDs in `wrangler.public.jsonc`. Provide production-only `PADDLE_API_KEY`,
   `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET` through protected secret delivery.
   Never reuse sandbox keys. `scripts/check-public-providers.py` performs read-only
   local credential/catalog checks without printing values.
3. Configure the live notification destination at
   `https://speak.rogerpbrown.com/api/billing/webhook`, subscribing to transaction
   creation/completion/update/cancellation and adjustment creation/update. Confirm
   delivery and signatures. Existing Access-protected staging uses polling; do not
   weaken its Access policy to expose a webhook.
4. Confirm Workers capacity and sender delivery; approval of a paid hosting upgrade
   is separate. Check Google pricing again before activation. Keep 100,000-character
   staging lifetime allowance unchanged; no test balance is imported to production.
5. Refresh production backup, quiesce new owner speech briefly, finish existing
   reservations, apply migrations 0010–0011 to `LEDGER`, and verify balances,
   identities and original trial counters unchanged. Do not migrate `DB` (feedback).
6. Run `npm run release:reader:public`. Review the clean commit, configuration,
   migrations and recursive asset hashes in `public-release-manifest.json`.
   Deploy only the approved candidate with `--deploy --production-approved`.
   The default command is local-only. Existing trial release command remains intact.
7. With `PUBLIC_LAUNCH_OPEN=0`, approve enabling synthesis/checkout for the verified
   test email only. One live pack costs $10 plus any checkout tax, with payment
   processing fees potentially retained after refund. A <=1,000-character smoke
   reading budgets <=$0.004 Google synthesis. Obtain the exact displayed total and
   explicit real purchase/refund approval before executing it.
8. Verify one grant, exact speech debit, account recovery in a second browser, actual
   saved MP3/VTT, approved refund reversal and zero stranded reservations. Repeat
   targeted device acceptance if the changed account flow affects playback.
9. Commit and approve `PUBLIC_LAUNCH_OPEN=1`. Test a fresh public customer journey.
   Do not enable this while live account/catalog/signature checks remain incomplete.

## Monitoring, support and rollback

The scheduled Worker records content-free `operations_alerts` for 90% budget usage,
stuck reservations (>15 minutes), delayed webhooks (>5 minutes), uncertain purchases,
payment errors and recent speech failures. Console alerts occur on transition, not
on every unchanged check. Logs omit input text, email, credentials and tokens.
Configure an approved operator notification/heartbeat after deployment: inspect
immediately, after one hour and at 24 hours, report only actionable changes and the
final checkpoint. Logs alone do not constitute delivered operator notifications.

Inspect `provider_periods`, `operations_alerts`, pending `webhook_events`,
`payment_sync` and aggregate open reservation counts. Keep invoice costs separate
from conservative admission totals. Do not run automatic paid probes or resets.

For a support refund, verify identity/order and wait for active reservations to
settle; cap the requested unused-credit amount by both remaining unrevoked purchase
credit and current available account credit. Review the Paddle preview and tax
allocation, submit only an approved refund, then read back its authoritative
adjustment and resulting credit. Never issue a refund by directly editing balances.

On failure disable `ENABLE_PAYMENTS` and `ENABLE_LIVE_SYNTHESIS`, keeping account
recovery, reconciliation and free voices available. Roll back compatible application
code only. Keep the additive ledger, grants, webhook inbox and provider admissions;
never restore a stale financial snapshot. Reopening the original pre-billing Worker
would hide account recovery/reconciliation and is not the normal paid-launch rollback.

Source branch already includes current main; unrelated uncommitted main-checkout
Python/container changes remain excluded and preserved. No push or public activation
is implied by a local commit.

References: https://developer.paddle.com/build/go-live-checklist/
https://developer.paddle.com/webhooks/signature-verification
https://cloud.google.com/text-to-speech/pricing

## Staging deployment checkpoint

Commit `34e00dd` deployed to isolated staging as Worker version
`06bc301a-2111-4dc8-ae5c-af1fd31aa392`. Migration 0010 applied to staging only.
Budget before and after: 23,978 / 100,000, unchanged. No synthesis, purchase,
refund, email or production change was submitted by this deployment. Browser
connection interruption prevented a fresh authenticated staging acceptance check;
previous live sandbox evidence does not substitute for retesting this release.

Final staging update: source `7682b7a`, Worker version
`2b4d94c7-90ef-4a15-8435-dc2a94be2c7e`. Eleven migrations applied; read-back shows
23,978 / 100,000 speech characters, zero payment errors and zero open reservations.
No new real-device, email or sandbox transaction acceptance is claimed. Public
pricing/account copy was subsequently refined locally; it does not change staging's
sandbox account flow. Production remains owner-only with checkout disabled.

## Production policy publication

The requested pricing and policy pages were published in trial mode from `a134249`,
Worker `8ea0d73f-47bf-474d-a090-e5e7000a7ec7`, after a fresh restore-tested backup
and migrations 0010–0011. Production accounting read-back remained exactly:
2 accounts, 95,827 available characters, 1 grant, 0 orders, 0 open reservations,
4,173 / 100,000 trial admissions. No email, synthesis, checkout or refund request
was made. The deployed mode remains `production-trial`; public purchasing is off.
Public launch approval remains outstanding. This publication implements the
requested public information pages and does not activate customer billing.

Final production policy Worker: `7f8edd54-1f11-4536-b3c1-236de0e6e18e`, source
`698e668`. Public HTTP verification confirms `/pricing` and `/terms` return HTML
with the expected content; the reader retains trial wording and billing status
reports `trial=true`, `configured=false`, `emailConfigured=true`. An initial
immediate HTTP check returned 403; subsequent curl verification succeeded.
These URLs are now available for Paddle website verification. Live merchant
approval, catalog/secrets, fresh staging acceptance, approved real checkout/refund,
and public activation remain outstanding.

## Live Paddle setup checkpoint — 2026-09-22

Created and read back in the live dashboard:
- Product `pro_01m35bhyw23tf3f8yfafsezark`: speak.rogerpbrown.com — Speech pack;
  account-bound Google WaveNet speech usage, Standard digital goods tax category.
- Price `pri_01m35bk8byw8drpd8t2rhayene`: USD 10, one-time, 1,000,000 characters,
  quantity minimum/maximum 1, automatic tax based on location, no trial.
- Checkout discount field disabled; statement descriptor saved as `SPEAKRPB`.

The public candidate configuration now references these live IDs, with payments,
synthesis and public launch still disabled. No deployment or transaction occurred.
Merchant review and domain approval for `speak.rogerpbrown.com` remain pending.
The default payment link `/api/billing` did not persist after saving; it remains
unconfigured and must be resolved before activation.
The existing live API key is revoked; no client-side token exists. Payout setup
is incomplete and requires the owner's private details and payment destination.

## Live credential setup — 2026-09-22

Owner approved creating the checkout token/webhook credentials and installing
credentials in Cloudflare with public purchasing disabled. The new limited live
API key was successfully installed as `PADDLE_API_KEY` on the existing production
Worker; Wrangler secret-list read-back confirms the binding.

Created client token `ctkn_01m35crq0pcsmgrvd0h2ymbfr5` (paste2speech-production)
and destination `ntfset_01m35ct3p29vxze92gt4tmwfdd` for
`https://speak.rogerpbrown.com/api/billing/webhook`, API version 1, Platform usage,
all ten transaction events and both adjustment events. Destination read-back is
Inactive pending public-mode endpoint deployment and secret installation.
The browser export capability was unavailable; owner file handoff is needed for
the client token and webhook secret. Neither value has been installed yet.
No public-mode application deployment, payment or synthesis was performed.
