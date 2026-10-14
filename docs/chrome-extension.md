# Read with PasteToSpeech — personal Chrome trial

Highlight text on a webpage, right-click **Read with PasteToSpeech**, and the
reader comes forward and attempts playback with your saved voice and speed.
Sending another selection replaces the reading in the extension's reader tab.
Tabs you opened independently are left alone. If Chrome blocks playback, press
**Play**; already-prepared audio is reused.

## Install

From `/home/roger/workarea/paste2speech` on `main`, run
`npm run build:extension`, then open `chrome://extensions` in desktop Chrome.
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

- Captures selected visible text only when you invoke the context menu. A short
  isolated script reads the selection in that frame before the reader opens,
  preserving paragraphs, explicit line breaks, and list markers. It reads no
  clipboard, browsing history, source URLs, or HTML attributes.
- `activeTab` and `scripting` provide temporary access following your menu action;
  persistent host access remains limited to the configured reader origin. No
  all-sites host permission or persistent source-page script is added. The icon
  reuses the approved PasteToSpeech site artwork.
- Chrome flattens line breaks in its context-menu text snapshot. If source capture
  is restricted, unavailable, stale, or takes over 1.5 seconds once delivery is
  ready, the original snapshot remains the fallback. Such selections may remain
  flattened; use Paste for full clipboard structure on those pages. Cross-origin
  frames and document viewers may require this fallback. Selection text stays
  bounded to two million code units; complex layouts use native selected text.
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

The context-menu handler starts source capture immediately, checks the selected
text against the menu snapshot, and serializes delivery in click order. It stores
a versioned request with a unique ID and sequence, then opens/focuses its owned tab. A top-frame content script bridges extension
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

## Local formatting candidate (October 14, 2026)

Build outside the installed extension folders and validate with synthetic Chrome
fixtures (no account, provider, or Cloudflare Access session required):

```sh
node scripts/chrome-extension/build.mjs --output work/extension-formatting-2026-10-14/extension
node --test tests/extension.test.js tests/extension-selection.test.js
node tests/extension-selection-browser.mjs
node scripts/chrome-extension/check.mjs --extension-root work/extension-formatting-2026-10-14/extension
node scripts/chrome-extension/check.mjs --staging --extension-root work/extension-formatting-2026-10-14/extension
```

To try this candidate, open `chrome://extensions`, disable the existing
PasteToSpeech extension to avoid duplicate menu items, choose **Load unpacked**,
and select the absolute folder
`/home/roger/workarea/paste2speech/work/extension-formatting-2026-10-14/extension/production`.
Close the old extension reader tab and invoke the menu on a fresh selection.
Use the sibling `staging` folder for staging instead; that reader still requires
its normal Access sign-in. Keep the candidate folder in place while installed.
To revert, disable the candidate and re-enable the existing extension. A native
menu click on an ordinary webpage remains the final manual acceptance check;
automation invokes the same handler and tests real script injection on a local
fixture covered by the existing reader-origin grant.

The installed `dist/chrome-extension/production` remains untouched by this
candidate workflow. This extension-only fix uses the existing reader protocol;
it needs no reader deployment, billing change, or Chrome Store publication.
Future regular builds include version 0.1.1 and the two temporary-access API
permissions above. Reload an installed package after rebuilding it.

## Release

Use `main` in `/home/roger/workarea/paste2speech` and preserve the current public configuration.
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
