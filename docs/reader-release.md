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

## Whole-reading credit preflight

Before new paid speech, the reader and recording download check fresh credit for
all unpaid parts of the cleaned reading. A shortage starts no speech and shows
needed and available credits, top-up, Refresh credit & Resume, and free browser
voices. Single-part readings now use the same tab-saved IDs and recovery as long
readings. Admission retains the exact request options on retry. Existing admitted
parts are checked and reused rather than included in the new-credit requirement.

This browser check is advisory: concurrent tabs, refunds, or account changes can
still cause a later server-side refusal. The server keeps its atomic per-part
checks and reservations. Both MSE and full-file preparation then pause with
Resume enabled; MSE can drain paid audio. Ordinary credit retries keep the same
IDs. Confirmed provider failures still require confirmation before replacement.
Clear, Stop of an unfinished reading, a changed reading/voice/split, expiration,
or closing the tab can require new speech and credit again. Reload reuse requires
identical text/voice/split in the same tab; listening position is not persisted.


## Reload behavior

A real reload starts an idle local player at the beginning and requires Play.
Experimental listening-position cursors are discarded without clearing paid
part references or sending cancellation/speech requests. Browser-restored text
is reconciled by the existing page-return readiness check; otherwise paste the
text again. Identical cleaned text, voice and actual part layout reuse valid
saved paid IDs in the same tab. Missing/expired parts retain their safeguards.
Normal in-session Pause/Resume preserves the live position across background
return. Stop and Clear keep their intentional behavior. `check:reader:reload`
exercises these paths with isolated Chrome profiles and intercepted APIs.


## Staging document import

Staging exposes **Open document** for PDFs and PNG/JPEG/WebP images. PDFs are
extracted locally first. The per-page gate checks corrupt embedded characters,
fragmented words, image-only pages and likely multiple-column reading order;
nonempty text alone is insufficient. One unsuitable page routes the document to
OCR. This is conservative routing, not a guarantee of transcription accuracy.
Imports are limited to 20 MB; local PDF evaluation is limited to 100 pages and
one million extracted characters. Unsupported, malformed, cancelled or failed
imports preserve the existing reading. A successful import fills the text box
and waits for explicit Play. TXT and Markdown downloads use current text;
unchanged OCR text retains reconstructed Markdown headings. Diagnostics remain
separate from the reading.

**Staging has an approved bounded owner-only OCR experiment.** Roger confirmed
secure Wrangler key upload on October 6. `OCR_LIVE_APPROVED=1` and a configured
Worker secret activate only the exact approved newsletter trial; setting that
flag to `0` pauses it without resetting budget or receipts. Production always returns 404 for OCR.
After separate activation, existing Cloudflare Access/origin checks plus a
current verified billing session for `OWNER_EMAIL` are required on both config
and upload routes. Anonymous, legacy, expired, disabled and other accounts are
rejected before file bytes are read.

Only the exact approved four-page October 2026 Spanish Fork newsletter may be
submitted: SHA-256 `f23892d03f3b807089e1af35df8175acf87f3cc12c2df786d1ec8b17c2909c80`,
5,814,537 bytes, PDF only. Client routing also checks the approved fingerprint;
the server checks independently. Explicit multipart consent and the pinned
`mistral-ocr-4-1` model are mandatory. Provider dispatch selects pages 0–3,
disallows redirects, times out at 90 seconds, limits results to 16 MB, and
requires exactly four processed/result pages and the pinned model. Provider
errors and credentials never enter user-facing details. No model fallback,
annotations, automatic paid retries, paid speech, or other documents are enabled.

