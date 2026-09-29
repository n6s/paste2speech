# Local Worker account and usage proof — September 21, 2026

The separate local account API saves a recoverable reading intent and alarm
before reserving available credit, settles successful sections once, and releases unused credit
after completion, failure or cancellation. It uses local D1, Durable Objects and
R2, cached synthetic audio, three seeded test identities and fake credit.
No real balances, purchases, email, Google speech requests, public deployment or
running private reader were changed in this slice.

## Observed results

| Scenario | Reserved | Consumed | Released |
|---|---:|---:|---:|
| Complete eight-section reading | 521 | 521 | 0 |
| One failure in first three-section batch | 521 | 136 | 385 |
| Stop during first batch | 521 | 206 | 315 |

The local runtime check also proved concurrent duplicate requests reserve once,
changed input cannot reuse a request key, two different requests cannot overspend
an 800-character balance, cross-account status/audio/delete/receipt access fails,
forged sessions fail, logout revokes a session, and repeated creates/status reads
do not charge again. A full runtime restart preserved the settled balance,
recording and eight attempts; replay did not generate or charge again.

All 123 JavaScript tests passed after adding admission recovery coverage. SQLite-backed tests additionally cover Unicode
code-point accounting, session expiry/hash storage, retention of an original
3-million-character grant on duplicate replay, disabled-account batch checks,
uncertain-section refunds and rollback/retry of an interrupted settlement
transaction. The existing local non-account MP3/VTT/range/cancellation checks
passed. No new browser or real-device playback claims are made by this slice.

## Boundaries and recovery

- The test-login endpoint accepts only three synthetic identities, on loopback
  port 8789, with live synthesis rejected. It is **not production authentication**.
  Existing email sign-in, customer migration, refunds/shortfalls and payment
  verification have not been ported or connected to this ledger.
- Session cookies are random, HttpOnly and SameSite=Strict; only hashes are stored.
  Real hosting requires HTTPS/Secure cookies and verified identity issuance.
- Source code points are reserved. Successful stored sections consume credit;
  provider attempts and uncertain costs remain separate. Successful in-flight
  sections are persisted even after Stop, before settlement releases the rest.
- Durable job markers prevent automatic resubmission of uncertain speech calls.
  D1 settlement is transactional and idempotent. Settlement/cleanup failures
  schedule another alarm; terminal status access can also reconcile settlement.
- Admission now starts inside the Durable Object. The reading intent and recovery
  alarm are committed together before the first D1 debit. Admission is serialized
  with duplicate creates and other job events. If D1 commits but its response is
  lost, the alarm repeats the same idempotent reservation and then continues.
  No synthesis starts until admission is accepted. Transient admission failures
  keep the durable intent pending and schedule recovery; insufficient credit
  permanently rejects that request key without creating a reservation.
- Pending cancellation/expiry checks whether a reservation actually exists,
  releases it if present, and cannot reserve again on replay. Accepted/terminal
  accounting remains idempotent. This prevents the old orphan-reservation window
  for newly created jobs; it is not a migration/reconciliation of databases made
  by older prototypes or the existing Python service.
- This pilot uses a separate local persistence directory. No SQL migration was
  applied to the Python ledger or remote D1. The database ID is a local placeholder.

## Reproduce

Use a fresh local persistence directory for a full test: the low-credit race
intentionally spends its seeded allowance. Preserve previous test directories;
do not reset customer data. Build cached assets with the existing
`scripts/wavenet-worker-proof/build.mjs` prerequisites described in
`docs/wavenet-worker-proof.md`.

```sh
node scripts/wavenet-worker-proof/build.mjs
/home/roger/workarea/paste2speech/node_modules/.bin/wrangler d1 migrations apply private-wavenet-account-local --local --config scripts/wavenet-worker-proof/wrangler-accounts.jsonc --persist-to work/wavenet-account-proof/verified-state
python3 scripts/wavenet-worker-proof/run-local.py --accounts --state work/wavenet-account-proof/verified-state
```

In another terminal:

```sh
node scripts/wavenet-worker-proof/check-accounts.mjs
npm test
```

Stop/restart the same local launcher, then run:

```sh
node scripts/wavenet-worker-proof/check-accounts.mjs --resume
```

Results are in `work/wavenet-account-proof/results.json`; the restart checker uses
an ignored owner-only session file. The account pilot root explains its API-only
scope; the existing player pilot remains on port 8788.

## Interrupted-admission verification

The cached-only harness accepts `X-Proof-Admission-Fault: after-intent` or
`after-reserve` to simulate interruption before/after the debit. Both return 503
and leave a durable alarm, with zero synthesis attempts at the interruption.
The fault is consumed once and excluded from the reading identity fingerprint.

```sh
node scripts/wavenet-worker-proof/check-recovery.mjs
node scripts/wavenet-worker-proof/check-recovery.mjs --stage
# Stop the local launcher immediately (within five seconds), then restart it
# with the same persistence directory.
node scripts/wavenet-worker-proof/check-recovery.mjs --resume
```

The automatic recovery and cancellation checks passed, as did an actual runtime
restart after the debit with admission still pending and zero section attempts.
Recovery completed with exactly eight attempts and one 521-character charge.
Repeated creates did not alter the settled balance. All existing account and
non-account audio API checks passed again. Test state was local only under
`work/wavenet-account-proof/recovery-verified`; earlier diagnostic state was
preserved separately. No Google credentials were loaded in the account runtime.

Next: connect the verified email identity flow and preserve existing
account/payment semantics, continuing to use local mocks and synthetic accounts
until separately authorized for any live service interaction.
