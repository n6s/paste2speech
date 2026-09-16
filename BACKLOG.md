# Queued improvements

After the background-playback upgrade, in order:

1. Expandable reading preview: allow manual expansion or automatic growth to show the paragraph being followed. Choose the interaction when planning this feature.
2. Collapsed PDF import: put Open PDF and its help text in a section collapsed by default.
3. Preview-sized sections for long paragraphs: split paragraphs that would fill multiple screens into smaller readable sections that fit the existing preview window. Consider this alongside expansion/auto-growth when planning the preview interaction; preserve reading order, follow-reading highlights, and tap-to-read navigation.

## Background playback device acceptance — partially verified

Roger reported on 2026-09-16 that a long newsletter played on his Pixel with the screen off and finished naturally with five seconds remaining on a ten-minute countdown (approximately 9 minutes 55 seconds). This verifies screen-off playback through completion for that reading; it is just short of the planned ten-minute duration.

Roger also confirmed that switching apps during prepared playback caused no audio interruption, and returning to the reader showed the correct currently playing section highlighted. App switching and preview synchronization passed.

Roger confirmed that lock-screen media controls appeared and playback responded correctly. Lock-screen pause/resume passed.

Roger confirmed that after disconnecting Tailscale, prepared playback continued uninterrupted and pause/resume still worked. Playback without the workstation connection passed.

Earbud check: pause worked, but resume did not. This is an open playback-control defect; the cause is not yet established. No backward/forward buttons appeared in the Pixel media player or lock screen, so device seeking could not be tested. After earbud resume failed, lock-screen Play successfully resumed without opening the reader. The same earbuds successfully pause/resume Podcast Addict. This narrows investigation to the reader/browser media-control path, but does not distinguish application code from browser/Android behavior. Next comparison: test Google's Media Session audio sample in the same Pixel browser and screen state.

Remaining checks on Roger's Pixel:

- Play a prepared reading for at least ten minutes with the screen locked.
- Diagnose and fix earbud resume, then repeat headphone pause/resume testing.
- Verify seeking if the device exposes seek controls; none were shown in this test.

Do not mark background playback device-verified until these checks pass.
