# Staging interrupted-section recovery — October 19, 2026

Roger approved staging-only error diagnostics and safe reuse of successful audio
inside an interrupted preparation part. No production deployment, paid provider
proof, schema migration, historical credit correction, or automatic provider retry
is included. The original failure's exception was discarded by the old code; this
change does not claim to establish or fix that original storage/ledger cause.

## Recovery boundary

`SPEECH_SECTION_RECOVERY=1` is set only in staging. Browser builds force it off in
public/trial environments; server access independently requires staging mode and
private Access admission. Source jobs remain failed with their original settlement.

A read-only `/api/readings/<id>/recovery` checks the authenticated owner, unexpired
failed job, exact closed settlement and usage rows. Reusable sections must form a
contiguous ready prefix. Every remaining section must be pending, with attempt and
submitted-character counters proving it was never submitted. A submitting marker,
a ready section beyond a hole, missing/corrupt objects, mismatched settlement,
source/voice identity, or unsupported size fails closed before new speech.

New staging preparation records a SHA-256 digest for each successful section.
Recovery verifies that generation-time digest, MP3 sample count and byte count,
then verifies the same bytes in the tab before offering a paid remainder. Historical
sections lacking integrity receipts require review; they are not silently reused
or regenerated. Proof is bounded to 100 saved sections / 32 MiB. Original source
expiry still applies; recovery does not extend retention. At most 64 segments may
compose an interrupted part.

The confirmation states the verified reused section/character count and only the
remaining characters that would use credit. If all audio is verified and saved,
recovery needs neither a provider request nor a paid confirmation. Unverifiable or
uncertain work remains blocked; there is no fallback to a silently billed whole-part
retry. Old client tabs keep their existing code and confirmation behavior.

## Accounting, concurrency and persistence

The old paid prefix keeps its original usage events. Only the untouched suffix is
submitted as an ordinary new job using the existing reservation, settlement and
provider-attempt protections. The server derives an owner/source/prefix-bound
request ID, so repeated/concurrent recovery creates the same remainder job; Durable
Object creation and ledger uniqueness prevent a second debit or dispatch. IDs are
persisted before POST; lost acknowledgements check that same ID.

The parent reading retains its original chunks and timeline. Its session records
contain bounded segment ranges, job IDs and attempt metadata, not source text.
Reload/re-paste with the same voice and split settings restores that composition
without a new job. Verified audio, captions and MP4 export use the same mapped
sections and preserve native playback position. Export an independently restored
recovered record through Play first so the active verified audio store is rebuilt.
Clear stops recovery-created scheduling and does not treat borrowed source jobs as
newly owned work. A source deleted or expired during confirmation is rechecked
before suffix preparation; failures never authorize speculative regeneration.

## Diagnostics and review

Staging failures record an allowlisted phase, error class, section index, timestamp
and opaque job ID. No raw exception message, source text, email, provider response,
credential or token is logged. The owner-visible status carries the safe failure
metadata; opt-in playback diagnostics include it. User-facing messages distinguish
reservation checks, progress persistence and assembly failures.

401/403 and HTML sign-in responses are access failures, not corrupted MP3. A failed
preparation's HTTP 422 and missing/expired audio likewise do not poison retained
audio as corruption. Real parse, timing, byte-count and digest failures still block
use. Network/status checks retry only existing IDs; no paid call retries itself.

Regression tests use synthetic APIs and actual SQLite billing triggers. They cover
partial/full reuse, exact Unicode charges, idempotent cross-tab creation, lost
acknowledgements, repeated interrupted recovery, cancellation, stale source,
settlement/ownership/environment mismatch, absent receipts, missing/corrupt audio,
source deletion during confirmation, and safe response/log handling. The built
browser proof uses native MP3/MSE plus the real MP4 encoder, preserves source and
position, verifies the complete MP4, and repeats after reload without a new job.
Manual review also checked cleanup ownership, digest/metadata races, expiry,
bounded I/O, persisted-data privacy and unchanged production configuration/schema.

If a staging regression appears after a recovered session is created, pause new
paid admissions and fix forward while retaining the recovery read endpoints and
saved IDs. An old Worker or disabling the feature can prevent restored composition
from resolving; do not restore old ledgers, reopen settled reservations, or replay
credits. There are no migrations to undo. Normal cleanup/expiry remains in force.
