# Queued improvements

After the background-playback upgrade, in order:

1. Expandable reading preview: allow manual expansion or automatic growth to show the paragraph being followed. Choose the interaction when planning this feature.
2. Collapsed PDF import: put Open PDF and its help text in a section collapsed by default.
3. Preview-sized sections for long paragraphs: split paragraphs that would fill multiple screens into smaller readable sections that fit the existing preview window. Consider this alongside expansion/auto-growth when planning the preview interaction; preserve reading order, follow-reading highlights, and tap-to-read navigation.

## Background playback device acceptance — pending

Desktop automation does not verify Android background playback. On Roger's Pixel:

- Play a prepared reading for at least ten minutes with the screen locked.
- Switch apps and return; confirm uninterrupted audio and accurate paragraph highlighting.
- Exercise lock-screen/headphone pause, resume, and available seek controls.
- Disconnect Tailscale after preparation and confirm playback continues.

Do not mark background playback device-verified until these checks pass.
