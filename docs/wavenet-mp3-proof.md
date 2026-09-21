# Private WaveNet MP3 assembly proof — September 21, 2026

**Result:** Google-generated sections can be assembled without re-encoding for
the exact MP3 format observed in this experiment. The complete recording retains
original-section highlighting, seeking, speed control, and matching MP3/VTT
exports. Standard JavaScript assembly also passed in the local Workers runtime.
This proves the audio path, not a production hosted service.

Latest follow-up: `docs/wavenet-worker-proof.md` records the subsequent local
Worker → Google → durable storage → player test. After discussing default speech
behavior, that new path uses WaveNet defaults without our text/pause overrides;
the original proof's speech-rule-parity item below is historical, not a mandate
to port those overrides blindly.

**Decision:** Roger selected full preparation on September 21, 2026 for the first
private hosted integration, preserving highlighting. Keep progressive delivery experimental until the
stream-to-file transition and final timeline are validated on the target devices.
Do not trade away highlighting or silently accept the raw-stream discrepancy.

### Follow-up implementation

The worktree's Google reader settings now select `delivery: 'complete'`. The
shared player polls preparation progress but does not attach an audio source until
the job is ready; it then opens the completed, range-capable recording directly.
Pause and section selection survive preparation; Stop cancels, and failed jobs
expose neither partial playback nor exports. The proof defaults to this path and
returns a job immediately, so full preparation does not require holding the
creation request open. Cached checks need no new Google calls.

Follow-up validation: all 103 JavaScript tests and the browser build passed.
The cached full-preparation browser run confirmed that the first audio load
occurred only after completion, then passed seeking, highlighting, speed,
byte-preserving MP3 export, VTT and exact complete-file duration checks.
Evidence is in `docs/wavenet-full-preparation-results.json`; its timings are
cached replay measurements, not another live synthesis benchmark.

These are private source changes, not a deployment. The existing Python Google
backend still uses LINEAR16 and continuous encoding; replacing it with the
Worker-native MP3 preparation pipeline remains a separate integration step.
The measurements below describe the initial proof, before this follow-up.

## Measurements

Eight fixed synthetic sections, 521 characters per voice; three concurrent
requests. US and GB WaveNet F were each generated initially, then US was generated
once more per live playback mode. Total: 32 requests, 2,084 submitted characters,
**$0.008336 list-price estimate** before any free allowance. No automatic retries.

| Live US run | First `playing` event | First observed clock advance | All audio prepared |
|---|---:|---:|---:|
| Progressive | 1.180 s | 1.444 s | 2.777 s |
| Full preparation | 2.671 s | 2.931 s | 2.656 s |

Measured in the Codex in-app Chromium 153 browser on the workstation. Timings
include the local Python process, authentication, real Google synthesis, network
wait, and browser delivery. They are single runs, not latency percentiles or
Cloudflare deployment measurements. `playing` is a browser event, not acoustic
output instrumentation; `timeupdate` is a coarsely sampled clock observation.

| Initial voice sample | Frames | Bytes | Decoded duration |
|---|---:|---:|---:|
| en-US-Wavenet-F | 1,613 | 309,696 | 38.712 s |
| en-GB-Wavenet-F | 1,623 | 311,616 | 38.952 s |

## Why this is more than naive concatenation

Every frame was inspected: MPEG-2 Layer III, mono, 24 kHz, **64 kbps**, 192 bytes,
576 samples, frame-padding bit zero, no CRC. No ID3, Xing/Info, VBRI, or declared
encoder-delay/end-padding metadata was present. The first frame in every section
has `main_data_begin=0`, so it does not refer to a prior section's reservoir.
Unsupported or changing format, missing reservoir bytes, metadata, and truncated
frames are rejected. This narrow acceptance policy is intentional.

All frames—including silence/encoder priming—are retained. There is no claim of
gapless trimming: absent encoder delay metadata, exact padding cannot be separated
from provider-generated silence without decoding or another provider contract.
Frame sums define the section timeline; sample counts stay integers until divided
by 24,000. Caption and highlight starts use that same clock and original text.

