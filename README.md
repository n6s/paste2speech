# Paste to Speech

Public early preview: **https://speak.rogerpbrown.com**. Cloudflare serves a separate
build with browser voices, experimental on-device Kokoro, local PDF extraction,
optional support links, and a feedback inbox that notifies Roger through the
dedicated `@paste2speech_bot`. See [release operations](RELEASE.md) for build,
deployment, privacy, analytics, rollback, and the planned review workflow.

For automated feedback investigations, Telegram summaries, and looking up a report
by ID, see [feedback reviewer operations](FEEDBACK-REVIEW.md).

The sections below describe the private development/testing deployment.

A small, mobile-friendly reading page for a Pixel, served from a Linux workstation over Tailscale. Plain HTML, CSS and JavaScript with browser speech, plus an optional local Kokoro service for more natural voices. No frontend build step, CDN, speech API key, or analytics.

## Try it locally

```sh
cd ~/workarea/paste2speech
python3 -m http.server 8765 --bind 127.0.0.1 --directory public
```

Open **http://127.0.0.1:8765** in a browser. Keep that terminal running; Ctrl+C stops it. Python only serves static files. Any static web server can replace it.

Use **Clear, Paste & Play** beside **Clear** to replace the text with your clipboard and start reading with your saved settings. Your browser may ask for clipboard permission. Empty or inaccessible clipboards leave the existing text intact. Formatted clipboard text keeps the same cleanup as normal paste.

Or paste text, choose **Read** to review the cleaned text without starting or resuming playback, choose **Browser voices** or **Workstation · Kokoro**, expand **Voice & speed** to pick a voice and speed, and tap **Play**. This row starts collapsed on each visit and shows your current voice and speed. **Read with** and **Clean up before reading** are inside it; your preferences are still remembered. Kokoro is available on the deployed Tailscale URL; the simple static development server only provides browser voices. Use **Pause** to save your place and **Play / Resume** to continue. **Stop** returns to the beginning. Editing text or cleanup options stops playback; changing voice pauses it so Resume uses the new voice. Workstation playback speed changes immediately without regenerating audio.

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

The page starts in **Edit**, showing your original text without a resize handle. **Read** dismisses the text keyboard and shows the cleaned text without starting, resuming, or replaying audio. **Play / Resume** opens Read and starts or resumes playback; after completion, **Replay** starts from the beginning. **Clear, Paste & Play** replaces the text from the clipboard and starts a new reading. Switching back to Edit leaves audio playing; changing the text stops playback and discards prepared audio. Returning to Read preserves your place and prepared audio while playing or paused; the original text is always preserved.

Cleanup settings always regenerate the reading text from the original, so filtered material is not lost. A successful PDF import shows the imported text in Edit; a failed import preserves your text and mode. Clear returns to an empty Edit view. The separate preview and duplicate current-reading display have been removed.

### Start at a reading section

Paste text and choose **Read** to start listening, then tap any section to jump there. Reading continues from that section to the end. The active section is highlighted. Tap another section to jump there, even while playing or paused. Keyboard users can Tab to a section and press Enter or Space.

Sentences flow together as continuous paragraphs, with blank lines separating paragraphs and single line breaks preserving headings. Each sentence remains individually tappable and keyboard-accessible (Tab, then Enter or Space); only the active sentence is highlighted. Headings and preserved line breaks stay separate. English sentence detection uses `Intl.Segmenter`; a conservative correction keeps common titles (such as Dr. and Prof.), name initials, abbreviated months before numeric dates, and No. before numbers together. Ambiguous endings such as etc., U.S., and p.m. remain best-effort sentence boundaries. Sentences longer than 500 UTF-16 code units split at a clause boundary where practical, then at whitespace; only oversized unbroken tokens are hard-split. Older browsers without sentence segmentation use bounded punctuation/word chunks instead. “Join wrapped lines” is enabled by default (existing saved choices are respected). Short multiword ALL-CAPS headings followed by mixed-case text get a blank line around them, including newsletter headings followed by emoji. Single all-caps words also become headings when the next mixed-case line starts with an emoji (for example, GOOGLE followed by 🧠 Google DeepMind…). This still works when emoji removal is enabled. Single acronyms without that cue and consecutive all-caps lines remain eligible for joining. The setting remains optional and merges lines before sentence detection; recognized Markdown headings, lists, tables and code remain separate even when it is enabled. Resizing the preview does not change section boundaries or interrupt playback.

