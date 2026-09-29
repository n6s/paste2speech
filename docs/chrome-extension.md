# Read with PasteToSpeech — personal Chrome trial

Highlight text on a webpage, right-click **Read with PasteToSpeech**, and the
reader comes forward and attempts playback with your saved voice and speed.
Sending another selection replaces the reading in the extension's reader tab.
Tabs you opened independently are left alone. If Chrome blocks playback, press
**Play**; already-prepared audio is reused.

## Install

Run `npm run build:extension`, then open `chrome://extensions` in desktop Chrome.
Enable **Developer mode**, choose **Load unpacked**, and select one folder:

- `dist/chrome-extension/production` — `https://pastetospeech.com`
- `dist/chrome-extension/staging` — `https://staging.pastetospeech.com`

Install only the version you intend to use to avoid duplicate context-menu items.
Staging requires the usual Cloudflare Access sign-in. Keep the installed folder
in place. After rebuilding it, click **Reload** on the extension's card and close
its old reader tab before sending a new selection. The toolbar icon opens delivery
status, **Open reader**, and **Retry delivery** when a handoff remains pending.

The corresponding reader release must include the extension bridge. An older
reader will keep the handoff pending; it will not accept the selection. Both
packages contain the same logic and differ only in name and fixed reader origin.
No arbitrary destination setting is provided. Chrome Web Store distribution is
outside this trial. Incognito is disabled for this version.

## Behavior and privacy

- Captures plain selected text only when you invoke the context menu. No source
  page scripts, clipboard access, browsing history, source URLs, or HTML capture.
- Access is limited to the configured reader origin, context menus, and extension
  storage. The icon reuses the approved PasteToSpeech site artwork.
- Keeps one pending selection in extension session memory until accepted. Pending
  selections become undeliverable after ten minutes and are removed on the next
  extension wake/access (including the live reader's retry timer). Closing the
  owned reader clears the pending selection; restarting Chrome clears session
  storage. Text never goes into URLs, sync storage, or extension logs.
- The reader keeps only the last request ID and sequence in tab session storage
  for duplicate protection. A repeated handoff after a reload restores its text
  without automatically generating speech again.
- Selections above two million UTF-16 code units are rejected intact, with advice
  to copy/paste into the reader. Nothing is silently truncated. Existing reader
  cleanup and speech limits still apply.
- Speech uses the existing reader/account flow. A saved WaveNet voice uses normal
  speech credit. Sending new text stops the previous reading; sections already
  generated may have consumed credit under the reader's existing rules.
- No queue, shortcut, rich formatting, or changed voice-switch behavior. Image-only
  content needs OCR elsewhere. Document viewers must expose selected text to
  Chrome's context menu; unusual viewers are not guaranteed.

## Implementation and validation

The context-menu handler stores a versioned request with a unique ID and sequence,
then opens/focuses its owned tab. A top-frame content script bridges extension
messages to the initialized reader through same-origin page messages. The worker
checks the owned tab, top frame, and reader URL before accepting acknowledgments;
the reader validates protocol and rejects stale/duplicate requests. Popup replies
contain status only. Retries deliver text, never call a speech provider themselves.

`npm test` includes controller, trust-boundary, expiry, deduplication, and browser
speech fallback tests. Build both readers and the extension, then run:

```
npm run build:reader:staging
npm run build:reader:public
npm run build:extension
npm run check:extension
npm run check:extension -- --staging
npm run check:reader:parity
npm run check:reader:resume
```

The extension browser check installs a temporary copy into an isolated real Chrome
profile using CDP. Its test-only worker entry point invokes the exact context-menu
handler; it is never packaged. Reader assets and speech APIs are intercepted with
local fixtures. No provider or billing calls occur. It tests fresh and already-used
reader tabs with normal autoplay policy, forced playback denial and recovery,
saved preferences, replacement, worker restart, closed/navigated tabs, cleanup,
and late clipboard/PDF completion. Headless checks establish playback progression,
not human listening quality or a manual click on Chrome's native context menu.

## Release

Use the shared release baseline and preserve the current public configuration.
Run the existing staging release first, then the **public** production release
(`scripts/release-reader-public.mjs`), promoting the same clean commit and checking
hosted metadata/assets. Do not use the historical production-trial configuration
for the live public site. No migrations, billing changes, or new server API are
needed. Deployment receipts live under the ignored `work/` directories.

### Verified September 28, 2026

235 automated tests passed. Both staging and public builds passed the unpacked
extension checks in Google Chrome 154 with normal autoplay settings. Fresh test
profiles and already-used reader tabs both started fixture audio automatically.
Forced autoplay denial displayed the Play fallback and resumed the existing job.
The shared reader parity and interrupted-reading resume checks also passed.
All speech checks used fixtures; no provider credit was consumed. Native-menu
manual interaction and human listening remain personal-trial acceptance checks.
