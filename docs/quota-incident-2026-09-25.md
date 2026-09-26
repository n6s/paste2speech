# Reader quota incident — September 25, 2026

User authorized urgent remote containment. Shared baseline:
`/home/roger/.codex/worktrees/reader-shared-release/paste2speech`.

## Evidence

September 25 UTC D1 rows written: staging 75,986; reader production 13,657;
Fibonudgy 2,167; original Paste to Speech 31. Durable Objects analytics reported
92,855 alarm requests and 3,356 HTTP requests. Most alarm requests were exceptions
or client disconnections. Exact exception has not been captured; cleanup/recovery
retry is suspected, not proven. Bounded live tails returned no events.

Rolling 24-hour query insights showed staging payment_commands consuming 41,980
writes (4,198 calls), staging reading_audit about 21,400 writes, and production
reading_audit 11,889 writes. Four credited staging orders are reconciled repeatedly.
Deployed code rewrites audit rows on repeated settlement and retries cleanup errors
with an explicit one-minute alarm plus a thrown exception (automatic retry risk).

## Initial containment deployed

Commit `587e5384feca3a3aaf629e9fdf98220701660357` adds
`BACKGROUND_WORK_PAUSED=1` to both environment configs. API requests return a
maintenance 503 before ledger access, cron work returns immediately, reading
objects skip state loading, and reading/payment alarms defer for 24 hours without
ledger/provider/storage-cleanup work. The switch remains on until explicitly
changed in a repair deployment; the 24-hour alarm does not unpause service.
No database records, balances, audio, or credentials were changed by containment.
Expiry deletion is temporarily deferred. Reading and billing APIs are unavailable.

Staging version: `8576ddd0-26ac-4587-bb70-5c98f49a8745`.
Production version: `39afbe23-6490-40b3-87e2-13535cd0ae08`.

All 200 tests and both reader browser parity checks passed before staging deploy.
The regression test proves paused alarms avoid job loading and ledger access,
reschedule once for a day later, and block reading/payment requests and cron work.
Staging's deployment succeeded but its hosted verification failed because the
Cloudflare Access token file is absent. Do not redeploy merely for that verification
failure. The management API verified staged code and pause binding. For urgent
containment, production was deployed directly with Wrangler from the same clean,
tested commit and already-built assets. Its release.json confirms the commit and
reading/payment POSTs return the expected 503. Python's default HTTP client hit
Cloudflare 1010; Node fetch succeeded without changing any security settings.

## Original repair plan

1. Capture the actual alarm exception in a controlled diagnostic path; inspect
   expiry/cleanup and recovery. Do not assume browser polling caused the alarms.
2. Make successful settlement/audit updates write only when values change.
3. Bound and back off recovery; avoid throwing after scheduling a retry. Preserve
   unsettled credit and unfinished cleanup state. Guard already-complete cleanup.
4. Avoid unchanged payment trigger writes; reduce settled-order reconciliation
   frequency while preserving refunds and webhook/manual reconciliation.
5. Validate on local fixtures. Restore service on staging first, then production;
   observe per-minute alarms and D1 writes before declaring the underlying defect
   resolved. Do not activate public billing or change the Cloudflare plan.

## Durable repair and controlled restoration

User approved two 30-minute observations (staging, then production) instead of a
24-hour soak, and disposal of old reading test data while preserving financial
records. Implementation commits: `2ed344e`, `85f251b`, `ccbc4a6`, and `404aafc`.
Deployed application commit: `404aafc`.

- Reading recovery persists attempts and backs off 1, 5, 15, and 60 minutes;
  the fifth failure stops alarms. Handled failures do not also throw for an
  automatic retry. Missing/corrupt state and failed cleanup writes are covered.
- Completed settlement is remembered. Identical audit updates are no-ops; a
  hosted D1 replay verified zero rows written. Expiry preserves the original
  accounting outcome.
- Completed payment orders reconcile daily. Unchanged status avoids financial
  triggers; webhooks/manual reconciliation remain immediate. Payment failures
  also have bounded recovery.
