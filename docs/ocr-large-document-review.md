# OCR large-document review — October 11, 2026

Status (October 12 checkpoint): Roger approved the exact staging temporary-original design on October 11 (“Clever. Proceed.”) and resumed implementation (“Yes, Resume it”). Source verification, atomic accounting, durable dispatch/results/cleanup, authenticated recovery API and material-consent UI are implemented and tested locally. The full native workerd lifecycle now passes with a 50,000,000-byte / 1,000-page synthetic PDF and a mocked provider. Nothing in this larger-job checkpoint has been deployed: staging remains Summary-consent release `fb74a5a` with the earlier 6 MiB / 10-page scanner. Public production remains `068c2318`. Remote staging migration, restricted gateway deployment, updated complete reader release gates and hosted verification remain. These larger limits are not ready for user processing yet.

## Target and verified economics

Roger's target is one deliberately pasted screenshot or chosen whole file, up to **50,000,000 bytes** and Mistral's maximum **1,000 PDF pages**, admitted only when the available wallet can reserve the whole document at **2 credits/page** (2,000 integer ledger units/page). The affordable-page bound is `floor(availableUnits / 2000)`, also subject to the provider's 1,000-page cap. No file splitting, partial-file charge, silent page truncation, recurring payment, or automatic credit refill is proposed.

The pinned model remains `mistral-ocr-4-1`. Mistral currently publishes **$4 / 1,000 standard OCR pages**, versus $5 / 1,000 annotated pages. The current request has no document/bounding-box annotation format. Thus the standard list-price estimate is $0.004/page; the existing two-times provider reservation rule would reserve $8 for 1,000 pages. At current shared-wallet pack terms ($10 USD / 1,000 credits), 1,000 pages use 2,000 credits ($20 of purchased face value before payment fees/tax). This is published list pricing, not an actual large-document provider invoice or latency proof.

