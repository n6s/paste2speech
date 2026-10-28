# Public reader feature promotion — October 28, 2026

This candidate promotes the tested document Summary/regeneration, Translate,
podcast playlist and explicit math speech together with the shared PDF, reader,
quota-aware storage and interface fixes since `58f234d`. No extra entry points,
paid provider tests, new payment plan or speech-credential changes are included.

Public enablement requires the existing reviewed live unified-wallet gates plus
`READER_FEATURES_VERSION=reader-2026-10-28`. Staging keeps independent feature
flags; local/unreviewed/historical trial builds stay excluded. An explicit
per-feature `0` still disables that feature. One version flag keeps the Free-plan
variable/secret budget bounded rather than adding seven public variables.

Public generation requires a verified, enabled, eligible customer account;
staging remains owner-only. Source/target/preset/account identities, exact holds,
settlement, uncertainty protection and expiry journals remain enforced. New
admissions use the existing public rate-limit binding; sequential chunks and
saved-result/status reads do not consume a new-admission slot. Ordinary readers
can use free browser speech while signed out or without credits. Paid actions
remain recognizable; insufficient-credit attempts stop at preflight with an Add
credits link, while saved results/copy/use remain free. A deliberate Summary click
requests a fresh generation; simply viewing/selecting a preset does not.

## Schema and rollback

Only production migrations `0025`–`0029` are required: translation receipts,
translation documents, Summary documents, bounded Summary output recovery and
fresh Summary generations. They explicitly require the production wallet control.
Never apply staging scripts directly or replay legacy grants. The production
budget row's historical name remains `sandbox-retail`; it is not a sandbox-mode
switch and must not be renamed. Held reporting, capacity and cron expiry include
all new journals before public dispatch is enabled.

Before live migration, export the approved fresh production ledger into the
private ignored promotion directory, file mode 600/directory 700. Local rehearsal
must preserve every prior row hash/count, wallet totals and capacity and pass
integrity/foreign-key checks. Keep the backup private and redact temporary export
URLs from logs. Do not restore an old financial backup over newer transactions.

Rollback baseline is clean commit `58f234d0cab0673521959f620753a9e1779159ab`,
currently Worker `ec2c70b6-f357-463e-bfa8-6d1fd560204e`. Roll back code, retaining
additive receipts and any newer transactions. Reconcile/release new in-flight
holds through journal-aware maintenance before abandoning that coordinator; old
code does not know the new journals. Retained audio must not be purged.

## Production translation identity

Use only `p2s-translation-production@paste-to-speech.iam.gserviceaccount.com`,
Google project `paste-to-speech`, custom role `p2sTranslationProduction` containing
only `cloudtranslate.generalModels.predict`, and one approved JSON credential in
`GOOGLE_TRANSLATION_SERVICE_ACCOUNT_JSON` on `paste2speech-reader-production`.
Staging and speech credentials are unchanged. The adapter rejects cross-environment
identities before OAuth. IAM/key/secret operations require their specific security
approval; binding existence alone does not prove a successful live translation.

## Verification

Public preparation includes native workerd/D1 ordinary-customer Summary and
translation settlement/cancel/resume/reuse checks, synthetic migration and
credit/account guards, and actual public assets through import → Summary →
translation → reader → offline reload/Resume. It also retains math wording/payload
parity, podcast journeys, legacy trial exclusion, public billing and existing
required release gates. The combined journey checks that transformed text gets a
new logical playback identity rather than remaining attached to an imported
source; old source membership/audio is retained, duplicate Play admits once.

Rebuild/restage the exact committed candidate and verify hosted hashes before
`release:reader:public -- --deploy --production-approved`. Its deployment preflight
requires the production credential binding, all registered migrations and the
reviewed binding budget. Never use the historical trial release command. Verify
hosted public metadata/assets and isolated synthetic UI afterward without touching
customer readings or spending provider credits. Physical Pixel/public live-provider
validation remains distinct from synthetic test results.
