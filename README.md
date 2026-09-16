# Paste to Speech

A small, mobile-friendly reading page for a Pixel, served from a Linux workstation over Tailscale. Plain HTML, CSS and JavaScript with browser speech, plus an optional local Kokoro service for more natural voices. No frontend build step, CDN, speech API key, or analytics.

## Try it locally

```sh
cd ~/workarea/paste2speech
python3 -m http.server 8765 --bind 127.0.0.1 --directory public
```

Open **http://127.0.0.1:8765** in a browser. Keep that terminal running; Ctrl+C stops it. Python only serves static files. Any static web server can replace it.

Paste text, review **Preview what will be read**, choose **Browser voices** or **Workstation · Kokoro**, pick a voice and speed, and tap **Play**. Kokoro is available on the deployed Tailscale URL; the simple static development server only provides browser voices. Use **Pause** to save your place and **Play / Resume** to continue. **Stop** returns to the beginning. Editing text or cleanup options stops playback; changing voice or speed pauses it so Resume uses the new settings.

## Use it from your Pixel over Tailscale

Open **https://pop-os.tailbd091c.ts.net/speak/** with Tailscale connected on the Pixel. Immich remains at the hostname's root. Paste to Speech is served directly from `public/` by Tailscale; Python is only needed for local development.

The route is already configured. To recreate it:

```sh
sudo tailscale serve --bg --https=443 --set-path=/speak /home/roger/workarea/paste2speech/public
```

The workstation must be awake and connected to Tailscale. The background route persists across restarts. Only the public directory is served. The old port 8443 route has been removed.

To inspect routes:

```sh
tailscale serve status
```

To remove only Paste to Speech:

```sh
sudo tailscale serve --https=443 --set-path=/speak off
```

Do not disable all of port 443 or run `tailscale serve reset`: that would also remove Immich's route. Serve is private to devices/users allowed by your tailnet policy; no Funnel or router port forwarding is needed.

## Start at a paragraph

Paste text, then tap any paragraph in **Preview what will be read**. Reading starts at that paragraph and continues to the end. The active paragraph is highlighted. Tap another paragraph to jump there, even while playing or paused. Keyboard users can Tab to a paragraph and press Enter or Space.

Blank lines separate paragraphs. Long paragraphs still use short speech chunks internally. Pause/Resume retains your position; Stop resets to the beginning, and Replay reads the entire text. Editing text or cleanup options rebuilds the paragraphs and stops playback.

Voice and cleanup preferences are stored per browser origin. Moving from port 8443 to the default HTTPS port starts with fresh preferences; choose your preferred voice again.

## Reading behavior and limits

- Sends one short chunk at a time (up to 180 UTF-16 code units), preferring sentence boundaries and spaces. Keeps a strong reference to the active utterance and ignores stale callbacks after cancellation.
- For browser voices, Pause cancels the utterance and retains the last reported word boundary. Resume repeats that word; voices without boundary events repeat the current chunk. This avoids relying on Android's inconsistent native pause/resume behavior.
- A stalled or failed voice leaves the current position available for retry. It never automatically skips an unread chunk. A timeout can also occur with an unusually slow voice.
- Keep the tab visible and the phone awake. Mobile browsers may suspend speech on screen lock, backgrounding, calls, or power saving. This is not a background audio player and chunking cannot guarantee every voice engine behaves correctly.
- Default cleanup removes Markdown formatting, ChatGPT citation tokens, URLs, fenced/indented code blocks and Markdown tables. Emoji removal is optional. Inline code stays readable. Cleanup is a best-effort text filter, not a full Markdown parser; inspect the preview for unusual formatting. Turn off “Markdown formatting” as well as “Code blocks” to preserve literal code formatting.
- Only preferences are saved in browser local storage. Browser voices do not send pasted text to the workstation. Kokoro sends the current and next chunks over Tailscale to the local service; submitted text and audio stay in memory and are not saved by the application. The browser/OS speech provider may process text online for some browser voices. Choose a voice labeled “on-device” when desired; available voices vary by device.
- Loading the page requires the workstation and Tailscale connection. There is no offline cache or service worker in this initial version.

## Workstation voices (Kokoro)

Choose **Read with → Workstation · Kokoro**. The default voice is **Heart**; Bella, Michael, Fenrir, Emma and George are also available. These are English voices. Browser voices remain available if the workstation speech service is unavailable. Refresh the page after restarting a failed service to rediscover voices.

