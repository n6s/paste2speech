# Paste to Speech

A small, mobile-friendly reading page for a Pixel, served from a Linux workstation over Tailscale. Plain HTML, CSS and JavaScript; no build step, CDN, API key, analytics or server-side application.

## Try it locally

```sh
cd ~/workarea/paste2speech
python3 -m http.server 8765 --bind 127.0.0.1 --directory public
```

Open **http://127.0.0.1:8765** in a browser. Keep that terminal running; Ctrl+C stops it. Python only serves static files. Any static web server can replace it.

Paste text, review **Preview what will be read**, choose a voice and speed, and tap **Play**. Use **Pause** to save your place and **Play / Resume** to continue. **Stop** returns to the beginning. Editing text or cleanup options stops playback; changing voice or speed pauses it so Resume uses the new settings.

## Use it from your Pixel over Tailscale

1. Connect both workstation and Pixel to your Tailscale network. Keep the local server above running and the workstation awake.
2. Inspect your existing routes:
   ```sh
   tailscale serve status
   ```
   At setup time this workstation already served another app on HTTPS port 443. Use a separate port for Paste to Speech:
   ```sh
   tailscale serve --bg --https=8443 http://127.0.0.1:8765
   ```
   If Tailscale asks you to enable HTTPS/Serve, follow the account setup link it prints. If it reports a permissions error, run the same Serve command with `sudo`. If port 8443 is already assigned to another app, choose a free HTTPS port instead.
3. Open the HTTPS URL printed by that command on your Pixel, including **:8443**. On this workstation the expected URL is **https://pop-os.tailbd091c.ts.net:8443/**; use the actual printed address if it differs. Bookmark it or add it to your home screen in Chrome.
4. Paste a long answer and test Play → Pause → Resume → Stop. Try a few voices: they depend on the Pixel’s installed speech services.

Serve is private to devices/users allowed by your tailnet policy. No Funnel or router port forwarding is needed. This repo's setup does not change any Tailscale routes automatically.

`--bg` keeps the Tailscale route configured, but does **not** keep Python running or start it after reboot. For the initial version, restart the local server when needed. To remove only this app's route:

```sh
tailscale serve --https=8443 off
```

Avoid `tailscale serve reset`, which would remove your other app's configuration too.

## Reading behavior and limits

- Sends one short chunk at a time (up to 180 UTF-16 code units), preferring sentence boundaries and spaces. Keeps a strong reference to the active utterance and ignores stale callbacks after cancellation.
- Pause cancels the utterance and retains the last reported word boundary. Resume repeats that word; voices without boundary events repeat the current chunk. This avoids relying on Android's inconsistent native pause/resume behavior.
- A stalled or failed voice leaves the current position available for retry. It never automatically skips an unread chunk. A timeout can also occur with an unusually slow voice.
- Keep the tab visible and the phone awake. Mobile browsers may suspend speech on screen lock, backgrounding, calls, or power saving. This is not a background audio player and chunking cannot guarantee every voice engine behaves correctly.
- Default cleanup removes Markdown formatting, ChatGPT citation tokens, URLs, fenced/indented code blocks and Markdown tables. Emoji removal is optional. Inline code stays readable. Cleanup is a best-effort text filter, not a full Markdown parser; inspect the preview for unusual formatting. Turn off “Markdown formatting” as well as “Code blocks” to preserve literal code formatting.
- Only preferences are saved in browser local storage; pasted text is neither persisted nor sent to the workstation. The browser/OS speech provider may process text online for some voices. Choose a voice labeled “on-device” when desired; available voices vary by device.
- Loading the page requires the workstation and Tailscale connection. There is no offline cache or service worker in this initial version.

## Tests

No packages are needed for core tests (Node.js 20+):

```sh
npm test
```

Optional browser checks use Playwright and an installed Chrome. With the local server running:

```sh
npm install --no-save --package-lock=false playwright
node tests/browser.mjs
```

Set `CHROME_PATH` if Chrome is somewhere other than `/usr/bin/google-chrome`. Screenshots are written to `work/`. The browser test mocks speech to deterministically check controls, progress, completion and error-independent UI behavior; it does not validate audible output on a Pixel.

## Files

- `public/`: the only directory to serve.
- `public/text.js`: cleanup and chunking.
- `public/player.js`: cancellable playback state machine.
- `public/app.js`: page controls, voice discovery and preferences.
- `tests/`: text, state-machine and browser tests.

## References

- [Tailscale Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Browser speech synthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
- [Speech pause and browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/pause)
