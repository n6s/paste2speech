# Private staging MSE verification — 2026-09-23

Status: progressive playback is enabled in private staging. Cached desktop
checks and all four live generation/accounting checks passed. Roger reports
hosted Pixel playback continues normally when he waits for speech to start
before locking. Locking before first speech did not start playback; device-neutral
start guidance is displayed. Other mobile browsers remain unverified.

Implementation: `050ad88` plus integration follow-ups through `b8cb874`,
isolated branch `codex/mse-staging-reader`.
Final live-enabled deployment: `e74da0d2-a53b-45d7-851a-f781c0e6f5af`.
Intermediate live-enabled version: `17e7e17a-57e8-4587-8853-575469c3e24d`
(replaced with device-neutral guidance before any live run).
Cached-only deployment: `cd1681da-d721-42b4-bd9a-3920a59b8c5f`.
Prior recovery version: `2b4d94c7-90ef-4a15-8435-dc2a94be2c7e`.
See [operation and recovery](mse-staging.md) for backup details and commands.

## Automated evidence

- 183 Node regression tests pass: reader, authentication, durable preparation,
  cancellation, settlement, MSE ordering and campaign/lifetime budget behavior.
- Production trial and public builds exclude the MSE implementation and UI;
  no production deployment or configuration change was made.
- Actual Chrome 153 on Linux exercised the normal reader, both locally and on
  the deployed private staging origin. All four cached voice/concurrency
  combinations passed early playback, pause/resume, speed change, buffered
  seeking/highlighting, natural end, replay, byte-identical exports and explicit
  same-job full-file fallback. Full-file durations match the sample timeline.
- Hosted checks also passed out-of-order completion, starvation/recovery,
  preparation failure, cancellation during fetch and append, Stop during a
  delayed creation acknowledgement, continued buffering while paused, bounded
  read retry exhaustion followed by same-source/same-job Resume, unsupported
  MSE selection before creation, quota failure, and the 24 ms discrepancy guard.
- API checks passed duplicate creation/reuse, rejected changed concurrency,
  pending/missing/cancelled section responses, denied foreign-account and
  unauthenticated section access, and rejected cross-origin cancellation.
- Completed-file playback can seek beyond currently buffered bytes and read
  from a selected section without creating another job (additional local Chrome
  check).
- Selecting a later section waits for that buffered position before playing.
  Failed preparation never becomes a successful end-of-stream.
- The 64-section long hosted fixture completed naturally through one source.
  This is automated desktop evidence, not evidence of phone screen-lock behavior.

Measured hosted cached timing (milliseconds after starting; delays simulated):

| Voice / concurrency | First playing | End of stream prepared | Raw buffered end / sample duration |
| --- | ---: | ---: | ---: |
| US / 1 | 2,966 | 12,994 | 38.712 / 38.712 s |
| US / 3 | 2,411 | 5,982 | 38.712 / 38.712 s |
| UK / 1 | 2,471 | 10,852 | 38.952 / 38.952 s |
| UK / 3 | 2,429 | 5,681 | 38.952 / 38.952 s |
| US / 3, 64 sections | 9,608 | 189,567 | 309.696 / 309.696 s |

Each normal run appends indices 0–7 exactly once; the long run appends 0–63.
Successful progressive completion causes no new media source load. Full-file
fallback is explicitly requested and logged separately. Section boundaries
match cumulative frame counts before duration assignment; no trimming, padding,
or corrective offset is used. Injecting a 24 ms status discrepancy fails
explicitly. The earlier discrepancy was not reproduced in these fixtures;
this does not establish its historical cause or eliminate the guard.

One initial headless start check timed out before playing; that initial attempt
had no detailed diagnostic capture. The cached case was rerun successfully,
and failure capture was added to the harness. No paid request was involved.

Fixture content SHA-256:
`e129bb0ca42fccf326ce5c86525c5960146ec2891084e45539cd8c02c94e8c40`.
Private detailed event records are in `work/mse-staging/local-checks` and
`work/mse-staging/remote-checks`, without reading text or credentials.

The signed-in interactive Chrome run also passed: UK / three, first playing
2,640 ms, EOS 6,238 ms, 38.952 seconds, eight appends, one source load, no error.
Its diagnostics are preserved with the desktop records. New downloads include
the job ID to distinguish runs. At Roger's request, the Pixel JSON was skipped;
phone behavior is recorded as user-reported evidence, not an automated log.