The flat exports are byte-for-byte joins of the source sections. Independently
decoding those sections and decoding the assembled file gave identical sample
counts. Maximum sample differences were approximately 0.00000137 US and
0.00000334 GB, verified with both ffmpeg and browser Web Audio decoding. This is
objective continuity evidence, not a substitute for listening.

Quiet regions around joins measured approximately 243–797 ms at an absolute
amplitude threshold of 0.001. The next section's above-threshold onset was
approximately 75–119 ms after its frame boundary. These are quiet-region proxies,
not an exact encoder-delay measurement. Roger listened to the initial live US
stream and reported **“sounded fine to my ear.”** The device was not specified.

## Browser finding and private fix

The first progressive run played through, but reported 38.688 s at its natural
end versus 38.712 s in the file. Its first seek test also timed out: buffered
stream bytes were not sufficient for reliable completed-file seeking.

The proof now reopens the identical complete bytes, with Content-Length and
Range support, on the first completed-file seek. This is a private subclass of
the existing player; that initial proof changed neither the running service nor
the application player. The full-delivery follow-up is described above.
After this adjustment, cached progressive replays passed for both voices:

- Pause holds the clock; changing to 1.5× does not regenerate audio.
- Beginning, middle, end, and backward seeks select the original text section.
- Highlighting crosses section boundaries using the audio clock.
- MP3 export retains every original byte; VTT includes all eight sections.
- Browser decoded sample count, complete-file native duration, and timeline agree.
- Playback reaches the completed file's true final frame.

The live full-preparation run passed these timeline/playback checks directly.
Later progressive passes replayed cached bytes/readiness times; they are not
additional paid live latency measurements. They also **do not establish a fix
for the raw stream's 24 ms final-duration discrepancy**, because those tests
switched to the completed file before reaching its end. No accumulated
section-clock drift was found in complete-file decoding.

## Workers suitability and remaining boundaries

`assemble.mjs` has no Node, Python, subprocess, or encoder dependencies. In local
`workerd`, both voice files streamed back byte-identically with the correct
timeline; malformed input was rejected. Observed local HTTP round trips were
about 40 ms US / 13 ms GB; these are not isolate CPU or deployed latency numbers.
The worker harness bounds total test input to 4 MiB. Production would stream
stored sections and bound concurrent preparation, rather than buffering an
entire long reading. Google's call/authentication still ran locally in Python.

Still required before adoption:

- Preserve the existing speech normalization, pronunciation and custom pause
  planning. This probe sends synthetic sections directly to Google; it does not
  prove parity for quote/colon/divider pauses or arbitrary private readings.
- Target-device checks for Pixel, downloaded MP3/VTT in mpv, and longer readings.
  Previous checks of the LINEAR16/re-encoding path do not validate this new path.
- Worker-side Google authorization, persistence, job recovery, accounting,
  signed-in ownership, cancellation, and payment integration remain future work.
- Resolve or explicitly discuss any timing/quality compromise before switching
  the product. Full preparation avoids the observed stream duration problem.

There was no deployment, subscription, server rental, purchase, private-reading
regeneration, credential exposure, private service restart, or Tailscale change.
The unrelated hosted-mode edits in the original checkout were left alone.

## Evidence and reproduction

- Committed numeric evidence: `docs/wavenet-mp3-proof-results.json`, including the
  initial failed progressive seek check and later passing checks.
- Scripts and exact reproduction steps: `scripts/wavenet-mp3-proof/README.md`.
- Ignored local audio and detailed timings: `work/wavenet-mp3-proof/`.
- 14 targeted automated tests passed (assembler validation and existing player).
- Private listening/export page: `http://127.0.0.1:8786/` while the harness runs.

Reference documentation checked during this experiment:

- [Google AudioEncoding](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/AudioEncoding)
  describes MP3 as 32 kbps; the actual samples measured here were 64 kbps. Do not
  infer byte rates or frame timing from that description.
- [W3C MPEG audio byte-stream format](https://www.w3.org/TR/mse-byte-stream-format-mpeg-audio/)
  describes audio frames and metadata in MPEG streams.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
  recommends streaming bodies to avoid buffering within isolate memory limits.
