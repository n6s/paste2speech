# Joined video downloads

This feature lives on the shared reader branch. `VIDEO_DOWNLOAD=1` enables the
UI, local FFmpeg assets and WebAssembly CSP permission. Staging and the production candidate enable it; the shared release workflow
promotes the same clean source commit with production billing disabled.

## Long-document playback

Normal Play now uses the same bounded preparation for long documents. A tab-local
logical reading maps global sentence indexes to sequential durable jobs, joins
sample-based timelines, and streams sections into the existing MSE player. The
completed-file fallback joins MP3 exports into one local Blob. The download waits
for all of these jobs and uses them without another speech admission. Requests
below the part size retain their original path. Cached staging fixtures retain
the original fixture path. Long-reading orchestration is gated independently by LONG_READINGS (and also
enabled by VIDEO_DOWNLOAD for compatibility). Both flags are enabled in the
production candidate.

The 21,347-character browser test uses the real split boundary: 20,000 plus 1,347.
It verifies early playback at six ready sections, cross-part seeking, full-file
fallback, exactly two admissions, and all 43 cues in the resulting MP4. Speech
APIs are intercepted; no real provider calls are made by the test. Staging still
uses 1,200 internally by default; the testing selector can exercise 20,000.

If Download starts preparing its own audio first, normal Play waits for that
preparation rather than racing it into duplicate paid jobs. A later Play reuses
its stored job IDs. Cancelling or clearing a reader stops scheduling future
parts; Clear cancels/removes that logical reading's admitted jobs.

## Use

Choose WaveNet, paste text or import a PDF, and expand **Download recording**.
Click **Download**. The button gives way to processing status, then one real
MP4 link that can be opened or right-clicked and saved. There is no automatic
download, separate preparation button, audio-parts list, or alternate-format UI.
The preparation stage makes bounded WaveNet jobs sequentially, preferring
paragraph boundaries. Oversized paragraphs fall back to the existing sentence,
phrase and word splitter. There is no document-length or part-count ceiling in
this path. All service requests remain at most 20,000 UTF-16 characters and
individual speech chunks at most 500 characters (under the service byte limit).
Staging defaults internally to 1,200 characters to exercise splitting. The
split-size selector appears only in `/?testing=1`; production defaults to 20,000.
PDF import with this feature enabled has no fixed file/text-size cutoff or
40-second timer; user cancellation and the device remain the constraints.

Only after every audio part is ready, the same action loads the approximately 31 MB encoder
on this device and produces one MP4: H.264 title card, AAC audio, mov_text
subtitles marked English/default. A matching running or complete reader job is
reused. If just 6 of 44 sections are ready, conversion waits for all 44; it does
not fetch partial audio or admit a duplicate job. In-flight job creation is also
allowed to finish before deciding whether an existing job can be reused. The downloaded file includes every part; no ZIP, playlist or VTT file
is required. The title card shows the site name and UTC conversion time.
A plain click on the MP4 link displays native browser controls with an internally attached
WebVTT track for reliable browser captions; that track is not a separate user
download. The same anchor points directly at the MP4 Blob for Save link as or
modified clicks. The generated file is kept until Clear, a new download, or
tab closure; it is not regenerated just by opening/saving the link.

The video remains a local Blob in the tab. It is not uploaded or published as a
remote URL; Open video does not force the OS to launch an external application.
Automatic file handoff depends on device settings. Roger reports successful
desktop playback with subtitles. Mobile/Infuse and lock-screen acceptance remain
real-device tests.

## Safety and lifecycle

Speech uses the existing account credit, admission, reservations, authorization,
and durable preparation system. Video encoding adds no provider call. IDs are
saved in sessionStorage before POST and reconciled after uncertain replies.
Checking or retrying conversion never creates replacement speech jobs. Terminal
failed/cancelled/expired jobs are not automatically synthesized again. Completed
audio remains retained if later parts fail. Cancellation stops scheduling
and conversion; an already admitted audio job finishes and is reused on retry.
Cancelling a download never cancels a borrowed reader job. Clear removes
the active video's audio jobs and local result. Older explicitly replaced video
preparations retain the existing service 24-hour expiry.

Preparation snapshots text and voice, so editing during work cannot change the
submitted document. The UI warns when a prepared result differs from the editor.
Keep the tab open for orchestration/conversion; a reload requires re-pasting the
same text/voice/split setting to reconcile saved job IDs. Session storage contains
IDs/status, not source text. It must be writable before new job admission.

The browser concatenates the validated header-free MP3 exports, rebases each
VTT cue using exact prepared durations, and encodes once. It preserves existing
WaveNet timing/padding rather than adding per-part AAC encoder delays. A 1 fps
static video keeps encoding inexpensive; the last video frame can extend the
container by less than one second beyond the audio. Browser memory/storage and
FFmpeg WebAssembly limits still apply; no infinite-size claim is made.

Single-thread FFmpeg needs no cross-origin isolation. Assets stay on this origin;
the WASM binary is transported in 8 MiB segments to fit Cloudflare Assets limits.
Only enabled deployments permit WebAssembly compilation and blob fetches. Disabled builds omit the feature, encoder assets, and source archives.