The staging-only SQL in `cloudflare/reader/staging-migrations/0001_document_ocr_trial.sql`
creates durable experiment receipts and atomic reservation triggers in the
existing staging D1 database. It is deliberately outside public migrations.
The $5 admission ceiling includes a $1 historical allowance (the private
prototype ledger establishes 2 cents reserved for one prior attempt) and $1
reserved before each new attempt. Those allowances are conservative bounds,
not claims of actual charges. The verified October 6 list rate is $4/1,000 pages
([official pricing](https://docs.mistral.ai/inference/pricing)), estimating
$0.016 for four pages. Invoice minimums, taxes, account billing and usage outside
this experiment remain unverified; the app ceiling cannot control other keys.

A unique experiment/document/model receipt permits one dispatch. Concurrent
uploads, lost insert acknowledgements, failures, provider rejections and
uncertain settlement cannot authorize another call. All reservations stay
consumed. Successful raw OCR results are privately cached in existing staging
R2 for 24 hours and reused across requests/restarts; the minute maintenance job
deletes expired source results, retaining numeric receipts. Missing/expired
cache and uncertain attempts require explicit investigation and fresh approval,
not deletion of receipts to force a retry. No source document is persisted.

Apply only to the staging database before deploying this backend:

```bash
npx wrangler d1 execute private-wavenet-reader-staging --remote \
  --config cloudflare/reader/wrangler.staging.jsonc \
  --file cloudflare/reader/staging-migrations/0001_document_ocr_trial.sql
```

Roger must enter the Mistral key himself through Wrangler's protected prompt:

```bash
cd ~/workarea/paste2speech
npx wrangler secret put MISTRAL_API_KEY \
  --config cloudflare/reader/wrangler.staging.jsonc
```

Do not put the value in chat, browser code, a command argument, shell history,
a repository file or an assistant-readable credential file. The assistant must
not read `/tmp/api.txt` or existing keys. User confirmation that secure setup
completed was received before activating `OCR_LIVE_APPROVED`. A live call still
requires the verified owner session and explicit consent in the staged UI.
Activation is a clean staging commit and verified staging-only release. Broader documents/accounts and public production require new approval.
PDF/image handlers form the first routes; new formats require separate adapters.

`npm run check:reader:documents` uses an isolated headless browser, local assets,
synthetic files and intercepted APIs. It checks local PDF success, production
regression, disabled OCR, consent, text/Markdown exports, cached result reuse,
failed/empty/cancelled OCR and zero speech creation.
`tests/document-ocr-trial.test.js` additionally checks real SQLite owner sessions,
concurrent durable reservations, exact-file admission, lost acknowledgements,
bounded/pinned mock provider dispatch, cached reuse, all uncertain failure paths
and source-cache retirement. It runs in both release
gates alongside parity, resume, reload and preview checks. Cached real document
responses are private verification inputs, never deployment assets.


### OCR admission and read-only recovery

D1 mutation metadata counts trigger effects. A successful receipt insert changes
two rows (receipt plus budget); admission requires an acknowledged successful
positive mutation, rather than exactly one changed row. Local regression tests
use `total_changes()` to match the installed D1 runtime. A lost acknowledgement
still blocks dispatch and retains its reservation.

The importer displays elapsed time while its single POST is active, without
inventing a progress percentage. **Check OCR status** calls only owner-protected
GET routes (`/api/ocr/status`, `/api/ocr/result`), can load an existing ready
result, and never submits paid OCR. A receipt older than 120 seconds without a
confirmed result is presented as uncertain rather than implying background
progress. This does not mutate, release or retry the original receipt. The
original October 6 stranded admission remains preserved for investigation.


### Explicit bounded OCR retry

The original receipt and its possible charge are never reset or refunded.
`staging-migrations/0002_document_ocr_retry.sql` adds a separate linked retry
table, a unique child per parent, the same $1 atomic budget reservation trigger,
and durable provider-dispatch checkpoints. Apply this SQL only to staging D1
before releasing the retry backend. The prior allowance plus all original and
retry reservations cannot exceed $5; uncertain reservations are never released.

A verified owner must reselect the exact approved newsletter and explicitly
approve **Retry OCR · reserve another $1** and its new charge checkbox.
`POST /api/ocr/retry` independently verifies that consent, document fingerprint,
latest parent, five-minute admission cooldown and expired dispatch lease.
An existing child is only checked/replayed, never dispatched again. A stale
reservation or expired cache cannot itself authorize a paid call. There are no
automatic retries. A successful saved result is preferred, including on a
repeat request or after reload. Every new dispatch is marked durably before
provider submission; an ambiguous checkpoint acknowledgement blocks submission.
The native base64 encoder is used where available, with the validated portable
fallback. The original stranded October 6 record stays preserved as evidence.

OCR diagnosis after the first real retry: staging paid submissions are temporarily
paused (`OCR_LIVE_APPROVED=0`). Apply staging migration
`0003_document_ocr_diagnostics.sql` before this release. Diagnostics retain only
failure phase, HTTP status and an allowlisted error class; never provider bodies,
headers, document contents or key values. A one-time scheduled GET `/v1/models`,
scoped to the named uncertain receipt, checks current access without OCR, document
uploads or budget changes. Its durable claim prevents automatic probe retries.
Historical discarded OCR error details cannot be recovered from this probe.

Local workerd reproduced `TypeError: Invalid redirect value` for `redirect:error`
with the staging compatibility date. OCR and diagnostic requests now use
`redirect:manual`; non-2xx responses are rejected, so credentials are never
forwarded to a redirect. The corrected read-only access probe uses a revision
suffix in its diagnostic identifier, retaining the first failed probe unchanged.
Paid OCR remains paused pending owner approval of another live attempt.

Roger approved one further live newsletter attempt after the redirect fix.
`OCR_APPROVED_RETRY_PARENT` pins admission to the specifically approved failed
receipt. Once its child is admitted, no subsequent new paid retry is enabled,
even if the global experiment budget has room. Repeated requests for that same
parent replay the child status/cache without another provider request.

Owner document trial expansion (staging only): apply
`0004_owner_document_ocr.sql` before enabling `OCR_OWNER_DOCUMENTS=1`.
The verified owner gate remains before every route. Cloud files are at most
6 MiB: PDF requests specify 1–10 page indices; PNG/JPEG/WebP requests specify
one image. The UI counts PDF pages locally and rejects over-limit cloud PDFs;
the backend bounds every requested page list independently. Maximum listed
processing cost is 10 × $0.004 = $0.04 under the pinned model, excluding any
account-level invoice terms. All admissions use the original experiment budget
and atomic $1 reservations; the existing $4 is never reset. Only $1 remains.
New owner/document/model receipts are unique, cache paths include the owner
hash, and all cache/config/status/result reads require verified owner access.
The completed newsletter's existing private cache remains available. There
are no automatic retries, including expired or uncertain results.

Clear now resets the loaded document, consent, exports, diagnostics and local
request context. It aborts the local request and invalidates every late
completion; it does not delete server receipts/cache or claim confirmed
provider cancellation. Clear remains available during document processing.
Validation uses synthetic PDFs/images and mocked provider calls; desktop
keyboard, 390-pixel responsive layout and ARIA state checks are included.
Actual Pixel and screen-reader testing are not represented by those checks.


Staging OCR timing guidance uses only two observed small-document completions
(JPEG about 3.2 seconds, four-page PDF about 7.4 seconds). It is explicitly
provisional: allow around 30 seconds, with elapsed time rather than a countdown
or percentage. A still-pending local POST gets one longer-wait announcement at
30 seconds; failures, cancellation and Clear stop it. No timing telemetry or
content is collected. Status checks remain explicit read-only requests.
The recovery hint explains identical-file/account cache lookup and the 24-hour
TTL from completion. Owner imports always consult server readiness and read the
private saved result before budget admission, including at the exhausted cap;
in-memory data cannot bypass server expiry. Expired or uncertain receipts never
authorize a new paid retry. Production remains on its separate deployed version.


Approved October 6 cumulative OCR allowance change: apply staging-only
`0005_owner_ocr_page_budget.sql` before deploying this owner backend. It creates
a versioned $10 owner budget, carrying the entire original ledger balance as an
immutable baseline; the original budget and all receipts remain intact. Existing
owner receipts gain their original 100-cent reservation metadata. No successful,
failed, uncertain or historical reservation is released or reconciled.
Future admissions reserve `max(1, ceil(pages * 0.8))` cents: twice the pinned
$0.004/page published price, rounded upward. Examples: image 1 cent, four-page
PDF 4 cents, ten-page PDF 8 cents. The server bounds the page list independently
and accepts results only when returned page count and usage match that list.
The UI shows this reservation separately from the published-price estimate.
Neither is a verified invoice charge; minimums, taxes and unrelated usage remain
unverified. Each admission and its audit journal row update the cumulative
counter atomically in SQL triggers. Duplicate, uncertain and expired requests
cannot initiate paid retries. Cache recovery still precedes budget admission.
With the observed original 500-cent balance carried forward, the new 1000-cent
ceiling leaves 500 cents of reservation room. This supersedes the earlier
$5/flat-$1 trial policy for owner documents only; historical trial routes remain
preserved for audit and are unreachable under `OCR_OWNER_DOCUMENTS=1`.
