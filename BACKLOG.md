## Payment recovery and refund accounting — private sandbox

- Service checks recorded Paddle transactions at startup and every 60 seconds
  after each bounded scan, even with all browsers closed. Approved refunds are
  applied with the grant atomically; repeat checks do not duplicate either.
- Partial refunds use pretax principal; tax-only adjustments preserve allowance.
  Already-spent refunded characters become a shortfall. New packs and reservation
  releases cover it before restoring spendable credit. In-flight generation stops
  before the next section when a shortfall exists.
- Canceled orders can be replaced; failed API checks retry with a visible notice.
  Chargeback reversal, pagination, restart and concurrent replay are covered.
- 99 Python and 96 JavaScript tests passed across the full run and added targeted
  cases; billing and independent-session browser tests passed. Actual sandbox API
  reads verified all three recorded orders; the restarted service checked them and
  preserved the six-million-character balance.
- Real sandbox refund test passed on 2026-09-21: requested $10.75 on transaction
  `txn_01m32j4k6c1gehf69y39nxkzgf` (adjustment
  `adj_01m32m3tkbqrmdv6k0psdqc2jt`). Pending approval kept all 6 million characters;
  Paddle approval triggered automatic removal of exactly 3 million, leaving
  3,000,000 visible in the signed-in browser. The next background check preserved
  that balance, confirming no duplicate deduction. No manual reconciliation was used.
- Public
  signed webhooks, hosting and refund policy remain launch work. Details and known
  boundaries: `docs/payment-recovery.md`. No public deployment.

## Email-linked sandbox allowance — private implementation

- Added email sign-in preserving existing credit, independent expiring sessions,
  one-time browser-bound links, sign-out and durable request limits.
- Two isolated browser contexts recover the same 6-million-character fixture
  balance without duplicating credit. Expiry, reuse, concurrency and conflicting
  balances are covered. See `docs/email-signin.md` for setup and boundaries.
- Resend sending key remains owner-only; Cloudflare's one-time DNS authorization
  adds only the three Resend sending records. No public reader deployment.
- Resend domain verified; actual email arrived with SPF/DKIM passing. Gmail put
  the first message in Spam, so inbox placement is not yet validated. The real
  link signed Chrome into the verified Paddle test email with all 6,000,000
  characters preserved. Resend now enforces TLS; tracking remains unconfigured.
- Python tests: 86 passed; JavaScript tests: 96 passed; both billing and email
  browser checks passed; private reader built. Roger confirmed the emailed link works on Pixel and
  recovers the same 6,000,000-character balance.

## Purchase recognition — sandbox verified

- Receipt product name: `speak.rogerpbrown.com — Speech pack`.
- Second actual sandbox purchase automatically increased credit from 3 million to
  6 million without a manual refresh; the new receipt confirmed the website name
  and statement descriptor.
- Saved statement descriptor: `SPEAKRPB` (the generic `SPEECH` was unavailable).
- Checkout explains the expected `PADDLE.NET* SPEAKRPB` statement entry.
- Keep the legal seller name Roger Brown. Carry this branding to live configuration
  before launch; existing receipts are historical and are not rewritten.

## Approved starter pack — 2026-09-21

- One-time USD $10 pack for 3,000,000 characters of hosted DeepInfra Kokoro
  generation. Describe it as approximately 50 hours of speech, not guaranteed hours.
- Replay, playback-speed changes and downloading an existing recording consume no
  additional allowance; generating a new version consumes allowance.
- Paddle sandbox account and product are created. Product:
  `pro_01m32gd3hj94whqywcvmyta74b`; price: `pri_01m32geyt53f5h9nxqfhqbt19x`.
  These are sandbox identifiers only. The catalog does not enforce usage balances.
- At the current $0.62/million provider rate, 3 million submitted characters cost
  $1.86. Standard Paddle fees on a $10 pretax sale are approximately $1, leaving
  $7.14 before hosting, support, retries, refunds and other expenses, not net profit.
  Allowance counts source text; provider pronunciation expansion adds a small cost
  absorbed by the service. Tax presentation and public hosting costs still need review.
- Implemented privately: durable numeric usage accounting, browser-bound sandbox
  balances, server-created Paddle orders, authenticated API purchase verification,
  idempotent grants and per-reading reservations with partial-failure refunds.
  Month totals and checkout are at `/speak/api/billing`. Real sandbox checkout
  completed with Paddle's test card, granted exactly 3,000,000 characters, and
  retained that balance across refresh/reload without a duplicate grant. Checkout
  confirmation now polls briefly for Paddle's delayed completed transaction status.
  Private email recovery is now implemented; public authentication, webhook/refund handling and deployment remain future work.

