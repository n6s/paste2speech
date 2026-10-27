# Unfinished listening playlist (staging)

The staging-only PODCAST_PLAYLIST flag gives the temporary playlist explicit membership independent of retained audio manifests. Production forces this flag off.

Next preserves the skipped entry and bookmark. Natural completion, Mark as read, or a deliberate seek to the end during active playback removes membership, including the final entry. Forward completion stops at the traversal endpoint; it never wraps to skipped entries. Previous from that endpoint can reach an earlier unfinished entry. The one remaining queued entry stays reachable until actual playback starts, then the playlist and reading navigation hide. Waiting or failed starts stay visible. Reload restores paused.

Membership uses the account-scoped podcast-playlist journal; legacy temporary-playlist records are preserved. Initial migration includes unfinished records, excludes finished records, and does not autoplay. Cache records use playedAt rather than legacy finishedAt, separating membership retirement from physical expiry. The existing original-added 24-hour retention and active-tab/export protections remain. Re-paste starts a new logical entry at zero and can reuse verified same-account audio matching the actual speech parts and voice, without extending its original expiry.

Clear remains the existing editor/pending-intake action. This change adds no workspace-clear or Undo feature. Existing queued-item undo is unchanged.

Validation uses isolated synthetic accounts, mocked provider admission and fixture audio. It includes the skipped Verdict/two Coast episodes sequence, endpoint Previous, single-item actual-start visibility, stale completion callbacks, native and prepared audio, partial saved audio, cached replay, reload, failed intake, account isolation and 320/390/1100px layouts. Physical Pixel/audible provider testing is separate.

Rollback to the prior application preserves audio and journals. Older code may display retained manifests using its old membership rules; it does not understand the new journal. Already open tabs need a refresh to adopt the new behavior.
