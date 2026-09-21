# Private sandbox payment recovery

A service-owned task checks Paddle at startup and every 60 seconds after a scan.
No browser callback, open tab, or incoming public webhook is required. Each scan
checks up to 50 recorded transactions, oldest checked first. With larger volumes
or slow API calls a complete round takes longer. Restarting the workstation catches
up from the durable ledger. This worker only reads Paddle; it never issues refunds.

For a completed transaction it verifies the server-created order, exact pack, price,
currency and quantity, then reads every page of adjustments before changing credit.
The grant and any existing refund are applied in one SQLite transaction. Repeated
checks and simultaneous browser refreshes cannot grant or revoke allowance twice.
Canceled checkouts release the pending-order slot for a new purchase.

Approved refunds, credits and chargebacks remove characters proportional to their
pretax subtotal divided by the original pretax subtotal. Tax-only adjustments remove
no speech allowance. Amounts are summed before rounding up to a whole character,
and removal is capped at one pack. Pending or rejected refunds do not remove credit.
A reversed original adjustment no longer removes credit; reversal notification rows
are not counted again. Chargeback warnings are informational, not approved refunds.

An already-spent allowance becomes a character shortfall, not a money charge. New
packs and unused reservation releases first cover that shortfall. A running reading
checks before each next section and stops if the account has a shortfall. A section
already being synthesized may finish and is still counted. Restart recovery releases
unused reservations through the same accounting path, so refunded allowance cannot
be resurrected. Existing downloaded audio is not removed.

Failed API checks preserve existing balances, show a delay notice, and retry. Refund
updates are therefore eventual: an offline workstation or Paddle outage delays
recognition. A purchase is never newly credited when its adjustments could not be
read completely. No raw Paddle responses, credentials or customer details enter logs.

The private pilot still permits Roger's explicitly selected non-allowance mode;
this is not the public paid-service enforcement boundary. Public rollout still needs
public hosting, signed Paddle webhooks plus reconciliation, refund policy/support,
and per-account usage views. No webhook endpoint or public deployment is added here.
An ambiguous transaction-creation timeout before its ID is saved still needs operator
recovery; this scan only recovers transactions already bound to a local order.

## Validation

Tests cover closed-browser recovery, restart, repeat/concurrent processing, partial
and full refunds, already-refunded purchases, tax-inclusive pricing, pagination,
failed reads, canceled purchases, chargeback reversal, and generation reservations.
Read-only checks against the actual sandbox API also use an isolated ledger copy.
Those read-only checks do not create or refund a payment.

On 2026-09-21 a separate end-to-end sandbox test refunded the full $10.75 on
transaction `txn_01m32j4k6c1gehf69y39nxkzgf`, adjustment
`adj_01m32m3tkbqrmdv6k0psdqc2jt`. While pending approval, the allowance stayed at
6,000,000. After Paddle approved, the background service removed 3,000,000
without manual reconciliation. The signed-in reader then displayed 3,000,000.
The next background check preserved that balance, confirming no duplicate
deduction. No real money moved.

### Real allowance generation check (2026-09-21)

A private Chrome test used DeepInfra Heart with sandbox allowance enabled. Starting
at 3,000,000 characters, a three-section reading charged exactly 159 source
characters (173 provider-submitted characters after pronunciation processing).
Replay and playback speed changes did not change the balance. MP3/VTT download
requests also left it unchanged. Direct download verification found a valid
9.744-second MP3 and three matching, ordered VTT cues. Browser download-event
confirmation timed out, so this run does not independently confirm browser file
saving.

A 30-section cancellation test reserved 4,011 characters. Stop ended unfinished
preparation after four successful 133-character sections, including any in-flight
section. Exactly 532 characters remained charged; 3,479 were released, with no
reservation left behind. The ledger and refreshed billing page both showed
2,999,309 characters. Combined provider-reported cost was $0.00043710.

No code defect was found in these checks. Sandbox allowance remains enabled.
Roger's final Pixel balance/playback/highlighting confirmation is still pending;
any new generation after this baseline will spend additional characters.

### Pixel preparation slowdown (2026-09-21)

The next Pixel test exposed a performance failure despite correct allowance
accounting. After the first section, ten more section completions spanned about
147 seconds while generating about 33 seconds of audio. Stop may finish one
in-flight section, explaining eleven ledger entries after the reported ten.

Three synthetic diagnostic requests reproduced remote delays: 11.554 seconds
for 1.425 seconds of audio, 8.823 for 8.800, and 5.891 for 1.725. Local decode
took 0.000-0.005 seconds. Remote measurements include connection, provider wait,
and response transfer; they do not isolate provider queue time. Probe cost was
$0.00011098, paid from project credit outside the user's allowance ledger.

Added numeric-only request timing logs (outcome, character count, remote/decode
durations, audio duration), without text, credentials, or response bodies.
100 Python and 96 JavaScript tests passed. This is diagnostic instrumentation,
not a playback performance fix. Before recommending paid playback, benchmark
bounded parallel preparation with per-section accounting, cancellation, ordered
assembly, and unchanged highlighting. Do not merge sentence requests without
resolving accurate cue timing.

### Bounded parallel preparation (2026-09-21)

Hosted Kokoro now prepares at most three sections concurrently, with a bounded
three-section window. Each request retains independent provider counters; the
encoder consumes results strictly in source order. Existing pronunciation,
pauses, sentence starts, captions, and the shared audio clock are retained.
Workstation synthesis stays sequential. Expanded text is checked against the
whole-reading provider limit before starting paid requests.

Stop or failure prevents further scheduling. Started requests are settled before
unused reservations are released; up to three started sections may finish and
be charged after Stop. Successful out-of-order sections are charged even if an
earlier failure prevents playback of them, as generation has occurred. No paid
request is automatically retried.

Real matched six-section tests produced 13.8 seconds of audio: sequential
preparation took 57.113 seconds, parallel preparation 28.580 seconds. This is
about a twofold improvement, but still slower than playback under the observed
remote latency. Provider conditions can vary between runs; this is not a
guaranteed speedup. The change does not yet establish uninterrupted progressive
playback. Numeric timing logs remain available for diagnosis.

Validation covers out-of-order completion with exact cue boundaries, cancellation
with three requests in flight, failure with other successful requests, exact
credit settlement, and preflight expanded-text limits. 104 Python tests and 96
JavaScript tests passed (the final added preflight case was run with the focused
parallel suite). Reader build passed. Benchmark calls used project credit, not
the user's allowance. No public deployment. Pixel validation remains pending.

### Remote latency breakdown (2026-09-21)

Three direct curl requests used the same small synthetic sentence, Heart, WAV,
24 kHz, non-streaming, and default service tier as the reader. Each returned
2.0 seconds of audio with HTTP 200. No Tailscale exit node or HTTP proxy
environment was configured for the probe.

| Trial | DNS/TCP/TLS ready | Wait to first byte after setup | Response download | Provider runtime_ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 0.083 s | 4.648 s | 0.031 s | 56 |
| 2 | 0.085 s | 6.336 s | 0.030 s | 58 |
| 3 | 0.061 s | 3.353 s | 0.031 s | 56 |

The wait includes request upload and remote processing, not a directly measured
queue duration. Together with low setup/transfer times and provider-reported
runtime, this strongly suggests remote queueing or other service overhead, but
does not prove which internal stage is responsible. Public deployment alone
would not remove this measured delay; another backend location remains untested.
Total probe cost: $0.00005208 outside the account allowance. Credentials were
passed to curl over standard input, never command arguments or diagnostic output.
No application code or deployment changed for this measurement.
