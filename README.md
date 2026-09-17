# Paste to Speech

A small, mobile-friendly reading page for a Pixel, served from a Linux workstation over Tailscale. Plain HTML, CSS and JavaScript with browser speech, plus an optional local Kokoro service for more natural voices. No frontend build step, CDN, speech API key, or analytics.

## Try it locally

```sh
cd ~/workarea/paste2speech
python3 -m http.server 8765 --bind 127.0.0.1 --directory public
```

Open **http://127.0.0.1:8765** in a browser. Keep that terminal running; Ctrl+C stops it. Python only serves static files. Any static web server can replace it.

Paste text, choose **Read** to review the cleaned text, choose **Browser voices** or **Workstation · Kokoro**, expand **Voice & speed** to pick a voice and speed, and tap **Play**. This row starts collapsed on each visit and shows your current voice and speed. **Read with** and **Clean up before reading** are inside it; your preferences are still remembered. Kokoro is available on the deployed Tailscale URL; the simple static development server only provides browser voices. Use **Pause** to save your place and **Play / Resume** to continue. **Stop** returns to the beginning. Editing text or cleanup options stops playback; changing voice or speed pauses it so Resume uses the new settings.

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

## Open a PDF

Expand **Open PDF** above the text box and choose a file on the Tailscale reader. PDFs up to 20 MB are sent to the workstation, where Poppler `pdftotext` extracts their existing text layer in memory. Files and extracted text are not saved. Successful imports replace the text box; failed imports leave it intact. Review the imported text in Edit, then tap Read to listen. Pages without text are skipped with a notice; image-only scans need OCR, which this version does not provide. Columns, tables, headers and footnotes may read out of order. Password-protected or damaged files may be rejected. Extraction times out after 30 seconds, and imports over one million characters are rejected.

PDF import requires the workstation API and `poppler-utils` (`sudo apt-get install poppler-utils`); the static-only development server cannot import PDFs.

## Formatting-aware paste

Paste into the existing Edit box normally. When the source supplies formatted clipboard content, the reader converts it locally to editable Markdown: headings, paragraphs, line breaks, numbered/bulleted lists, emphasis, links, quotes, and code retain their structure. Email layout tables become separate content blocks; simple data tables with header cells become Markdown tables. Read mode then uses the usual cleanup preferences and paragraph pauses. Plain-text-only clipboard content uses the browser's ordinary paste behavior, so mobile support depends on what the source app copies.

Conversion uses a detached, inert template and writes only text into the textarea. Images and executable/embedded content are omitted; clipboard HTML is never attached to the page, and the app does not fetch its links or images. Only HTTP(S) and mailto link destinations are retained. The app does not request ongoing clipboard access or save the clipboard content. Empty, oversized (over two million HTML characters or one million output characters), or unconvertible rich content falls back to normal paste. Pasting replaces the selected text and resets playback just like typing. Native undo is preserved where supported; browsers without native text insertion use selection replacement as a fallback.

## One panel for editing and reading

The page starts in **Edit**, showing your original text without a resize handle. **Read** dismisses the text keyboard, shows the cleaned text, and starts or resumes playback. After finishing, Read replays from the beginning. **Play / Resume** does the same. While audio is playing or preparing, Read only switches views without interrupting it. With no readable text or supported engine, Read just opens the reading view. Switching back to Edit leaves audio playing; changing the text stops playback and discards prepared audio. Returning to Read preserves your place and prepared audio while playing or paused; the original text is always preserved.

Cleanup settings always regenerate the reading text from the original, so filtered material is not lost. A successful PDF import shows the imported text in Edit; a failed import preserves your text and mode. Clear returns to an empty Edit view. The separate preview and duplicate current-reading display have been removed.

### Start at a reading section

Paste text and choose **Read** to start listening, then tap any section to jump there. Reading continues from that section to the end. The active section is highlighted. Tap another section to jump there, even while playing or paused. Keyboard users can Tab to a section and press Enter or Space.

