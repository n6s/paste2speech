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

## Premium scan-to-speech

Accept photographed pages and scanned/image-only PDFs, including multipage PDFs.
Use high-quality AI-assisted OCR to recover faithful text and reading order from
columns, headings and imperfect scans, then feed it into the existing reader.

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

## When revisiting

Choose one small feature based on Roger's priorities at that time. The earlier
suggestion of cached previews plus a simple share action was a possible first
slice, not a commitment. Preserve the stable reader and keep live billing changes
separate from these ideas.
