# Wayland recording

`~/bin/grab-wayland` links to the permanent script in this directory.
Run `grab-wayland demo.mkv`, choose Chrome or a monitor in the desktop sharing
picker, and press Ctrl+C to finish. Existing files are never overwritten.
The terminal reports optional portal logical geometry and actual capture pixels.
Wayland does not provide global window coordinates through this portal; window
capture needs no coordinates. This script selects windows or monitors, not a
freehand rectangle.

Default audio: current output monitor (computer sound) and default microphone,
stored as separate tracks, system first and mic second. Ordinary video players
usually play only one audio track; mix both in your editor for the final demo.
Use headphones to prevent the microphone picking up the generated speech again.
Use `--mic-device SOURCE` to select a specific microphone, or `--audio system`,
`--audio mic`, or `--audio none`.

`--duration 10` stops after ten seconds. `--geometry-only` selects and reports
portal geometry without recording. `--self-test` uses synthetic video/audio;
it does not verify live desktop capture.

Dependencies on Pop!_OS: python3-gi, gir1.2-gstreamer-1.0,
gstreamer1.0-pipewire, gstreamer1.0-plugins-good,
gstreamer1.0-plugins-bad, gstreamer1.0-plugins-ugly, pulseaudio-utils.
Uses the ScreenCast portal documented at
https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html

To omit title bars/tabs, use `grab-wayland --crop-top 100 demo.mkv`.
The amount is in captured pixels, removed before automatic even-dimension padding.
Adjust the number after a short test; keep it smaller than the captured height.
