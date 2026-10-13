# Staging feedback review

The staging reviewer polls only private-wavenet-reader-staging with the staging
Wrangler configuration. P2S_FEEDBACK_ENVIRONMENT=staging selects a separate
SQLite queue, lock, reports and temporary review directory under
~/.local/state/paste2speech-feedback-staging. The existing production service,
queue, database and schedule remain unchanged.

Install deploy/paste2speech-feedback-review-staging.{service,timer} in the user's
systemd directory and enable the timer. The service runs from the shared release
checkout; it reviews committed Cloudflare/frontend sources, excludes the unrelated
Python server and bounds source input to 350,000 characters. Tool-disabled
review isolation, retry/deduplication and no automatic fixes are retained.
Notifications go to Roger's existing Telegram destination, clearly prefixed
PasteToSpeech · staging. Benign pipeline tests use the test category.

Initial activation imports the four retained staging reports, including Roger's
September 28 test. Future scans run at :05 and :35 each hour; empty scans are quiet.
Staging reports are not merged into production, and no billing data is modified.

Activation verified September 28, 2026: all four retained reports reviewed as
benign tests and notified once (Telegram message IDs 26–29). Latest report
28a36aee-8183-4636-93b5-b16c3a883db8 delivered as message 29. A second service
run imported zero rows, stayed healthy and left every delivery_attempts count at
one. All 16 reviewer tests passed. Production service and state were untouched;
no Worker deployment or billing configuration change was required.


## Opt-in scan diagnostics (October 12, 2026)

The scan outcome offers an explicit Send feedback form. Include my scan with this
report starts unchecked. Clipboard failures also offer explicit metadata-only reporting, without another clipboard read or a file request. A JSON-only request records the exact raw filename basename
(up to 1,024 UTF-16 code units, with truncation disclosed), file size/type and available
bounded header dimensions, actual input route, browser/OS version, relevant scan-choice
booleans, client build and stage. It contains no editor text, clipboard contents,
credentials, full folder paths, source links or provider bodies. Filenames are untrusted
data, kept in JSON and rendered with textContent; never shell arguments or instructions.

The server correlates only the owner's attempt, using original hash, timestamps,
provider stage/HTTP status when available, and immutable credit settlement. Its current
served build is labelled serverBuildAtReport rather than attributed to the original
attempt. Missing provider request IDs and original Ray IDs remain null. An unconfirmed
client ID remains a separate reportedClientJobId with attemptAvailable=false.

After explicit inspection consent, the owning Durable Object verifies the existing
R2 object and pins that same object for seven days; no second file is uploaded. Normal
provider access still ends at the original hour/single-GET deadline and revocation.
Diagnostic access requires the same app's verified Access owner identity plus a saved
report reference. Its stream ends at that report's expiry. Cleanup serializes with
retention, retries failed deletion and honors later independently consented reports.
Each report has its own deadline; repeated submission does not extend its consent.

Failed/uncertain/canceled originals normally revoke and delete immediately. This change
does not extend pre-opt-in storage. If the original never arrived or is already deleted,
the report is metadata-only with the reason stated. No replacement upload is requested.
D1/local report diagnostics keep the existing 90-day cleanup. No schema migration,
new storage binding, credential or paid OCR retry is introduced.

The staging systemd service must run from %h/workarea/paste2speech after integration.
Its existing timer, queue, recipient, Telegram credentials and production service stay
unchanged. Review input stays under the existing 350,000-character source bound, with
relevant files selected first and the partial source scope stated. The reviewer retrieves only an explicitly consented saved report reference when the
original is still available. Missing/expired originals receive metadata-only analysis. Telegram renders
findings/recommendations, suppresses raw evidence and removes URLs for scan reports.

### Bounded image review (approved October 13, 2026)

The recipient is OpenAI, using gpt-6-astra through Roger's existing ChatGPT-
authenticated Codex CLI. Payload: an explicitly opted-in original represented by
at most three initial PDF pages or one PNG/JPEG/WebP image, scaled to at most
1,600 pixels per side, plus sanitized correlation metadata and the existing bounded
committed source subset. No additional model provider, recipient or credential.

Retrieval uses only the current app-specific cached staging Access session; it never
opens a browser or renews login automatically. Only the fixed authenticated report
endpoint is requested. The client identifies itself as PasteToSpeechFeedbackReviewer/1.0;
it does not impersonate a browser or change access rules. No redirects/arbitrary URLs,
a 50 MB bound and 30-second
wall-time deadline. Size/type/hash are verified when available. An unavailable or
expired original leaves the reviewer in metadata-only mode with that limitation stated.