- Old readings created before 2026-09-26 02:20 UTC are logically retired before
  page loading. A private cron queue removes old audio in bounded batches and
  leaves minimal tombstones. Financial tables are preserved. The queue processes
  at most one object per cron (staging every minute; production every five).
- Migrations 0012/0013 were applied after private backups passed restore/integrity
  checks. Accounts, grants, reservations, account_debt, and usage were compared
  with those backups and matched exactly after repair.

Validation: 208 repository tests, both browser parity checks, and real
Miniflare/workerd Durable Object + R2 checks passed. Runtime coverage includes
48-hour clock advancement, bounded retries across restart, expiry, cancellation,
large cleanup batches, and cached progressive audio. Three hosted staging cached
probes (ready/cancel/expire) passed without paid synthesis. No real purchase was
made; trial mode and disabled public payments remain in force.

The original thrown alarm exception was not captured. Completed cleanup offsets
and retained job state were observed; the exact historical cause remains
unproven. The repair removes confirmed write amplification and bounds recovery
for the tested failure modes.

Cloudflare Access browser credentials were unavailable while the user was remote.
Staging deployment/settings were checked through the management API, with hosted
internal cached probes and local browser parity. Access was not weakened.
Production was promoted directly with Wrangler from the same clean tested commit
and already-built assets. Production public release metadata/assets and API gates
were then checked separately.

### Operational checks

Read-only account usage summary (two-minute analytics lag):

```sh
python3 scripts/quota-recovery/cloudflare.py report --since '<UTC ISO timestamp>'
python3 scripts/quota-recovery/cloudflare.py status --env staging
python3 scripts/quota-recovery/cloudflare.py status --env production
```

Credentials come from the existing environment and are never printed. A stopped
recovery or maintenance `attention` state requires diagnosis; do not reset retry
budgets indiscriminately. The emergency switch remains `BACKGROUND_WORK_PAUSED=1`;
maintenance processing is controlled separately by `MAINTENANCE_QUEUE_ENABLED`.
Do not restore stale ledger backups over later transactions.

### Deployment evidence

- Staging restored version: `e20f30f6-49a0-4d37-b477-1732b62343f3`.
- Production restored version: `26af226c-6d18-4043-808a-d35b379f395e`.
- Both environments serve application commit `404aafc4c4d885bbcba0b605817d4dd2bdc699bb`.
- Production release metadata and all 34 asset hashes matched the clean local
  build. Reader API returned 200 with liveEnabled=true; anonymous creation
  returned 403. Billing status remained trial=true and checkoutAvailable=false.
- Staging gate: September 26, 03:04:00–03:34:12 UTC (30.21 minutes).
  Across both reader environments: 92 D1 writes, 76 Durable Object requests,
  zero failed alarms, no maintenance attention records. Daily projections:
  4,385 writes and 3,623 requests, including one-time retirement work.
- All 26 legacy production objects completed retirement before production
  restoration. Staging retirement continues at one object per minute.
- Production gate: September 26, 03:39:00–04:09:26 UTC (30.43 minutes).
  Across both reader environments: 60 D1 writes, 62 Durable Object requests,
  zero failed alarms, no maintenance attention records. Daily projections:
  2,839 writes and 2,933 requests. Production itself recorded zero writes and
  zero Durable Object requests; the measured activity was staging cleanup.
- Final financial comparison again matched all five financial tables in both
  environments. No snapshot restore was performed.
- At the final measurement, staging had 164 queued legacy objects remaining
  (107 completed queue records, including three cached probes). Physical cleanup
  continues automatically at the bounded rate. All old readings are already
  logically retired; production's 26 legacy objects are fully retired.

Both agreed observation gates passed. These are short background/idle windows,
not proof of paid synthesis capacity or a 24-hour hosted soak. Longer failure and
payment schedules were exercised in accelerated local tests. The exact original
alarm exception remains unconfirmed. Local Tailscale/Kokoro was confirmed working
by the user during the incident and was not changed by this repair.
