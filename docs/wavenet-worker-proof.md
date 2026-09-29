# Full-preparation Worker pilot — September 21, 2026

## Result

The local Cloudflare Workers runtime now performs the complete path:

**plain original sections → Google authorization and WaveNet MP3 calls → stored
sections → validated flat MP3 and VTT → complete-file playback and highlighting.**

No Python speech service or server-side audio encoder is used. The launch helper
uses Python only to supply an owner-only temporary credential file to local
Wrangler. No deployment, remote resource creation, subscription, or change to
`https://pop-os.tailbd091c.ts.net/speak/` occurred.

## Speech policy

WaveNet's defaults are the baseline: no custom pronunciation dictionary, number
or time expansion, SSML, inserted pause, silence trimming or synthesis-rate
override. Each original section is sent verbatim. Section boundaries still limit
Google's context; all returned padding/silence remains in the assembled MP3.
The default timing and final-byte behavior remain those tested in the prior proof.
Original text is retained for section highlighting and VTT.

## Measured live run

US WaveNet F, eight synthetic sections, 521 characters, three concurrent requests
per batch, 38.712 seconds of completed audio:

| Measurement | Result |
|---|---:|
| Worker preparation, including authorization and storage | 2.068 s |
| Browser observed completion | 2.154 s |
| First browser `playing` event | 2.183 s |
| First sampled audio-clock advance | 2.313 s |
| Browser decoded samples at 24 kHz | 929,088 |
| Complete-file native duration | 38.712 s |
| List-price estimate for this run | $0.002084 |

These are a single local-workerd run with real Google calls, not deployed
Cloudflare timings, acoustic latency, or long-reading performance. An earlier
authorization/request-compatibility failure stopped before any speech attempt.
After correcting the fetch adapter and verifying authorization separately, one
explicit zero-speech-attempt authorization retry completed the same durable job.
No failed paid speech section was resent. The successful browser result is saved
in local R2 through `/metrics`; selected numeric evidence is committed alongside
this report in `docs/wavenet-worker-proof-results.json`.

Browser checks passed for loading only the complete file, pause, original text,
speed changes, forward/backward/end seeking, boundary highlighting, VTT export,
MP3 availability, decoded duration, and completion at the final frame. Cached
fixture checks additionally compare every exported byte and decoded joins against
the individual original Google files. The new direct-Worker live run exercised
US English; the earlier two-voice MP3 proof also covered GB English.

## Persistence and failure behavior

Each job uses a local Durable Object with persistent state and an alarm. A batch's
attempt markers are saved before provider submission. Partial sections are stored
in local R2, but audio/download routes return 409 until the complete job is ready.
Completed audio supports byte ranges, including suffix requests, for seeking.

Local API checks passed for identical stored bytes, complete VTT, byte ranges,
rejection of anonymous/cross-owner reads and cross-owner deletion, arbitrary-input
rejection, and cancellation while a batch was running. A stopped/restarted Worker
retrieved the identical completed recording with the original eight attempts.

Unit tests exercise provider failures, an interrupted `submitting` marker, durable
write failure before paid submission, concurrency/order, cancellation, UTF-8
limits, original Google request text, bounded responses and verifiable OAuth JWT
signing. Full JavaScript suite: 112 passing tests.

## What remains

This is a bounded **local synthetic pilot**, not a hosted release. It rejects all
non-loopback origins and arbitrary reading input. The original public Worker and
running private service are untouched. Before a hosted private trial:

- Connect the real reader and signed-in owner/usage reservation model; keep existing
  balances and payment semantics intact.
- Add a deployment-specific secret-delivery and access plan; production account
  sign-in must replace the local test cookie boundary.
- Validate larger readings, failures and recovery under deployed limits; extend
  bounded storage/assembly for long recordings as needed.
- Listen and verify highlighting/export on Pixel/mpv for this actual path.
- Keep WaveNet defaults unless a concrete example demonstrates a need for an override.

Implementation/reproduction: `scripts/wavenet-worker-proof/README.md`.

References checked during implementation:
[Google service-account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account),
[Durable Object alarms and retry semantics](https://developers.cloudflare.com/durable-objects/api/alarms/),
[R2 range reads](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[Workers request behavior](https://developers.cloudflare.com/workers/runtime-apis/request/).
