# Shared device audio — local staging candidate, October 20, 2026

This is a separate local candidate after production release 300e1ca. Neither
staging nor production has been deployed for this phase. Full staging release
preparation remains required before deployment approval. Physical Pixel QA is not
available. The staged feature switch is `PERSISTENT_AUDIO=1`; public and historical
trial builds force it off. No backend, payment, credit or retention change exists.

## User behavior and lifecycle

Normal playback keeps its existing behavior until the user chooses **Offline
readings on this device → Save this reading offline**. The action becomes
available once speech preparation is complete; it saves already-prepared audio,
not new speech. It stores the editor text, cleanup settings, voice and listening
place, then the verified source sections and offline reader/MP4 tools. One shared
section store supplies playback, arbitrary seeks and the existing MP4 encoder.
Downloading can resume missing sections after reconnect/reload without another
speech admission. Missing source audio can still become unavailable when the
original server jobs expire; locally completed copies do not extend server
retention and remain until explicit removal or browser/site-data deletion.

The saved list explicitly opens text and place without autoplay. Press Play to
listen; opening a saved copy cannot create new speech. Clear, voice changes and
RAM eviction do not delete saved copies. Remove from device atomically removes
the selected manifest/place and audio jobs not shared by another saved reading.
Late metadata/audio writes are invalidated so they cannot resurrect a removed
copy. Static offline app files remain browser-managed separately.

Saving is opt-in because this introduces local retention of private reading text.
The disclosure explains browser removal and shared-browser-profile access while
offline. Persistent storage is requested, not assumed; denial retains best-effort
storage with a clear warning. No text/audio is uploaded by saving; only existing
prepared audio is retrieved. Online account scope is confirmed through the
existing OCR capability endpoint, with direct owner-checked status reads if a
reading predates local scope confirmation. A verified account change/sign-out
stops old playback and switches the library without deleting the previous
account's disk data. Offline reopening uses only the last locally consented
profile scope. This is not encrypted protection from someone controlling the
same browser profile. API responses, credentials and billing pages are never
cached in the offline shell.

## Implementation

`DeviceAudioStore` uses account-scoped IndexedDB keys, SHA-256 manifest receipts,
atomic section writes and atomic reference-aware removal. Positions are small
separate journals, avoiding copying/hashing a whole book on every timeupdate.
`PersistentReadingAssets` preserves the existing unsaved path, keeps section
metadata separately from an 8 MiB audio RAM LRU, prioritizes requested sections,
and validates stored MP3 byte/sample/digest identity. Evicting RAM never evicts
saved disk audio. Storage estimates are advisory disk quota, not free RAM;
quota/blocked/interrupted writes preserve online playback and never claim that
an incomplete copy is offline-ready. Scope, abort and removal guards apply
across asynchronous writes.

The opt-in service worker saves a build-specific, SHA-256 checked static allowlist.
Offline readiness requires saved sections, reading metadata and a complete
verified app shell. It never caches account/API responses or redirects, never
intercepts other origins, and does not delete previous app-shell versions or user
readings automatically. Old shell versions may consume storage until site data is
cleared; automatic version cleanup needs a compatibility policy before expansion.

The existing MP4 codec/encoder path is unchanged: H.264/AAC/mov_text output still
assembles the complete recording in WebAssembly memory. Disk-backed audio does
not remove that independent export-memory limitation. Full-file playback and
encoder/in-flight buffers also consume memory beyond the bounded source-audio
working cache. No arbitrary percentage of device RAM is used.

## Completed local checks

- Real isolated Chrome IndexedDB: 74,027,520 bytes across 70 verified sections;
  70 initial audio fetches, arbitrary far seeks and reload with zero extra audio
  fetches. A 2 MiB test RAM budget stayed below its bound. Complete audio assembly
  for export reused all 74 MB from disk.
- Quota failure, actual aborted IndexedDB transaction, blocked storage, missing-only
  resumed downloads, account switch during conversion and in-flight fetch, corrupt
  manifest, shared-reference removal, and explicit final-copy deletion.
- Built staging reader with real service worker, MSE and MP4 encoder: offline app
  reload, text/voice/place recovery, rapid previous/next controls, and offline
  H.264/AAC/mov_text export reused the same 61 source sections with zero additional
  speech posts or section GETs. Account switching paused/hid old audio; explicit
  removal remained removed after offline reload. Mobile widths 320/390/780 fit.
- All 621 existing JavaScript tests passed against this candidate.

Evidence is ignored under `work/persistent-audio/`, plus the two top-level
`work/persistent-audio-*-test.log` logs. Both new browser checks are included in
staging release preparation when the feature switch is enabled.

## Remaining before readiness/deployment

Run the full prescribed `npm run release:reader:staging` preparation (without
`--deploy`), including existing parity/recovery/OCR/queue checks and Worker dry run.
Check a public build remains flag-off and has no service-worker asset or device
controls. Review slow/failed app-shell saves and lifecycle behavior again. Do not
claim hardware Pixel QA, automatic Android background completion, unlimited device
storage, or successful long-document MP4 encoding. Confirm hosted production and
installed extension hashes remain unchanged. Only then report a deployable staging
candidate; staging deployment itself requires the next approval.
