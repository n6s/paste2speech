# Production owner-only trial: release review

Prepared September 22, 2026. This is an implementation/review artifact, not a
record of production deployment. The owner requested implementation but explicitly
reserved production deployment and spending for approval after validation.

## Exact release

- Source: `codex/wavenet-mp3-proof`, based on tested staging commit `beb2b62`.
  Main checkout's uncommitted hosted Python/container edits are excluded.
- Host: `https://speak.rogerpbrown.com`, moving from Worker `paste2speech` to
  new Worker `paste2speech-reader-production`. Staging keeps its own host and Worker.
- New D1 and private R2: both named `paste2speech-reader-production`.
  New Worker owns independent `PreparedReading` and `PaymentCoordinator` namespaces.
  The production ledger ID remains an intentionally invalid placeholder until
  approved provisioning. The release command refuses deployment with it.
- Existing feedback/statistics stay in D1 `paste2speech`,
  `5499d01a-aa14-460d-97b9-100ece1293d3`, bound as `DB`. Its `review` mode and
  90-day retention are preserved. No staging data is imported.
- Trial owner: verified `rogerpbrown@gmail.com`, one 100,000-character grant.
  Independent lifetime admission limit: 100,000 characters, never automatically
  replenished. Failures/cancellations can consume the admission limit even when
  unused account credit is released. This is not a total Cloudflare/provider bill cap.
- Production configuration starts with speech, email and checkout disabled.
  Checkout remains disabled regardless of payment credentials or enable flag.
- Required separate production secret bindings: `GOOGLE_SERVICE_ACCOUNT_JSON`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `FEEDBACK_SECRET`. No Paddle secrets.
  Keep the old Worker and its secret bindings intact for rollback.

## Current read-only evidence

Live Cloudflare inspection on September 22 confirmed:

- Production hostname still belongs to `paste2speech`; 100% serves Worker version
  `7776e7ef-7595-49b9-83bf-441f384901f1`, deployment
  `a7e7ce5a-d5e0-4aef-ab16-88fa0df02bec`.
- Staging serves version `cbcb4d95-bc3b-4be5-a537-702abca2154f`.
- Production `DB`, event/feedback limits and `FEEDBACK_DELIVERY_MODE=review`
  match the existing configuration. No live data was read or modified.
- Staging has Google, Resend, sender, feedback and sandbox payment secret bindings;
  their values were not read. Local Google credential structure is valid for the
  `paste-to-speech` project; no token or speech request was made.
- Account subscription lookup returned HTTP 403. Workers plan remains unverified.
- The local Resend credential returned HTTP 401 from a read-only domain lookup.
  Do not provision production from that credential without resolving this result.
  Local SMTP sender configuration names `signin@speak.rogerpbrown.com`; this does
  not prove the deployed Resend sender or its verification status.

## Local verification

- 161 Node tests including production route authorization, disabled checkout,
  per-account usage, fail-closed rate limits, idempotent verified-owner grant,
  concurrent lifetime admissions, cached-audio production Durable Object execution,
  Range/ownership, restart/accounting and existing production feedback binding.
- Three synthetic offline migration tests; no customer migration is planned.
- Local Worker API integration: complete preparation, cancellation, idempotency,
  Range, ownership, browser-bound one-use email confirmation and disabled payments.
- Integrated Chrome reader: 40 sentences, navigation, seek/speed without another
  synthesis request, MP3/VTT, original editing text, account recovery and late cancellation.
- Shared Chrome suites passed for browser controls/mobile layout, rich paste, and
  local PDF extraction (real, blank, malformed and oversize files, without upload).
- Local Worker restart: account balance and completed audio survive.
- Production Chrome preview uses mocked account APIs and browser speech. It checks
  anonymous playback without account creation, mobile account layout, trial wording,
  no checkout, and no external requests. It does not prove real device audio.
- `npm run release:reader:production` runs tests, builds production assets, rejects
  staging/checkout content and cached audio assets, and runs Wrangler's local dry run.
  It writes `work/production-reader/release-manifest.json` with source commit,
  dirty status, configuration digest and asset digests. No remote writes occur.

## Approved cutover procedure — not executed

1. Resolve Workers plan visibility and the Resend credential/sender check. Obtain
   approval for the exact host/resource changes and 100,000-character allowance.
   Refresh the old Worker version and hostname mapping immediately before changes.
