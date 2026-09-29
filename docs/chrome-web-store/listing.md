# PasteToSpeech — Chrome Web Store submission

Prepared September 28, 2026. Local materials only; nothing submitted or published.

## Upload

Run `npm run package:extension` from `/home/roger/workarea/paste2speech`.
Upload `dist/chrome-extension/store/pastetospeech-0.1.0-webstore.zip`.
This ZIP has `manifest.json` at its root. The older download ZIP has an enclosing
folder and is not the store-upload package. Upload production only, not staging.

## Store listing

Name: PasteToSpeech

Summary (also in the manifest):

Read highlighted text aloud with PasteToSpeech using your saved voice and speed.

Detailed description:

Highlight something worth listening to. Right-click “Read with PasteToSpeech”
and the reader opens with your selection, ready to speak using your saved voice
and playback speed.

• Send selected text from a webpage without copying and pasting.
• Start listening automatically where Chrome permits it. If playback is blocked,
  press Play in the reader.
• Pause, resume, and adjust playback speed in PasteToSpeech.
• Send another selection to replace the reading in the extension’s reader tab.
• Use the toolbar popup to open the reader or retry an unfinished delivery.

The extension is free to install. Browser voices are free and do not require an
account. Optional Google WaveNet voices use purchased speech credit through
pastetospeech.com; the extension itself does not process payments. Chrome on a
desktop computer is required. Voice availability depends on your device.

The extension receives only the text you select and explicitly send. It does not
scan source pages in the background or collect their URLs or browsing history.
It temporarily holds an unfinished delivery in Chrome session memory, then passes
it to the PasteToSpeech reader. Speech processing follows your chosen voice:
browser voices use your device’s speech service, which may connect to the internet;
WaveNet sends cleaned reading text to Google Cloud.

Website: https://pastetospeech.com/
Support email: rogerpbrown@gmail.com
Language: English
Suggested category: Productivity (choose the closest matching dashboard label).
Distribution recommendation: Unlisted initially; anyone with the link can install.
This is a recommendation, not a visibility setting already saved in Google.

## Privacy tab

Single purpose:

Read user-selected webpage text aloud by sending it to the PasteToSpeech reader
with the user’s existing voice and playback settings.

contextMenus justification:

Adds “Read with PasteToSpeech” to Chrome’s context menu when the user selects text.
The click supplies the selected plain text, so the extension does not need to
inject code into or scan the source webpage.

storage justification:

Uses chrome.storage.session to hold one pending text delivery, its request ID,
sequence, destination tab ID, and delivery status. The text is removed after the
reader acknowledges it, when the owned tab is closed, or on browser restart.
Undelivered text expires after ten minutes and is removed on the next extension
wake/access. The extension does not use synced or persistent local storage.

Host permission justification (https://pastetospeech.com/*):

Identifies and reuses the reader tab created by the extension and runs its packaged
content script on the reader’s home page. The script passes the selected text to
the initialized reader and returns a delivery acknowledgment. This permission does
not authorize access to the webpages where the user selects text.

Remote code:

No remotely hosted code executes in the extension. Its service worker, popup and
content script are bundled in the upload. It opens the normal PasteToSpeech website,
which runs its own web application and speech service. Website messages contain
text and delivery status, not executable instructions for the extension.

Data collection:

Disclose **Website content** for selected text. Do not select “no user data.”
The extension does not separately collect source browsing history, account emails,
credentials, payment details, health records, location, or activity logs. A user’s
selected text can itself contain personal or sensitive information; that text is
handled as described in the privacy policy. The connected website’s optional
account, payment, feedback and aggregate-statistics processing is described
separately in its existing policy. Review the actual dashboard wording before
certifying the declarations; if it asks about the connected service as a whole,
include the relevant website processing too.

Limited-use certifications: the intended product use is speech playback and the
related user-facing reader features. No sale of extension user data, advertising
use, creditworthiness assessment, or lending use is part of this implementation.
The publisher should confirm these statements before submitting the certifications.

Privacy URL (verify the deployed section before submitting):
https://pastetospeech.com/terms#chrome-extension

The extension-specific section is included in `cloudflare/reader/terms.html`,
with a reference copy in `privacy-addition.html`. Deploy through staging and public
production and verify the section at the URL above before store submission.

## Reviewer test instructions

No account, credentials, purchase, or paid speech is required to test the core flow.

1. Install the production extension. Open https://pastetospeech.com/ and select
   Browser voices if another engine is selected. Browser voices depend on the OS.
2. Open a normal webpage with selectable text. Highlight a paragraph, right-click,
   and choose “Read with PasteToSpeech”.
3. A new reader tab comes forward with the selection and attempts playback. If
   Chrome blocks automatic playback, use Play. Pause and resume in the reader.
4. Send a different selection. The extension reuses its own tab and replaces the
   reading. Independently opened reader tabs are not overwritten.
5. Open the toolbar popup to view status, open the reader, or retry a pending
   delivery. Closing or navigating away from the reader is recovered on a new send.

Optional WaveNet speech requires an existing verified account and purchased credit;
it is not necessary for this review. This submission contains no private staging
hostnames, Cloudflare Access requirement, or testing-mode UI.

## Listing images

Files generated under `dist/chrome-extension/store/`:

- `icon-128.png`: approved brand artwork, 128 × 128 with transparent padding.
- `promo-440x280.png`: small promotional tile.
- `screenshot-reader-1280x800.png`: real reader UI with original sample text.
- `screenshot-controls-1280x800.png`: real reader controls with the same sample.

Screenshots show the local production build with the free browser-voice flow.
They use original sample text and no real customer accounts or paid synthesis.
The promotional tile is branded explanatory artwork, not a simulated Chrome menu.

## Sources checked

- https://developer.chrome.com/docs/webstore/prepare
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/user_data
- https://developer.chrome.com/docs/webstore/cws-dashboard-distribution

## Rebuild the materials

Run `npm run package:extension` to build and validate the production upload ZIP. Run `npm run build:reader:public` followed by `node scripts/chrome-extension/store-assets.mjs` to regenerate the local reader screenshots and promotional images. The image script needs Google Chrome and ImageMagick. These commands do not deploy or submit anything.
