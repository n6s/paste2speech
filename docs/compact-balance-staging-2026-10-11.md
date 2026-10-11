# Compact remaining balance and selective test cleanup

Roger approved this staging-only refinement on October 11, 2026. His mobile
screenshot was retrieved from Library (`libfile_f7e6848ae2288191a3f369f56945e3fc`)
and inspected locally before the layout change.

The reader labels **Your remaining balance**, followed by a compact estimate such
as **≈ 1.8 hours or 47 pages**. A native, keyboard-accessible **Details** control
contains the shared-balance explanation, fixed normal-speed assumptions, free
browser voices, summary-creation versus paid-audio terms, the existing per-reading
cost details, and a link to **Balance & usage** for exact credits and prices.
Balance & usage uses the same remaining-balance label and places its explanation
inside Balance details. Repeated scan-panel capacity is inside Scanning details.
The file-specific upload disclosure, whole-file page count, credit hold, Mistral
consent and disabled-until-consent control remain visible before a paid upload.

At 390px with identical synthetic balance (95,301 units), paid voice selected,
closed panels and normal text size, the reader header shrank from 243.55px to
127.67px. The text box begins at 389.67px instead of 505.55px: 115.88px less vertical
space. The source screenshot's browser chrome is excluded from these measurements.
The estimate remains fixed at 54,000 characters/hour and whole pages round down
at 2,000 units/page. Rates, credit units, account data and billing behavior did
not change. No usage history is used to derive the estimate.

## Approved test cleanup

- Removed the old CSS clipping reproduction from the routine mode browser gate;
  retained all 27 current width/text-size/mode combinations, full labels,
  checkmarks, touch targets, keyboard selection, source preservation and focus.
- Replaced its exact selected RGB assertion with visually distinct selection and
  at least 4.5:1 selected-label contrast. Current geometry and focus checks remain.
- Moved two retired staging ceiling cases to
  `tests/historical/mse-staging-ceilings.test.js`. They remain runnable explicitly;
  the routine suite retains migration idempotency, historical records, current
  reservation enforcement, staging guards and production-isolation checks.
- Capacity tests assert structured numerical results and alternative-use/shared
  balance semantics, allowing incidental wording and punctuation to vary.
- Clipboard link tests record speech starts without completing every utterance.
  All long Android no-anchor/HTML-loss and item-order payloads remain, now also
  asserting one explicit speech start per Paste & Play. Dedicated permission,
  fallback, text-preservation, Paste-without-autoplay and autoplay checks remain.
- Offline and built-offline gates were left unchanged, as requested.

The routine suite changes from **413 to 411 cases across the same 46 files**.
The two optional historical cases also pass. Moving those cases is primarily a
maintenance improvement; a single unit run is not evidence of a substantial
speedup. Browser and Python checks are additional to these JavaScript case counts.

Single sequential runs measured: clipboard 35.63s → 2.30s (33.33s saved, 93.55%);
mode gate 6.34s → 6.21s; routine unit gate 4.53s → 4.46s. The smaller unit/mode
differences are within ordinary run-to-run variation. Explicit autoplay remains
asserted for all seven Clear, Paste & Play item-order cases.

Benchmark logs, before/after mobile captures, release-gate output and hosted
asset/browser verification are retained under
`work/compact-balance-staging-2026-10-11/` (ignored). Full release and hosted checks
must pass before calling this deployed. Tests use isolated Chrome profiles with
intercepted synthetic APIs; they make no real payments, credit grants or provider
requests. Physical Android testing remains a user follow-up.
