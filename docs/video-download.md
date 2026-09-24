# Joined video downloads

This feature lives on the shared reader branch. `VIDEO_DOWNLOAD=1` enables the
UI, local FFmpeg assets and WebAssembly CSP permission. Staging enables it;
production has not been enabled or deployed. Promotion can use the same source
and enable that variable through the normal shared release workflow.

## Use

Choose WaveNet, paste text or import a PDF, and expand **Download recording**.
**Prepare audio for video** makes bounded WaveNet jobs sequentially, preferring
paragraph boundaries. Oversized paragraphs fall back to the existing sentence,
phrase and word splitter. There is no document-length or part-count ceiling in
this path. All service requests remain at most 20,000 UTF-16 characters and
individual speech chunks at most 500 characters (under the service byte limit).
Staging defaults internally to 1,200 characters to exercise splitting. The
split-size selector appears only in `/?testing=1`; production defaults to 20,000.
PDF import with this feature enabled has no fixed file/text-size cutoff or
40-second timer; user cancellation and the device remain the constraints.

After audio is ready, **Download video** loads the approximately 31 MB encoder
on this device and produces one MP4: H.264 title card, AAC audio, mov_text
subtitles marked English/default. Existing matching complete reader audio is
reused. The downloaded file includes every part; no ZIP, playlist or VTT file
is required. The title card shows the site name and UTC conversion time.
**Open video** displays native browser controls with an internally attached
WebVTT track for reliable browser captions; that track is not a separate user
download. **Save MP4** provides the same file for an external player.

The video remains a local Blob in the tab. It is not uploaded or published as a
remote URL; Open video does not force the OS to launch an external application.
Automatic file handoff depends on device settings. Native VLC/mpv/Infuse and
mobile-device listening/lock-screen acceptance remain user tests.

## Safety and lifecycle

Speech uses the existing account credit, admission, reservations, authorization,
and durable preparation system. Video encoding adds no provider call. IDs are
saved in sessionStorage before POST and reconciled after uncertain replies.
Checking or retrying conversion never creates replacement speech jobs. Terminal
failed/cancelled/expired jobs are not automatically synthesized again. Completed
part audio stays accessible if later parts fail. Cancellation stops scheduling
and cancels unfinished jobs, including late POST acknowledgement. Clear removes
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
Only enabled deployments permit WebAssembly compilation and blob fetches. The
production build omits this feature and its encoder assets until enabled.

Dependencies: @ffmpeg/ffmpeg 0.12.15 (MIT) and @ffmpeg/core 0.12.10
(GPL-2.0-or-later), unmodified, from https://github.com/ffmpegwasm/ffmpeg.wasm.
Upstream source/build recipes and licensing must accompany any broader release.

## Checks

- `node --test tests/video-download.test.js`: paragraph/Unicode boundaries,
  provider validation, caption offsets, uncertain creation and cancellation.
- `node scripts/video-download/check.mjs`: actual Chrome/WASM conversion with
  intercepted speech APIs and cached real audio; no paid provider requests.
- Set `VIDEO_STAGING_ORIGIN=https://speak-staging.rogerpbrown.com` for the same
  browser check against hosted assets and real CSP. Speech APIs stay intercepted.
- `npm run release:reader:staging`: all unit tests, both builds, existing browser
  parity checks, and staging Worker dry run.

The conversion check creates two audio jobs totaling 110.88 seconds, verifies
one H.264/AAC/mov_text file with 60 captions, plays and seeks the browser preview,
and downloads again without another speech request. Ignored local evidence is
under `work/video-download`, including joined.mp4, title.png and verification.json.
