# Local full-preparation Worker pilot

This is an isolated Cloudflare Worker with a Durable Object per reading and a
local R2 binding. It is **not imported by the public Worker, deployed, or attached
to the running Tailscale reader**. It accepts only the fixed synthetic passage in
`fixture.json`; arbitrary input and non-loopback hosts fail closed.

The reusable implementation is in `cloudflare/prepared/`:

- `google.js`: Web Crypto service-account authorization and plain-text WaveNet
  MP3 calls. No pronunciation replacement, SSML, custom pauses, or speaking-rate
  override. Endpoints are fixed; redirects are not followed.
- `mp3.js`: the previously tested frame validation, original-byte assembly timing,
  and VTT formatting. The original probe now re-exports this module.
- `job.js`: bounded three-request batches, durable attempt markers, per-section
  storage and complete-file publication. No audio decoding or re-encoding.

## Offline/local replay

From the repository root, with the earlier synthetic probe files present:

```sh
node scripts/wavenet-worker-proof/build.mjs
python3 scripts/wavenet-worker-proof/run-local.py
```

Open `http://127.0.0.1:8788/`. Start proof → Run playback checks. The page uses the
shared player with complete delivery. Cached mode reuses Google bytes with recorded
per-request delays through the new three-request batch scheduler; it is not a
fresh Google latency measurement.

The launcher uses the already-installed Wrangler in the original checkout by
default; `--wrangler /path/to/wrangler` overrides that location. It runs `dev
--local` with local SQLite/R2 persistence in `work/wavenet-worker-proof/state`.
No remote bucket or Durable Object is provisioned.

```sh
node --test tests/prepared-reading.test.js tests/wavenet-mp3-proof.test.js
node scripts/wavenet-worker-proof/check.mjs
# After stopping and restarting the local Worker with the same state directory:
node scripts/wavenet-worker-proof/check.mjs --resume
```

The API check saves an owner-only session file in ignored `work/` solely to verify
that the same owner can retrieve the identical recording after a restart. It
prints only numeric status and check results, never the session cookie. Browser
checks save their report through `/metrics` into that browser owner's local R2
record. The latest report is visible in the page.

## Explicitly enabled live synthetic test

Only when a small paid synthetic test is authorized:

```sh
python3 scripts/wavenet-worker-proof/run-local.py --live
```

The launcher securely reads the existing Google service-account file and writes
an ignored, mode-0600 `.dev.vars` next to this pilot's config. It suppresses
Wrangler/debug output while the credential is loaded and removes its temporary
file on normal exit or interruption. It refuses to overwrite any existing file.
The Python process only launches the local runtime; **all authorization, speech
requests, assembly, persistence and downloads run inside the Worker**.

The live control uses a fixed durable ID per voice. Reopening that job returns
the existing attempt, not a new paid reading. An explicit create can retry a
failed authorization once only when the persisted counter proves zero speech
attempts. Any uncertain or failed speech request stops the job without automatic
retry. Cancellation and expiration retain a minimal attempt tombstone so the
fixed paid ID cannot be reused. Do not delete the persistent state to evade this
guard. Each voice's passage is 521 characters, eight requests; at most two voices
can be submitted in the retained pilot state.

`/auth-check` is a local, owner-session POST diagnostic available only in live
mode. It reports success/failure stage, never the token, and makes zero speech
requests. Do not expose this pilot as a hosted authentication system.

## Boundaries

The page establishes a random HttpOnly, SameSite=Strict test-session cookie.
Every job read, audio read and deletion checks the owner; mutation requests also
check Origin. These are local pilot protections, not production account sign-in.
The production account ledger, reservations, refunds, and payment webhooks are
not connected. List-price estimates are attempt counters, not provider invoices.

The generic job limits are 32 sections / 20,000 JS text units, 5,000 UTF-8 bytes
per section and 4 MiB completed audio. Public ingress further restricts this to
the eight fixed synthetic sections. The assembly buffer is bounded, not designed
for book-length recordings. Generation runs in a Durable Object alarm; interrupted
in-flight markers deliberately fail closed because alarms can run more than once.
Completed files survive process restart; status polling does not drive synthesis.
An expiration alarm removes recording content after 24 hours. Local metadata and
diagnostic reports have no general production retention policy yet.

The exact tested MP3 format remains a strict acceptance condition; format changes
fail visibly. Defaults are the baseline for this WaveNet path. Add provider-specific
text or pause overrides only after a demonstrated need and Roger's agreement.
