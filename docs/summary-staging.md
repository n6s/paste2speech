# Summary: current staging price and provider allowance

Roger approved the staging-only upstream daily-allowance policy and simple style
controls on October 9, 2026. Roger approved promotion to public production on October 9, including a
persistent AI binding and additive Summary usage tables. Public mode uses
existing customer eligibility plus a current verified session; historical owner
trial mode remains excluded. That original release included no plan upgrade, billing change or paid fallback. The October 11 staging price below supersedes its free customer-pricing and retention descriptions; public production retains the original free Summary behavior.

## October 11, 2026: one-credit staging Summary

Roger approved **1 shared credit (1,000 wallet units, $0.01 at the $10/1,000-credit
pack face value) per successful accepted ordinary Summary**. Staging enables
`SUMMARY_PRICE_CREDITS=1`; public production has no price flag and remains free.
There is no new purchase SKU, subscription, refill, plan upgrade or paid AI fallback.
The model, input/output bounds and provider allowance policy below are unchanged.

The first-use button says “Summarize · 1 credit ($0.01)” and explains the hold,
Cloudflare AI transfer, acceptance cutoff, retention and separate speech cost.
Optional remembered one-tap consent uses `cloudflare-summary-1-credit-receipt-v1`;
an earlier free preference cannot authorize a paid action. Choices are scoped to
account, operation and policy. No source is sent on typing or ordinary text paste.

`POST /api/summary` atomically acquires the shared provider lease, records a
source/settings hash and reserves exactly 1,000 units from the existing wallet.
An immutable dispatch marker precedes the single provider call. Valid output is
saved privately, but only prepared receipt metadata is returned. The current UI
checks the unchanged source, settings, account and price before accepting it via
`POST /api/summary/accept`. Acceptance consumes the existing hold once and returns
the output. Concurrent acceptance, duplicate receipts and lost settlement
acknowledgments recover the same saved result without a second AI call or charge.
**Acceptance is the charge cutoff:** cancellation/source changes before acceptance
release the hold; a result already accepted remains charged and recoverable.
Cancellation racing acceptance resolves to exactly one settle or one release.

Provider failure, malformed/empty output, allowance exhaustion, uncertainty,
pre-acceptance cancellation, account suspension, debt and abandoned prepared
results use zero customer credits. Holds expire after 120 seconds and are released
by the existing minute maintenance task. Refund releases reduce any wallet debt
before creating available credit. Speech, OCR, refunds and Summary share the same
integer balance; refundable Summary holds are included in purchase liability.

Apply only `staging-migrations/0011_summary_credits.sql` to **staging** after a
private D1 export. It adds separate `summary_credit_attempts`, immutable
`summary_credit_events` and `summary_credit_results` tables and extends the staging
capacity view. It does not rewrite old wallet events, grants, balances, orders or
legacy reservations. Generated output, not source text, is stored in the result
table for 24 hours from generation completion. Canceled/unaccepted output is
removed at cancellation/hold expiry. Expired accepted output is inaccessible and
maintenance deletes it; financial receipt metadata remains. This short recovery
retention is included in the new consent and staged terms.

Cached reopening in the same tab is free, retains edits and does not infer again.
Receipt replay is owner-authenticated and account scoped; no general recent-result
UI or browser-restart recovery is promised in this change. Re-generating through
the priced button is a fresh paid request. No inference retries occur automatically.

Oversized text is rejected **before credit reservation or AI invocation**, with
all original text intact. Keep the full document open, copy a smaller excerpt into
a separate reader tab, and summarize that excerpt. There is no silent prefix
truncation, whole-book claim, recursive/chunked summary or raised input cap.
The browser shows both actual raw UTF-8 bytes and encoded-source size.

Verification: `tests/summary-credits.test.js` checks exact one-credit accounting,
debt/refund races, cross-service holds, cancellation at each stage, lost admission/
dispatch/settlement acknowledgments, lease contention, expiry, foreign accounts,
immutable history and unchanged prior rows with foreign-key checks. The isolated
`tests/summary-credits-browser.mjs` verifies priced first use, free-to-paid
reconsent, cached edits, lost acceptance recovery, stale source/length cancellation,
account/policy/credit checks, oversized input and 320/390px layouts. Providers and
wallets are synthetic. Existing free Summary and whole-reader release gates remain.

Rollback keeps all receipt/event tables and historical financial rows. Before
returning to an older Worker or removing the flag, release all held/prepared
attempts using the current cancellation/expiry implementation (or a reviewed
`UPDATE summary_credit_attempts SET state='canceled',updated=<now>` restricted to
those states); its triggers refund exactly once. Remove expired/abandoned output,
then restore the prior staging `unified_capacity` view if reverting its definition.
Do not delete journals, replay grants, rebuild wallets or restore a stale database
backup over live payment/activity history. The migration is passive for old code
before priced deployment. A private exported database restore is checked locally.

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
  import retire that saved source. A length change cancels stale results
  without clearing the original or an existing edited summary.
- General audience is built into every new UI request; there is no audience/style
  selector. More settings contains only Length: Brief, Standard or Detailed, with
  Standard selected initially. The backend retains its validated legacy style
  enums for compatibility; existing trusted prompts and model limits are unchanged.
  No ASD-STE100 compliance claim.
- `@cf/meta/llama-3.2-3b-instruct`; source at most 24,000 UTF-8 bytes; request JSON
  at most 150,000 bytes; output at most 512 tokens and 8,000 characters; response
  timeout 30 seconds. Detailed adds detail within the same output limit.
- No per-user hourly/daily quota or experimental five-attempt/five-cent cap.
- One shared D1 lease permits one admitted Summary request at a time. A canceled or
  timed-out call may continue upstream; its request key stays recorded and lease
  stays held until settlement or its conservative 120-second expiry. No automatic
  inference retries. This is concurrency safety, not an allocation per user.
- In the original free/public flow, no source or summary is stored by Summary inference in D1, R2 or localStorage.
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

Only length lives in the native, initially collapsed More settings disclosure.
General audience is automatic and Standard is the initial length. Opening or
closing settings or switching reader modes retains the chosen length without
submitting anything. Summary settings were not persisted in localStorage; no
storage migration or changes to unrelated reader preferences are needed. New
requests explicitly send General audience and cannot restore a legacy audience.
Changes during a request still cancel and
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