Enable **Follow reading** in Read mode to keep the active section visible. Only the preview scrolls; your page position stays put. The toggle is remembered in this browser. Turn it off to browse freely. Sections taller than the preview are aligned to their beginning.

In Read mode, tap **Aa** beside **Follow reading** to adjust **Text size** from 14 to 32 pixels (default 20). The compact panel closes when you tap outside it, move keyboard focus away, or press Escape. The size is remembered in this browser. Changing it preserves playback and the highlighted section; Follow reading keeps that section in view.

The Read pane grows to fit the active chunk at your selected text size, including after width or font changes. It keeps the larger height between chunks rather than shrinking repeatedly. Growth also works with Follow reading off; that switch still controls automatic scrolling. A very tall chunk can make the pane taller than the screen. Drag the preview's bottom-right handle vertically where your browser supports it. The preview starts at 300px tall, with a 150px minimum; larger manual heights survive mode switches and reset on reload. Touch browsers may not show a native resize handle.

Pause/Resume retains your position; Stop resets to the beginning, and Replay reads the entire text. Editing text or cleanup options rebuilds the sections and stops playback.

Voice and cleanup preferences are stored per browser origin. Moving from port 8443 to the default HTTPS port starts with fresh preferences; choose your preferred voice again.

## Reading behavior and limits

Uppercase answer labels `A)` through `Z)` at the start of a line, followed by whitespace and answer text, are treated as separate list items. Their letters remain visible, and wrapped indented continuations stay with the item. Kokoro gives the letter a short 150 ms pause before its answer, including after `Correct Answer: B)`. Excess synthesis silence is trimmed with the same small speech-edge buffers used for em dashes. Ordinary closing parentheses, inline references such as “option A),” lowercase labels, and multi-letter labels do not trigger this pause. Existing colon/quote boundaries use the longer applicable pause rather than stacking.

When Join wrapped lines is enabled, a line starting with a numbered question marker such as `Q1 ·` begins a separate paragraph. This preserves a preceding plain-text newsletter heading even when copying has lost its Markdown. Wrapped lines within the question still join; inline Q1 references and retained code are unaffected. A line break before the marker must still exist in the pasted text.

With Markdown cleanup enabled, complete dollar amounts ending in uppercase `M` or `B` expand in Read mode and speech input: `$300M` → “three hundred million dollars,” `$1.78M` → “one point seven eight million dollars,” and `$2.5B` → “two point five billion dollars.” Decimal digits are retained individually. `~$48M`, `~ $48M`, and Markdown-escaped tildes become “about forty eight million dollars”; the plain-number tilde rule also accepts a dollar sign (`~$100` → “about $100”). Original Edit text stays unchanged. Bare M/B values, megabytes, longer identifiers, URLs, and inline or retained block code are excluded. Unsupported or malformed amounts stay literal; integer parts longer than 18 significant digits are left alone rather than rounded. Disabling Markdown cleanup disables these prose conversions.

Kokoro reads standalone `1:1` as “one to one” in speech input, keeping the displayed text unchanged. This is deliberately a narrow rule: other ratios, times, larger colon-separated numbers, identifiers, and URLs are not converted by it.

Kokoro converts valid comma-grouped numbers directly to cardinal words in speech input (`1,079` → “one thousand seventy nine”), leaving ungrouped numbers such as `2025` to the voice’s existing year/number handling, and expands numeric `sq-ft`, `sq ft`, `sq. ft.`, and `sqft` measurements to “square feet.” This lets `150,700-sq-ft` read as “one hundred fifty thousand seven hundred square feet,” without altering the preview. Comma-separated lists, malformed digit groupings, and URLs are excluded from thousands normalization.

