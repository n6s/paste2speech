# Private MSE reader experiment

This isolated experiment runs the actual Worker, Durable Objects, and R2 locally.
It appends cached WaveNet MP3 sections to one MediaSource/SourceBuffer. Playback
never switches to the completed MP3. Only the separate download uses that file.

Phone URL: **https://pop-os.tailbd091c.ts.net:8443/** (Tailscale required).
The existing `/speak/` reader and all hosted readers are unchanged.

## Boundaries and implementation

- Fixed synthetic US/UK fixtures only; arbitrary text, live mode, and extra input
  fields are rejected. No credentials, provider calls, billing, remote bindings,
  or deploy command are part of this configuration.
- A separate cookie identifies each test session. Each job and section enforces
  ownership. The loopback and exact Tailscale origins are allowlisted, including
  the HTTP spelling used by Wrangler behind Tailscale's TLS proxy. Mutating
  requests require a matching Origin; cookies on Tailscale are Secure/HttpOnly.
- The shared preparation function retains its existing defaults. Only this
  cached experiment opts into one/three concurrency and immediate per-section
  publication. State writes take serialized snapshots; storage precedes ready
  metadata. A slow section holds back the published consecutive prefix, never
  changes its order. The scheduler still uses bounded batches, not a rolling pool.
- `POST /api/readings` accepts only `{voice, concurrency, scenario}`. Status adds
  consecutive-ready `sections: [{index,samples,bytes,start}]`. The authenticated
  `GET /api/readings/:id/sections/:index` returns MP3 bytes, 409 while pending,
  404 when absent/not owned, 410 after cancellation/expiry, or 422 after failure.
  Existing completed audio, Range reads, MP3 and VTT downloads are reused.
- Durable alarms drive preparation independently of listeners. Stop cancels a
  job; a lost listener does not. An interrupted local runtime fails uncertain
  work on recovery rather than automatically repeating it. Do not edit Worker
  source or restart Wrangler during an acceptance run.
- The browser verifies MP3 MSE capability, SourceBuffer creation, each section's
  sample/byte counts, and actual media decoding. Sequence-mode appends wait for
  `updateend`. Only after every section arrives and the job is complete does it
  verify the buffered end is within one sample of the frame count, set that
  duration, and signal `endOfStream()`. A discrepancy fails explicitly, without
  clipping the buffer or concealing the difference.
- There is no trimming, timestamp correction, source handoff, or silent fallback.
  Native full-preparation playback is a separate explicit comparison. Buffered
  audio is retained, with explicit quota errors. Reads retry at 0.5/1/2 seconds;
  after exhaustion Resume retries missing reads using the same media source.
- Local artifacts/state live under ignored `work/mse-reader-proof/`. Jobs use the
  existing 24-hour expiry behavior, only in this isolated local storage.

## Run and stop

Working directory for all commands:

```sh
cd /home/roger/.codex/worktrees/mse-reader-proof/paste2speech
```

Dependencies were reused from the source checkout for this session. On a fresh
checkout, run `npm ci`. Build the test assets:

```sh
node scripts/mse-reader-proof/build.mjs
```

For a foreground local run:

```sh
node node_modules/wrangler/bin/wrangler.js dev --local --ip 127.0.0.1 --port 8790 --config scripts/mse-reader-proof/wrangler.jsonc --persist-to work/mse-reader-proof/state
```

The current background run is a transient user service (survives terminal close,
not a reboot). Inspect or stop it with:

```sh
systemctl --user status codex-mse-reader-proof
journalctl --user -u codex-mse-reader-proof -n 30
systemctl --user stop codex-mse-reader-proof
```

To start it again after stopping, from the working directory above:

```sh
systemd-run --user --unit=codex-mse-reader-proof --description='Private cached-audio MSE Worker test' --working-directory="$PWD" --setenv="PATH=$PATH" "$(command -v node)" node_modules/wrangler/bin/wrangler.js dev --local --ip 127.0.0.1 --port 8790 --config scripts/mse-reader-proof/wrangler.jsonc --persist-to work/mse-reader-proof/state
```

Check port availability and existing Tailscale routes before creating a new
listener. The session verified ports 8790/8443 were free, saved the previous
Tailscale configuration under `work/mse-reader-proof/tailscale-before.json`, and
verified its existing entries were unchanged after adding this endpoint.

