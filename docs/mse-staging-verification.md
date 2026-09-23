# Private staging MSE verification — 2026-09-23

Status: cached desktop verification passed; hosted Pixel verification pending.
Live synthesis remains disabled pending that result. No new live speech has
been generated during this staging round yet.

Implementation: `050ad88`, isolated branch `codex/mse-staging-reader`.
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
Its original download was `/home/roger/Downloads/staging-playback-results.json`;
it identifies Linux Chrome, not Pixel. A copy is preserved in the remote results.
New diagnostic downloads include the job ID to avoid filename confusion.

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
That is separate from the hosted staging trial, which is still pending.

The approved live matrix is calculated in advance: eight sections, 521 Unicode
code points per run, US/UK × one/three requests = 2,084 characters. Run only
after hosted cached checks pass; use the existing funded metered account.
Record each job, eight expected attempts, one closed 521-character reservation,
matching eight usage rows, admission and balance changes, media timings and
unchanged accounting after replay/download/fallback. Stop if any paid result is
uncertain. Do not repeat successful runs or expand the 3,000-character ceiling.
