# Deliberate OCR retry on staging

A repeated file selection must not masquerade as a new provider failure. Staging
offers a priced Retry action for existing no-contact recovery proofs or a confirmed
terminal provider rejection: HTTP 400, 413, 415 or 422; zero consumed pages; the
whole hold released; source access closed and original revoked/deleted; no active
local processing. Selecting the file never automatically retries it.

A replacement upload is verified and quoted. The explicit Retry click sends the
quoted prior job ID. The server rechecks the prior actor and appends a linked
admission. Existing financial/source identities remain intact. The unique child
index, one-active-upload rules, account/source/model/page/cost checks and wallet
triggers remain. Duplicate clicks reuse one admission. Cached success is reused.

Network failures, timeouts, HTTP 408/409/429/5xx, unknown outcomes, consumed credits
and absent closure evidence remain protected. The message says no new scan was
made and reconciliation is needed. Other failure classes require more evidence.
This does not establish the original source-failure cause or change access limits.

Feedback exposes previousJobId from server lineage and allowlisted client
repeatOutcome/relatedUploadId to distinguish blocked previous attempts, waiting
for a deliberate retry and requesting a new retry. Client metadata is diagnostic
observation, never authority for credits or admission.

## Migration and rollback

Apply only staging-migrations/0015_ocr_deliberate_retry.sql to staging after a
private export, restore/integrity/foreign-key checks and unchanged-row proof.
It adds an empty immutable authorization table and extends the admission trigger
without changing old receipts, accounts, jobs or money. Old Workers remain
compatible. No production migration/promotion is included; eligibility is gated
to staging. Roll back by redeploying the old Worker, retaining additive tables
and all receipts. Never restore a whole backup over later activity or delete old
attempts to enable retries.

Synthetic tests cover row preservation, native workerd/D1/R2/DO retry and concurrent
acceptance, active/ambiguous guards, old receipts and mobile picker/legacy UI.
They use mocked providers. Real Mistral and physical Android are not tested.