Sentences flow together as continuous paragraphs, with blank lines separating paragraphs and single line breaks preserving headings. Each sentence remains individually tappable and keyboard-accessible (Tab, then Enter or Space); only the active sentence is highlighted. Headings and preserved line breaks stay separate. English sentence detection uses `Intl.Segmenter`; a conservative correction keeps common titles (such as Dr. and Prof.), name initials, abbreviated months before numeric dates, and No. before numbers together. Ambiguous endings such as etc., U.S., and p.m. remain best-effort sentence boundaries. Sentences longer than 500 UTF-16 code units split at a clause boundary where practical, then at whitespace; only oversized unbroken tokens are hard-split. Older browsers without sentence segmentation use bounded punctuation/word chunks instead. “Join wrapped lines” is enabled by default (existing saved choices are respected). Short multiword ALL-CAPS headings followed by mixed-case text get a blank line around them, including newsletter headings followed by emoji. Single all-caps words also become headings when the next mixed-case line starts with an emoji (for example, GOOGLE followed by 🧠 Google DeepMind…). This still works when emoji removal is enabled. Single acronyms without that cue and consecutive all-caps lines remain eligible for joining. The setting remains optional and merges lines before sentence detection; recognized Markdown headings, lists, tables and code remain separate even when it is enabled. Resizing the preview does not change section boundaries or interrupt playback.

Enable **Follow reading** in Read mode to keep the active section visible. Only the preview scrolls; your page position stays put. The toggle is remembered in this browser. Turn it off to browse freely. Sections taller than the preview are aligned to their beginning.

In Read mode, tap **Aa** beside **Follow reading** to adjust **Text size** from 14 to 32 pixels (default 20). The compact panel closes when you tap outside it, move keyboard focus away, or press Escape. The size is remembered in this browser. Changing it preserves playback and the highlighted section; Follow reading keeps that section in view.

Drag the preview's bottom-right handle vertically where your browser supports it. The preview starts at 300px tall, with a 150px minimum; its height survives mode switches and resets on reload. Touch browsers may not show a native resize handle.

Pause/Resume retains your position; Stop resets to the beginning, and Replay reads the entire text. Editing text or cleanup options rebuilds the sections and stops playback.

Voice and cleanup preferences are stored per browser origin. Moving from port 8443 to the default HTTPS port starts with fresh preferences; choose your preferred voice again.

## Reading behavior and limits

Uppercase answer labels `A)` through `Z)` at the start of a line, followed by whitespace and answer text, are treated as separate list items. Their letters remain visible, and wrapped indented continuations stay with the item. Kokoro gives the letter a short 150 ms pause before its answer, including after `Correct Answer: B)`. Excess synthesis silence is trimmed with the same small speech-edge buffers used for em dashes. Ordinary closing parentheses, inline references such as “option A),” lowercase labels, and multi-letter labels do not trigger this pause. Existing colon/quote boundaries use the longer applicable pause rather than stacking.

When Join wrapped lines is enabled, a line starting with a numbered question marker such as `Q1 ·` begins a separate paragraph. This preserves a preceding plain-text newsletter heading even when copying has lost its Markdown. Wrapped lines within the question still join; inline Q1 references and retained code are unaffected. A line break before the marker must still exist in the pasted text.

With Markdown cleanup enabled, complete dollar amounts ending in uppercase `M` or `B` expand in Read mode and speech input: `$300M` → “three hundred million dollars,” `$1.78M` → “one point seven eight million dollars,” and `$2.5B` → “two point five billion dollars.” Decimal digits are retained individually. `~$48M`, `~ $48M`, and Markdown-escaped tildes become “about forty eight million dollars”; the plain-number tilde rule also accepts a dollar sign (`~$100` → “about $100”). Original Edit text stays unchanged. Bare M/B values, megabytes, longer identifiers, URLs, and inline or retained block code are excluded. Unsupported or malformed amounts stay literal; integer parts longer than 18 significant digits are left alone rather than rounded. Disabling Markdown cleanup disables these prose conversions.

Kokoro reads standalone `1:1` as “one to one” in speech input, keeping the displayed text unchanged. This is deliberately a narrow rule: other ratios, times, larger colon-separated numbers, identifiers, and URLs are not converted by it.

Kokoro converts valid comma-grouped numbers directly to cardinal words in speech input (`1,079` → “one thousand seventy nine”), leaving ungrouped numbers such as `2025` to the voice’s existing year/number handling, and expands numeric `sq-ft`, `sq ft`, `sq. ft.`, and `sqft` measurements to “square feet.” This lets `150,700-sq-ft` read as “one hundred fifty thousand seven hundred square feet,” without altering the preview. Comma-separated lists, malformed digit groupings, and URLs are excluded from thousands normalization.