With Markdown cleanup enabled, a prose tilde before a number (`~100`, `~ 100`, or Markdown-escaped `\~100`) becomes “about 100” in Read mode and the speech input. The original paste in Edit mode is preserved. Inline/fenced/indented code, retained URLs, and path-like tokens such as `~/Documents` and `~100/file` are excluded. This applies to both speech engines; disabling Markdown cleanup leaves tildes unchanged.

A small speech-only pronunciation dictionary supplies explicit Kokoro phonemes for demos (DEH-mohz), UBTECH (YOO-bee-tek, any capitalization), Waymo (WAY-moh, any capitalization), robotaxi, and robotaxis (robo-taxi / robo-taxis), plus Houthi (HOO-ti), Houthis (HOO-teez), and astaxanthin (as-tuh-ZAN-thin). It covers American and British voices, preserves possessives, and avoids replacements inside URLs or longer words. Overrides are applied after cleanup and pause planning, so the preview and quote/colon timing remain unchanged. Add future corrections to `shared/pronunciations.json` and verify both dialects. Prepared audio must be regenerated to hear new corrections.

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
- Only preferences are saved in browser local storage. Browser voices do not send pasted text to the workstation. Workstation Kokoro sends the reading over Tailscale. Source text stays in service memory; the continuous MP3 is temporarily stored in an owner-only cache directory until cleared, expired, or the service stops. On-device Kokoro keeps its prepared WAV in browser memory. The browser/OS speech provider may process text online for some browser voices. Choose a voice labeled “on-device” when desired; available voices vary by device.
- Loading the page requires the workstation and Tailscale connection. There is no offline cache or service worker in this initial version.

## Workstation voices (Kokoro)

Choose **Read with → Workstation · Kokoro**. The default voice is **Heart**; Bella, Michael, Fenrir, Emma and George are also available. These are English voices. Browser voices remain available if the workstation speech service is unavailable. Refresh the page after restarting a failed service to rediscover voices.

Kokoro runs on the workstation NVIDIA RTX 4060 Ti with CUDA. Playback now begins
as the first MP3 audio arrives, while the workstation generates later sections.
A single encoder spans the whole reading; the same sample clock drives text
highlighting, section navigation, and exported WebVTT captions. Existing clock,
pronunciation, and pause rules still run at the synthesis boundary.

Speed changes immediately on the media element, preserving pitch, without a new
synthesis request. The browser remembers the chosen speed. Pause saves the exact
position and lets preparation continue. Stop cancels unfinished preparation; for
a completed recording it returns to the beginning and retains replay/downloads.
Changing text, cleanup, or voice requires a new recording. If preparation fails,
Play retries the reading; an incomplete recording is never offered for download.
Autoplay rejection leaves a Play button. Media Session registers play, pause,
stop, previous/next section, and seek controls; which controls appear depends on
the browser/device. Returning to the page refreshes highlighting from audio time.

A seek within received audio is immediate. Once a section has been generated,
the player can seek through the arriving MP3 even if Chrome stopped prefetching
while paused. Navigation to an ungenerated section waits until that section is
ready. Completed recordings can reopen the same MP3 with range support. The
highlighted requested section stays fixed while waiting. Speed changes do not
alter any caption timestamps.

Expand **Download recording** after preparation finishes to save a single mono
24 kHz, 64 kbps MP3 at original speed. **Include timed text** reveals a separate
`reading.vtt` download using the same filename stem. Caption display in other
players varies. Both exports reuse the generated audio; there is no extra speech
synthesis or provider charge.