## Hosted Kokoro pilot — private only

DeepInfra is selectable in the private reader, with Heart/Emma, bounded prepaid
usage, shared speech rules, continuous playback and MP3/VTT export. Validate its
Pixel behavior separately from the previously confirmed workstation path. Public
hosted infrastructure and production account/billing integration remain future work.
The private sandbox purchase/allowance pilot above is not a public deployment.

# Current private milestone — 2026-09-21

Progressive workstation Kokoro, media playback speed, section controls, MP3 export,
and optional WebVTT are implemented privately. Real chapter playback and export
passed desktop/mobile-layout checks. Final Pixel lock-screen, background buffering,
and listening acceptance remain open. Do not publish the pending browser experiments.

Pronunciation contributions should take a small, reviewed regression-tested path
to production, independent of these experiments. Preparing that isolated public
release is separate work; this milestone does not change the feedback automation
or authorize automatic fixes/deployments. Regenerate old recordings after a fix.

# Queued improvements

- Investigate occasional unnatural Kokoro pauses reported during mobile soak testing (2026-09-17). No exact passage captured yet. Check preserved line breaks, long-sentence splits, ambiguous abbreviation boundaries, and silence generated within each audio section; the player concatenates prepared audio without adding gaps. Capture the affected wording and voice when a case is available.
- Paste and Play near the text panel.
- Persistent playback controls for easier access while scrolling.

GPU request batching is deferred: first measure Pixel preparation with CUDA; the workstation browser added only about 0.2 seconds over local generation in the sample.

These convenience features are deferred from the consolidated-panel update.

## Completed — 2026-09-20

- Weekend pronunciation reports: shared American/British Kokoro overrides for Houthi (HOO-ti), Houthis (HOO-teez), and astaxanthin (as-tuh-ZAN-thin). Both workstation and on-device synthesis use the dictionary; original text, URLs, longer words, and pause planning are preserved. Regression tests cover the supplied passage, capitalization, and possessives. Real workstation Heart/Emma and browser Heart/George audio samples are generated for listening; final Pixel pronunciation acceptance remains with Roger. Reload and regenerate prepared audio to hear the changes. Private reader release only.

## Completed — 2026-09-17

- Multiple-choice labels: separate uppercase A)–Z) answer lines into paragraphs and add 150 ms Kokoro pauses after the labels, including Correct Answer labels. Normal parentheses remain unchanged. 94 automated tests, browser checks, live paragraph/playback checks, and real answer-label pause measurements passed.

- Formatting-aware paste in the existing Edit textarea: formatted clipboard HTML becomes Markdown with heading/list/paragraph structure; ordinary text paste stays native. Conversion is local and inert. Browser tests cover undo/selection, playback reset, code, layout tables, and no embedded-resource requests. Actual Gmail/Pixel rich clipboard availability remains a device acceptance check.

- Currency-specific prose expansion: all 14 supplied newsletter dollar figures now read as million/billion dollars, with decimal digits spoken individually. Approximation handles `~$48M`, including Markdown escaping. Code, URLs, bare M/B units, and longer identifiers stay excluded. 57 unit tests, mobile browser checks, and live Kokoro currency playback passed; original Edit text is preserved.

- Comma-grouped quantities now expand directly into cardinal words: `1,079` reads “one thousand seventy nine.” Ungrouped years stay untouched. Grouped decimals and square-foot measurements remain supported; installed phoneme checks and live American/British synthesis passed.

- Approximation tildes before prose numbers now read as “about” under Markdown cleanup, including escaped newsletter tildes. Protects code, retained URLs, and paths; preserves original Edit text. Exact Waymo example verified on the live page, plus 55 tests and mobile browser checks.

- Added the first explicit Kokoro pronunciation dictionary entries: Waymo (case-insensitive), robotaxi, and robotaxis, with American/British phonemes. Installed phonemizer checks, pause integration regression, and live synthesis with Heart and Emma passed; Roger's listening confirmation remains open.

- Kokoro speech-only measurement and decimal pronunciation (`50 lb.` → pounds, `7.2-ft.` → seven point two feet) and 150 ms em-dash pauses. Original display and section boundaries retained. Exact robot-news sentence covered by regression tests; live synthesis and dash timing checked. Phone pronunciation feedback remains useful.

