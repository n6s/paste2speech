# Current reader production promotion — October 20, 2026

Roger approved promotion of the input/queue refinements, interrupted-section
recovery, revised sign-in handling, local TXT import, and new-tab credit link.
The offline audio-storage redesign is explicitly separate and is not included.

The public configuration enables `INPUT_QUEUE_REFINEMENTS`,
`SPEECH_SECTION_RECOVERY`, `LOGIN_FAIR_ALLOWANCE`, and `LOCAL_TEXT_IMPORT`.
The builder allows these in public builds while retaining the historical
owner-trial exclusion. Server recovery and fair-login handling require the public
mode and existing live shared-wallet approval as well as their feature switches.
Owner/session checks, bounded recovery proof, original expiry, idempotent remainder
IDs, exact settlement checks and explicit paid-remainder confirmation remain.

Production migration `0023_login_fair_allowance.sql` guards the production wallet
control before replacing only the login quota check/record triggers. It preserves
all table rows, sessions, links, financial records and rolling quota entries. The
budget is 90 public links/day plus five reserved links/day for each enabled existing
identity; hourly per-email/IP checks stay in force. Queued delivery returns a
uniform acknowledgement, not a delivery guarantee. Hosted flows use a Secure,
HttpOnly, SameSite=Strict, host-only cookie; suppressed resends reuse a valid flow.
Previously emailed production links using the old cookie require a fresh request
after rollout; existing authenticated sessions remain valid.

Before migration, export the private production ledger, restore it locally,
check integrity and foreign keys, and rehearse exact row preservation and reapply.
Save original trigger SQL and previous Worker deployment metadata privately under
ignored `work/current-reader-promotion/`. Only migration 0023 is expected pending.
Do not restore a whole backup over new transactions. The trigger change is
compatible with old code; if quota policy must be reverted, restore only the two
saved triggers without deleting any usage history. Returning to older login code
can invalidate outstanding new-format login links; request a fresh link.

After recovered speech compositions exist, prefer fixing forward: old code or
turning recovery off can prevent composition replay. Preserve endpoint support,
saved IDs, financial history and original expirations. No speech, purchase, credit
grant, payment configuration or provider control changes are part of this release.

Public release gates exercise TXT imports and real native-audio recovery/MP4
assembly against both staging and public builds using synthetic APIs, in addition
to existing parity, playback, offline, OCR, input queue and billing checks. Hosted
release metadata and all declared asset hashes must match the same clean commit
first on staging and then production. This does not certify physical Android file
pickers or long-document MP4 memory behavior; the 64 MiB audio cache is unchanged.