Sources checked October 11: [model/pricing](https://docs.mistral.ai/models/ocr-4-1), [OCR limits and document URLs](https://docs.mistral.ai/studio/document-processing/basic_ocr), [zero-based page ranges](https://docs.mistral.ai/api/endpoint/ocr).

## Proposed storage/access/retention decision

Approve this exact design for the next **staging** implementation:

- Use the existing private staging R2 bucket through its existing `AUDIO` binding. Add a dedicated SQLite `OcrJob` Durable Object class/binding and additive migration. Do not reuse speech job IDs/state. No S3 credentials, public bucket, additional API token, new account access, or paid plan is required by this proposal.
- A foreground upload streams into a private random object under an account/job-specific prefix. Stop at 50,000,000 bytes. Incomplete uploads are not accepted jobs, do not reserve customer credits, cannot dispatch OCR, and are deleted; any orphan is denied all reads and removed by cleanup. Enforce **one hour from upload start** as the hard original-file access expiry, including an interrupted upload.
- A complete immutable object is verified independently for byte length, hash, MIME, PDF structure and whole-file page count. This verification belongs to the job Durable Object, rather than the Free HTTP Worker's 10 ms CPU budget. Only trusted counts can reserve the atomic wallet hold and provider allowance.
- Confirm “Accepted” only after the complete source, verified metadata, admission, reservation, and durable alarm are recorded. Return a job ID promptly. Before this confirmation, the UI says “Uploading — keep this page open”; it must never imply that a suspended/interrupted upload will continue.
- Staging Cloudflare Access currently protects the app origin, so Mistral cannot fetch that URL. The next implementation also needs an explicitly approved separate **staging OCR source gateway Worker** (public Workers.dev endpoint, only an OCR-job namespace binding and the expiring one-object capability GET route). Do not bypass Access for the app or cross-bind staging files into production. Public rollout can use a token-protected source route on its existing public origin. This additional endpoint/resource is part of the pending storage/access review; none has been created.
- For Mistral only, mint one random 256-bit capability for GET of this immutable object, store its hash and expiry, and allow no listing, upload, or access to any other object. Proposed capability expiry: **15 minutes from accepted dispatch admission**, never beyond the original-file hard expiry. Treat the URL as a temporary bearer secret; redact it from logs/results/history. Customer result endpoints remain authenticated and account-bound. Do not create permanent provider access.
- Bump the remembered OCR policy version and require renewed disclosure/choice before using temporary original-file storage or provider URL access. A remembered approval for the current inline/no-original-storage path must not authorize the new privacy behavior.
- Once accepted, server-owned alarms drive queued → running → ready / failed / uncertain. An alarm retry must inspect a durable dispatch marker and **never redispatch a paid OCR request**. A marked dispatch with lost/expired execution becomes uncertain, releases customer credit, retains the provider cost reservation, and permits only reconciliation of the original attempt. It does not offer an automatic paid retry.
- Proposed operation deadline: **12 minutes from acceptance**, with a provider request timeout of **10 minutes**. Stop admitting expired jobs. Timeout/failure/uncertainty retains the previous editor source and charges zero customer OCR credits. These values require real-account throughput/latency validation before a public rollout; they are proposed bounds, not a completion estimate.
- Request deletion of the original scan and revoke its capability immediately on success, failure, uncertainty, timeout, or cancellation; the one-hour expiry is a hard fallback. Existing staging cron (one minute) and an idempotent job alarm retry deletion; access is denied at expiry even if physical deletion needs a retry. Record cleanup status and alert operationally on retained expired objects. No customer notification is sent.
- Persist complete original OCR Markdown plus per-page extracted header/footer/blocks and manifest privately; validate every submitted page/model/usage before settlement. Stream/page-part output rather than buffering one unbounded result JSON. Set result access expiry to **24 hours from successful completion**, then deny reads and delete content. Retain the minimal receipt/ledger metadata for reconciliation and financial history; do not retain source images or OCR text in that receipt.
- An authenticated Recent scans list recovers status/results after lock, app switch, tab close or reconnect. Complete Copy all text / Download .txt / Download .md remains available before expiry without another provider request. Original provider Markdown is distinct from reader cleanup and edits. Optional email completion is future design only; no email sending or infrastructure is authorized.

This changes the present privacy behavior: today original scans exist only in request/browser memory and are sent inline to Mistral, while successful output alone is temporarily in R2. The new original scan storage, its exact expiry, capability access, and dedicated durable-job binding require approval before deployment. Existing Mistral handling remains subject to the provider's terms; the app's R2 deletion does not make a claim about Mistral retention.

## Capacity evidence and remaining implementation gates

A local workerd prototype widened parser bounds only in a temporary bundle. It verified a valid **50,000,000-byte, 1,000-blank-page synthetic PDF** with filler, not a real scanned job. Sampled active V8 was about **32.7 ms**; the fixture retained roughly **100.7 MB of backing storage** plus heap. These are local sampling/snapshots, not Cloudflare billed CPU or peak-memory proof. The current multipart + inline Base64 path therefore cannot be certified by merely increasing constants.

Cloudflare currently offers SQLite Durable Objects on Workers Free, with a separate default **30-second active CPU budget per invocation** and durable alarms. The original-file verifier can be placed there without assuming a $5/month Workers Paid upgrade. The **128 MB per-isolate memory limit remains**: the prototype's duplicate source copies must be removed, output must stream into bounded page parts, and maximum compressed metadata/JSON/page expansion must be tested. A single job per object does not by itself guarantee a separate isolate or solve memory pressure. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [alarm retry semantics](https://developers.cloudflare.com/durable-objects/api/alarms/).

Required local gates before enabling this path:

1. Upload disconnect, incomplete/orphan cleanup, rejected size/MIME/encryption/adversarial page tree; immutable-object and capability expiry/security tests.
2. Verified 1,000-page admission and affordability, generalized D1 schema/triggers (current page/index/reservation constraints are still 10-page shaped), atomic simultaneous holds and refund/debt races. Preserve legacy receipts and reservations.
3. Durable dispatch marker before exactly one provider call; alarm retry, suspension, timeout, crash, lost result/storage/settlement acknowledgement; deterministic synthetic fault injection and no paid retry.
4. Full response/page/index/model/usage validation, bounded streaming output and all-or-zero customer settlement only after durable result and cleanup. A parsing/storage limit rejects a whole incomplete result and charges zero; it must never silently truncate it.
5. Client receipt persistence/status polling and authenticated recent-job recovery after reload; 24-hour result expiry measured from completion; complete page-boundary downloads and OCR-only export provenance.
6. Resource tests for exact 50 MB input, 1,000 pages, highly compressed metadata, dense page output, concurrent isolates, and output streaming. Real device testing remains necessary; desktop Chrome at 390px is a layout check, not phone memory/lock-screen proof.
7. Current Mistral account limits/latency are still unverified. Obtain bounded authorization for any real provider smoke test, with exact file/pages/maximum provider cost before running it. No promised 2,000-pages/minute throughput is substantiated.

No billable Summary overage is authorized. The current static Free-plan safety configuration cannot detect a dashboard plan change automatically. If a paid plan is later approved, pause Summary before the change and revisit its free-only enforcement.

## Optional Workers Paid configuration for later approval

Roger is willing to consider higher limits when the revenue leaves margin; no purchase or credit-rate change is approved. A practical initial Paid configuration is explicit `limits: { "cpu_ms": 30000 }` (the default), rather than immediately allowing five minutes. The local verification samples (6.7–59.6 ms across the synthetic cases) demonstrate work above the current HTTP Free allowance, but do not measure complete production authentication, upload, hashing, output parsing, R2 and D1 CPU. Record real CPU separately from wall time and select a lower protective cap only after maximum-input and adverse-structure tests pass with margin.

For parent unit economics, use account-wide monthly base/included usage rather than pretending every sale creates another subscription: currently $5/month, 10 million dynamic requests and 30 million CPU milliseconds included; additional usage $0.30/million requests and $0.02/million CPU ms. An illustrative **one second total Worker CPU per job**, after inclusions are exhausted, is $0.00002 CPU plus per-request usage, not a measured OCR job cost. Count polling, source fetches, downloads, cleanup and failed/uncertain attempts too. Durable Object active wall duration and SQL operations/storage, D1, R2 GB-month/Class A/Class B operations and retries are separate billing inputs. Network waiting is not Worker CPU, but it can incur Durable Object duration charges. The fixed account subscription can dominate marginal Worker compute at low volume. [Official Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Higher CPU cannot make a disconnected foreground request durable or increase 128 MB memory. Retain immutable R2 input/output and a server-owned job under either plan. One dedicated Durable Object with an alarm is the smallest existing-stack candidate: metadata only in SQL, no source blobs, idempotent alarms, and at-most-once paid dispatch marking. Queues add delivery retries and a 15-minute consumer wall limit; they would still need the same durable dispatch fence. Workflows can orchestrate longer steps, but introduce another binding and step/state charges and long default history retention. Do not put original files/OCR text in Workflow state/history or adopt it implicitly. For this bounded one-provider-call job, neither Queues nor Workflows is yet necessary.

Guardrails for any approved upgrade: keep exact size/page/output-expansion bounds, verified full-wallet holds, bounded simultaneous large allocations, provider reservation for uncertain dispatch, per-job CPU cap, account-wide budget/usage monitoring and a pause control. Customer billing remains the approved 2 credits/page until an explicit rate change. Pause Summary before an account upgrade because its current Free-plan flag does not detect the dashboard change, then enforce a separate non-billable allowance before resuming. No upgrade is performed by this release.

## Text/reader capacity audit and independent release

The editor has no `maxlength`; new text and OCR results remain in the current tab until a durable result-recovery feature is implemented. Local PDF extraction still has its existing 20 MiB, 100-page and 1,000,000-character quality bounds. These are distinct from the proposed paid OCR path; no larger local-PDF promise has been made.

The reader now preserves all cleaned text/chunks and global paragraph/section indices while rendering only **160 sections** at once for sources over 1,000 sections. Earlier/Later and Go to section controls expose the remainder; playback Follow reading moves the rendered window without changing speech order. Source, Copy all, and original scan downloads are complete. The normal short-document view is unchanged.

Synthetic desktop Chrome at 390px accepted 1,000-page realistic/dense text (about 4.51/5.05 million characters) and a 2-million-character unbroken token without truncating the editor. The old dense case created **80,000 section nodes**; the bounded view creates **160**, about 500 total DOM nodes. Full cleanup/chunking still takes roughly 0.8 seconds in the dense desktop test; physical phone responsiveness and incremental processing remain future large-job gates. Heap readings are snapshots and can include uncollected previous allocations; do not treat them as phone or peak-memory certification.

Speech jobs remain split at **20,000 characters** with per-chunk provider bounds; the complete source is not capped at one speech job. Existing audio prefetch concurrency (three) and tab cache (64 MiB), MSE trimming, and on-device PCM bounds remain. Preparing an entire million-character reading may be lengthy/expensive; whole-reading balance preflight and server reservations remain authoritative. MP3/VTT assembly and FFmpeg MP4 export can load the whole prepared recording into device memory and are **not certified for a 1,000-page book**. No cache/memory limit was raised to mask this.

Summary retains its explicit **24,000-byte UTF-8 source** and encoded-source limits; it rejects oversized text without inference or truncation. Remembering one-tap Summary does not turn it into a full-book summarizer.

The staging UX release is independent: optional account/operation/policy-version-scoped remembered choices for OCR and Summary; visible Cloud actions revocation; deliberate paste/file choice only; whole-file price disclosure; insufficient-credit failure before provider dispatch; complete original OCR Copy/.txt/.md and clipboard download fallback. Native ordinary text paste retires OCR-only export provenance. All current tests use synthetic responses; no live provider call or payment occurred.

## Current Summary model/accounting checkpoint

Read-only source/config inspection and existing D1 aggregates on October 11 confirm PasteToSpeech uses `@cf/meta/llama-3.2-3b-instruct` in both staging and public production; no Qwen model is selected by this app's Summary path. Both have the `AI` binding, approved upstream-free-daily mode and static Workers Free flag. This task has not inspected unrelated Ripples infrastructure.

Exact application limits: 24,000 UTF-8 source bytes; 30,000 encoded-source bytes; combined message content at most 32,000 bytes; request JSON at most 150,000 bytes; one response up to 512 generated tokens / 8,000 characters and 65,536 response bytes; temperature 0.1; non-streaming; 30-second timeout. The app does not count source tokens; Cloudflare currently publishes an 80,000-token model context, distinct from these application byte limits ([official model documentation](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/)). One D1-serialized shared in-flight request per environment (120-second uncertainty lease), one AI.run call per admission, no automatic retry, retained request keys prevent reuse. Separate environment databases do not form one account-wide concurrency lock.

Existing aggregate records: production **1 done, 0 requests in the preceding 24 hours**; staging **31 done, 4 requests in the preceding 24 hours**. The read-only queries wrote zero rows. The request table stores only ID, account, creation time and admitted/done/failed/uncertain state; returned token usage and neurons are not recorded. Thus no actual per-summary token/cost average can be calculated from the current ledger. No inference was run for this check. Current free availability remains unchanged; a pricing discussion authorizes neither a model change nor wallet deductions.


## First implementation milestone: private original source

`ocr-source.js` implements metadata-only Durable Object state plus a bounded raw
R2 upload. The original is streamed through native `FixedLengthStream`, enforcing
exact declared size with a 50,000,000-byte ceiling and a conditional immutable
PUT. Upload completion is confirmed by R2 size/etag before becoming eligible for
verification. No source body or clear capability is persisted in DO state or D1.
A server verifier must set the hash/pages, and an injected durable-dispatch check
must authorize access; the default check denies all capability creation/access.
This component alone does not accept an OCR job or charge credits.

A 256-bit capability expires after 15 minutes, bounded by the original's hard
one-hour lifetime from upload initialization. It permits one canonical GET for
that immutable object. Range, HEAD, wrong token, expired/revoked source, replaced
etag, or unauthorized dispatch cannot expose the object. The used marker is
persisted before returning bytes; uncertain GET acknowledgement never retries.
Revocation also stops an active stream. Original access expires at the hard hour
even if R2 deletion needs retries. Physical cleanup is retried by alarm after a
minute, including a cancel/late-upload race. Incomplete, excessive, disconnected,
conditionally rejected or unconfirmed uploads cannot become accepted jobs.

`ocr-source-gateway.js` is a disabled-until-configured, staging-only handler. Its
only intended binding is the OCR-job namespace; it receives no bucket, D1,
account/session, payment or provider-key binding. It forwards only the capability
header to a fixed internal source-read route, never external account/cookie/auth
headers or query parameters. Its future dedicated Worker must disable request
observability so capability paths are not logged. No gateway Worker or binding has
been created yet, and the existing private app Access policy remains intact.

`tests/ocr-source.test.js` covers twelve lifecycle/security cases with fake R2,
transactional metadata and no providers: size/type/owner bounds, exact immutable
upload, early storage rejection without hanging, lost write/metadata/GET
acknowledgments, single GET/hash-only storage, expiry, replacement, revocation of
an active stream, deletion retry, late commit cleanup and gateway header isolation.
Native workerd 50 MB streaming/resource proof is still required; Node's test
transform emulates length checks and is not a Cloudflare memory/CPU measurement.

Remaining integration: bounded 1,000-page server admission, staging additive job
and wallet/provider journals preserving legacy rows, durable alarm/dispatch and
settlement, paged/streamed complete result persistence, owner recovery UI and
material new privacy consent. Existing provider permits still have 10-page and
finite-cents constraints; this milestone does not widen them or authorize a paid
smoke. Preserve the deployed Summary consent fix while these gates are built.

Runtime references: [R2 conditional/streaming API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[native exact-length streams](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/),
[durable alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).


## Native resource and accounting milestone

`tests/ocr-large-native.mjs` now exercises local workerd with native
`FixedLengthStream`, SQLite Durable Objects and local R2. The exact synthetic
**50,000,000-byte / 1,000-page** supported PDF is uploaded immutably, independently
counted, hashed, retrieved byte-for-byte once through the gateway, and deleted.
The recorded loopback upload/verify/retrieve duration was **1,223.13 ms**, including
**25 ms hash wall time** and **25 ms parse wall time**. Those are local wall timings,
not Cloudflare billed CPU, production latency or Mistral throughput.

The large verifier avoids pdf-lib's raw-stream copy by using read-only subarray
views. In that maximum fixture it reports **one original/raw-stream backing buffer
of 50,000,000 bytes**, rather than another source-size content-stream copy. It
bounds metadata tokens before allocation (64 KiB strings, 4 KiB names, 64-byte
numbers, 4 MiB aggregate text), 131,072 parser steps, bounded structural inflation,
page-tree depth and a 10-second parse wall deadline. The source/hash/parse allocation
is serialized per isolate; two concurrent 50 MB/1,000-page verifications both
report a maximum of one active large verification allocation. This is retained
backing-buffer/concurrency evidence, **not a measured process or phone memory
peak**. The old verifier retains its 6 MiB/10-page policy and its existing tests.

Native tests also reject byte/page excess, long literal metadata, incomplete PDF,
and a short chunked upload without issuing provider access. Plain/compressed
1,000-page unit cases, structural inflation bombs, false Count, parent cycles,
duplicate definitions and missing EOF are covered separately. Rejected duplicate
stream uploads exposed a request-lifetime issue; `ocr-upload-proxy.js` now checks
owned metadata first, pumps through a native known-length stream and keeps the
HTTP context alive until pumping finishes or stops. Incoming account/auth headers
are not forwarded. Native duplicate and incomplete cases pass without an extra
original or accepted job.

`staging-migrations/0012_ocr_jobs.sql` and `ocr-job-ledger.js` are prepared locally.
They add upload identity/one-active-owner checks, job receipts, an immutable credit
journal and immutable provider reservations, plus refundable-hold capacity. Tests
preserve every prior table row and account balance before exercising isolated
fixtures. A 1,000-page fixture atomically holds **2,000 credits / 2,000,000 units**
and reserves **800 provider cents**, settles once only with the full saved result
and confirmed source deletion, or refunds once against debt. Cross-service holds,
account suspension, cancellation, expiry, foreign ownership, receipt immutability
and duplicate inline/durable processing are checked. Eight accounting tests pass.

No migration has been applied remotely. The new large-job allowance table starts
empty/disabled; existing legacy provider permits and counters remain unchanged
unless an ordinary admitted job legitimately consumes their existing scope.
There is no implicit 1,000-page live authority or new credit grant. These components
still need the durable admission/alarm/dispatch protocol, bounded result persistence,
recovery UI, changed source-storage consent and end-to-end staged verification.
The larger limits are **not ready for user processing** at this milestone.

The separately authorized five-page recipe QA used the already deployed fb74a5a
inline path and settled 10 credits. It is independent of these local proofs;
no duplicate or broader provider test was run here. Handwriting can contain
material substitutions and must be compared with the original; generated export
bytes do not establish transcription accuracy.


## Durable lifecycle and browser checkpoint — October 12

`ocr-job.js` now accepts only a complete immutable server-verified source, fresh
account/policy/whole-price consent and an affordable whole-file hold. SQLite DO
alarms continue after the upload client leaves. A durable D1 dispatch fence allows
one provider call only; lost acknowledgements and restart uncertainty never cause
another paid attempt. The pinned standard model remains `mistral-ocr-4-1`.
Provider reservations remain immutable estimates ($8 for 1,000 pages), not a new
customer spending allowance. Standard jobs do not gate on or mutate old finite
experimental permits/business counters; tests preserve those old records.

`ocr-job-results.js` parses the provider response as bounded streaming JSON, writes
immutable page objects, and publishes a manifest only after every expected page,
model, usage count and nonblank body are validated. Bounds: 64 MiB response,
1 MiB per page, 20 million text characters and JSON nesting 64. Excess/incomplete
work is rejected as a whole and refunded; there is no silent truncation. A complete
manifest can recover a lost write/settlement acknowledgement. Source revocation
and confirmed original deletion precede settlement; deletion failure retains the
hold temporarily and retries without repeating inference. Failure, timeout,
cancellation, refund debt and a lost dispatch acknowledgement cannot settle.
Outputs are privately available for 24 hours from completed storage; expiry deletes
page content while retaining immutable minimal financial receipts.

`ocr-jobs-api.js` requires the verified staging owner session and exact owned job
IDs. Raw foreground uploads use native known-length streams without forwarding
incoming account/credential headers. PUT now requires the same-origin source
check, alongside existing POST/DELETE protection. Recent scans includes both new
jobs and earlier inline receipts, allowing free original-result replay. The
prepared staging source gateway binds only the OCR job namespace, has no bucket,
D1, credentials, account or payment binding, and disables logs/traces. Its origin
is `private-wavenet-ocr-source-staging.rogerpbrown.workers.dev`; it is not deployed.

The staging-only `ocr-jobs-client.js` first obtains explicit temporary-storage
consent, uploads/verifies the whole file, then displays the verified full price for
explicit acceptance. The material policy is
`mistral-temporary-original-2-credit-v1`; the old inline remembered choice cannot
authorize it. A newly remembered choice applies only to deliberately chosen/pasted
files, fresh matching account/policy/price metadata and full affordability.
Accepted work survives tab closure; Recent scans recovers it without re-upload or
inference. Loading saved text is explicit and preserves editor changes during
loading. Server text/Markdown downloads stream complete original page data;
Copy preserves all original pages and footers. Local PDF checking remains free;
large PDFs go to bounded server verification. Public builds keep the old path.

Native proof: `work/ocr-job-native-proof/verification.json`, generated by
`tests/ocr-job-native.mjs`, uses local workerd, native FixedLengthStream, local
SQLite DO/D1 and private local R2. The exact 50,000,000-byte / 1,000-page file was
verified, held at exactly 2,000 credits, fetched byte-identically by the mocked
provider once (second GET denied), processed once, saved and settled once.
**5,025,890 result characters** and the final original footer replayed intact;
text/Markdown exports contain **5,039,813 / 5,046,820 bytes**. The full local
lifecycle/replay/export/cleanup proof took **13,488.28 ms**. This is local wall time,
not billed CPU, production throughput, physical-phone memory or real Mistral
latency. Expiry and pre-upload cancellation cleanup pass. No real provider call,
payment, remote data write or new access credential was used.

Browser proof: `work/ocr-job-browser-proof/verification.json` and
`mobile-consent.png`, generated by `tests/ocr-jobs-browser.mjs`, uses built staging
assets in isolated Chrome with every API intercepted. It checks old-consent
invalidation, separate privacy/whole-price clicks, deliberate remembered action,
whole 50 MB upload, exact 1,000-page/2,000-credit price, 1,000-page reader load,
reload/recent recovery with no new inference, editor preservation, original Copy
and download, insufficient wallet, material/account isolation, uncertain admission
without retry, and 320/390px fit. This is not a physical phone/lock-screen proof.

The repository tests and focused fault/parser/accounting/API checks pass. The
native proof exposed Wrangler's CASE/END splitting requirement; the new migration
is formatted compatibly and has a regression using Wrangler's actual splitter.
Before any larger scan becomes available, finish adapting the older reader browser
gates to the new staging flow, take and verify a private staging D1 backup, apply
only additive 0012, deploy the DO binding and restricted gateway, and verify hosted
assets/UI with all provider writes mocked. No new real-provider smoke, public
promotion or paid account upgrade is approved by this checkpoint.
