# Translation staging candidate

Staging Translate mode and the shared local suggestion use the approved Google NMT path.
Production excludes Translate mode and its suggestion; production API routes
return 404. Dispatch requires staging mode, the UI/live flags, the migrated billing schema and a verified enabled owner account. Public/trial routes stay 404. Existing staging credentials and least-privilege scope are reused; no new permissions.

## User flow

Translate follows Summary. A conservative local Spanish/French/Portuguese lexical
hint may offer “Read this in English?”; ambiguous/short text gets no suggestion.
Detection sends nothing and downloads no model. Both entry points share one
source/target/account identity. Target defaults to English; the first release
provides a bounded documented subset of Google's standard NMT languages.

A complete plain-text translation is requested only by an explicit action after
its quote. Original editor text is preserved until Use in reader. Use never
starts speech or changes voice. A language mismatch is explained. Restore original
keeps edits to the translated text in the copyable preview. New source, Clear,
queue switches, account changes and stale responses invalidate the appropriate
UI state. No source/result is added to new browser persistence. Existing reader
persistence applies if the user explicitly uses the translation in the editor.

The initial request limit is 30,000 Unicode code points, not a truncation rule.
Larger readings remain intact and are not silently split or summarized. A separate
future long-document workflow would need durable per-part billing/recovery.

## Price and durable accounting

Roger approved 4 credits per 1,000 source Unicode code points. One credit is
1,000 ledger units, so each source character costs exactly 4 units (0.004 credits).
No per-thousand or per-chunk rounding. Whitespace/punctuation sent to Google count;
output length does not. OCR and speech remain separate actions and charges.

`0016_translation_credits.sql` is an additive **staging-only** migration prepared
for billing activation. It retains immutable receipts/events, updates the existing
capacity view to include refundable translation holds, and never changes existing
wallet rows during migration. It is not a production migration. Back up/rehearse
before applying it. Set `TRANSLATION_BILLING_SCHEMA=1` only after it is applied;
that enables held-balance reporting and expiry maintenance in staging only.

The prepared service reserves once, claims dispatch once, settles only a complete
saved result, and reuses source/target results for their original 24-hour lifetime.
Source text is not stored in its journal. Result text is private, expires after
24 hours, and is removed while numeric receipts remain. Lost acknowledgements and
unknown provider outcomes never authorize another dispatch. Failed/expired known-
safe attempts require an explicit newly priced linked request; no retry loop.
Cancel in the UI stops waiting; already accepted work can finish and charge once.

## Approved bounded proof and normal staging

Roger separately approved at most two actual Google Translation attempts, 5,000
total input Unicode code points, $0.10 gross provider tariff cost and 20 staging
credits. A temporary `TRANSLATION_LIVE_TEST_BUDGET=1` deployment additionally
enforces two dispatched journal rows and 5,000 total characters atomically. Lost
acknowledgements consume the proof budget conservatively. All attempt states count;
no automatic provider retry is made. Reopening ready results requires no dispatch
or second charge. After proof, restore the reviewed normal staging flag `0`;
user-triggered translations continue only after their displayed quote and explicit
Translate action. The agent must not make any additional live requests.

The gross cost estimate excludes Google's free allowance. Only the provider bill
can establish actual invoiced/free-allowance coverage. Staging accounting and real
provider results must be recorded separately from synthetic fixture evidence.

Before applying the additive staging schema, retain a private database backup and
rehearse existing-row/capacity preservation, integrity and foreign keys. Production
migration/deployment is not authorized. Roll back code to the prior staging build
without restoring an old wallet over new transactions; retain additive receipts.

Official references: https://cloud.google.com/products/translate/pricing,
https://docs.cloud.google.com/translate/quotas,
https://docs.cloud.google.com/translate/docs/languages,
https://docs.cloud.google.com/translate/docs/reference/rest/v3/projects/translateText.

## Live-proof diagnostics and language follow-up

The initial 192-code-point proof was refunded in full and remains uncertain; its
original provider error was not recorded, so do not retry it or claim its cause.
A local replay against the real staging schema settles a synthetic success
correctly. Both Google hostnames serve the same discovery metadata; this alone
does not establish an alias routing failure. The adapter now uses the canonical
REST documentation hostname and manual redirects without following credentials.
Failure diagnostics record only attempt ID, bounded stage, numeric status and
allowlisted Google status/reason codes. Raw messages, response bodies, source text,
keys and bearer tokens are excluded. Provider and settlement failures are distinct.

Esperanto (`eo`) and Igbo (`ig`) are standard NMT targets confirmed by Google's
language table; their prior omission was the manual initial shortlist, not voice
filtering. A broader official NMT target list needs no additional permissions or
new API but should be versioned/tested separately. Translation target support
does not promise a device or WaveNet speech voice. Only one agent live attempt
remains; use an independent benign source rather than retry the uncertain one.

Native workerd subsequently reproduced the actual compatibility defect: its
Request implementation rejects `redirect: error` before network dispatch. The
original adapter used that unsupported option; mocked fetch ignored it. The
corrected adapter uses `manual`, constructs both OAuth/NMT requests successfully
in native workerd, and does not follow redirects. The maintained native regression
uses generated synthetic credentials/responses and forbids all external requests.
The original refunded receipt stays intact; this diagnosis does not reclaim an
additional live-test attempt.
