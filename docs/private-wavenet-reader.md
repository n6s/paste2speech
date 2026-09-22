# Private Cloudflare WaveNet reader

The private implementation lives in `cloudflare/reader`. It runs the reader,
email identity, accounts, WaveNet preparation, stored audio, and sandbox payment
reconciliation in Workers, Durable Objects, D1, and R2. No Python speech server,
encoder, ffmpeg process, or workstation tunnel is part of its runtime.

This is implemented and locally verified, **not deployed or live-verified**.
The running checkout, its site, credentials, customer data and balances were not
modified. The isolated branch is `codex/wavenet-mp3-proof`.

## Preserved behavior

- Playback waits for the whole recording. Seeking, section highlighting, MP3 and
  VTT exports use the same sample-derived clock. Playback speed reuses audio.
- Google receives plain source text: no SSML, dictionary substitutions, spelling
  rewrites, inserted silence, or synthesis-rate override. The assembler retains
  validated MPEG-2 24 kHz mono 64 kbps frames without re-encoding or trimming.
- US and British WaveNet F voices are available. Input is bounded to 20,000 UTF-16
  units, 32 sections, and 5,000 UTF-8 bytes per section. Prepared files are bounded
  to 32 MiB and expire after 24 hours. Unsupported MP3 formats fail closed.
- Email links are single-use, browser-bound, and valid for 15 minutes. Sessions
  last 30 days. A stable account page lets customers request fresh links; account
  credit does not expire with a link. Conflicting account balances or pending
  orders are never silently merged. Signing out revokes that session only.
- Existing $10/one-million-character sandbox packs and historical three-million
  packs retain their original amounts and exact product/price verification.
  Client checkout success never grants credit. Server verification does.
- Successful sections consume reserved allowance once. Failed/uncertain sections
  return allowance. Approved principal refunds/chargebacks reduce entitlement;
  reversals restore it. Credit already used becomes debt. Returned reservations
  and later purchases first pay that debt down.
- The existing optional allowance switch remains: an unmetered private reading
  does not debit account credit, but still consumes the independent speech budget.
- Background alarms reconcile payments with all browser windows closed. A single
  coordinator serializes provider snapshots and checkout creation. A lost create
  response is not retried blindly: it requires verification before another order.

## Private and spending boundaries

The local config listens on `127.0.0.1:8790` only. It uses the previously cached
synthetic samples, simulated mail to `example.invalid`, and no checkout. It never
loads credentials and rejects arbitrary text for local synthesis.

The staging template has no route, no workers.dev URL, no preview URLs, an invalid
unconfigured database ID, and speech/email/payment flags off. Hosted requests
must match the configured HTTPS origin and pass cryptographic Cloudflare Access
JWT verification (issuer, audience, algorithm, signature, expiry and not-before).
The local bypass cannot authorize a hosted origin. All mutations check Origin.

Enabling speech also requires an explicit lifetime character budget, capped in
code at 100,000 characters. The D1 counter is atomic, never automatically resets,
and is not refunded after failed/cancelled admissions. Request fingerprints stop
reuse of a small admission for larger text. Attempt markers precede synthesis;
uncertain speech calls are never automatically resubmitted. This is an application
bound on submitted speech, not a guarantee about all Cloudflare/provider fees.

Only Paddle sandbox keys and the fixed sandbox API are accepted. Resend delivery
is separately gated. No credential is returned to the browser other than Paddle's
public sandbox client token. Sign-in fragments are removed before confirmation;
the confirmation page excludes third-party scripts.

## Local verification

From this checkout, with the project's Node dependencies available:

```sh
npm test
python -m unittest tests/test_reader_migration.py
node cloudflare/reader/build.mjs
npx wrangler d1 migrations apply LEDGER --local \
  --config cloudflare/reader/wrangler.local.jsonc \
  --persist-to work/private-reader/state
npx wrangler dev --local --ip 127.0.0.1 --port 8790 \
  --config cloudflare/reader/wrangler.local.jsonc \
  --persist-to work/private-reader/state
```

In another terminal:

```sh
node cloudflare/reader/check-api.mjs
node cloudflare/reader/check-browser.mjs
```

The browser check uses installed Google Chrome and blocks external requests.
After restarting the local Worker with the same persistence directory:

```sh
node cloudflare/reader/check-api.mjs --resume
```

The build uses cached audio under ignored `work/wavenet-mp3-proof`; a fresh clone
needs those existing synthetic fixture files copied in, not newly paid synthesis.
The implementation itself has no dependency on those files in hosted live mode;
fixtures are used only by the local harness.

## Migration rehearsal

`cloudflare/reader/import-ledger.py` takes an **explicit offline snapshot** and
writes a new owner-only SQLite file. It never discovers the running ledger or
contacts Cloudflare. It refuses active reservations and existing output files.
It preserves exact balances, debt, identity mappings, session expiries, historical
orders/grants, payment synchronization state, usage history, and pending link
hashes. Historical grants are not credited again. Legacy cookie hashes are kept
for a future same-origin cutover; a new staging hostname instead needs fresh
email sign-in. Ambiguous unbound old orders remain blocked for verification.

Only synthetic snapshots were used here. No customer snapshot was read/imported.
Production cutover will need a quiesced, verified snapshot and an approved import
into an empty isolated database, followed by exact per-account reconciliation.
The offline converter is not an automatic production migration/deployment tool.

## Approval boundary and remaining live validation

An isolated Cloudflare staging deployment needs approval to create dedicated
D1/R2/DO resources, select a private hostname and Access policy, and install
separate secrets through owner-controlled secret delivery. No resource IDs,
routes, domains, credentials or budgets have been guessed or reused from the
running service.

After that approval, validate real Access protection, Resend delivery/recovery,
Paddle sandbox purchase/refund/reversal and background alarms, a small explicitly
budgeted WaveNet run, and real-device audio/seek/highlight behavior. Local cached
browser tests do not prove those live integrations or human listening quality.
Production cutover and any real-data migration remain separate approvals.

Protocol references checked during implementation:

- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Paddle authentication and sandbox key format](https://developer.paddle.com/api-reference/about/authentication/)
- [Resend idempotency keys](https://resend.com/changelog/idempotency-keys)
