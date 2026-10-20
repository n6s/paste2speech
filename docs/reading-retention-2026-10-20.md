# Ephemeral reading queue

This supersedes the indefinite library and manual Finished design. Staging only;
production remains on its separately approved release.

- Unfinished readings (never started or partly heard) expire 24 hours after the
  original added time. Playback, seeks, reloads and bookmark writes never renew it.
  Pending queued intents carry that same original timestamp into preparation.
- A real final playback completion marks Finished. Merely seeking to the final
  section does not. Keep the current completed reading until moving to another;
  reopening that same reading is not moving on.
- Remove device audio, text, bookmark and local queue intent, with durable deletion
  markers preventing stale tabs/background writes from resurrecting them. Preserve
  editor text, original files, external MP4 downloads and backend jobs. Explicit
  playback of expired Natural text requires confirmation before new credit use.
- Shared Web Locks protect active playback, source downloads and MP4 export.
  Cleanup acquires an exclusive lock and rechecks the record and playback before
  its atomic deletion. A paused expired tab releases its selection lock. Cleanup
  runs at a safe opportunity (including focus/reconnect and a 30-second check),
  not while a tab is suspended. Unsupported Web Locks conservatively defer cleanup.
- Existing original creation times are retained. An old record with no reliable
  creation time receives one fixed 24-hour migration grace period, written once.
- A monotonic elapsed clock and persisted observed high-water time prevent ordinary
  backward clock changes from renewing a lifetime. Offline clients cannot establish
  trusted real time across device-clock tampering; a forward clock change can make
  an inactive reading expire early. Active playback/export stays protected.
- The UI has compact Previous / Reading N of M / Next navigation and a brief
  retention/MP4 note. There is no library list, per-entry management or Save/Open
  workflow. Retry appears only after an actionable offline-saving error.

Tests use isolated synthetic profiles and speech. No real user's saved reading is
purged by test tools. Source-audio storage and normal online playback retain their
existing safeguards; MP4 encoder memory requirements are unchanged.
