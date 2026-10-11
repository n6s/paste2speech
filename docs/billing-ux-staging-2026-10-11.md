# Staging balance and scanning wording — October 11, 2026

Roger approved implementing and deploying these UX refinements on staging only.
The main reader leads with approximate listening hours at normal speed **OR**
whole scanned pages. One shared balance funds paid cloud-voice audio and scanning;
using either reduces both alternatives. Browser voices remain free. These are
new-audio capacity equivalents, not independently promised allowances or tracked
listening time. Existing prepared audio replay still uses no credits.

The fixed display assumption is 150 words/minute × six characters/word including
spaces × 60 = 54,000 characters/hour. Listening hours are approximate, displayed
to one decimal; positive values below 0.1 are labeled as less than 0.1. Whole scan
pages round down from the **available** balance, excluding held credits. The UI
uses no listening history, provider duration samples, telemetry or additional
usage collection. `public/balance-capacity.js` documents this assumption; the
Balance & usage view explains that text and voice affect actual audio length.

Exact available/held credits, character pricing, the $10/1,000-credit pack and
refund rules remain under expandable details. Creating summaries uses no credits;
creating paid-voice audio from the summary uses the usual speech credits. The
scan feature is named “Scan text from images & PDFs,” with optical character
recognition (OCR) explained in details. The upload consent still names Mistral,
the whole file/page count and its exact credit hold before any processing. No
automatic upload, provider retry, new wallet grant or financial migration occurs.

Source changes are presentation only. All billing rates, wallet operations,
financial history, identity and security checks, provider limits and environment
configurations remain. Production billing and deployment are outside this scope.
The release preserves the installed Chrome extension. Validation uses isolated
Chrome profiles with intercepted APIs/Paddle, synthetic OCR and cached speech;
no real purchases, refunds or paid provider calls are needed. The required staging
release pipeline and served asset verification still apply. Evidence is retained
in the ignored `work/billing-ux-staging-2026-10-11/` directory.

The isolated browser regression checks the reader and balance view at 320, 390
and 780 pixels with 100%, 150% and 200% text size. A staging-only stylesheet
allows playback/cleanup controls to wrap and keeps the shared-balance explanation
visible in the compact header. Hosted verification uses the existing Cloudflare
Access session and intercepts all account/provider APIs before network dispatch.