With Markdown cleanup enabled, a prose tilde before a number (`~100`, `~ 100`, or Markdown-escaped `\~100`) becomes “about 100” in Read mode and the speech input. The original paste in Edit mode is preserved. Inline/fenced/indented code, retained URLs, and path-like tokens such as `~/Documents` and `~100/file` are excluded. This applies to both speech engines; disabling Markdown cleanup leaves tildes unchanged.

A small speech-only pronunciation dictionary supplies explicit Kokoro phonemes for demos (DEH-mohz), UBTECH (YOO-bee-tek, any capitalization), Waymo (WAY-moh, any capitalization), robotaxi, and robotaxis (robo-taxi / robo-taxis). It covers American and British voices, preserves possessives, and avoids replacements inside URLs or longer words. Overrides are applied after cleanup and pause planning, so the preview and quote/colon timing remain unchanged. Add future corrections to `PRONUNCIATIONS` in `server/app.py` and verify both dialects. Prepared audio must be regenerated to hear new corrections.

Kokoro applies speech-only pronunciation rules without changing displayed text: numeric `lb`/`lbs` measurements become pounds (pound for 1), `ft` becomes feet, and decimal fractions are spoken digit by digit with “point” (`7.02` → “7 point zero two”). Hyphenated measurements such as `7.2-ft.` are supported, and abbreviation dots before continuing lowercase prose are removed from the speech input. URLs and dotted version/IP identifiers are left intact. Em dashes create a short 150 ms pause, trimming excess near-silence with the same speech-edge buffers used for quotes. Adjacent pause markers use the longer pause rather than stacking. Ordinary hyphens are unchanged. Browser voices retain their own pronunciation behavior.

Cleanup identifies Markdown blocks before removing formatting or content. Headings and individual list items become separate prose paragraphs; wrapped lines join only within prose or a list continuation. Empty pipe-layout tables, including short separators such as `| - |` and `| :- |`, disappear when table removal is enabled without merging the text on either side. Nonempty tables still require standard separators for recognition.

Within non-code text, numeric HTML entities and `nbsp`, `amp`, `quot`, `apos`, `lt`, and `gt` decode once as literal characters. Encoded or escaped Markdown punctuation stays literal, never becoming new Markdown structure or HTML. Nonbreaking spaces normalize to ordinary spaces. Retained code stays protected, saved cleanup choices remain in force, and disabling every cleanup option preserves the source apart from newline normalization.

Kokoro carries the paragraphs shown in Read mode into audio preparation. Between paragraphs, it adds only enough silence to reach a 250 ms minimum, counting existing silence on both sides and preserving longer natural pauses. No additional paragraph silence is added between sentences within the same paragraph or stacked onto an already sufficient colon pause. The final output remains one continuous WAV track; tapping a paragraph skips its inserted gap and seeks to that paragraph's audio. Paragraph metadata is internal, not saved as a preference or sent to the speech service. Changing paragraph boundaries invalidates prepared audio, even if its spoken words are unchanged. Browser voices retain their device-managed timing.

Kokoro gives colons followed by whitespace a short pause by synthesizing the label and following text separately. It tops up existing silence across the boundary to at least 250 ms rather than adding a second full pause. A colon at the end of an existing reading section receives the same treatment, covering line and paragraph boundaries. Times such as `10:30` and URLs such as `https://example.com` remain intact. Displayed text and section highlighting do not change; browser voices retain their device punctuation behavior. This can add some preparation work for colon-heavy text. Already-prepared audio must be regenerated to pick up changes.

Kokoro also gives paired curly quotes (double or single) and straight double quotes a lighter 50 ms boundary pause. Excess near-silence introduced by separate synthesis is trimmed at quote boundaries, keeping a 5 ms buffer beside each speech edge; short gaps are padded to the target. Adjacent colon boundaries use the longer 250 ms target, and nested quotes only mark the outer pair. Apostrophes and inch marks are left alone. Closing punctuation stays with the quotation, with no additional quote pause at the end of a reading section. Only pairs contained within one section are recognized; unmatched marks and quotations spanning sections retain normal voice behavior. Text and highlighting remain unchanged.

