# Single temporary playlist staging correction

The playlist above the player and Previous/Next use the same ordered logical
reading IDs. Existing retained entries migrate visibly without merging same-text
readings. Starting an item replaces its pending intent with its reading metadata
under the same ID; audio job/cache identities remain independent.

Paste & Play replaces membership only after usable intake succeeds. Explicit
Next/End preserves membership. Removing/replacing retires membership durably;
physical cleanup continues to respect playback/export locks in every tab.
Unfinished entries retain the original fixed 24-hour clock. Actual completion
plus moving away retires the finished entry. Existing 20-entry and 512 MiB guards
remain; protected retired sources do not consume a replacement's entry slot.
The audio byte budget still counts all actual stored source data.

Pending text and ordering use scoped, checksummed IndexedDB metadata with
serialized cross-tab mutations. Pending file processing interrupted by reload
can be recovered by reopening the file through existing saved OCR recovery;
no paid operation automatically restarts. Browser voices have no audio
pre-generation path. Queued WaveNet preparation still starts at its turn.
Current-entry metadata registration never generates speech.

The mobile action row keeps Open file, Clear and Paste & Play together. File
processing information is in the file menu. Text cleanup is a native disclosure,
initially collapsed on mobile, without replacing its existing inputs/settings.

Maintained tests cover logical-ID ordering, stale peer updates, handoff races,
replacement success/failure, duplicate intents, offline navigation/bookmarks,
reload without autoplay, completion and active cross-tab replacement, large
storage limits and protected replacement metadata. Synthetic browser journeys
include 320/360/412 px primary controls, cleanup keyboard/settings persistence,
7/20 populated entries and desktop/mobile screenshots. No real readings are
purged, paid speech generated, purchases made or active user tabs accessed.
Physical Pixel audio and airplane-mode behavior remain device QA.

The playlist presentation and reading navigation are hidden with fewer than two
logical entries, including queued text still preparing. Adding a second entry
reveals the same ordered playlist; returning to one hides it again. Ordinary Play
can start a lone ready queued entry without showing a separate queue control or
automatically generating audio. Current reading/offline status remains visible.
