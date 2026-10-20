# Reading navigation and bookmark iteration

Staging baseline: bd532af. Production stays 300e1ca. This iteration is authorized
for local implementation, full release gates and staging deployment only. Deferred
cleanup-panel/button-spacing requests stay out of scope.

Implementation decisions:

- Keep native speech and prepared Natural audio separate. Record native text,
  voice URI, cleanup/rate, section and word offset; never generate Natural audio
  as a fallback. Missing native voices require an explicit replacement choice.
- Show Previous reading / Reading N of M / Next reading only for multiple readings,
  distinct from section controls. Retain reading history alongside pending queue
  intents. Switching restores paused, flushes the old position immediately and
  preserves unfinished preparation. Normal queue completion may keep its existing
  automatic progression. Explicit navigation must not silently regenerate audio.
- Account-scoped bookmarks; free signed-out native playback must never require an
  account or credit check. Anonymous native history uses a separate local-profile
  scope; observing sign-in/out never merges histories or exposes old-account data.
  Automatic startup restoration respects the selected engine and never switches a
  browser-voice preference to Natural.
- Keep the 512 MiB shared source-audio safeguard and 20 bookmarks/account. Under
  pressure, reclaim only audio explicitly marked Finished, with completed original
  preparation. Mark finished is tucked into management; reaching/seeking the last
  section alone never authorizes reclamation. Legacy records are unfinished.
  Text, voice, options and bookmarks survive audio reclamation.
- Current readings, background preparation/downloads and exports hold shared Web
  Locks. Reclamation requires an available exclusive lock. Unsupported Web Locks
  disable automatic cleanup conservatively. No timer-based guess that a suspended
  mobile tab is inactive. Actual cross-tab browser tests are required.
- Reclaimed audio is visibly missing: opening may retrieve original unexpired jobs
  online, but never buys replacement synthesis. Expired audio requires explicit,
  priced regeneration. All-protected and oversized cases keep online playback and
  explain that offline saving is incomplete. Browser quota and application budget
  errors have different messages.
- Deliberate removal remains durable across tabs; a visible management action may
  explicitly keep the current reading again, with a new generation. Retry alone
  must not undo removal intent.

Current local checkpoint:

- Reading navigation, native text/voice/section/word-offset bookmarks and immediate
  switch journals are integrated. Manual navigation loads paused; queued snapshots
  keep engine/voice/rate. Startup restoration filters by selected engine.
- Schema 4 adds independent signed lifecycle state. Position journals reject stale
  timestamps. Reclamation removes audio atomically while keeping text/place, and
  explicit re-keep can override a deliberate removal with a new generation.
- Shared locks now protect selected readings, source downloads and MP4 encoding.
  Pressure handling considers only explicitly Finished, fully prepared audio, and
  leaves protected/unfinished data alone. Existing records are never assumed done.
- Input switches preserve the original Natural preparation. Background manifests
  track later admissions independently of the editor. Returning within the same
  tab reuses a matching live preparation rather than losing later part IDs.
- Passed: 626 unit tests; actual cross-tab IndexedDB/Web Locks lifecycle test;
  two native readings with offline switching/reload and queued voice/rate; existing
  74 MB storage tests and Natural offline/reload/MP4/interruption browser tests.
  All browser APIs are synthetic except actual local storage/media/encoder engines;
  no real private reading or paid provider was used.

Mandatory remaining checks before any staging release:

1. Add a full two-Natural-reading UI test, including switching during multipart
   preparation and returning after later part IDs were admitted. Test pressure in
   the actual coordinator, all-protected/export cases, audio-only reclamation,
   missing-audio re-download and explicit re-keep. The existing lifecycle test
   proves transactions and real cross-tab locks, not this whole UI path.
2. Cover native startup when a Natural bookmark also exists; signed-out/native
   account transitions; missing native voices; mixed-engine round trips.
3. Review cold reload of a multipart reading with truly unadmitted suffix parts:
   current readonly restoration never creates those parts. It may need an explicit
   Continue preparation action that reconciles session-cached IDs and reuses all
   completed audio, never silent regeneration. This is not implemented yet.
4. Run all maintained browser/release gates on one clean commit, verify public
   forced-off behavior and installed extension hashes, then deploy only staging
   through the established workflow and verify hosted hashes/flags/smoke.

Staging is still bd532af; production is still 300e1ca. This local iteration has
not been deployed. Deferred cleanup-panel/button-spacing work remains untouched.
