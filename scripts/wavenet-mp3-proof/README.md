# Private WaveNet MP3 assembly proof

Isolated experiment; not imported by the application or deployed. All input is
the eight synthetic sections in `generate.py`. Outputs and browser measurements
live in ignored `work/wavenet-mp3-proof/`. No private reading is submitted.

## Reproduce offline

From the repository root, with the previously generated artifacts present:

```sh
node scripts/wavenet-mp3-proof/build.mjs
python scripts/wavenet-mp3-proof/analyze.py
node --test tests/wavenet-mp3-proof.test.js tests/progressive-player.test.js
node scripts/wavenet-mp3-proof/serve.mjs
```

`analyze.py` needs NumPy and ffmpeg. ffmpeg only **decodes for measurement**;
it never encodes an exported MP3. Open `http://127.0.0.1:8786`, select a cached
mode, click Start proof, then Run playback checks. The browser saves its own
measurements in `work/wavenet-mp3-proof/browser-*.json`. Cached startup numbers
replay recorded provider readiness; they are not new live synthesis measurements.

The harness defaults to the real `public/progressive-player.js` complete-delivery
path: poll progress, then open only the finished file. Progressive comparisons
use one private adapter to reopen the completed, range-capable file on the first
completed-file seek. Completed MP3/VTT exports are available in
the page; the standalone initial exports are `<voice>.mp3` and `<voice>.vtt`.

## Deliberate paid synthetic runs

Only when authorized, use a Python environment with `google-auth` and `requests`:

```sh
python scripts/wavenet-mp3-proof/generate.py --generate
```

This submits 1,042 characters total across US and GB WaveNet F (16 requests).
An attempt marker is written before any request and prevents automatic retry.
The service-account key is read from the existing owner-managed configuration;
it never enters browser code, HTTP responses, artifacts, or repository files.
`--voice en-US-Wavenet-F` limits a run to 521 characters / eight requests.

For the two bounded end-to-end startup measurements:

```sh
P2S_PROBE_PYTHON=/path/to/python node scripts/wavenet-mp3-proof/serve.mjs --live
```

The explicitly labeled live controls each allow one run per mode, persist attempt
markers, and use fixed synthetic text. No automatic retries. The server defaults
to paid generation disabled. It binds only to loopback and validates Host and
Origin; it is a developer harness, not a production authentication boundary.

## Local Workers runtime

```sh
wrangler dev --local --ip 127.0.0.1 --port 8787 --config scripts/wavenet-mp3-proof/wrangler.jsonc
node scripts/wavenet-mp3-proof/check-worker.mjs
```

There are no Cloudflare bindings, production routes, credentials, purchases, or
deploy steps. `worker.mjs` accepts a bounded binary POST with JSON section byte
lengths in `X-Section-Lengths`, validates each section, then streams identical
bytes with timeline headers. The assembler itself uses only standard JavaScript.
The local worker harness buffers a small bounded request for testing; production
would require bounded concurrency, persistent section storage and streamed reads.

See `docs/wavenet-mp3-proof.md` for measured findings and limits.
