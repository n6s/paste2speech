# Shared staging and production reader releases

Updated September 24, 2026. This is the current release workflow for the private
staging reader and owner-only production reader. Their separate earlier branch
instructions are historical. Public billing launch remains a separate workflow.

Production now serves `https://pastetospeech.com`; the old hostname permanently redirects, with a move
notice on the new site. See [the domain move record](rebrand.md) for provider
settings and validation. Public checkout remains disabled.

## One release baseline

Use branch `codex/reader-shared-release` in
`/home/roger/.codex/worktrees/reader-shared-release/paste2speech` for both sites.
The staging and production histories have been merged. Change the shared source,
commit it, deploy staging, verify it, and promote that same commit to production.
Do not maintain separate fixes or backports in the old deployment branches.
The main checkout and the original Tailscale reader are separate and unchanged.

```sh
# Local preparation: both builds, unit tests, browser parity, Wrangler dry run.
npm run release:reader:staging

# After committing, and when deployment is authorized:
npm run release:reader:staging -- --deploy

# Cached-only hosted check; no provider calls or account credits consumed.
MSE_STAGING_ORIGIN=https://staging.pastetospeech.com \
MSE_CHECK_ONLY='^en-US-Wavenet-F-3$' node scripts/mse-staging/check.mjs

# Promote the same clean commit after staging verification.
npm run release:reader:production -- --deploy --production-approved
```

Both commands use `scripts/release-reader.mjs`. Every release builds both readers
and runs the same synthetic browser checks against each: progressive default,
collapsed options, early audio, pause, speed, seeking, same-job file fallback,
clear server errors, unsupported-browser handling, and testing-mode isolation.
Tests intercept all speech API requests and never call Google.

Each build serves `release.json` with its commit, environment, clean/dirty state,
configuration digest and reader asset digests. Production promotion requires the
staging metadata and its actual served HTML/JavaScript to match the clean local
build exactly. Staging verification uses the existing Cloudflare Access token;
a missing or expired token blocks promotion. Every deployment verifies its own
served metadata and assets. Private run receipts are in `work/shared-reader`.

## Normal reading and explicit testing mode

Both homepages use the same playback controls and request format. Staging's
normal reader does not expose its player object or testing controls. Its footer
has a **Testing mode** link (`/?testing=1`), which enables the existing cached
samples, fault scenarios, concurrency comparison and diagnostics. Returning to
`/` exits testing mode; it is not persisted as a browser preference. Cached audio
is selected initially in testing mode. Load the matching sample before playing.
Production ignores that parameter and contains no testing controls or fixture
assets. Server-side checks continue rejecting test options in production.

The intentional differences remain: Cloudflare Access on staging, owner-only
WaveNet on production, sandbox checkout versus disabled production checkout,
separate databases/audio storage/accounts, and environment-specific account and
privacy copy. These are not playback differences.

## Staging speech ceilings retired

Roger requested removing staging's artificial campaign and lifetime ceilings.
The staging-only `staging-migrations/0002_retire_speech_ceilings.sql` deactivates
the old 3,000-character campaign and removes its database's lifetime admission
limit trigger. It preserves every admission, campaign record, balance and usage
counter. The historical `speech_budget.maximum` field remains for schema
compatibility; it no longer imposes a staging cutoff. Usage continues counting.
Account credit checks, reservations, settlement and the per-reading size limit
remain. Live WaveNet still incurs provider cost; cached test audio does not.
Production retains its 100,000-character lifetime allowance and its limit trigger.

For this one-time staging schema change, first export the staging ledger to an
ignored private backup and verify its integrity, then deploy the shared staging
Worker and execute only this file with `wrangler.staging.jsonc`. Confirm the
campaign is inactive, `budget_check` is absent, `budget_debit` and reservation
checks remain, and balances/admission history match the backup. Never apply this
migration to production. Its first statement requires a staging-only table.
Do not rerun the original campaign installation script: it would reactivate old
limits. Keep the historical migration for reproducing the original schema/tests.

Do not roll staging back to the pre-unification Worker after retiring the caps:
that older code requires an active campaign. Fix forward on this shared baseline
(or pause new live staging admissions while recovering). Never restore a ledger
backup over newer transactions. Production rollback does not require a schema
change; preserve production data and bindings.

## Quota recovery safeguards

See [the September 25 incident and recovery record](quota-incident-2026-09-25.md)
for bounded retries, payment reconciliation cadence, legacy reading retirement,
and read-only quota/maintenance checks. Keep the deployment's `RETIRE_BEFORE`
cutoff fixed: changing it forward would retire newer readings. Do not clear retry
state or requeue `attention` items without diagnosing them. The maintenance queue
has a separate enable switch from the main background-work pause.

## Resume long-reading preparation

The existing Resume control restarts a failed logical reading using its saved
part IDs. A failed status request is rechecked against the same ID, including
lost create acknowledgements. Completed parts are never regenerated by Resume.
If the server confirms that a part failed, the user must confirm replacing that
part; the prompt explains that its already-generated speech may use credit again.
The previous attempt ID and estimated cost stay in the saved record, including
any incomplete-cost warning. Missing, expired, or cancelled
parts do not silently create new paid requests.

Recovery keeps the player source and listening position. On replacement, only
the interrupted part's buffered audio is discarded; a position within that part
is restored by section and offset, clamped if the replacement section is shorter.
Repeated Resume clicks share one recovery operation. Clearing the reading while
confirmation/status lookup is pending prevents new work.

Part records remain tab-session scoped. After a page reload, reimporting identical
text with the same voice and split settings can reuse those IDs while server audio
is available; the text and listening position are not persisted across reloads.
This change does not promise recovery of expired audio or browser-closed sessions.
It applies to split long readings, not arbitrary media-decoding errors.

`npm run check:reader:resume` exercises real browser MSE recovery with intercepted
synthetic APIs, including different replacement durations. The normal release
script includes it; no provider calls or credit grants are used by these tests.

## Clear and saved long readings

Clear synchronously forgets the tab's saved long-reading part IDs, including IDs
left by an earlier page load. Server cancellation remains asynchronous; late
preparation or cleanup responses cannot restore forgotten IDs or remove a newer
reading's saved records. Refresh after Clear therefore starts new preparation
when the text is imported again. Resume without Clear still preserves saved IDs.
Regression coverage includes Clear followed by reload and fresh preparation in
Chrome against both reader builds, with speech API calls intercepted.

## Chunk navigation and speed presets

The public reader position slider selects sentence chunks, using the existing
500-character splitting limit and phrase-boundary fallback. Only consecutively
prepared chunks are selectable; the position count retains the whole-reading
total. Dragging commits on release and preserves playing or paused state.

The speed button near the playback controls cycles through 0.75, 1, 1.25, 1.5,
and 2 times normal speed, without regenerating audio. Preferences persist in
the browser; earlier custom rates map to the nearest preset (lower on ties).
The original Tailscale UI remains unchanged.