Dependencies: @ffmpeg/ffmpeg 0.12.15 (MIT) and @ffmpeg/core 0.12.10
(GPL-2.0-or-later), unmodified, from https://github.com/ffmpegwasm/ffmpeg.wasm.
Enabled builds include an Open-source licenses footer link, local GPL/MIT texts,
and 18 locally served pinned source archives (about 53 MiB total). sources.json
records upstream revisions and hashes; SOURCE-NOTES.txt describes provenance,
build steps, packaging and test-only submodule exclusions. The build checks
installed package versions and every archive checksum. Missing archives are
retrieved from immutable upstream URLs into ignored work/encoder-sources.
Harfbuzz is recompressed losslessly from gzip to xz to fit the hosting file limit;
rebuilding an empty cache requires xz. The release manifest verifies all source
archives alongside executable assets. This is source matching to the upstream
release recipe; a byte-identical encoder rebuild is not claimed.


## Checks

- `node --test tests/video-download.test.js`: paragraph/Unicode boundaries,
  provider validation, caption offsets, uncertain creation and cancellation.
- `node scripts/video-download/check.mjs`: actual Chrome/WASM conversion with
  intercepted speech APIs and cached real audio; no paid provider requests.
- Set `VIDEO_STAGING_ORIGIN=https://staging.pastetospeech.com` for the same
  browser check against hosted assets and real CSP. Speech APIs stay intercepted.
- `npm run release:reader:staging`: all unit tests, both builds, existing browser
  parity checks, and staging Worker dry run.

The conversion check creates two audio jobs totaling 110.88 seconds, verifies
one H.264/AAC/mov_text file with 60 captions, plays and seeks the browser preview,
and saves the real link repeatedly without another speech request. A second
case starts a 44-section reader job, holds it at six ready sections, clicks
Download, verifies no duplicate admission/partial download/encoder load, then
releases all 44 and verifies the complete audio duration and all 44 subtitles. Ignored local evidence is
under `work/video-download`, including joined.mp4, title.png and verification.json.

## Mobile buffer recovery (September 24)

Roger confirmed that an early Download click waited for all audio on mobile;
MP4 playback worked in Podcast Addict, MPV and VLC, and the inline browser
preview displayed subtitles. Podcast Addict subtitles were limited; external
players may require their audio/background-playback setting. These are device
observations, not a claim of universal player compatibility.

The staging reader now keeps about 90 seconds ahead and 20 seconds behind the
playhead, instead of appending the entire reading into MSE. On quota pressure it
reduces the ahead window and releases played audio more aggressively. Seeking
outside the window reloads existing prepared sections at their original sample
positions; it does not synthesize again. If even the first section cannot fit,
the same job switches to native completed-file playback. Server preparation and
the complete MP4 download remain independent of the playback window. This is a
playback-buffer bound, not a total browser-memory bound: MP4 generation still
assembles the whole recording locally.

`node scripts/video-download/check-buffer.mjs` uses real Chrome MSE with cached
fixture bytes and intercepted APIs. It checks eviction, backward/forward seek,
seek after end-of-stream, injected quota recovery, and same-job native fallback.
The existing video check covers full download completion and captions. Run the
buffer check against staging with `VIDEO_STAGING_ORIGIN` as for the video check.
Physical-phone confirmation of this buffer fix is still needed.

## September 24 reader acceptance and compact controls

Roger reports phone playback working; one non-reproducible glitch cleared on
reload, and a separate failure was an expired staging Cloudflare Access session.
He reports no player-experience blocker to promotion.

Normal hosted playback chooses progressive automatically when supported; the
manual full-preparation selector is confined to staging testing mode. Automatic
unsupported-browser and buffer-pressure recovery remain. The hosted reader now
places playback before voice settings, reduces mobile header spacing, and moves
reader help into the footer. MP4 title and comment metadata identify Paste to
Speech and its URL as the creation tool, without claiming authorship of input.
These latest changes are local pending release, not a production deployment.

## Independent long readings and production promotion (September 24)

LONG_READINGS now selects splitting, bounded buffering and PDF limits independently
of VIDEO_DOWNLOAD. With video disabled, a long logical reading joins MP3 and VTT
exports on request, reusing prepared parts and preserving caption offsets. No
server endpoint is fabricated for a tab-local logical reading ID.

The production browser check is scripts/video-download/check-long-production.mjs.
It uses cached audio and intercepted APIs, verifies 21,347 characters across two
jobs, early playback, cross-part seeking and a complete download with 43 cues.
It passed with MP4 disabled (joined MP3/VTT), then tests MP4 when enabled, including
project metadata, duration, subtitles and exactly two admissions. It never calls
a provider. Production keeps owner-only eligibility, the existing speech budget,
and ENABLE_PAYMENTS=0. No ledger migration or grant is part of this release.

## Voice choices and flat settings (September 24)

Hosted WaveNet now accepts US/UK male D as well as the original female F voices;
the server validation, Google adapter, reader discovery and export validation
share the expanded choices. Mocked synthesis verifies voice/locale forwarding;
no paid audition was performed. The workstation-only menu keeps its old choices.
Voice, Download recording and Clean up before reading are separate peer sections
below playback. The filename link supplies the desired MP4 name; the browser's
own Blob-video download menu can still use its generated identifier.
