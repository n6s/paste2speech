# Cloudflare reader restoration acceptance matrix

The established public reader is the UI authority. The WaveNet-only staging
harness has been retired in favor of the established shared interface. This matrix tracks implementation and
verification; pending items are not claims of completion.

| Feature | Implementation target | Verification |
|---|---|---|
| Free browser voices without login | shared app/Player | implemented; automated local checks passed |
| Paid US/UK WaveNet, account/upgrade | server eligibility, sandbox purchase | local eligibility passed; real sandbox purchase granted once; US/UK sentence preparation passed |
| Clear; Clear, Paste & Play; formatted paste; denied clipboard | shared app/paste | implemented; automated local checks passed |
| Single Edit/Read pane; original text retained | shared app | implemented; automated local checks passed |
| Sentence sections, highlighting, tap, previous/next | shared splitter and timed audio | implemented; automated local checks passed |
| Follow reading; text size; persisted settings | shared app/styles | implemented; automated local checks passed |
| Collapsible voice/speed; cleanup controls | shared app | implemented; automated local checks passed |
| Full preparation; progress; pause/resume/stop/seek/live speed | shared ProgressivePlayer | implemented; automated local checks passed |
| Local PDF import, cancellation, errors | browser PDF extractor | implemented; automated local checks passed |
| MP3 and optional VTT download | existing private audio endpoints | implemented; automated local checks passed |
| Sign-in/recovery, balances, usage, purchases/refunds/debt | private ledger/identity/payment coordinator | local identity/payment tests passed; real email sign-in confirmed; sandbox purchase and automatic partial/full refunds passed |
| Feedback, statistics, support, privacy | isolated staging tables and shared footer | local UI passed; remote staging feedback stored with zero notification attempts; isolated statistics verified |
| 24h expiry, ownership, Range, recovery, budget | private Worker/DO/R2 | implemented; automated local checks passed |
| Kokoro, workstation, DeepInfra, model/GPU controls | explicitly removed for this build | agreed |

All work and deployment remain private staging. Production data and configuration
are excluded. Preserve the already-consumed lifetime speech budget. Mobile
acceptance follows integrated desktop and backend checks, not each milestone.

Completed validation: 154 unit tests; 3 synthetic offline-migration tests; existing
Chrome suites for basic reader, formatted paste, local PDF, and mobile-layout
feedback; integrated 40-sentence cached recording, paid eligibility, sentence
navigation, seeking/speed without regeneration, MP3/VTT, email-link confirmation,
late cancellation, Range/ownership/idempotency, and runtime restart persistence.
The user reports the restored mobile experience feels good overall; the remaining
concern is time spent preparing. Full preparation remains the agreed design.
Authorization is now reused within its declared expiry in Worker memory, and
stored sections are assembled with bounded parallel reads to reduce overhead.
No claim of a measured mobile speedup is made.

Live restoration evidence (2026-09-22): verified sandbox purchase issued exactly
one 1,000,000-character grant. Five-section US and UK readings each consumed 134
characters. The lifetime budget is preserved at 7,501 / 100,000 after these tests
(92,499 remaining at this checkpoint). Email recovery was confirmed by the user.
The half-pack refund was approved and automatically removed exactly 500,000
characters with the account page closed. The separate full-pack refund also automatically removed exactly 1,000,000
characters. Each test transaction has exactly one grant. No production data,
real balances, production payment configuration or route has been changed.

Final checkpoint: Worker `cbcb4d95-bc3b-4be5-a537-702abca2154f`, eight
migrations applied, and 19,512 / 100,000 lifetime characters consumed (80,488
remaining at 2026-09-22 17:50 UTC, including the owner's mobile readings). The
final six-section UK smoke check consumed 122 characters and reached ready.
The test account retained 487,721 characters after both refunds and test usage.
The speech cap remains independent of purchased sandbox credit.

No agreed feature remains unimplemented. Mobile feedback accepts the restored
experience overall; full preparation's wait is a known design tradeoff. The
latency reductions passed automated and live completion checks, but their mobile
speedup has not been measured. Progressive playback is not claimed or enabled.

Production remains at the approval boundary described in
`private-reader-cutover.md`. No production data has been read or migrated.