Kokoro runs on the workstation CPU with four inference threads. In a local sample, all six voices generated 7–8 seconds of speech in about 2 seconds. Initial playback waits for generation; one chunk ahead is prefetched to reduce subsequent gaps. Audio is played through Web Audio, with precise pause/resume. Changing voice or speed while paused regenerates the current chunk from its beginning. Failed generation preserves the current chunk for retry. Keep the page open and phone awake; background playback is not guaranteed.

The service binds only to `127.0.0.1:8766`; Tailscale exposes it at `/speak/api`. `/speak/` still serves static files, and Immich remains at `/`. Requests accept a fixed voice list, bounded text and body sizes, and approved browser origins. Model inference is serialized; briefly busy requests are retried by the player. Request bodies and generated audio are not logged or stored. After setup, the service loads cached models in offline mode.

### Service management

The user service is installed, enabled, and starts automatically. This workstation already has user lingering enabled, so it can start at boot without an interactive login.

```sh
systemctl --user status paste2speech-kokoro
systemctl --user restart paste2speech-kokoro
journalctl --user -u paste2speech-kokoro -n 30
```

To stop the speech service while keeping browser voices usable:

```sh
systemctl --user disable --now paste2speech-kokoro
```

### Recreate the installation

From the project directory, with Python 3.12:

```sh
sudo apt-get install espeak-ng python3-venv
python3 -m venv .venv
.venv/bin/pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r server/requirements.lock.txt
# Download model/voice files and warm the model before offline service startup:
.venv/bin/python -c 'from server.app import Engine; Engine()'
mkdir -p ~/.config/systemd/user
cp deploy/paste2speech-kokoro.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now paste2speech-kokoro
sudo tailscale serve --bg --https=443 --set-path=/speak/api http://127.0.0.1:8766
```

Allow around 2 GB for the Python environment and model data, and roughly 1–2 GB RAM while the service is running. Models are downloaded from Hugging Face and the English language data comes from spaCy during setup. The service unit assumes the repository is at `~/workarea/paste2speech`. For another hostname, set `P2S_ORIGINS` to a comma-separated list of approved origins (scheme and host, no path) in a systemd override. Local development origins `http://localhost:8766` and `http://127.0.0.1:8766` are included by default.

To remove just the API route:

```sh
sudo tailscale serve --https=443 --set-path=/speak/api off
```

[Kokoro](https://github.com/hexgrad/kokoro) and its [model weights](https://huggingface.co/hexgrad/Kokoro-82M) are Apache-2.0 licensed. No voice cloning or paid service is used.

## Tests

No packages are needed for core tests (Node.js 20+):

```sh
npm test
```

Optional browser checks use Playwright and an installed Chrome. With the local server running:

```sh
npm install --no-save --package-lock=false playwright
node tests/browser.mjs
# Or test the deployed path:
TEST_URL=https://pop-os.tailbd091c.ts.net/speak/ node tests/browser.mjs
```

Set `CHROME_PATH` if Chrome is somewhere other than `/usr/bin/google-chrome`. Screenshots are written to `work/`. The browser test mocks speech to deterministically check controls, progress, completion and error-independent UI behavior; it does not validate audible output on a Pixel.

Server validation tests use the isolated Python environment:

```sh
.venv/bin/python -m unittest discover -s tests -p '*_test.py'
```

The real-audio integration test requires the running Kokoro service. It generates speech, decodes and plays it in Chrome, checks paragraph navigation, pause/resume, completion, saved settings, and recovery from service errors:

```sh
TEST_URL=https://pop-os.tailbd091c.ts.net/speak/ node tests/kokoro-browser.mjs
```

This validates desktop Chrome with a mobile viewport; actual Pixel audio still needs a device check.

## Files

- `public/`: the only directory to serve.
- `public/text.js`: cleanup and chunking.
- `public/player.js`: cancellable playback state machine.
- `public/app.js`: page controls, voice discovery and preferences.
- `public/audio-player.js`: workstation audio, prefetch, and pause/resume.
- `server/`: local Kokoro API and pinned Python dependencies.
- `deploy/`: automatic-start service definition.
- `tests/`: text, state-machine and browser tests.

## References

- [Tailscale Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Browser speech synthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
- [Speech pause and browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/pause)
