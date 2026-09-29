# Staging status — September 22, 2026

The user approved staging deployment and credential setup, paused for a cost
review, then explicitly resumed and activated R2 and Zero Trust Free.

Current staging: https://staging.pastetospeech.com/ . Production remains
https://speak.rogerpbrown.com/ and still routes to the original Worker.

Historical September 22 activation and deployment (superseded by the restoration update below):

- Dedicated private R2 bucket `private-wavenet-reader-staging`, WNAM Standard.
  Public r2.dev access is disabled. A 24-hour lifecycle deletes audio and aborts
  incomplete multipart uploads (cleanup scheduling is asynchronous).
- Access application `9c39a68a-5733-4663-87a3-8cabc94e7cc5` allows only
  rogerpbrown@gmail.com through the existing Cloudflare identity provider.
  Issuer: https://broad-king-0668.cloudflareaccess.com .
- Deployed Worker, D1/R2 bindings, Durable Objects and separate custom hostname.
  Anonymous requests redirect to Access. workers.dev and previews stay disabled.
- Installed existing local Google, Resend and Paddle sandbox credentials directly
  through stdin into staging secrets; values were not printed or committed.
  All provider enable flags remain zero, and speech budget remains zero.
- User reached the reader's denial response after Access sign-in. Isolated runtime
  reproduction showed Workers rejects fetch redirect:error. Changed Access and
  provider calls to redirect:manual; non-2xx responses still fail closed.
  Sixteen reader tests pass, including redirect rejection for all three adapters.
- User subsequently reported Chrome ERR_BLOCKED_BY_CLIENT; the browser tool also
  encountered that block. Authenticated success remains unverified after the fix.
- Next: resolve browser access, verify real sign-in/email and sandbox payments,
  obtain an explicit speech allowance before any synthesis, then device listening.
  No real account data imported, no real purchase or speech request submitted.

Historical preparation before activation:

- Created dedicated D1 `private-wavenet-reader-staging`, ID
  `74f0d55c-b7ab-4d6b-aa26-cf06bfa9036f` in the existing Cloudflare account.
- Applied all five reader migrations remotely. Cloudflare's REST statement
  splitter rejected CASE expressions inside triggers despite local acceptance.
  Equivalent WHERE-based RAISE guards and COALESCE identity selection applied
  successfully. Fifteen reader tests and two offline migration tests passed.
- Verified remote triggers with synthetic data: 5,000 credit became 4,999 after
  one successful character, 1,004,999 after a synthetic pack, and 4,999 after its
  full synthetic refund. Removed every synthetic account/order/grant/reservation.
  Read-back: zero accounts, grants and orders; five applied migrations.
- No production database, balance, route, Worker, or running checkout changed.

The original activation blockers are resolved. Account subscription lookup still
lacks permission, so the Workers plan remains unverified. No paid upgrade made.

References checked live:

- https://developers.cloudflare.com/r2/get-started/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/learning-paths/secure-internet-traffic/initial-setup/create-zero-trust-org/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://cloud.google.com/text-to-speech/pricing
- https://resend.com/pricing

## Approved live speech trial

The user confirmed successful authenticated reader access, then explicitly
approved a total staging allowance of 100,000 characters (approximately $0.40
at the discussed list rate before free allowance; not a total cloud bill cap).
Enabled live synthesis only on the private staging Worker and set
MAX_LIFETIME_CHARACTERS=100000. Email and payments remain disabled.
Deployment: 13fb225d-0a57-440e-835e-4a4263792ff4.

All 16 reader tests passed before deployment. A real browser submission prepared
and finished a 15.7-second US WaveNet reading, exposing MP3 and caption downloads.
Remote staging D1 read-back confirmed maximum=100000, characters=228, and
speech_admissions sum=228 (99,772 remaining at that check). No budget reset or
real-balance mutation was performed. Human listening quality, device playback,
email recovery and sandbox payments remain separate validation items.

Mobile navigation correction: the user reported `Open the private reader directly`
after opening staging on a mobile device. The source check rejected all cross-site
requests, including legitimate top-level navigation after Access authentication.
Permit GET/HEAD with navigate/document metadata while retaining the Access JWT
gate, mutation Origin checks, and rejection of cross-site API/iframe requests.
All 17 reader tests pass, including the navigation and mutation regression matrix.
Deployed only to staging; real-device confirmation remains pending.

## Shared-reader restoration

The established reader now runs on Cloudflare with browser voices and credit-gated
WaveNet. The separate WaveNet-only harness was retired. Email and sandbox
payments are enabled in private staging; the existing lifetime speech limit
remains 100,000 with 7,501 consumed after the targeted US/UK sentence tests.
All eight migrations are applied. New accounts require verified credit; imported
legacy private-pilot entitlements remain explicit server-controlled data.

The user confirmed real email sign-in. A real sandbox checkout granted exactly
one pack. Partial-refund verification passed; the user reports good restored mobile
behavior and notes the full-preparation wait. A separate full refund was approved
by Paddle and automatically removed exactly one million characters. Final
background-ledger and speech-budget figures are recorded in the matrix. Feedback and aggregate statistics use the
isolated staging D1; the synthetic report has zero notification attempts.

See `reader-feature-parity.md` for current verification and
`private-reader-cutover.md` for the separate production approval boundary.
