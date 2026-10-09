# Summary production promotion checkpoint

Roger approved production publication of the reviewed free Summary UI and latest
OCR navigation/parser fixes. Publication is pending the separate approval to add
Workers AI access to the production Worker. No production configuration, schema,
plan, catalog or deployment is changed at this checkpoint.

## Exact access change requiring approval

Add the persistent Workers AI binding named `AI` to
`paste2speech-reader-production`, in the existing Cloudflare account. It lets that
Worker send the source chosen by a verified customer when they explicitly press
Summarize to `@cf/meta/llama-3.2-3b-instruct`. No additional credentials, API token
scopes, Gateway credits or other provider access is required. Dashboard currently
shows Workers Free as Current plan. Runtime configuration must retain
`SUMMARY_WORKERS_PLAN=free`, `SUMMARY_ALLOWANCE_MODE=upstream-free-daily` and
`SUMMARY_LIVE_APPROVED=1`. No Paid upgrade, overage or fallback is authorized.

Existing production has no AI binding or Summary flags. Its current version is
`42da02a5-75fd-4fcd-8735-7b51b421afa8`. Staging has an AI binding already.
Automatic approval review rejected preparing the combined production binding and
enablement changes before this specific access approval, so they remain untouched.

## Work after that approval

1. Prepare public flags/build and backend public-mode gates, preserving verified
   session identity, enabled customer eligibility and existing launch restrictions.
   Trial mode remains excluded. Validate negative cases and public UI behavior.
2. Refresh a private production LEDGER export immediately before schema change;
   import the export locally and verify integrity. Compare financial aggregates
   before/after. Add only Summary gate/request-metadata tables equivalent to
   staging 0009, in a new production migration. Never copy staging data or apply
   unrelated staging migrations. No source text belongs in the ledger.
3. Deploy staging and public from the same clean commit using required release
   checks, approved public release flag and hosted asset/version verification.
   Existing Paddle products, balances, OCR/speech reserves and provider settings
   remain unchanged. Do not run a paid smoke test.
4. Confirm deployed AI/free-only flags, verified-customer access and unchanged
   financial aggregates. Pause/rollback Summary if the account later becomes Paid
   without a separately approved business decision; the configured free marker is
   not a live subscription monitor.

## Rollback

Disable Summary UI/live approval or roll the Worker back to the previous production
version above. Retain additive Summary metadata and existing financial records;
do not restore an old database over newer transactions. Preserve OCR and speech
webhook/ledger reconciliation. Remove unapproved model access if necessary through
an explicitly authorized configuration change. Do not reset uncertain attempts.