- Both speech engines use the same sentence-based sections (up to 500 UTF-16 code units), with clause/word splitting for long sentences. Keeps a strong reference to the active utterance and ignores stale callbacks after cancellation.
- For browser voices, Pause cancels the utterance and retains the last reported word boundary. Resume repeats that word; voices without boundary events repeat the current chunk. This avoids relying on Android's inconsistent native pause/resume behavior.
- A stalled or failed voice leaves the current position available for retry. It never automatically skips an unread chunk. A timeout can also occur with an unusually slow voice.
- Browser voices need the tab visible and phone awake. Kokoro prepares a single audio track for background listening, with lock-screen/headphone controls where supported. Actual Pixel screen-lock acceptance testing remains pending; see BACKLOG.md.
- Default cleanup removes Markdown formatting, ChatGPT citation tokens, URLs, fenced/indented code blocks and Markdown tables. Emoji removal is optional. Inline code stays readable. Cleanup is a best-effort text filter, not a full Markdown parser; inspect the preview for unusual formatting. Unchecked Code blocks and Tables keep their content. Markdown cleanup separates headings (including underlined headings) and list items, preserves ordered-list numbers, and reads task checkboxes as Checked or Unchecked. Retained tables read headers once and each row separately, using semicolons between cells; empty cells keep their positions, escaped pipes remain literal, and ambiguous tables remain unchanged. Retained code loses its fences and language label, but its contents, indentation and line breaks are protected from all prose cleanup. Turn off Markdown formatting too to retain fences. Join wrapped lines applies only to prose and continuations within a list item; sentence-ending punctuation and blank paragraphs still prevent joining. Structure detection is conservative, not a full Markdown renderer; deeply nested or unusual syntax may need manual editing.
- Only preferences are saved in browser local storage. Browser voices do not send pasted text to the workstation. Kokoro sends all reading chunks sequentially over Tailscale to the local service; submitted text and audio stay in memory and are not saved by the application. The browser/OS speech provider may process text online for some browser voices. Choose a voice labeled “on-device” when desired; available voices vary by device.
- Loading the page requires the workstation and Tailscale connection. There is no offline cache or service worker in this initial version.

## Workstation voices (Kokoro)

Choose **Read with → Workstation · Kokoro**. The default voice is **Heart**; Bella, Michael, Fenrir, Emma and George are also available. These are English voices. Browser voices remain available if the workstation speech service is unavailable. Refresh the page after restarting a failed service to rediscover voices.

Kokoro runs on the workstation NVIDIA RTX 4060 Ti with CUDA. The CPU environment remains available for rollback. Initial playback waits for the complete reading to be generated, with preparation progress and a working Stop button. One in-memory WAV track plays through a persistent HTML audio element, with precise pause/resume and paragraph seeking. If automatic playback is blocked, tap Play when audio is ready. Changing voice or speed prepares a new track and resumes from the current chunk’s beginning. Failed generation retains completed chunks in memory for retry. Stop resets the position and retains completed audio for replay. Lock-screen/headphone controls support pause, resume, stop, and 15-second seeking where available.

Keep the page open, but you can switch apps or lock the screen while the prepared track plays. Once preparation finishes, playback no longer requires Tailscale or the workstation connection. Text, audio, and position are temporary: Clear removes them, and reloading or closing the page discards them. Prepared PCM audio is limited to 256 MiB (about 93 minutes); split longer readings into smaller sections. No audio is stored on disk by the application. Pixel background-playback verification is still pending; desktop tests cannot establish Android behavior.

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
python3 -m venv .venv-cuda
.venv-cuda/bin/pip install -r server/requirements-cuda.lock.txt
# Download model/voice files and warm the model before offline service startup:
P2S_DEVICE=cuda .venv-cuda/bin/python -c 'from server.app import Engine; Engine()'
mkdir -p ~/.config/systemd/user
cp deploy/paste2speech-kokoro.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now paste2speech-kokoro
sudo tailscale serve --bg --https=443 --set-path=/speak/api http://127.0.0.1:8766
```

The installed CUDA environment uses about 7 GB, excluding shared cached model files, because it includes NVIDIA runtime libraries. The service retains its 3 GiB host-memory limit; GPU memory is separate. Models are downloaded from Hugging Face and the English language data comes from spaCy during setup. The service unit assumes the repository is at `~/workarea/paste2speech`. For another hostname, set `P2S_ORIGINS` to a comma-separated list of approved origins (scheme and host, no path) in a systemd override. Local development origins `http://localhost:8766` and `http://127.0.0.1:8766` are included by default.

### Measured preparation performance

