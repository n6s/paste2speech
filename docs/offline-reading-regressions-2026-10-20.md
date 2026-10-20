# Offline reading navigation and voice corrections

Staging baseline cf1c75a; production remains 300e1ca. No retention-policy change.
No existing real duplicate readings are merged or purged by this correction.

Confirmed causes and corrections:

- Opening a saved Natural reading awaited verification of every stored section
  while Previous/Next were disabled. Restore now uses the verified manifest;
  whole-reading audio verification continues in the background. Each section is
  still verified before playback. A stalled distant section no longer blocks
  reading navigation or the already available prefix.
- A missing saved browser voice threw before text/bookmark restoration, blocking
  navigation through that entry. It now opens paused in browser mode with Device
  default selected and an actionable available-voice notice. It never autoplays
  or falls back to paid Natural synthesis. An explicit available-voice choice is
  kept on that logical reading without resetting a newly selected speed.
- Restoring a saved Natural engine overwrote an explicit current-tab browser
  choice. Playback engine is now separate from prepared-audio identity; native
  and Natural positions survive switching. Natural H/D remain distinct provider-
  qualified choices. Device default's empty identifier is a valid browser choice.
- During engine changes, Natural-player callbacks could be captured as browser
  readings. Only the actual native Player can enter native autosaving.
- Reading identity previously followed the audio provider/voice cache key.
  Explicit conversion now carries the selected logical reading ID and original
  added time into its new audio preparation. It borrows matching live/restored
  paid audio where available without another admission. It does not compare or
  merge arbitrary existing entries by text. Old duplicates remain intact.
- Bookmark journals retain both native and Natural positions, record current
  playback mode, and reject stale selection writes. Whole-book hydration is not
  required for text navigation, and unavailable is not classified as removed.

Maintained tests include slow blocked hydration offline, complete cached playback
without network, browser override and return to Natural, H/D restoration, missing
native voice recovery, explicit browser-to-Natural conversion without changing
queue identity/added time, no phantom entries or extra admissions, reconnect,
existing native voice/rate/offset/account checks, MP4 reuse/protection and unchanged
24-hour expiry. All use isolated synthetic profiles and speech.

Actual Pixel/Android audible voice availability is unverified. Browser voices can
require an installed offline voice. Partial audio needs a connection for missing
sections. The existing service worker preserves an active old app during updates;
closing all reader tabs and reopening online lets a waiting app update activate.
