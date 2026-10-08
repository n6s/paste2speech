# Summary staging prototype

Summary is staged separately from public production and billing. The UI is enabled
only by `ENABLE_SUMMARY_UI=1` in the staging build. It preserves an original in the
current tab, provides an editable result, and explicitly loads that result into the
existing reader. Clear, new paste and new document import retire it. Typing never
invokes inference; each request requires the source-specific consent checkbox and
Summarize button. No source or summary is stored in D1, R2 or localStorage.

The deployed initial state deliberately has no Workers AI binding,
`SUMMARY_LIVE_APPROVED=0` and `SUMMARY_BUDGET_CENTS=0`. The UI explains this pause.
Production always returns 404 for Summary routes and has no Summary UI.

## Concrete activation proposal, awaiting approval

- Add a staging-only Workers AI binding named `AI`; no new API credentials.
- Apply `staging-migrations/0008_summary_attempts.sql` to staging D1 only.
- Set `SUMMARY_LIVE_APPROVED=1`, `SUMMARY_BUDGET_CENTS=5` in staging.
- Use `@cf/meta/llama-3.2-3b-instruct`, 12,000 UTF-8 source bytes,
  bounded 18,000-byte request JSON, 512 output tokens, temperature 0.1.
- Only the existing verified, enabled owner account can use it. No public users.
- Atomic D1 admission reserves one whole cent for every attempt. A five-cent
  lifetime aggregate cap admits at most five calls, two per hour, five per UTC
  day. No automatic top-up, reset, reserve release or inference retry. Failed,
  canceled and uncertain calls remain counted. The 30-second response timeout
  does not promise that server-side inference is canceled.
- Source is JSON-encoded data in a user message, separate from a faithful-summary
  system instruction. No tools, retrieval or external facts. Output is plain text
  and must be reviewed for possible model omissions or inaccuracies.

Published Cloudflare pricing checked October 8, 2026:
https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/
$0.0509/M input tokens and $0.335/M output tokens. Conservative byte-as-token
bounds for the accepted request and prompt plus 512 output tokens are below one
cent per call, so one-cent reservations have substantial headroom. The cap is
for this feature's inference only, not the account's other usage. If model pricing
or tokenization changes, recheck the bound before activation.

https://developers.cloudflare.com/workers-ai/platform/pricing/
The shared 10,000-neuron daily allowance does not ensure a call is free on a paid
account. Existing staging metadata confirmed no AI binding; subscription lookup
with the existing token returned HTTP 403. No access scope was expanded, no real
inference was called, and no real documents were transmitted during development.

## Verification

`node --test tests/summary.test.js`: real SQLite atomic admission with mocked AI;
production and approval gates, verified owner, byte limits, consent, prompt/output
bounds, duplicate keys, hourly and global caps, failures retaining reservations.

`node tests/summary-browser.mjs`: real isolated Chrome, local UI module, synthetic
source and intercepted responses; consent, explicit request, editable result,
original restoration after result edits, Read mode, stale-response dismissal,
duplicate suppression and 390px viewport. This does not validate model quality or
Workers AI account authorization. Existing full release/browser checks remain
required. Live inference requires the activation approval above, followed by only
synthetic/nonprivate smoke-test content within the approved cap.
