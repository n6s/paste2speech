# OCR source failure diagnostics

The source-access policy is unchanged: at most three full-byte reservations, two
active downloads, existing grant/deadline limits, and immediate terminal-state
revocation. No new provider retries or paid admissions are introduced.

New attempts expose a bounded `sourceResponse.events` sequence through the
existing owner-authorized job status and allowlisted scan-feedback report. Events
contain only a sequence number, timestamp, fixed kind and fixed denial reason.
The first 20 events persist; `eventsDropped` counts later events. Invalid bearer
capabilities cannot write diagnostics. There are no request URLs, bearer tokens,
headers, document contents or provider error bodies in these events.

`admitted` and `denied` are recorded in the same durable transaction as the
admission decision. Denials distinguish source state, closed access, legacy
single-use, total reads, active reads, byte budget, grant/source expiry and
unauthorized dispatch. A denied request consumes no new reservation. Diagnostic
write failure still fails closed. Existing per-read records describe subsequent
object lookup and streaming outcomes; `accessClosedAt` and close/revoke events
identify terminal cleanup. Sequence order disambiguates equal millisecond times.
Protocol/malformed/wrong-token requests rejected before authenticated admission
are deliberately not attributed to a job.

Job status also records provider request start/response timestamps and
`dispatchBuild`: the release commit from the Worker's bound static assets when
that attempt dispatches, best effort (null for historical/unavailable evidence).
The existing job UUID and sanitized provider request ID correlate these records.
No new endpoint, credential, external logging or data-retention period is added.

## Synthetic evidence

`tests/ocr-bounded-source.test.js` distinguishes:

- Two delayed object lookups plus a third overlapping request: the third is
  denied as `active_read_limit`; a mocked provider rejection then revokes both
  pending lookups without delivering bytes.
- The same two delayed lookups and provider rejection without a third request:
  both still end revoked with zero bytes, but there is no admission denial.

Thus revoked/404 zero-byte reads alone do not establish why a provider rejected
its source. Historical report bd56ef22-e201-4a44-ab1d-a6a91d5c3b54 lacks the new
reason/order fields; neither hypothesis is proven for that attempt. No private
source image is included in tests. All provider calls in tests are mocks.

`tests/ocr-job.test.js` covers interrupted upload (no admission/hold/provider), and
accepted work completing after client departure/server instance replacement.
`tests/ocr-job-native.mjs` verifies the event reasons in local workerd with real
R2/D1/DO emulation and a synthetic provider. Feedback tests verify field filtering.
These tests do not measure Pixel-versus-desktop failure rates or reproduce a
physical Android background interruption. A processing-stage report with accepted
upload and later provider HTTP response differs from a pre-accept upload failure.

Future diagnosis should first compare phase, job/build, request/response times,
admission reasons and per-read delivery, without inferring math recognition errors
from a source-download failure or raising access limits speculatively.
