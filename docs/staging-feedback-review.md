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
relevant files selected first and the partial source scope stated. The present reviewer
is metadata-only: no private image is retrieved or transmitted. Telegram renders
findings/recommendations, suppresses raw evidence and removes URLs for scan reports.

### Pending image-analysis approval

Automatic approval review blocked retrieval/transmission of private scan previews until
explicit payload-and-destination approval is confirmed. The concrete proposed recipient
is OpenAI, using gpt-6-astra through Roger's existing ChatGPT-authenticated Codex CLI;
there is no additional model provider, recipient or credential. Proposed payload: the
opted-in original represented by ephemeral previews, at most three initial PDF pages
or one PNG/JPEG/WebP image, scaled to at most 1,600 pixels per side, plus the sanitized
correlation metadata and bounded committed source subset already used by the reviewer.
Local retrieval would use only the existing cached staging Access session (no automatic
browser login), bounded 50 MB/30-second reads, no redirects or arbitrary URLs. Preview
conversion would have bounded memory, CPU and time, and local copies would be deleted
at the end of the review; the R2 original expires after seven days. The model receives
images as untrusted evidence and has all action tools disabled. Telegram receives no
image, attachment, image URL, transcription or raw filename.

This image path is not implemented or enabled pending that approval. Tests for the
current report, retention and browser flows use synthetic files, mocked APIs and local
workerd only; no old scan has been transmitted.
