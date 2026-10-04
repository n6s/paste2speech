# Staging and public reader releases

Updated September 28, 2026. The canonical source is **`main` in
`/home/roger/workarea/paste2speech`**. The former `codex/reader-shared-release`
history and main-only planning notes are merged here. Old Codex worktrees are
retained for recovery and existing installations, not as independent release
baselines. Use temporary branches/worktrees only for isolation and integrate
finished work back into `main`.

Production serves `https://pastetospeech.com` with public WaveNet purchasing live.
Private staging serves `https://staging.pastetospeech.com` behind Cloudflare Access.
The environment-specific configurations, accounts, storage, and payment modes
remain separate. Source consolidation does not deploy or change account data.

## Prepare and release from the canonical checkout

```sh
cd /home/roger/workarea/paste2speech
npm ci
npm run release:reader:public
npm run build:extension
npm run check:extension
npm run check:extension -- --staging
```

Public preparation runs the unit tests, staging/public builds, reader parity and
resume checks, and a Worker dry run. Extension checks use isolated Chrome profiles
and fixture speech; they do not spend speech credit. Extension installation folders
stay under `dist/chrome-extension/`; the private-site build preserves them.

After committing and when deployment is authorized:

```sh
npm run release:reader:staging -- --deploy
npm run release:reader:public -- --deploy --production-approved
```

Staging preparation also builds the historical trial variant for its existing
checks; it deploys only staging. The second command rebuilds the **public** variant,
checks the hosted staging commit and asset hashes, and promotes that same clean
commit with `wrangler.public.jsonc`. Do not substitute `release:reader:production`:
that command targets the historical owner-only trial configuration.

Both deployments verify served `release.json` and asset hashes. Staging verification
uses the existing Cloudflare Access session; missing access blocks promotion.
Never substitute an old worktree or a different commit to get past a failed gate.
Production/public receipts are under `work/production-reader/`; staging receipts
are under `work/shared-reader/`. No migrations are implied by a code release.

The consolidation contains the deployed Chrome-extension release `f810544`.
Its additional changes are repository guidance, preserved planning notes, the
private-build favicon copy, and protection for the installed extension directory.
The hosted sites remain on their last explicitly deployed commit until the next
requested release.

## Consolidation verification

From the canonical checkout: 235 JavaScript tests and 115 Python tests passed,
as did staging/public builds, reader parity/resume checks, the public Worker dry
run, and both unpacked Chrome extension checks. The private-site build preserved
all 24 extension/package files byte for byte, and rebuilding the extension from
its source reproduced the installed files exactly. App, server, Worker, and
extension runtime sources match the deployed `f810544` release; no site deployment
or database change accompanied this consolidation.

A recovery branch, `codex/main-before-consolidation-20260928`, preserves the former
main tip. Older worktrees remain intact for existing users/installations.

## Historical implementation notes

The following September 24 notes explain the shared-reader transition. References
to owner-only production, disabled checkout, and old trial limits describe that
point in time; use the workflow above and current configurations for releases.

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

The cloud reader uses one position slider for browser voices and WaveNet, with
shared previous/next section controls. Browser voices can select any loaded
section; seeking restarts at its beginning and preserves playing or paused state.
Seeking after completion selects a section while paused. Stop and Clear disable
navigation until a reading is loaded again. The duplicate upper progress bar
and counter are omitted from cloud builds.

The position slider selects sentence chunks, using the existing
500-character splitting limit and phrase-boundary fallback. For WaveNet, only consecutively
prepared chunks are selectable; the position count retains the whole-reading
total. Dragging commits on release and preserves playing or paused state.

The speed button near the playback controls cycles through 0.75, 1, 1.25, 1.5,
and 2 times normal speed, without regenerating audio. Preferences persist in
the browser; earlier custom rates map to the nearest preset (lower on ties).
The original Tailscale UI remains unchanged.


## Credit exhaustion during long readings

An explicit credit refusal pauses preparation while MSE playback drains already
paid sections. Resume replays admission with the saved idempotency key, including
legacy refused records; it does not replace the ID or discard buffered audio.
After a top-up, refresh the balance and use Resume. A durable credit rejection
can retry only when its owner and request match, it is unexpired and failed,
all sections are untouched, and no reservation exists. Cancelled jobs and actual
missing/expired prepared audio keep their existing recovery safeguards.

The resume browser check includes credit exhaustion, paid-audio drain, top-up,
unchanged audio source/listening position, and reuse of the refused ID. Unit tests
also cover reload reuse, repeated insufficient-credit resumes, durable admission
replay with exactly one debit, and cancellation before top-up.
