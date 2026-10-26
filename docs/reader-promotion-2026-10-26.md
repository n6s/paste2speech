# Reader promotion candidate — October 26, 2026

Preparation is approved; production migration and deployment are not yet approved.
Translation is a separate future release. Its staging credential must never be
copied into production as part of this promotion.

The candidate carries the reader fixes since production `300e1ca`, including
persistent device audio, a single temporary playlist, bookmarks, fixed 24-hour
retention, safe refunded OCR retries, PDF extraction, cleanup and mobile controls.
The public build enables persistent audio; the historical owner-only trial stays
excluded. Public retry eligibility additionally requires the existing reviewed
reader/live shared-wallet gates. It does not retry active or ambiguous dispatches,
or start paid calls without a fresh disclosed user action.

Before production, apply only migration `0024_ocr_deliberate_retry.sql` to the
production LEDGER after a fresh private backup. It adds an immutable retry journal
and extends the OCR admission trigger; old receipts, balances, source fences and
settlement records remain intact. Local rehearsal of the October 26 backup
preserved all 1,963 rows in 70 existing tables, passed integrity and foreign-key
checks, and created an empty authorization journal. Rehearsal evidence and the
original trigger are in ignored `work/production-reader-promotion-2026-10-26/`.
Never commit or share that directory's private database/SQL backup.

Commit and restage the exact reviewed candidate, complete staging and public
release gates, verify hosted metadata/hashes, then request final production
approval. Use `release:reader:public`, never the historical trial command.
Production rollback baseline is Worker `61740c18-02c9-4087-87de-87efe3cd646b`.
Prefer fixing forward; keep additive journals and newer transactions. Do not
restore the full backup over later activity. Restoring old code can remove new
UI/recovery support; device audio remains local and must not be purged.

Offline storage depends on browser quota and service-worker support; 512 MiB and
20-reading safeguards remain. Active playback/export protection can defer expiry
cleanup. Native browser voices depend on installed device voices. Physical Pixel
foreground/background behavior is not certified by desktop synthetic tests.
