# Summary on staging: Workers Free daily allowance

Roger approved the staging-only upstream daily-allowance policy and simple style
controls on October 9, 2026. Production has no Summary UI or AI binding and returns
404 for Summary routes. No plan upgrade, billing change or paid fallback is included.

## Free-plan assumption and business decision

The authenticated Cloudflare Workers plans dashboard for account
`c71dba5be3cc617a904adc61e767704d` showed **Free → Current plan** on October 9.
That account hosts both staging and production. Workers Free supplies 10,000 AI
neurons/day, shared with other apps/models in the account, and stops inference on
exhaustion until 00:00 UTC. This application cannot control other apps' consumption.

Staging configuration requires `SUMMARY_ALLOWANCE_MODE=upstream-free-daily`,
`SUMMARY_WORKERS_PLAN=free`, `SUMMARY_LIVE_APPROVED=1` and its existing `AI` binding.
Unknown/paid configuration fails closed. The plan marker is a verified configuration
assumption, **not a live subscription monitor**: existing API credentials cannot
read the subscription API (403); no scopes were expanded. Pause Summary before
upgrading/changing the account plan. A future Workers Paid capacity/budget decision
requires paying customers to justify it and Roger's explicit approval. Never
silently upgrade, add overages, route through prepaid AI Gateway, or fall back to
a paid model/provider.

https://developers.cloudflare.com/workers-ai/platform/pricing/
https://developers.cloudflare.com/workers-ai/platform/errors/
https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts

## Request and privacy boundaries

- Summarize is the explicit source-specific consent action, with a concise visible Cloudflare AI disclosure beside it. There is no separate checkbox; typing never invokes inference.
- Original retained in the tab, editable result, explicit load into existing reader.
  Ordinary result edits preserve original restoration. Clear, new paste and document
  import retire that saved source. A language/length change cancels stale results
  without clearing the original or an existing edited summary.
- Language: General audience, Plain language, Technical. Length: Brief, Standard,
  Detailed. Defaults: General audience / Brief. These are validated enums selecting
  trusted instructions, not arbitrary prompt text. No ASD-STE100 compliance claim.
- `@cf/meta/llama-3.2-3b-instruct`; source at most 24,000 UTF-8 bytes; request JSON
  at most 150,000 bytes; output at most 512 tokens and 8,000 characters; response
  timeout 30 seconds. Detailed adds detail within the same output limit.
- No per-user hourly/daily quota or experimental five-attempt/five-cent cap.
- One shared D1 lease permits one admitted Summary request at a time. A canceled or
  timed-out call may continue upstream; its request key stays recorded and lease
  stays held until settlement or its conservative 120-second expiry. No automatic
  inference retries. This is concurrency safety, not an allocation per user.
- No source or summary stored by Summary inference in D1, R2 or localStorage.
  D1 stores request keys, account IDs, timestamps and states only. Existing reader
  playback/storage follows the separate speech policy. Review model output for
  omissions or inaccuracies before use.

## Errors and shared circuit

Raw binding responses retain structured provider codes; do not parse user-facing
error text or treat every 429 as daily exhaustion.

- Only provider code **3036** sets the shared D1 daily circuit to exact next 00:00
  UTC. Other isolates/accounts using this staging endpoint are blocked without
  invoking AI. Config returns the reset time. The UI preserves usable summaries
  and rechecks availability at reset; that check never generates a summary.
- **3040** or unclassified HTTP 429: temporary capacity/rate pressure, try later.
  No midnight lockout. Capacity responses suggest a short retry delay.
- **3007/3008** or HTTP 408: timeout/interruption, no automatic retry.
- Model/account permission (including **5035**) and configuration errors are
  distinct; midnight does not fix them.
- Even a late confirmed 3036 after a response timeout updates the shared circuit.

Apply `staging-migrations/0009_summary_free_allowance.sql` to staging D1 only.
Migration 0008 and its experimental reservations remain historical and unchanged;
they do not limit new requests. No production migration is implied.

## Verification

`node --test tests/summary.test.js` uses SQLite atomic admission and mocked raw AI
responses: no per-user cap, invalid enums, injected options, output bounds, request
key deduplication, cross-request concurrency, daily/reset boundaries, late quota,
capacity/auth/model/timeout distinction and unknown/paid configuration gates.

`node tests/summary-browser.mjs` uses isolated local Chrome and intercepted APIs:
single-action consent, collapsed keyboard-accessible settings, options/defaults, editable results, original restoration, stale source and
option changes, cached daily message/reset metadata-only refresh, retained result
on capacity/quota failures, and 390/320px layouts. Actual quota exhaustion is never
used as a test. Full staging release and existing OCR/speech browser checks remain
required; any minimum real smoke call uses synthetic nonprivate text only.

## Article-size input bound and disabled reason

The staging cap is 24,000 raw UTF-8 bytes. JSON-encoded source is separately
bounded at 30,000 bytes and complete system/user content at 32,000 bytes before
admission. Llama uses byte-level tokenization: using a conservative one-token per
UTF-8 byte bound leaves more than 47,000 of the hosted 80,000 context tokens for
chat framing and the unchanged 512-token output. This does not equate ordinary
character counts to token counts. Escaping control characters can expand JSON,
so the encoded guard is necessary. Request transport accepts 150,000 bytes to
permit escaped input validation; that transport cap is not model admission.

The UI derives an explicit oversized-source message next to Summarize, showing
actual raw/encoded byte counts, maxima and the smaller-section action. Settings changes cannot hide this reason. Summarize submits the current source
at the moment of the explicit click, without a separate consent checkbox. Full source remains intact. Boundary
checks cover a 15,852-character ASCII article, exact 24,000-byte ASCII and emoji
sources, one byte above the bound and escape-heavy controls. No automatic
truncation, section submission or retry is introduced.

## Minimal default flow

Language and length live in a native, initially collapsed More settings disclosure.
General audience / Brief remain the defaults. Opening or closing settings does not
submit anything and retains selections. Changes during a request still cancel and
invalidate its result while keeping the original and existing edited summary.
The explicit Summarize button sends `consent: true` with the current source;
backend validation still requires consent. No dialog, automatic inference or
additional required decision is added. Visible default copy is brief.

## Leading model-preamble cleanup

The prompt asks for summary content directly. The backend removes one anchored
leading preamble matching “Here is a summary of the source text in concise plain
text:” or “Here is a summary of the provided source text in concise plain text:”,
including case variants and simple bold/heading/list Markdown wrappers. It never
deletes a generic first paragraph or arbitrary heading. A matching phrase present
in the source is ambiguous and remains untouched; later occurrences and quotes
remain untouched. If cleanup leaves no content, the request fails safely with the
original intact and no automatic retry. These checks precede returning a summary
for editing or speech; user edits are never scrubbed by this rule.
