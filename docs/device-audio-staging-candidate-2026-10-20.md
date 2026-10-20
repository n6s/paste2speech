# Shared device audio — local staging candidate, October 20, 2026

This is a separate local candidate after production release 300e1ca. Neither
staging nor production is deployed by preparation. Full staging release
preparation must pass again after this automatic-saving refinement before deployment approval; current evidence is recorded
under `work/persistent-audio/`. Physical Pixel QA is not
available. The staged feature switch is `PERSISTENT_AUDIO=1`; public and historical
trial builds force it off. No backend, payment, credit or retention change exists. Clear of a restored local
reading/export never deletes server jobs. Play remains disabled until a verified
Open completes; stale Open operations cannot replace a newer selection or edit.

## User behavior and lifecycle

During Google speech preparation/playback, the reader automatically keeps text,
voice, settings, listening place and each verified source section in this browser.
Playback never awaits an audio disk write. One shared section store supplies
playback, arbitrary seeks and the existing MP4 encoder. The latest reading and
place reopen automatically without autoplay or a Save/Open action. Other copies
and removal are available in a collapsed **Offline storage** panel, alongside an
automatic-saving preference and retry control.

Partially downloaded readings reopen too: retained sections can play offline;
missing sections need a connection. Reconnect polls only already-admitted job IDs
and downloads missing audio, never starts new synthesis or automatically admits
unprepared parts. Missing source audio can become unavailable when original
server jobs expire. Completed copies do not extend server retention.

Automatic storage stops at 20 readings per account or a transactional 512 MiB
source-audio budget shared across accounts on this origin. A schema-3 usage ledger
counts replacement writes atomically and recounts preserved data after removal
or migration. Limits preserve existing copies and online playback; nothing is
automatically erased. Static app files and text consume additional browser quota.

The management list also opens older text and place without autoplay. Press Play to
listen; opening a saved copy cannot create new speech. Clear, voice changes and
RAM eviction do not delete saved copies. Remove from device atomically removes
the selected manifest/place and audio jobs not shared by another saved reading.
Late metadata/audio writes are invalidated so they cannot resurrect a removed
copy, including writes from another tab. Small opaque deletion markers remain
locally until site data is cleared; they contain no reading text or audio. Automatic saving respects durable reading tombstones as well as audio-job
tombstones, including newly admitted parts absent from the removed manifest. Retry
does not erase deletion intent. Corrupt records are isolated from other books and can still be removed. Static offline app files remain browser-managed separately.

Automatic retention is disclosed in the collapsed storage panel and can be disabled
across tabs without deleting existing copies. The disclosure explains browser
removal and shared-profile access offline. Browser persistence is checked, never
assumed; best-effort storage carries a clear warning. No text/audio is uploaded by
saving; only existing prepared audio is retrieved. Online account scope is confirmed through the
existing OCR capability endpoint, with direct owner-checked status reads if a
reading predates local scope confirmation. A verified account change/sign-out
stops old playback and switches the library without deleting the previous
account's disk data. Offline reopening uses only the last locally verified
profile scope. This is not encrypted protection from someone controlling the
same browser profile. API responses, credentials and billing pages are never
cached in the offline shell.

## Implementation

`DeviceAudioStore` schema 3 adds deletion, reference and usage journals when upgrading earlier
versions, preserving saved records. It uses account-scoped IndexedDB keys, SHA-256 manifest receipts,
atomic section writes and atomic reference-aware removal. Positions are small
separate journals, avoiding copying/hashing a whole book on every timeupdate.
`PersistentReadingAssets` preserves the existing unsaved path, keeps section
metadata separately from an 8 MiB audio RAM LRU, prioritizes requested sections,
and validates stored MP3 byte/sample/digest identity. Evicting RAM never evicts
saved disk audio. Storage estimates are advisory disk quota, not free RAM;
quota/blocked/interrupted writes preserve online playback and never claim that
an incomplete copy is offline-ready. Scope, abort and removal guards apply
across asynchronous writes.

The automatic service worker saves a build-specific, SHA-256 checked static allowlist.
Offline readiness requires saved sections, reading metadata and a complete
verified app shell. It never caches account/API responses or redirects, never
intercepts other origins, and does not delete previous app-shell versions or user
readings automatically. Updates prepare a verified immutable shell before
installation succeeds, wait for existing clients to close, and preserve the old
worker on failure. Offline Retry does not invalidate an already-working shell.
Cached assets are hash-checked on use; readiness checks verify the whole shell. Old shell versions may consume storage until site data is
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
- Automatic incremental test: two sections saved while the server still prepares
  later audio; offline reload restores without autoplay, retained prefix plays,
  reconnect completes existing IDs with no extra speech admission.
- Automatic tombstones, parent-generation/reference guards for newly admitted
  parts, 20-reading bound and transactional 512 MiB budget; a delayed write cannot
  hold foreground audio or claim offline-ready.
- All 621 existing JavaScript tests passed; full release preparation reruns them.

Evidence is ignored under `work/persistent-audio/`, plus the two top-level
`work/persistent-audio-*-test.log` logs. The store, UI and service-worker lifecycle browser checks are included in
staging release preparation when the feature switch is enabled.

## Release gates and operational limits

Run the full prescribed `npm run release:reader:staging` preparation (without
`--deploy`), including existing parity/recovery/OCR/queue checks and Worker dry run.
Check a public build remains flag-off and has no service-worker asset or device
controls. Review slow/failed app-shell saves and lifecycle behavior again. Do not
claim hardware Pixel QA, automatic Android background completion, unlimited device
storage, or successful long-document MP4 encoding. Confirm hosted production and
installed extension hashes remain unchanged. Only then report a deployable staging
candidate; staging deployment itself requires the next approval.
