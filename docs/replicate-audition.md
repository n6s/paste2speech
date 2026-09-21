# Replicate Kokoro private audition — 2026-09-21

Model: `jaaari/kokoro-82m`, version
`f559560eb822dc509045f3921a1921234918b91739db4bf3daab2169b71c7a13`.
Authenticated model metadata lists Emma but not Heart. No reader provider or
public deployment changed. Synthetic text only; project credit, no allowance debit.

| Emma sample | Playable after | Audio duration |
| --- | ---: | ---: |
| short-1 | 1.238s | 2.575s |
| short-2 | 3.609s | 2.575s |
| paragraph | 0.936s | 8.650s |
| pronunciation-original | 0.786s | 6.125s |
| pronunciation-corrected | 0.728s | 4.500s |

These are individual sequential requests, not a sustained playback benchmark.
Ready-to-play includes prediction submission/wait/polling and audio download.
Samples are in ignored `work/replicate-audition/`. Pronunciation-corrected input
uses shared numeric/time expansion and voice-specific dictionary markup. The
provider accepted it; listening confirmation is pending. This standalone probe
does not implement the reader's explicit phrase-gap assembly.

Initial HTTP 402 resolved after funding propagated. The next request received
HTTP 429 stating accounts with less than $5 credit are limited to six prediction
creations per minute, burst one. Remaining requests were spaced by 11 seconds.
The audition therefore does not establish suitability at normal reader request
frequency. No failed paid prediction was automatically resubmitted.

Five Emma samples total 24.425 seconds of audio and 1.310 seconds of reported
prediction time. At the listed T4 rate of $0.000225/second, estimated compute cost
is $0.000295; extrapolated to ten hours of audio, about $0.43. This is an estimate
from a tiny sample, not a billing reconciliation or book-length measurement.
Source: https://replicate.com/pricing and https://replicate.com/jaaari/kokoro-82m.

Generic urllib user-agent requests were rejected by the edge with HTTP 403/1010.
A descriptive `paste2speech-audition/1.0` user-agent succeeded. Credentials were
read from the owner-only token file and not printed or committed.

## Heart alternative

Authenticated metadata for `alphanumericuser/kokoro-82m` does list `af_heart`.
One corrected-text request generated 4.65 seconds of audio, but provider metrics
reported 123.300 seconds total and 21.369 seconds prediction time. It was still
processing at our 120.906-second observation deadline. The subsequent cancel
request returned succeeded, so the completed output was retrieved without
resubmitting. Startup/queue overhead is consistent with the timestamps, but a
cold start specifically is not established. This first-request result fails the
immediate-fallback requirement. Billing for this model was not verified.

Emma original/corrected and Heart corrected WAV files are available under
`work/replicate-audition/` for Roger's listening check. No claim of audible
pronunciation equivalence is made from successful API responses alone.