2. Create the new D1 and R2, record the real ledger ID in production configuration,
   and apply the nine reader migrations only to `LEDGER`, never the existing `DB`.
   Read back zero accounts/grants/reservations and no admission consumption.
3. Keep R2 public access disabled. Set a one-day object lifecycle and abort incomplete
   multipart uploads after one day. Durable Object alarms enforce access expiry and
   cleanup; R2 lifecycle cleanup itself is asynchronous. Verify both settings.
4. Install secrets directly through stdin into the new Worker without printing them.
   Confirm sender identity and origin. Enable email, leaving speech/payments off.
   Commit the provisioned configuration and rerun the release dry run; review its
   clean commit/digest manifest before `npm run release:reader:production -- --deploy
   --production-approved`. The hostname is claimed by another Worker today: inspect
   the custom-domain reassignment before approving the concrete route operation;
   do not delete the old Worker. If automatic reassignment is refused, stop and
   perform only the already-approved hostname transfer through Cloudflare's UI/API.
5. Check unauthenticated reader, browser playback, feedback in the existing DB,
   cross-origin denial, unapproved-account speech denial, no test-mail route,
   disabled checkout, and private audio ownership. Keep speech disabled if any fail.
6. Owner completes a fresh production email sign-in. Run
   `cloudflare/reader/grant-production-trial.sql` against production `LEDGER` once;
   rerunning is safe. Read back the verified identity, exactly one trial grant and
   100,000 credit. Never insert an identity or legacy entitlement to bypass sign-in.
7. Set `ENABLE_LIVE_SYNTHESIS=1`, retaining cap 100000 and checkout 0; commit and
   deploy that exact configuration. Make a short approved US/UK speech check, read
   back exact account debits and admission consumption, and verify MP3/VTT/Range.
   Obtain owner phone listening/seek/screen-off observations before claiming device
   acceptance. Do not reset the cap after smoke tests.
8. Start a 24-hour follow-up only after deployment: inspect after smoke, one hour,
   and at 24 hours for errors, stuck reservations and unexpected consumption.
   Use read-only checks; no automatic speech, grant, retry or budget reset. Notify
   only on failures or needed action, and report completion at 24 hours. Do not
   log reading text, tokens or provider credentials. Existing payment reconciliation
   is intentionally inactive because purchases are disabled.

## Rollback

Disable new speech admissions first if WaveNet alone fails; leave public browser
voices running. If the reader fails, reassign only `speak.rogerpbrown.com` to the
preserved `paste2speech` Worker/version above. Confirm anonymous browser playback
and feedback routing. Do not restore a stale credit snapshot, delete the new ledger,
reset the speech budget or copy staging balances. Preserve new audio/accounting for
reconciliation. Reconcile any in-flight jobs before resuming a later trial release.

At the end of release preparation, no live resource, routing, data, secret or speech change had been made. The execution record below supersedes that checkpoint.


## Approved execution — September 22, 2026

The owner explicitly approved the production cutover and 100,000-character trial,
and agreed to perform phone checks afterward. No further cutover approval is needed.

Readiness resolved: the Cloudflare dashboard identifies **Free** as the current
Workers plan. No upgrade was performed. Resend's detailed response identifies the
existing API key as **send-only** (`restricted_api_key`); domain-listing HTTP 401
was a permissions limitation, not evidence of an invalid sending key. Actual
production email delivery is still to be verified through sign-in.

Provisioned D1 `d3c03af9-3833-4242-b032-f10620d65fe7` and R2
`paste2speech-reader-production`, both WNAM. All nine migrations applied only to
the new ledger. Verified zero accounts, grants and reservations, and a persisted
speech budget of **0 / 100,000**. Verified R2 public access disabled and 86,400-second
object-deletion and multipart-abort lifecycle rules.

The original feedback D1 was exported to owner-only local rollback storage;
SHA256 `0a751791eb8ee3712c65dbccafb73c38e59f4691afd8f44aa31f69881c8147c8`.
The existing production hostname/version were rechecked unchanged.

A route-less bootstrap deployment created the new Worker and Durable Objects;
version `eb0f4bd3-9d3e-4e2e-ac6f-87e192f9a93f`. Four production secret bindings were
installed directly through stdin; no values were printed or committed. Production
email is now configured for the hostname cutover; speech and checkout remain off.
