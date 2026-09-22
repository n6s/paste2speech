# Cloudflare reader restoration acceptance matrix

The established public reader is the UI authority. The WaveNet-only staging
page is a harness, not the replacement. This matrix tracks implementation and
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
| Sign-in/recovery, balances, usage, purchases/refunds/debt | private ledger/identity/payment coordinator | local identity/payment tests passed; real email sign-in confirmed; sandbox purchase passed, refund approval pending |
| Feedback, statistics, support, privacy | isolated staging tables and shared footer | local UI passed; remote staging feedback stored with zero notification attempts; isolated statistics verified |
| 24h expiry, ownership, Range, recovery, budget | private Worker/DO/R2 | implemented; automated local checks passed |
| Kokoro, workstation, DeepInfra, model/GPU controls | explicitly removed for this build | agreed |

All work and deployment remain private staging. Production data and configuration
are excluded. Preserve the already-consumed lifetime speech budget. Mobile
acceptance follows integrated desktop and backend checks, not each milestone.

Validation so far: 153 unit tests; 2 synthetic offline-migration tests; existing
Chrome suites for basic reader, formatted paste, local PDF, and mobile-layout
feedback; integrated 40-sentence cached recording, paid eligibility, sentence
navigation, seeking/speed without regeneration, MP3/VTT, email-link confirmation,
late cancellation, Range/ownership/idempotency, and runtime restart persistence.
Actual mobile acceptance after restoration is still required. Cached speech proves
UI and state, not the new sentence joins' audible quality.

Live restoration evidence (2026-09-22): verified sandbox purchase issued exactly
one 1,000,000-character grant. Five-section US and UK readings each consumed 134
characters. The lifetime budget is preserved at 7,501 / 100,000 after these tests
(92,499 remaining at this checkpoint). Email recovery was confirmed by the user.
A sandbox half-pack refund is awaiting provider approval. No production data,
real balances, production payment configuration or route has been changed.
