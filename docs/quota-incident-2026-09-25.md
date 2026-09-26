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

## Containment deployed

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

## Repair before resuming

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