- Structure-preserving prose cleanup and playback: decode HTML entities literally outside protected code, remove short empty layout tables without merging neighbors, and retain paragraph boundaries through prepared WAV assembly with a 250 ms minimum gap. Exact newsletter fixture, timing/retry/cache/size-limit regressions, mobile browser checks, and real Kokoro integration passed. Live sample naturally supplied about 455 ms at the heading-to-item boundary, so no extra silence was added. Phone comfort confirmation remains with Roger.

- Subtle Kokoro quote boundaries: 50 ms target silence around paired quotes within a reading section. Counts existing silence on both sides, avoids nested/colon pause stacking, and preserves apostrophes. Verified automated audio tests and real generated audio around “responsibility and incentive”; Roger still found the 75 ms minimum too long. A live sample showed natural gaps around 430 and 590 ms; quote boundaries now trim excess near-silence to a 50 ms target, retaining small speech-edge buffers. Colon behavior is unchanged. Regression tests and live generated audio verified.

- Deliberate Kokoro colon pauses: whitespace after a colon separates synthesis phrases; colon-ending sections top up trailing silence to 250 ms without stacking a full extra pause. Verified with PCM regression tests and a real live Kokoro response. Pixel listening feedback remains useful for tuning pause length.

- Join wrapped lines now preserves short multiword all-caps newsletter titles followed by mixed-case prose, including Roger's Gmail example with a leading emoji. Joining defaults to enabled for new settings; saved choices are respected. Text/chunk regression and mobile browser checks pass; audible Pixel confirmation remains open.

## Completed — 2026-09-16

- NVIDIA CUDA synthesis: 138.9 seconds of audio prepared in 1.43 seconds locally (CPU: 37.3 seconds), or 1.63 seconds through the workstation browser (CPU: 45.4 seconds). CPU environment retained for rollback; Pixel preparation speed still needs user confirmation.

- Consolidated Edit/Read panel, preserving original text and cleanup settings. Mode changes preserve playback; editing resets it.
- Removed editing resize handle and duplicate current-reading display; resizing remains available in Read mode.
- Stable short preview sections for long paragraphs, using the existing speech chunks for section navigation and highlighting.
- Manually resizable reading preview (native vertical handle, where supported), replacing the expandable-preview proposal.
- PDF import collapsed by default under Open PDF.

Native preview resize-handle availability still needs a Pixel check; touch browsers may not expose the handle.

## Background playback device acceptance — partially verified

Roger reported on 2026-09-16 that a long newsletter played on his Pixel with the screen off and finished naturally with five seconds remaining on a ten-minute countdown (approximately 9 minutes 55 seconds). This verifies screen-off playback through completion for that reading; it is just short of the planned ten-minute duration.

Roger also confirmed that switching apps during prepared playback caused no audio interruption, and returning to the reader showed the correct currently playing section highlighted. App switching and preview synchronization passed.

Roger confirmed that lock-screen media controls appeared and playback responded correctly. Lock-screen pause/resume passed.

Roger confirmed that after disconnecting Tailscale, prepared playback continued uninterrupted and pause/resume still worked. Playback without the workstation connection passed.

Earbud check: pause worked, but resume did not. After earbud resume failed, lock-screen Play successfully resumed without opening the reader. The same earbuds successfully pause/resume Podcast Addict. Google's Media Session audio sample reproduced the same pause-success/resume-failure behavior in the Pixel browser. This supports a browser/Android headset-control compatibility issue rather than a confirmed reader-specific defect; the exact cause remains unverified. Workaround: resume from the lock-screen Play control. No backward/forward buttons appeared in the Pixel media player or lock screen, so device seeking could not be tested.

Remaining checks on Roger's Pixel:

- Play a prepared reading for at least ten minutes with the screen locked.
- Track earbud resume as an unresolved browser/device compatibility issue; retest if a browser update or workaround becomes available.
- Verify seeking if the device exposes seek controls; none were shown in this test.

Do not mark background playback device-verified until these checks pass.


Private allowance validation (2026-09-21): real DeepInfra generation, free replay
and speed changes, MP3/VTT endpoint verification, and cancellation reservation
release passed. Final balance 2,999,309; provider estimate $0.00043710. See
`docs/payment-recovery.md` for evidence and browser-download limitation. Final
Pixel balance/playback/highlighting check remains pending. No public deployment.


DeepInfra parallel preparation (2026-09-21): implemented a three-section bounded
window with ordered encoding/cues and settled cancellation accounting. Real
comparison improved 57.1s to 28.6s for 13.8s audio, still too slow for uninterrupted
playback in these conditions. Do not mark progressive paid playback validated.
See docs/payment-recovery.md.