## Accounting checkpoints

The verified pre-deployment backup restored successfully with no integrity or
foreign-key errors and zero open reservations. The additive campaign migration
created a 0/3,000 counter without changing the 24,100/100,000 lifetime counter.

Cached checks leave these values unchanged:

| Checkpoint | Value |
| --- | ---: |
| Lifetime admitted characters | 24,100 / 100,000 |
| Campaign admitted characters | 0 / 3,000 |
| Open reservations | 0 |
| Existing reservations / consumed characters | 10 / 21,827 |
| Existing usage rows / characters | 152 / 21,827 |
| Aggregate account balance | 485,406 |

No credit was granted, counters reset, or paid call retried.

## Hosted Pixel and live matrix

Roger reported all local Tailscale Pixel tests passed before this integration.
For hosted staging, Roger reported that locking before playback starts does
not start speech, but waiting for speech before locking works. This confirms
the requested continued-buffering case after playback starts, with an explicit
initial-start limitation. No claim is made that a lock before first audio works.
Separate hosted phone results for seeking/speed/highlighting and interruption
have not yet been reported; their automated desktop checks passed.

## Completed live matrix

The exact submitted count was verified before every Play action: eight sections,
521 Unicode code points per run. The four successful runs were not repeated.

| Voice / concurrency | Job | First playing / EOS prepared | Duration | Debit |
| --- | --- | ---: | ---: | ---: |
| US / 1 | `4efd2c8e-0473-4632-9956-cb0967bfc1dc` | 3,252 / 10,388 ms | 38.712 s | 521 |
| US / 3 | `f7f03eb1-3ec0-4a6a-add1-05ee88d03877` | 2,561 / 6,144 ms | 38.712 s | 521 |
| UK / 1 | `30f78666-2da0-409a-86e8-fde5953980a3` | 3,616 / 10,271 ms | 38.952 s | 521 |
| UK / 3 | `286f8b37-784c-496b-af67-4d3caf0a96ca` | 2,464 / 6,001 ms | 38.952 s | 521 |

For each run, verified eight provider attempts, eight ordered exactly-once
appends, one source load through natural completion, raw frame-count timing,
byte-identical section concatenation/MP3 export, and eight VTT cues. Explicit
completed-file playback of the same job matched the progressive duration and
preserved paused position. Every run had exactly one metered reservation,
closed with outcome ready, 521 consumed, zero remaining and zero released.
Eight usage rows totaled 521. No legacy/unmetered pilot account was used.

Read-only ledger checkpoints before/after replay, seeking, MP3/VTT reads and
same-job fallback were identical for each run. These operations created no
extra admission, provider attempt, reservation or debit.

Final accounting:

- Campaign: **2,084 / 3,000**, with **916 remaining**; active ceiling unchanged.
- Lifetime: **26,184 / 100,000**, up exactly 2,084 from 24,100.
- Existing metered account balance: **483,322**, down exactly 2,084 from 485,406.
- Four new closed reservations; **zero open reservations**.
- 32 new usage rows; total ledger now 184 rows / 23,911 characters.
- No credit grants, resets, budget increases, or uncertain paid-call retries.

[Machine-readable verification summary](verification/mse-staging-2026-09-23.json)
contains job metadata, export hashes, timing and final ledger checkpoints without
reading text or credentials. Private detailed diagnostic files remain under
`work/mse-staging`; the live jobs remain available to their owner until normal
expiry. Do not repeat this paid matrix automatically.

## Handoff and limits

Staging remains progressive by default where MP3 MSE is supported, with the
full-preparation option and the active campaign ceiling. Production and the
original Tailscale experiment were not deployed or modified. The experiment
service and HTTPS 8443 → loopback 8790 route were checked and remain active.

The hosted Pixel lock-screen report covers continuing playback after speech
begins. Initial playback while already locked failed. Hosted phone controls and
interruption results were not separately supplied, and iPhone/Safari and other
mobile devices have not been validated. Capability detection is not a promise
of background playback. These are explicit mobile acceptance limits, not a
claim of universal mobile support. No HLS or completed-source handoff was
introduced to conceal them. Production deployment and broader device acceptance
remain separate follow-up decisions.
