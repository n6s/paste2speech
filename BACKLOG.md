# Queued improvements

After the background-playback upgrade, in order:

1. Expandable reading preview: allow manual expansion or automatic growth to show the paragraph being followed. Choose the interaction when planning this feature.
2. Collapsed PDF import: put Open PDF and its help text in a section collapsed by default.
3. Preview-sized sections for long paragraphs: split paragraphs that would fill multiple screens into smaller readable sections that fit the existing preview window. Consider this alongside expansion/auto-growth when planning the preview interaction; preserve reading order, follow-reading highlights, and tap-to-read navigation.

## Background playback device acceptance — partially verified

Roger reported on 2026-09-16 that a long newsletter played on his Pixel with the screen off and finished naturally with five seconds remaining on a ten-minute countdown (approximately 9 minutes 55 seconds). This verifies screen-off playback through completion for that reading; it is just short of the planned ten-minute duration.

Roger also confirmed that switching apps during prepared playback caused no audio interruption, and returning to the reader showed the correct currently playing section highlighted. App switching and preview synchronization passed.

Roger confirmed that lock-screen media controls appeared and playback responded correctly. Lock-screen controls passed; headphone controls and the specific availability of seek buttons were not separately reported.

Remaining checks on Roger's Pixel:

- Play a prepared reading for at least ten minutes with the screen locked.
- Exercise headphone pause/resume and confirm backward/forward seeking where available.
- Disconnect Tailscale after preparation and confirm playback continues.

Do not mark background playback device-verified until these checks pass.
