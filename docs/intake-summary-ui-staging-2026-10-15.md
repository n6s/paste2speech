# Reader interface polish — staging only

The staging reader places Open file beside Your text and retains unified Paste,
Open file and drop as intake paths. Selection never uploads, even with an old
remembered preference. The first foreground action discloses a Cloudflare upload
for verification without credits; a separate action quotes exact page credits and
Mistral before dispatch. Backend identity, bounded source-link leases and credit
settlement remain unchanged. Existing text survives failure, cancellation and
late results. A current completed scan can be loaded explicitly if editing has
continued. The Saved scans listing and global Online processing choices are gone.

Duplicate verification uses the existing account/file SHA-256/pinned model
lookup. Complete unexpired output reopens before balance/provider admission,
without a second paid acceptance. Matching currently requires the disclosed file
upload; there is no silent upload on selection or background fingerprint upload.
Processing is fixed to the existing whole-file model/options. Durable replay
validates the existing manifest representation version and model; incompatible,
missing or expired output fails closed without dispatch. New selectable OCR
options would require a separately versioned cache identity before being enabled.
No such options or migrations are introduced here. A small awaited-result fix
returns controlled failures when a cached manifest is unavailable.

Summary uses its existing Brief, Standard and Detailed backend settings. The
selector programs the single Summary action. Cost and provider remain visible;
source limits, retention and other details move behind Info. The editable result
is directly below the mode tabs in a simple bordered content box. Generation
limits remain 24,000 source UTF-8 bytes and 512 output tokens for every setting;
content is not silently shortened by this UI change. Existing prepare/accept,
refund, lost-acknowledgement and account/policy guards remain in place.

Processing and persistent failure share an in-flow location, with an accessible
warning icon, honest reason, credit outcome, optional feedback and Dismiss. Editing
or canceled pickers do not erase a failure. New attempts or Dismiss can clear it;
there is no timeout or automatic paid retry. Clipboard failures from unified Paste
use the same recovery mechanism. Keyboard focus survives unrelated status updates.

Playback shows verified source position and total divided by the selected rate.
Changing generated-audio speed changes labels and HTML audio rate without seeking,
resuming paused audio or touching internal section boundaries. Progressive totals
remain unknown while the prepared-audio duration is disclosed. Browser speech has
no reliable source duration/current-time API, so timing is unknown; its existing
utterance-based speed/resume behavior remains. No new duration estimate or paid
synthesis is requested. The section rail and seek mapping remain section based.

Playback legend/pause notes, voice/provider notes, cleanup explanations and
original-to-readable character savings are behind accessible Info controls.
Cleanup settings remain visible. Download recording is renamed Download
text-to-speech recording. A nonblocking first-visit guide gives the two copy then
Clear, Paste & Play steps, highlights the button and can be reopened with Help.
It records only that this browser saw the guide; it does not start playback.

Validation uses synthetic files, intercepted APIs and existing fixture audio.
The release gate includes the intake/Summary contract, cache identity/expiry/body
checks, clipboard/feedback, durable OCR, section seeking/timing, recovery and
existing reader parity suites. No provider purchase, payment, real OCR/speech
call, production deployment or installed extension rebuild is part of this release.
Physical Android Bluetooth/headset behavior still requires a device check.
Evidence is kept privately under work/intake-summary-polish-2026-10-15/.