Keep the page open and Tailscale connected while audio arrives. Unlike the old
fully downloaded WAV, a fully generated MP3 is not necessarily fully buffered
on the phone. Download it for reliable offline use. The page does not restore
text or playback after reload. Clear deletes the current temporary recording.
Files are under `~/.cache/paste2speech/readings/recording-*/reading.mp3`, in
owner-only directories, with no separate source-text files. They expire after
24 hours without server access; normal service shutdown removes them. The
cleanup loop also removes expired files left after a crash. Up to three readings
can be retained at once; clear earlier readings before opening more. Input is
bounded to 1 million characters / 10,000 sections, and encoded audio to about
512 MiB. Browser storage/buffering and device limits still apply.

The service binds only to `127.0.0.1:8766`; Tailscale exposes it at `/speak/api`.
`/speak/` serves the local `dist/` build, and Immich remains at `/`. Creation and
deletion require an approved browser origin. Unguessable reading IDs protect
status, stream, and download URLs; cross-site browser access is rejected.
Inference is serialized, and submitted text is never logged. FFmpeg and FFprobe
are required. The old short-speech API and on-device WAV player remain available.

Validation on 2026-09-21: a real 2,448-word chapter (168 sections) produced an
850.584-second / 6,804,672-byte MP3. Desktop Chrome began playback in 1.2 seconds,
with the complete recording ready in 12.2 seconds. Real-browser checks covered
speed without regeneration, pause/resume, early and completed-file navigation,
correct highlighting at middle/final sections, 168 VTT cues, mobile layout, and
Clear removing the server recording. Full MP3 decoding and a measured encoder
latency test passed. This does not verify Pixel screen-off behavior.

Pixel acceptance for this new path: start a chapter, lock the phone while it is
still preparing, test play/pause and any previous/next controls offered, return
and check highlighting, change speed, then download and play the MP3 elsewhere.
The earlier prepared-WAV Pixel results do not establish this streaming path.

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
- `public/audio-player.js`: on-device prepared WAV playback.
- `public/progressive-player.js`: private workstation stream, speed, highlighting, and media controls.
- `server/readings.py`: bounded temporary MP3 recordings, sample-clock metadata, downloads, and expiry.
- `server/`: local Kokoro API and pinned Python dependencies.
- `deploy/`: automatic-start service definition.
- `tests/`: text, state-machine and browser tests.

## References