```sh
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8790
```

To remove **only this experiment's endpoint**, without resetting other routes:

```sh
sudo tailscale serve --https=8443 off
```

## Automated checks

Start the Worker first, then run:

```sh
node --test tests/*.test.js
node scripts/mse-reader-proof/check.mjs
node scripts/mse-reader-proof/check-lifecycle.mjs
MSE_PROOF_ORIGIN=https://pop-os.tailbd091c.ts.net:8443 node scripts/mse-reader-proof/check.mjs
node scripts/mse-reader-proof/check-long.mjs
```

Checks use `/usr/bin/google-chrome` and installed Playwright. Browser results and
screenshots are saved under `work/mse-reader-proof/results/`; runtime fixtures do
not require any historical ignored proof artifacts.

### Observed on September 23, 2026

- All **179 Node tests passed**.
- Real desktop Chrome **154.0.8037.57** passed the normal/one-versus-three tests
  over both loopback and Tailscale HTTPS: early playback, pause/speed controls,
  natural ending, replay, forward/backward seeks, highlighting, one unchanged
  source, byte-identical MP3 exports, VTT cues, Range responses, and ownership.
- Out-of-order readiness, deliberate starvation/recovery, preparation failure,
  interrupted reads, cancellation during fetch, and blocked live requests passed.
- A 64-section Tailscale run appended **309.696 seconds** while paused, kept
  one source, matched the unadjusted frame-count timeline, and played its ending.
- Separate lifecycle checks passed unsupported-MSE comparison, explicit quota
  failure, cancellation during append, preparation while paused, and bounded
  read retries followed by manual Resume without duplicate appends. A deliberate
  24 ms timeline mismatch is rejected rather than silently corrected.

The final Tailscale runs measured the following. Startup times are **simulated
cached runs**, with several browser tests sharing the local machine; they are
not provider latency measurements.

| Voice | Requests in flight | First playing | Finalized | Raw buffered end | Natural end |
|---|---:|---:|---:|---:|---:|
| US | 3 | 1.960 s | 4.540 s | 38.712 s | 38.712 s |
| US | 1 | 2.043 s | 8.953 s | 38.712 s | 38.712 s |
| UK | 3 | 1.812 s | 3.927 s | 38.952 s | 38.952 s |
| UK | 1 | 1.890 s | 8.195 s | 38.952 s | 38.952 s |

Raw buffered ends were captured **before assigning a finite MediaSource duration**.
Every appended boundary matched cumulative frame sample counts. Natural playback
then reached the same final time without seeking to the end. Thus these MSE runs
do not reproduce the previous raw-stream 24 ms discrepancy; this is evidence for
these fixtures and this desktop browser, not a universal browser/audio guarantee.

## Phone acceptance — passed on Pixel

On September 23, 2026, Roger reported **"all tests passed on Pixel"** after
receiving the test link and checklist below. This is user-reported acceptance of
the phone checks, including screen-lock playback, controls/highlighting, and the
one/three-request and connection-interruption comparisons. No Pixel model,
browser version, or exported phone diagnostics were supplied; the numerical
timing evidence above remains desktop evidence.

The local experiment is accepted on the tested Pixel. The remaining step before
any hosted-reader change is private Cloudflare staging verification. This report
does not authorize a deployment, paid synthesis, or production activation.

Phone checklist used:

1. Open the phone URL with Tailscale connected. Start Normal with three requests.
   Listen for gaps, repetitions, or missing words through completion.
2. Pause, seek within buffered audio, and change speed. Check highlighting.
3. Choose **Long**, start, and lock the phone before preparation completes.
   Listen for several minutes so continued playback requires new sections.
4. Compare one request, then briefly interrupt the connection. Resume if the
   bounded reconnect attempts run out. Save test results after a problem.

Long repeats the eight sections eight times (~5 minutes of speech). Each simulated
request takes 8 seconds: three-at-a-time prepares ahead, while one-at-a-time is
intentionally slower than speech and will buffer. No acoustic gaplessness or
phone screen-lock success is claimed from automated desktop tests.

Use **Save test results** to download browser capability, section progress,
appends, buffered ranges, media events, final durations, and errors. Report the
phone/browser and whether the screen was locked alongside listening feedback.
Private Cloudflare staging verification follows review of those results; it is
not included in this local implementation.
