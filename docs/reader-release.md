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


Staging interim math cleanup: **Skip math notation** is unchecked on first use
and its preference is saved with the other cleanup controls. It is exposed only
on the document-import/staging reader. Shared speech chunks and cleaned preview
omit recognized math when selected, so browser speech, cloud request bodies,
caption text and successful-section character allowance agree. Toggling it
detaches the old player without starting synthesis; completed audio identifiers
remain cached, and returning to the earlier chunks can reuse them. Incomplete
preparation is cancelled through the existing path. Clear retains its intentional
cleanup behavior; original document text/Markdown exports ignore this playback
option. Existing feedback's cleanup schema remains compatible.

Recognition is intentionally conservative: balanced `\(...\)`, `\[...\]`,
`$$...$$`, single-line `$...$` containing a recognizable math signal, and balanced
named LaTeX math environments (including array/aligned and common matrices).
Single-dollar prose/currency and multi-letter plain-word spans are kept; bare
numbers are not treated as dollar math. Code fences, inline backticks, indented
code, URLs, escaped delimiters, unmatched delimiters/braces/environments, bare
`x^2`/`x_{1}` and unwrapped `\frac` are not math-skipped. An unmatched non-dollar
opener conservatively leaves the remaining source alone. Supported environments
are listed in `public/math-notation.js`; this is syntax recognition, not semantic
validation or math narration. Explicit math is protected from Markdown cleanup
and prose line joining so exports preserve subscripts and array row separators;
unmarked `x_{1}+y_{2}` no longer loses underscores as false Markdown emphasis.
Tests use synthetic algebra, currency/code/malformed inputs and mocked audio/OCR
only. No MathJax/SRE dependency, new paid call or private upload is needed.


Staging clipboard images: native paste events on the editor route actual image
files/items to the same document importer; ordinary text/HTML paste keeps its
existing behavior. **Paste screenshot** calls `navigator.clipboard.read()` only
from its foreground click/keyboard gesture, after HTTPS/focus/API checks. No
background clipboard read, remote image fetch or permission polling is added.
PNG/JPEG/WebP representations use the same file signature, size, OCR page count,
owner/cache/budget and explicit upload-consent checks as Choose file. Empty,
text-only, multiple-image, unsupported/denied clipboard cases explain the file
fallback. A saved screenshot may not have been copied to the clipboard; a visible
hint explains that distinction. Clear and a newer file selection invalidate
pending clipboard reads, so late bytes cannot restore a cleared selection.
The image-paste handler opens the document panel to expose status and consent.
PWA Share Target and math narration remain future features.

