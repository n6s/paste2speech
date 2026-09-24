> September 24: staging and production now share the release workflow in [reader-release.md](reader-release.md). Staging testing tools require explicit testing mode; its old campaign/lifetime ceilings are retired. Earlier instructions below are historical where they differ. Public billing remains gated.

# Progressive reading in private staging

Integration branch: `codex/mse-staging-reader`, based on Pixel-accepted experiment
`01126ab`. The original experiment and production are unchanged. The normal
reader at https://speak-staging.rogerpbrown.com is the deployment target.

## Isolation and behavior

Build with `node cloudflare/reader/build.mjs --mse-staging`, then use only
`cloudflare/reader/wrangler.staging.jsonc`. Production builds reject the MSE
flag and exclude its player implementation and controls. The normal staging
reader uses the existing Access policy, signed-in account, transport, and
payment configuration. No harness cookies or hosted local-origin exceptions.

Progressive and Prepare everything first share durable jobs and downloads.
Unsupported browsers select full preparation before creation. Runtime MSE
failures require explicit same-job completed-file playback. Replay, seeking,
and fallback never create another job. Reads have bounded retries; uncertain
paid synthesis is never retried. A successful progressive reading has one
MediaSource and no completed-file handoff. The raw buffer endpoint must match
integer MP3 samples within one 24 kHz sample before duration/EOS is finalized.

Jobs persist delivery, concurrency, fixture/live mode and scenario. Repeated
creation must match those fields. Old requests/jobs retain full preparation.
Each section is validated and stored before readiness is published; durable
snapshots are written serially. Consecutive-ready status and authenticated
section downloads coexist with separately completed MP3/VTT exports. Existing
reservation and settlement rules remain in force.

Staging checks are collapsed by default. Cached audio uses only server-selected
US/UK fixture text and bytes. Delays are simulated; normal, out-of-order,
stalled, failed and 64-section long scenarios are available. Cached jobs never
call Google and create no speech admissions, reservations or usage debits.
Downloadable diagnostics include a fixture content hash, configuration, device,
capability, readiness, appends, ranges, media events and errors, without text,
authentication credentials, or account identity.

## Budget

`staging-migrations/0001_mse_campaign.sql` is deliberately separate from normal
production migrations. It adds two tables and two triggers, without rewriting
existing records. The active `mse-pixel-v1` campaign has a fixed 3,000-character
maximum. Its debit and the existing lifetime admission debit are atomic. Failed
and cancelled admissions count; duplicate admissions do not count twice.
The application requires this active ceiling for live staging admissions.
Never reset either counter, grant credit, or increase either maximum.

The approved live matrix is eight fixed sections per run: US/UK × concurrency
one/three. Each run is exactly 521 Unicode code points: 2,084 total. Live calls
must use the existing funded metered staging account. Do not repeat a completed
run or retry an uncertain paid call. Use cached jobs for faults and phone trials.

## Local verification and operation

The isolated integration server uses port 8791 and
`cloudflare/reader/wrangler.mse-local.jsonc`, with persisted state under
`work/mse-staging/state`. It has no synthesis/email/payment access. The original
8790/8443 Tailscale experiment is separate and must not be changed.

```sh
node --test tests/*.test.js
node cloudflare/reader/build.mjs --mse-staging
node scripts/mse-staging/check.mjs
```

For remote cached checks, sign in through `cloudflared access login --quiet`
for the staging origin, then set `MSE_STAGING_ORIGIN` to the exact staging URL.
The script reads the Access token privately; it creates zero-credit test sessions
and always selects cached audio. `MSE_CHECK_ONLY` selects case names;
`MSE_CHECK_LONG=1` includes the approximately five-minute fixture. Local and
remote diagnostic JSON are kept under `work/mse-staging/*-checks` (ignored).

Build changes can require restarting the isolated local server because the
asset builder replaces its output directory. The temporary integration service
is `codex-mse-staging-local`; stopping it has no effect on the original reader.

## Recovery

Pre-change staging version: `2b4d94c7-90ef-4a15-8435-dc2a94be2c7e`.
Its configuration is saved privately as `work/mse-staging/staging-version-before.json`.
Verified D1 backup: `work/mse-staging/staging-before.sql` (private, mode 0600).
SHA-256: `5150b3b8042ea2a8910bbfefde6f1c7029c959c92d921add7f74e91d51d53f9e`.
An in-memory restore passed integrity and foreign-key checks; 33 tables,
24,100/100,000 lifetime characters and zero open reservations.

To disable progressive playback for new readings, keep `MSE_STAGING=1` for
existing jobs, set `MSE_NEW_READINGS=0`, build the normal reader without
`--mse-staging`, and deploy only staging. Existing progressive clients and
section endpoints remain functional; new normal-reader requests use full
preparation. Keep the campaign trigger active.

For a broader failure, set `MSE_ADMISSIONS_PAUSED=1` first and inventory
in-flight jobs. This refuses new live readings while existing preparations
continue with ENABLE_LIVE_SYNTHESIS=1.
Changing ENABLE_LIVE_SYNTHESIS to 0 can fail unfinished live preparations, so
account for and settle them before restoring the recorded compatible version.
Do not roll back over a running progressive preparation: the older Worker does
not understand its scheduling options. Preserve R2 objects, job state, additive
schema and all newer accounting transactions. Never restore the old database
over the current ledger. A Worker rollback does not roll back D1/R2 data; see
[Cloudflare rollback guidance](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Acceptance evidence

See the accompanying verification report for deployment IDs, exact paid runs,
ledger checkpoints and desktop/phone results. Passing local Pixel results are
prior evidence only; hosted staging listening and screen-lock results must be
reported separately by Roger. Production cutover and additional live allowance
are separate decisions.