Measured on 2026-09-16 with Heart at 1×, unchanged 180-character chunking, and identical input on an i5-14400 versus RTX 4060 Ti (8 GB):

| Measurement | CPU | CUDA |
| --- | ---: | ---: |
| Warm short-request median (5 requests) | 2.106 s | 0.073 s |
| Local API preparation, 24 chunks / 138.9 s of audio | 37.295 s | 1.435 s |
| Full preparation through the deployed reader | 45.440 s | 1.627 s |

The multi-minute local sample was approximately 26× faster on CUDA. These are synthetic sample measurements, not guarantees for every text, voice, or workstation load. The browser ran on the workstation through the Tailscale URL, so these results do not measure Pixel/mobile-network latency. Only about 0.2 seconds separated GPU local and browser preparation in this sample; batching is deferred.

The sample repeats this paragraph twelve times, splitting each paragraph with `chunkText`: “Walking through the neighborhood gives us time to notice small changes. The trees provide shade along the quiet streets. Taking a short break can help us return to our work with a clearer mind.” Browser input uses those same chunks separated by blank lines. No synthesis-result cache is used.

Startup/warm-up is separate from the table: a fresh CPU Engine initialization took 12.43 seconds; the temporary CUDA service reached healthy readiness in 6.03 seconds. These are single startup observations with different process wrappers/cache state. After built-in warm-up, first timed requests took 2.244 seconds on CPU and 0.121 seconds on CUDA.

The temporary GPU process used about 960 MiB of GPU memory after the benchmark. Production used about 1.4 GiB of host memory (peak also about 1.4 GiB), below the existing 3 GiB limit, and about 1.2 GiB of GPU memory after real-audio browser tests. Full-track preparation, offline playback, section timestamps, and voice selection remain unchanged.

### Device selection and CPU rollback

`P2S_DEVICE` accepts `cpu` (default) or `cuda`. The installed service explicitly selects CUDA; unavailable CUDA causes a clear startup failure. `/speak/api/health` reports the selected device. Both language pipelines share one model. Display/graphics configuration is unaffected.

The original `.venv` CPU environment is retained. To roll back, use `systemctl --user edit paste2speech-kokoro` with:

```ini
[Service]
ExecStart=
ExecStart=%h/workarea/paste2speech/.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8766 --no-access-log
Environment=P2S_DEVICE=cpu
```

Then run `systemctl --user daemon-reload` and `systemctl --user restart paste2speech-kokoro`. Remove only these override lines to return to CUDA, then reload and restart again. A fresh CPU environment can be created using `server/requirements.lock.txt` with the PyTorch CPU wheel index.

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

Formatted-paste browser checks can run against the same server:

```sh
TEST_URL=https://pop-os.tailbd091c.ts.net/speak/ node tests/paste-browser.mjs
```

They test synthetic clipboard HTML, selection replacement, undo, safe fallback, protected code, and absence of image/frame/style requests. Real phone clipboard format availability still requires a device check.

Set `CHROME_PATH` if Chrome is somewhere other than `/usr/bin/google-chrome`. Screenshots are written to `work/`. The browser test mocks speech to deterministically check controls, progress, completion and error-independent UI behavior; it does not validate audible output on a Pixel.

Server validation tests use the isolated Python environment:

```sh
.venv/bin/python -m unittest discover -s tests -p '*_test.py'
```

The real-audio integration test requires the running Kokoro service. It verifies the exact newsletter Markdown fixture and measures its assembled heading-to-item silence, generates speech, decodes and plays it in Chrome, checks paragraph navigation, pause/resume, completion, saved settings, and recovery from service errors:

```sh
TEST_URL=https://pop-os.tailbd091c.ts.net/speak/ node tests/kokoro-browser.mjs
```

This validates desktop Chrome with a mobile viewport; actual Pixel audio still needs a device check.

## Files

- `public/`: the only directory to serve.
- `public/text.js`: cleanup and chunking.
- `public/paste.js`: inert clipboard HTML-to-Markdown conversion.
- `public/player.js`: cancellable playback state machine.
- `public/app.js`: page controls, voice discovery and preferences.
- `public/audio-player.js`: prepared WAV audio, media controls, and pause/resume.
- `server/`: local Kokoro API and pinned Python dependencies.
- `deploy/`: automatic-start service definition.
- `tests/`: text, state-machine and browser tests.

## References

- [Tailscale Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Browser speech synthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
- [Speech pause and browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/pause)