Validation injects synthetic clipboard items and paste events into isolated
headless Chrome; it does not read or replace Roger's desktop clipboard. Actual
desktop/Pixel clipboard permissions remain untested in this tool context.
Browser capability guidance follows [image paste](https://web.dev/articles/clipboard/paste-images)
and [Async Clipboard](https://web.dev/articles/async-clipboard) official docs.


### October 7 public HTTP hotfix exception

Roger explicitly approved a narrow production HTTP navigation redirect without
promoting the unrelated current staging OCR/math/clipboard/budget work. Prepare
an isolated checkout from the live production commit `0040136`, with only the
Worker redirect, its regression tests and this record. Run the public release
preparation/full checks, compare every public asset hash against the live
baseline (only release metadata changes), then deploy that exact public Worker
configuration. The usual same-commit staging promotion prerequisite cannot be
used for this approved exception; do not deploy this old baseline over staging.
The canonical public host redirects GET/HEAD non-API HTTP navigation with 308,
preserving encoded path/query. API HTTP, mutations, trial/private/staging,
unconfigured origins and other hosts retain the existing access gate. No
financial migration, permission change or provider request is part of the fix.
Verify HTTP root/pricing/terms/robots/sitemap, HTTPS public pages, protected API
responses and unchanged staging metadata after deployment. Rollback restores
production Worker version `73d121ce-8202-422f-98bc-d8771eb87b3e`.

### October 7 staging OCR region boundaries

OCR reconstruction preserves separate layout blocks and page regions instead of
joining them based on missing sentence punctuation. Wrapped lines inside ordinary
prose still join. Within a single prose block, consecutive line-start month/day
entries (at least two) retain separate paragraphs; a following short multiword
all-caps heading retains its boundary. A single date or ordinary acronym is not
sufficient to split prose. This covers the UCAS October 7 newsletter's five
Important Dates rows followed by UCAS COLLEGE FAIR & FAFSA NIGHT. Recognition
requires the original line boundaries; previously flattened text cannot recover
layout reliably. Source wording remains intact, and uncertainty diagnostics stay
in Extraction details, outside spoken/exported prose.

Tests cover one-block and separate-block/page examples, text/Markdown exports,
Join wrapped lines on/off, normal wraps, acronyms and diagnostics. No explicit
silence, speech policy, billing or production promotion is included. Reopening the
same file on staging reconstructs a still-valid cached raw OCR response with the
new code without a paid rescan; Clear first if the old text is loaded. Cache expires
24 hours after completion. If no valid result is available, stop before upload or
Use cloud OCR; a fresh paid attempt requires separate approval. An existing text
or Markdown export has already lost the original boundaries.

### October 8 approved live OCR launch preparation

Roger approved $10 USD plus applicable tax for 500 OCR pages, one-time, no
automatic renewal or scheduled credit expiry, and a $10 hard provider reserve
cap with no automatic refill. Live Paddle catalog is saved and API-verified:
product `pro_01m4ehjj41jz5zvrn1mkaxxkb8` (SaaS); price
`pri_01m4ehnebc7mqj8ymdynbm5b4k` (1000 USD cents, external tax, quantity 1,
no billing cycle/trial/country overrides). Speech SKU is unchanged. Existing
canonical live webhook subscribes to transaction.completed, transaction.updated,
adjustment.created and adjustment.updated; all four are required for OCR.

Customer copy now discloses complete-success charging, blank pages within a
successful document, zero credits for failed/incomplete/entirely blank output,
24-hour saved replay, blocked same-file reprocessing after expiry, Mistral whole-
file consent, and proportional refunds rounded up to a whole page. Used refunded
pages become a shortfall covered by future purchases; speech remains separate.

Production is not deployed at this preparation checkpoint. Roger must enter
MISTRAL_API_KEY himself as an encrypted production Worker secret. Do not copy
the staging key or inspect its value. After metadata-only secret verification:
refresh and verify a private production LEDGER backup; check pending migrations;
apply 0015; execute ocr-live-launch-budget.sql once; verify cap=1000 and reserved=0
and unchanged speech aggregates. Then deploy staging and public from the same
clean validated commit using the normal release gates. No live payment or
provider smoke test is authorized; mock checkout verification makes no purchase.

Rollback disables ENABLE_OCR_PAYMENTS and ENABLE_DOCUMENT_OCR. Retain
OCR_RETAIL_LIVE_APPROVED=1, live IDs, credentials, OCRPAYMENTS binding, schema,
and ledger records so existing purchases/refunds can still reconcile. Never
restore a whole database over newer transactions or reset provider reservations.
The initial conservative capacity can back two 500-page packs; failed/uncertain
provider attempts retain business reserves and can pause later processing without
removing customer credits. No automatic reserve top-up is allowed.

### October 8 OCR purchase navigation review

Insufficient OCR page credit now displays a keyboard-accessible Buy OCR pages
link to /api/billing#ocr-account in a new tab with noopener/noreferrer. Opening
it does not buy or upload. The reader retains its text and selected document
reference; the file chooser is cleared as before so choosing the same file again
works. The message explicitly tells the reader to return and choose the file
again after buying. Consent remains unchecked and extraction remains blocked.

The reader header says Account & credits. Retail account pages include On this
page navigation with descriptions for OCR pages, speech credit, sign-in, and
monthly speech usage. OCR deep links focus the dynamically inserted OCR section;
contents links focus their targets. Local mocked browser checks cover keyboard
opening/closing, repeated imports, dismiss/reopen/Clear, unchanged reading text,
no automatic purchase/upload, all contents targets, and 390px mobile overflow.
Roger authorized staging deployment for review; production publication of this
change requires separate approval.

The reported five-page, unencrypted PDF (657335 bytes, PDF1.4) failed before
provider dispatch because ordinary outline metadata exceeded the 8192 parser-
operation ceiling. The independently walked page tree and local client both count
five pages. Raise the bounded operation ceiling to16384; retain the 6MB, ten-page,
two-second, nesting, structural inflation, duplicate-object and independent page-
tree protections. Rejections now distinguish structural metadata, encryption,
incomplete PDF, page limit and consent-count mismatch without exposing parser
internals. A synthetic five-page PDF with600 linked outline entries verifies and
mock-dispatches exactly five pages;1200 entries remain rejected with no additional
credit/provider reservation. Node and local workerd tests pass. The reported
personal PDF was inspected locally only, left unchanged and never submitted.

Selectable text alone did not bypass OCR suitability routing: local PDF.js found
4367characters but flagged repeated single-letter text on four pages and possible
column order on page1. Retail import now offers Use local text · no credits when
text exists but quality checks flag it. This explicit choice loads existing text
locally, warns about spacing/order/missing image content, and never uploads or
auto-plays. Cloud OCR remains optional behind consent and whole-document billing.
Synthetic column-layout browser coverage checks local use with zero credits and
Clear reset. No wedding content was included in test fixtures.

### October 9 named-link label staging review

Roger approved a narrow cleanup fix and staging review, with his original daily
briefing input still needed to confirm the reported encoding. A synthetic named
ChatGPT link reproduces the exact missing-label sentence. Ordinary Markdown and
rich HTML paste already retain their friendly labels.

Cleanup now extracts display labels from well-formed `link`/`cite` tokens carrying
an HTTP(S) or www destination plus a label, before generic reference removal.
Web addresses controls the destination independently of ChatGPT references;
URL scanning stops at private token separators. Citation-only references retain
existing cleanup behavior, and literal code remains opaque. Unknown/malformed
payloads are not treated as well-formed named links.

Core regressions cover URL/reference/Markdown toggle combinations, both reported
labels, citation-only markers, Unicode/punctuation/entities, literal code and
malformed inputs. `tests/named-links-browser.mjs` exercises the complete built UI:
original source, preview, speech chunks with mocked browser speech, normal rich
HTML paste and 390/320px layouts. It blocks external/provider requests. This
change has staging deployment approval only; production is unchanged.

Roger's original retest did not resolve the labels: his stored Edit sentence
already reads “the and the”. The named-token cleanup test therefore does not
confirm his source clipboard format. Ordinary text paste keeps the supplied
plain text; rich paste prefers inert HTML conversion. The original clipboard's
plain/HTML payloads are still needed to distinguish source omission from HTML
import filtering. No source labels are reconstructed from guessed URLs.

The delay investigation found an independent existing quadratic wrapped-line
scan, unchanged by the named-token patch. Anchoring at each line keeps behavior
but avoids retrying a whole unwrapped paragraph at every character. On this
machine 30,075 characters took about 280ms before and 1.4ms after; doubling length
previously took about 1,057ms. `tests/cleanup-performance.mjs` checks a 120,300
character line and wrapping semantics. The mocked built-browser test now checks
30,075-character plain and HTML paste through input/preview (about 2/4ms here).
These synthetic measurements do not establish the full 37-second phone delay.

The supplied source sentence is ordinary Markdown with weather.gov/gjt and
weather.gov/slc destinations. Chrome native text insertion preserves it, including
30,075-character context and multiple input events without a paste event. A
separate reproduced importer bug prefers empty-label HTML anchors over intact
plain Markdown. Rich paste now keeps the exact supplied plain source only when a
rendered empty HTML anchor matches a complete, named HTTP(S) Markdown link in
that plain source. Valid rich formatting remains preferred; malformed, escaped,
image and empty-label Markdown links do not trigger this fallback. Later phone
evidence below broadens the check to links omitted from HTML altogether.
The shared conversion covers native rich paste and Clear, Paste & Play.

`tests/link-paste-browser.mjs` verifies this failure and correction, exact source
preservation, keyboard insertion, URL/reference toggles, async clipboard text,
multiline/30,075-character context and conservative exclusions with mocked APIs.
Existing rich-paste selection, undo, inert HTML and formatting checks also pass.
Roger's Android Chrome Beta keyboard payload and original cause remain
unconfirmed; this correction does not reconstruct labels absent from all supplied
clipboard representations. Staging approval only; no production or provider calls.

Roger's later device test confirms native soft-keyboard preview paste preserves
the original Markdown, while Clear, Paste & Play still drops labels. The async
clipboard route now pairs plain and HTML representations across separate
ClipboardItems as well as within a single item. Each plain representation is read
at most once. The same destination/empty-anchor guard applies; this does not
blanket prefer plain text over valid rich HTML. The actual button handler is
covered with same-item, HTML-first and plain-first item sequences, exact
30,075-character source and mocked browser speech. No diagnostic UI was shipped.
The reproduced split-item case remains to be confirmed on Roger's actual phone.

### October 9 opt-in phone paste evidence

The original phone issue remains unresolved. Desktop fixtures verify independent
fixes, but do not establish Roger's Android clipboard representation. Earlier
device reports mixed ordinary Clear, Paste & Play listening with keyboard-only
inspection, so those reports must not be assigned a route without explicit
evidence. The acceptance target is identical preserved text and Read output for
the same clipboard across text paste routes; only deliberate autoplay differs.
Screenshot changes are deferred.

Staging now has a collapsed “Troubleshoot this paste” panel under Your text.
Start paste check preserves the existing editor, pauses active playback and skips
automatic playback during the check. It observes the actual keyboard/native paste
events and the existing Clear, Paste & Play clipboard/import/assignment path.
Cleanup and preview timing, read/readText availability, clipboard item formats,
known weather label/destination presence and bounded weather-anchor structure are
recorded in memory. The report embeds the running JavaScript commit and compares
it with a no-store release metadata read, displaying a mismatch warning.

No arbitrary text, raw HTML, private URLs, account details or full documents are
retained in the report. The only verbatim sentence classifications come from the
fixed public weather fixture already supplied. No diagnostic clipboard read is
initiated by Start; clipboard reads happen only through the user's existing paste
actions. Copy report is explicit. Discard and reload erase the in-page report;
no report is written to storage, analytics, feedback or a provider. The panel is
absent from public builds, which have not been deployed.

`tests/paste-diagnostics-browser.mjs` checks source preservation and pause of
active mocked playback, version match/mismatch, native insertText and HTML paste,
the actual button with same/split items and readText fallback, stage timings and
equal 30,075-character source/preview, privacy, no automatic clipboard reads or
diagnostic POST content, explicit copy/discard/reload and 390/320px layout. It
asserts zero external/provider calls; normal off-mode text/button tests still
pass. Phone evidence is the next step; this release does not claim a root cause.

### Confirmed phone HTML omission

Roger's opt-in report verifies running/served build `ea552f5`, Android Chrome 156,
and one ClipboardItem with both text/plain and text/html. Plain text has 29,294
characters and both complete named Markdown links. HTML has 31,346 characters
but neither label, destination nor weather anchor; its converted text is the
30,075-character version containing “the  and the .”. Clear, Paste & Play selected
that incomplete HTML. Cleanup left the editor unchanged. The measured button
import/preview took about 120ms; this does not diagnose the separate 20-second
keyboard delay.

The shared HTML converter now verifies that meaningful named Markdown link text
from the supplied plain representation survives in its readable output, even
when HTML omits anchors entirely. It compares normalized word sequences and
occurrence counts, excluding URL destinations from readable content. Any missing
named text selects the exact plain source. Matching work is bounded; unusually
expensive verification conservatively retains supplied plain source. This policy
contains no weather-specific names or domains and does not guess missing text.
Valid rich formatting remains preferred when those labels survive.

The regression uses synthetic surrounding content with the observed exact sizes
and no-anchor HTML shape, verifies 30,075-character HTML conversion without a
plain alternative, then identical preserved source/Read output across keyboard,
native rich paste and the actual button. It covers same-item MIME orders, split
item orders, generic and repeated labels, malformed/excluded links, normal rich
formatting, privacy and performance. The existing diagnostic remains available
to confirm the result on the phone and investigate keyboard timing separately.

### Keyboard input burst and capped report

Roger's next build-matched report on `906e5fd` records native, trusted
`beforeinput insertText` with exactly 20,000 data characters, then an editor of
20,000 characters. `pasteSignature` uses exact `text.length`; the editor has no
`maxlength`. The visible later events repeatedly leave the editor unchanged.
This is not a diagnostic character clamp or evidence that the HTML importer ran.
The report's visible timestamps cover about 583ms from first beforeinput to its
last entry, not a measured 20-second interval from a user tap. Its capped tail
cannot establish the final editor length or total event count.

The diagnostic stops adding detailed entries at 120. Its old copy/stop path
added `final` in memory after the last serialization, so capped copied reports
could omit both truncation metadata and the terminal summary. This reproduces
without any omitted tail from Roger. The report now always serializes the final
editor/Read signatures when stopped or copied, and retains per-stage totals,
omitted-entry count, maximum editor length and first/last input timestamps even
past the detail cap. It keeps the same bounded, private metadata model and never
reads the native clipboard automatically.

The actual input handler also reset reading and rebuilt the preview for every
unchanged value. It now retains the reading DOM and state for unchanged input;
real edits still reset and render immediately. Async clipboard invalidation and
image/import event handlers remain active on input events.

`tests/input-burst-browser.mjs` reproduces the old cap and 100 unchanged-event
rebuilds on the previous built UI, then checks native insertion of 20,000 followed
by 29,294 characters, deletion, retained DOM, exact capped maximum/final counts,
independently counted input totals, immediate changed-source previews and zero
clipboard/provider reads. One isolated desktop run reduced the 100-event burst
from 348.2ms/400 DOM mutations to 0.3ms/no mutations with diagnostics off, and
from 374.1ms to 63.7ms with diagnostics on. The fixed run counted 106 inputs,
103 unchanged and only three changed-source previews; the copied report retained
maximum/final lengths 29,294/29,293 after 433 omitted detailed entries. These
synthetic timings identify avoidable app work; they do not prove that the phone's
previous delay is resolved or why its initial native payload was 20,000.

### Summary length-only settings

Roger approved General audience as the built-in audience and removal of the
audience/style choice after comparing all nine settings. Summary now has only
Brief, Standard and Detailed under the initially collapsed More settings, with
Standard selected on a fresh load. In-tab length choices survive mode/disclosure
changes. The current UI had no persisted Summary settings; no unrelated storage
is changed. Every new UI request sends `language: general` explicitly, regardless
of any stored legacy values. The backend prompts, model, limits and compatible
legacy API enums are unchanged.

Changing length still cancels stale work while keeping the existing editable
summary and original restoration. The result identifies its length and exposes
that description to the textarea's accessible description. The settings layout
is a single column. Browser checks verify Standard, all three length payloads,
General audience on every request, no audience control, native keyboard
disclosure, preservation of the selected length, cancellation/restoration and
390/320px layouts. Synthetic Summary responses only; no live inference is needed
for this UI change. Deployment is authorized for staging review only.


### October 10 staging playback recovery

Roger approved a staging recovery test after an outage prevented WaveNet resume
at every position and browser voices reported `synthesis-failed`, including on
fresh short text. Production remains on `431ee06`; this approval does not promote
staged clipboard/Summary changes, enable offline saving, or authorize new paid
proof synthesis.

Media network error code 2 now preserves the logical reading, paid part IDs and
position, retires the failed resource/controller, and rebuilds playback on Resume.
Ready readings use the existing completed recording; unfinished MSE readings
rebuild from saved sections. Seeking while disconnected preserves the requested
position. No replacement reading POST is made by media recovery. Decode errors
remain fatal rather than being mislabeled as a lost connection. Play promises,
playing events and media-session updates from paused/released playback cannot
undo a later pause or engine switch. Stop resets a pending restored position;
Clear retires recovery and ignores late callbacks.

Browser speech unpauses the native speech engine before submitting a fresh
utterance when `speechSynthesis.paused` is true. Its existing generation guard and
exact `synthesis-failed` error remain. This addresses a verified paused-queue gap;
it is not a claim to repair every Android speech service failure.

`check:reader:recovery` is included in staging/public release gates. It exercises
real desktop Chrome MSE/completed-file decoding with existing MP3 fixtures and
synthetic API responses: complete and unfinished reading recovery, repeated
network errors, same-job/position/source reuse, seek, decode-error classification,
Stop/Clear during a pending reload, stale play/event/media-session callbacks,
three built-UI engine switches, native paused-engine retries and persistent
`synthesis-failed`. The same UI test supports `READER_ORIGIN` for hosted staging
verification with the existing Cloudflare Access session. All API writes and
speech engines are mocked, including hosted verification; no provider/account
state is changed by these tests. Actual Android validation remains separate.

Offline saving remains a separate proposed change: existing playback buffers
about 90 seconds ahead and trims behind. Server-ready does not mean saved on the
phone. An explicit save action should reuse paid IDs, download every required
part, verify and persist audio/timings, and cache the reader app for offline
reopening. Only successful complete storage should display ready; quota failures,
eviction, incomplete generation and interrupted downloads must not. Display
remaining character credit, preserve cancel and current limits, retry retrieval
without automatic paid resynthesis, and decide local retention explicitly.


## October 10, 2026: continue buffered audio during status outages

Real-reading preparation now retries network/timeout and temporary HTTP status
failures against the saved job ID with capped backoff. It publishes a connection
warning while retaining the last validated preparation snapshot. Terminal job
failures, cancelled/expired/missing jobs, authorization errors and malformed
status responses retain the existing failure/reconciliation protections. Online
and explicit Resume wake status backoff; Stop interrupts it without new jobs.

The MSE reader continues already-buffered audio through these outages and retries
retrieval without replacement speech. A sustained native wait at unavailable
audio pauses with the saved position and Resume enabled. Reconnection refills
the buffer; a boundary pause stays paused until Resume. Repeated transitions and
Stop/Clear retire pending timers. Staging testing says “Use server test sample ·
no speech credit” and “Internet required to load. This sample is not saved for
offline listening.”

The recovery release gate includes nine real desktop MSE/synthetic API scenarios:
buffered playback through three poll-loss/reconnect cycles, unavailable boundary,
interrupted section retrieval, terminal failed/404/expired/cancelled responses,
and Stop/Clear during outage. They verify one paid-job creation, unchanged source,
job ID and audio resource, no automatic confirmed-failure replacement, and safe
Resume. Additional unit cases cover GET-only retry classification and cancellation.
All providers and account APIs in these regressions are synthetic.

Roger separately reported that the earlier staging recovery resumed a real
286-section briefing after reconnecting on Android without editing its source.
He heard several sections after going offline once all sections showed prepared.
This is user-reported evidence, not an instrumented buffer measurement or a claim
of complete offline support. The exact report is retained in the ignored
`work/network-recovery-2026-10-10/android-user-report.json`.

Whole-reading prefetch, durable offline storage, export reuse, an additional
Paste button and automatic voice fallback are not implemented by this release.
Automatic browser-voice fallback was withdrawn during the design discussion.

## October 10, 2026: staging full-reading download trial

Roger approved a staging-only trial of continuous full-reading downloads shared
by playback and MP4 export. The earlier status-outage recovery remains included.
Production deployment and the installed extension are unchanged.

Staging retains verified MP3 sections in the current open tab with three bounded
GET slots and a 64 MiB audio budget. Playback starts as the first sections arrive;
downloading continues beyond the decoder's 90-second window. Player refills,
completed-file recovery, and MP4 preparation reuse the same section requests and
bytes. Captions derive from the same submitted text and validated sample timeline
using the backend's existing caption algorithm. Retrieval never creates speech.

Offline readiness requires every section of every source part to be present and
verified against its declared bytes/sample count and timeline. Server-ready alone
is insufficient. Network errors retain valid bytes and retry GETs with timeout;
quota/size limits, invalid audio and incomplete/cancelled/expired jobs cannot claim
readiness. Stop retains a complete downloaded reading for replay; Clear, changed
text or changed voice retire the current recording and readiness without automatic
synthesis. Existing confirmation for explicitly retrying failed paid work remains.

This first trial uses memory, not Cache Storage or a service worker. The visible
status says to keep this tab open: reload, tab closure or browser process eviction
clears downloaded audio. Mobile browsers may suspend downloads when backgrounded;
wait for readiness and audible speech before locking the screen. Media Session
handlers and normal audio playback remain in use. An OS Downloads MP4 is a separate
file and is not silently reopened by this reader. MP4 export remains H.264/AAC
with embedded mov_text subtitles; the encoder assets load on export, so first-time
offline MP4 conversion is not promised.

Unit coverage checks single-flight retrieval, concurrency, exact shared audio/VTT,
retention limits, corruption/timing rejection, late cancellation and eviction.
`check-full-reading.mjs` uses real Chrome MSE with a synthetic 90-section reading:
early playback, full offline seeking beyond the decoder window, interruption and
reconnect, Media Session pause/play and visibility transitions, Stop/replay,
cancellation, eviction and reload. `scripts/video-download/check.mjs` runs the
real browser/WASM encoder and ffprobe, checks complete duration/subtitle counts,
and verifies player/export section reuse plus actual UI text/voice invalidation.
All speech/account APIs in these tests are synthetic; no paid/provider calls.
Android lock-screen and airplane-mode behavior still requires Roger's device test.

## October 10, 2026: separate staging Paste action

Roger requested the previously discussed Paste control and removal of ordinary
paste troubleshooting UI. Staging now shows Clear, Paste, Clear, Paste & Play in
that order. Paste inserts at the saved editor cursor or replaces its selection,
returns to Edit, and does not start speech. The replacement button keeps its
existing deliberate autoplay behavior. Both actions use the same one-read
clipboard payload converter, including the confirmed Android HTML-omission
fallback and split-item plain/HTML pairing. Native rich paste and the new action
share native insertion/Undo with a setRangeText fallback.

The saved range is captured while editing and before pointer/keyboard toolbar
focus changes. The action captures its own source/range before awaiting clipboard
permission. A later edit, native paste, Clear, document import or newer action
invalidates a pending result; denied and empty clipboards leave source/selection
intact. Image-only clipboard contents still open the existing document/consent
flow; Paste never starts OCR or speech automatically. Document busy/read-only
states apply to both clipboard buttons.

Troubleshoot this paste is created only in explicit staging testing mode
(`?testing=1`). It remains opt-in, local, bounded and private; the normal reader
has no diagnostic panel or listeners. No diagnostic machinery was deleted.
The three staging actions retain 44px touch targets and their order at 390/320px.
Public builds expose neither the new button nor diagnostics. This is a staging
release only and preserves the f533251 full-reading download/recovery work.

`check:reader:paste` is now a release gate. Built Chrome tests cover empty/append/
insertion/selection, toolbar and async permission focus, Undo and fallback,
rich HTML/plain Markdown and long text, delayed-read edit/Clear races, keyboard
activation/native input, natural-voice no-autoplay/no-job behavior, old explicit
autoplay, mobile layout and diagnostic testing-mode isolation. Existing label,
privacy and input-burst regressions remain included. Clipboard, provider and
account APIs in these checks are synthetic. They preserve the verified Android
source-shape fixes; actual device clipboard behavior is not newly instrumented.

Offline audio still has f533251's current-tab-only 64 MiB retention and readiness
verification. Reload or browser process eviction discards it. The MP4 encoder
loads on export, so first-time offline MP4 conversion is not promised. Roger's
Android airplane-mode and lock-screen acceptance remains a separate device test.
