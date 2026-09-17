# Queued improvements

- Investigate occasional unnatural Kokoro pauses reported during mobile soak testing (2026-09-17). No exact passage captured yet. Check preserved line breaks, long-sentence splits, ambiguous abbreviation boundaries, and silence generated within each audio section; the player concatenates prepared audio without adding gaps. Capture the affected wording and voice when a case is available.
- Paste and Play near the text panel.
- Persistent playback controls for easier access while scrolling.

GPU request batching is deferred: first measure Pixel preparation with CUDA; the workstation browser added only about 0.2 seconds over local generation in the sample.

These convenience features are deferred from the consolidated-panel update.

## Completed — 2026-09-17

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