- [Tailscale Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Browser speech synthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
- [Speech pause and browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/pause)

## Private hosted voice auditions

On the Tailscale reader, use **Audition hosted voices** in the footer, or open
`https://pop-os.tailbd091c.ts.net/speak/api/audition`. Compare MeloTTS English,
Aura 1, Aura 2 English, and DeepInfra Kokoro (Heart and British Emma) with a passage of up to 2,000 characters. Each model
has an explicit Generate sample button, playback, download, request timing, and
an estimated generation cost. No request runs automatically. Samples are kept
in page memory, and downloads are explicit. Text is sent to the selected provider. Two Kokoro cards compare original text
with the shared pronunciation dictionary; provider support for that markup needs
listening confirmation. Neither card applies workstation pause planning or time
expansion. Original reader text and existing reader speech behavior are unchanged.

DeepInfra uses `~/.config/paste2speech/deepinfra-api-token` (mode 600), the native
Kokoro endpoint, MP3 output, and the default service tier. Its returned cost
estimate and submitted character count are displayed; dictionary markup adds
billable characters. HTTP 402 reports insufficient prepaid credit.

The private workstation API reads `~/.config/paste2speech/cloudflare-ai-token`
(owner-readable only), scoped to this account's Workers AI access. It never sends
the token to the browser, logs submitted text, or saves generated samples. The
public Worker has no audition endpoint. No public release is required. API calls
are serialized and bounded to short samples, with no automatic paid retries.

Validation on 2026-09-21: Aura 1 and Aura 2 returned real MP3 samples. MeloTTS
returned Cloudflare HTTP 500 / error 3043 for both a short passage and “Hello
world.” Its audition remains available for manual retry; successful synthesis and
its advertised low cost have not yet been confirmed. Cost labels are estimates,
not measured account billing. Existing full-reader playback is unchanged.

DeepInfra validation on 2026-09-21: a 200-character passage generated original
and dictionary versions with Heart and Emma. Four valid MP3 clips lasted
13.1–13.5 seconds each and took 1.2–3.1 seconds per complete request. Their
combined provider-reported cost estimate was $0.00057660. The initial 54-character
Heart request cost $0.00003348. These short tests do not establish whole-book
throughput or reliability. Listening on the Pixel remains the pronunciation
quality check. Test artifacts are local under ignored `work/auditions/`.

Validation: 84 JavaScript tests, 59 Python tests, and mobile browser audition
checks (explicit requests, independent samples, playback, download, errors).
This change is private only; do not publish the pending browser experiments.

## Private DeepInfra reader pilot

Choose **DeepInfra - Kokoro · private test** under Voice & speed on the private
reader. Heart and British Emma are available. This sends text to DeepInfra and
uses the project's prepaid balance; browser users never receive the API token.
The public interface has no hosted option or recording endpoint.

The pilot uses the same progressive recording pipeline, pronunciation dictionary,
clock-time expansion, pause planning, highlighting, playback-rate controls, MP3,
and WebVTT exports as workstation Kokoro. DeepInfra supplies mono 24 kHz WAV
phrases; the workstation applies the shared pause rules and encodes the continuous
MP3. Speech inference is remote; the workstation still relays, stores, and serves
the recording. This is not a deployed Cloudflare generation backend.

Inputs are capped at 20,000 original characters per reading and 30,000 attempted
characters after expansion. Requests use DeepInfra's default service tier and
have no automatic paid retry. Provider-reported cost estimates appear beside
preparation progress; unknown/missing costs are marked incomplete. Failed reads
are not offered as complete exports. Retrying a failed reading starts again and
can incur new charges. Stop prevents further phrases; an already-running provider
request may finish and be charged. Existing workstation-only readings keep their
larger limits and do not call DeepInfra.

The provider adapter shares the existing speech-boundary code instead of creating
a second pronunciation/pause implementation. Feedback remains compatible with the
currently deployed schema: the physical engine is the workstation relay, and the
voice label identifies DeepInfra. No feedback-service deployment is needed.

A controlled phoneme probe on 2026-09-21 substituted dog phonemes for the displayed
word cat. The hosted result had the same sample length as the ordinary dog reading,
with normalized peak waveform correlation 0.9946 versus 0.1964 for ordinary cat.
This supports dictionary-markup compatibility. Heart and Emma pronunciation/clock
samples are under ignored `work/deepinfra-validation/`; Roger's listening test is
still the final check for the reported words.

Use `P2S_TEST_ENGINE=deepinfra node tests/progressive-browser.mjs` against the
isolated local test service to run the paid chapter comparison. Do not run it as
an ordinary unit test: it consumes prepaid credit. The default browser check
continues to use local workstation synthesis.

Hosted chapter result (2026-09-21, Heart, one successful run): 2,448 words / 168
sections, 13,863 submitted characters, 802.584 seconds of audio, 6,420,672 MP3
bytes. First playback: 1.247 seconds. Full preparation: 210.072 seconds. Provider
reported cost: $0.00859506 (generation only). Speed changes, section highlighting,
live-stream navigation, middle/final seeks, natural completion/replay, and all
168 VTT cues passed. The chapter decodes as a complete MP3. This is a measurement,
not a latency guarantee or whole-book reliability result. A prior attempt exposed
the paused live-stream seek wait and was cancelled at the harness timeout; the
native-stream seek fix above resolved it before this successful comparison.

Validation: 96 JavaScript tests and 68 Python tests. Local artifacts and provider
cost/timing records are under `work/deepinfra-validation/`. The two ~9-second
Heart/Emma correction samples together reported $0.00020708. Pixel listening,
lock-screen behavior with hosted generation, and pronunciation acceptance remain
with Roger. No hosted public release, checkout, authentication, or billing work
was performed.