Image/PDF conversion runs in a separate namespace with no network, home, credentials,
repository or sockets. It has 512 MiB memory, 20-second CPU, 25-second wall-time and
10 MiB per-output bounds; image pixel count is limited to 20 million. Preview metadata
is stripped, alpha rendered on white, and raw input removed immediately after conversion.
Only validated PNG previews within the bounds reach the CLI. All local copies disappear
at review completion; the existing stale-run cleanup handles interrupted runs. Expired
report references never start a new image transmission. Diagnostic access expires after
seven days, subject to earlier bucket cleanup; physical deletion is asynchronous.

The model treats filenames, image text and source comments as untrusted evidence and
has every action tool disabled. Telegram receives findings/recommendations only,
without images, image URLs, transcription or raw filenames. No paid OCR rerun occurs.

Tests use synthetic files, mocked private retrieval and local workerd. A synthetic
OpenAI image handoff smoke test verified the same existing transport, including the
visible test shapes, without any real scan or Telegram message. No old scan is transmitted without its explicit opt-in.

### Existing lifecycle constraint and retention wording

The historical staging setup record (docs/private-wavenet-staging-status.md:12)
records a 24-hour R2 deletion/multipart-abort lifecycle. Current lifecycle-rule
inspection returned HTTP 403; it was not retried through another route and no
permissions were changed. The rule's current status and prefix scope are unknown.
Application metadata/pins cannot override a matching R2 lifecycle rule. Therefore
seven-day file availability is not guaranteed. The API guarantees that diagnostic
access ends at its seven-day deadline even if deletion is delayed. Deletion is
scheduled then and retried after storage errors; physical completion is asynchronous.
The UI states at-most-seven-day diagnostic access with possible earlier storage
cleanup, rather than an exact physical-deletion or availability promise.

Before claiming seven-day storage availability or deploying on that basis, Roger
must verify the current lifecycle and approve any narrowly scoped policy change.
Object age matters: lifecycle age starts at upload, while diagnostic consent starts
at reporting. No source copy, key rewrite, new bucket, lifecycle edit, credential or
Access change has been made. The proposed pre-opt-in 24-hour retention remains
unapproved and unimplemented. A metadata-only deployment can avoid this storage
promise entirely. The deployed feedback wording uses at-most access and possible
earlier cleanup; no seven-day storage availability promise is made.

The immutable settlement guard still requires original deletion for successful
scans. Diagnostic retention is permitted only for already-closed failed, uncertain,
canceled or expired attempts; active/unaccepted viable scans produce metadata-only
reports with scan_still_active. Feedback cannot pin an active original, delay a
successful settlement or generate another provider request. Existing accounting
and source-deletion constraints are unchanged.

Cloudflare's current object-lifecycle documentation confirms prefix-scoped rules,
age-based expiration and asynchronous deletion:
https://developers.cloudflare.com/r2/buckets/object-lifecycles/ . This public
reference describes behavior; it does not verify this account's current rules.


### Safe failure diagnostics and concise scan notifications (October 13, 2026)

Future provider rejections retain only an allowlisted category/code, the category's
origin (provider code, heuristic message pattern or HTTP status alone), a validated
request ID, and the bounded-body read outcome. At most 4,096 response bytes are
examined for two seconds. Raw error text, document/source URLs, capability tokens,
credentials and filenames are discarded. An HTTP-only 400 remains unspecified;
a heuristic category is not a confirmed explanation from the provider.

The source gateway's existing single GET records response status, expected bytes,
bytes enqueued by the server, local stream completion/outcome, start/end times and
bounded denied reuse count. A complete local stream does not prove remote receipt.
An unavailable/interrupted stream is distinguishable from mere grant consumption.
Diagnostic writes are best effort and cannot authorize reuse, change settlement,
retain an original, or dispatch another provider request. Existing deletion/refund
and uncertain-attempt safeguards remain in force; no automatic paid retry is added.
Old attempts have unknown new fields; their discarded provider responses cannot
be reconstructed. No change to pre-opt-in retention or bucket lifecycle is included.

Future staging scan notifications contain Outcome, Credits, Uncertain and Next,
plus one report ID and the existing reply-channel guidance, within 1,200 UTF-16
units. Credit figures come from correlated ledger evidence. Complete sentences are
selected within each budget; excessive prose receives a complete fallback rather
than a clipped sentence. Technical file paths remain in private saved review
fields. Already-delivered reports are not reformatted or resent.

Unpaid regressions cover rejected/malformed/oversized/timed-out provider bodies,
secret redaction, incomplete source streams, diagnostic storage failures, one-time
refund/dispatch, and offline boot followed by online reload and a single mocked
scan acceptance. Reloading after a failed attempt cannot redispatch it. These
checks use intercepted APIs and mocked providers; no real OCR or payment occurs.
