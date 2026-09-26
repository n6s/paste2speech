# Future feature ideas

Saved September 24, 2026, after Roger reported being very happy with the reader
and wanting to let it soak. These are ideas to revisit when he is ready—not an
implementation plan, launch requirements, or authorization to enable paid services.

## Introduce free users to WaveNet

Help free browser-voice users discover the natural paid voices.

- Start with a short curated passage, generated once and cached for each voice.
  A “Hear the natural voices” action near the voice selector lets people compare
  the same passage without signing in or consuming speech credit.
- Consider a small free-character allowance so people can hear their own text.
  Decide account limits, abuse controls, and provider-spending limits first.
- Cached previews are the simplest candidate and need not wait for live billing.

## Encourage sharing

- Add a simple share action after a completed reading or recording download.
- Share the site URL and an optional short message, not the user's reading text.
- Existing project attribution in MP4 title cards and metadata provides a path
  back to the app when people share recordings.
- Later, consider referral speech-credit rewards for both people after a
  qualifying purchase. Settle provider acceptance, self-referral prevention,
  refund handling, and economics after billing works.

## Browser extension: selected text to reader

Roger especially liked this interaction:

**Select text → right-click → Read in Paste to Speech.**

Open the existing reader with the selected text ready and saved voice/speed
preferences. Keep playback, downloads, accounts and billing in the web app;
make the extension small and focused. Only transfer text the user selected.

Possible later extensions: keyboard shortcut, main-article extraction without
menus/ads, and playback controls within the source page. These are secondary to
the selected-text right-click workflow.

## Premium scan-to-speech and image input

Accept photographed pages and scanned/image-only PDFs, including multipage PDFs.
Use high-quality AI-assisted OCR to recover faithful text and reading order from
columns, headings and imperfect scans, then feed it into the existing reader.

Expanded September 26, 2026: treat screenshots, book-page photographs and scans
as related ways to supply text for listening. Support a series of images, with
clipboard image paste alongside file upload and camera input. This helps when
text is visible but inconvenient to copy—for example, an AI response split across
several chat bubbles that can only be copied individually.

- Shared flow: add images → review/reorder pages → extract into one continuous
  reading → review if needed → play. Make repeated clipboard pastes convenient.
- For books, preserve paragraph continuity across pages, join words hyphenated
  at line breaks, and omit page numbers and repeated running headers.
- For chat screenshots, preserve bubble order, offer “Replies only” or “Whole
  conversation,” and skip interface labels and controls. Consider removing
  duplicated passages when consecutive screenshots overlap.
- Preserve the author's wording rather than summarizing. Flag uncertain or
  clipped text instead of guessing what was outside the image.
- Keep the phone workflow short enough to be useful for preparing listening
  before a drive or while stopped. Test the interaction with real screenshots
  and book photos as well as extraction accuracy.

- Let users review and correct extraction before generating speech; flag uncertain
  text rather than silently inventing or rewriting it.
- Roger favors a strong OCR service and charging enough to preserve profit.
- Quote document processing and speech costs clearly before starting. Account for
  retries, hosting, payment fees and margin; avoid charging speech allowance for
  failed OCR or extraction retries.
- Benchmark real clean/difficult scans and photos for accuracy, reading order,
  latency and measured cost before picking a provider or setting retail prices.

### Google Cloud candidates

Roger already has the Google Cloud billing relationship used by WaveNet and wants
to explore suitable services there first. Additional APIs/permissions still need
setup; no OCR service has been enabled or tested for this project.

- Enterprise Document OCR: baseline text extraction.
- Document AI Gemini layout parser: OCR plus document structure understanding;
  a promising first benchmark for listening-friendly reading order.
- Direct Gemini document understanding is another comparison candidate if needed.

Research on September 24 listed approximate standard processing costs of
$1.50/1,000 pages for Enterprise Document OCR and $10/1,000 pages for Layout
Parser (about $0.15 or $1 per 100 pages). These are dated research estimates,
not verified account quotes or customer prices; recheck rates, applicable model
versions, add-ons, free allowances and other charges when revisiting.

References:
- https://docs.cloud.google.com/document-ai/docs/layout-parse-chunk
- https://cloud.google.com/products/document-ai/pricing
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/samples/googlegenaisdk-textgen-with-pdf

## Personal paid-usage projections and value

Add a quiet, optional “Your usage” section on the account page to help people
assess what their speech packs buy in their own reading routine.

- Show the exact remaining character balance, estimated days remaining at the
  user's recent pace, and equivalent monthly spending at that pace. Spending is
  an estimate for prepaid packs, not a subscription or scheduled charge.
- Base projections on the user's actual paid-character deductions, accounting
  for returned allowance. Use a rolling 30-calendar-day window including days
  with no usage; exclude staging, development, and project-wide Google totals.
- Label shorter histories as early estimates and show the observation period.
  With too little history or no recent usage, show the balance without a forecast.
- Use conditional wording such as “At your recent pace…” Packs do not expire;
  estimated days remaining should not look like an expiration date or create
  pressure to purchase.
- Consider a value measure such as hours of speech generated from paid credit.
  Generated audio duration is not measured listening time, and replay should not
  increase paid usage. Per-pack claims would need reliable attribution when users
  have multiple packs.

Illustrative example for the discussed $10 / 1-million-character pack:
“840,000 characters remaining—about 35 days at your recent pace of 24,000
characters per day.” This is example copy, not a promised amount of use.

## When revisiting

Choose one small feature based on Roger's priorities at that time. The earlier
suggestion of cached previews plus a simple share action was a possible first
slice, not a commitment. Preserve the stable reader and keep live billing changes
separate from these ideas.
