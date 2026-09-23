# Sandbox rehearsal — September 23, 2026

Executed against the existing isolated staging deployment at
`https://speak-staging.rogerpbrown.com`. No deployment or production mutation.
The user authorized sandbox purchase/refund testing and separately approved one
reading of at most 500 characters with a $0.01 Google spending limit.

## Observed results

- Existing verified staging session loaded successfully; initial credit 485,528.
- Paddle checkout visibly showed Test Mode on `sandbox-buy.paddle.com`.
  Used Paddle's documented test card and synthetic test billing postcode.
- One $10 pack plus $0.89 simulated tax completed successfully.
  Transaction: `txn_01m37beh2d4ckv53zjvfwqsrm3`.
  Order: `3705d29c-bc39-42c7-8f34-f16dfcb1face`.
- Browser balance became 1,485,528. Refresh and page reload preserved the same
  verified account and balance. Remote staging ledger confirmed exactly one grant,
  order credited, transaction completed, and zero revoked characters.
- Full sandbox refund requested for this transaction only:
  `adj_01m37bhr1b01t3mj9s8mx1t3g9`. Initially pending approval; no premature
  removal of credit. Left the billing page to test background reconciliation.
  Paddle approved at 14:50:03 UTC; background reconciliation recorded the result
  at 14:50:16 UTC without the billing page open. Ledger confirmed 1,000,000 revoked,
  exactly one retained grant record, and final balance 485,406 (original less the
  122-character reading). Zero open reservations; no manual ledger mutations.
- One British WaveNet F reading completed, with full preparation before playback.
  Input 123 characters; two spoken sections total 122 characters (the separating
  space is not synthesized). Balance became 1,485,406. Reading ID:
  `d271ae60-998d-4a43-826c-32233770c4dc`.
- Playback reached the end; replay finished with unchanged balance. Remote audit
  reports ready, 122 submitted characters, 8.496 seconds, and zero remaining
  reservation. Lifetime staging dispatch counter changed 23,978 -> 24,100,
  confirming no new provider admission for replay.
- MP3 and VTT links appeared and were clicked. The user observed the download
  windows, confirmed downloads have worked previously, and requested no further
  saved-file checks. File contents were not inspected. The browser policy blocked
  the downloads manager; no workaround attempted. Recording left available in staging.
- 40 targeted Node tests passed across reader-public, reader, reader-production,
  and prepared-payments: signed webhook rejection/deduplication, exact grants,
  refunds/debt, lost-response recovery, reservations, cached-audio preparation,
  ownership, and restart behavior. These are automated tests, not proof of Paddle
  webhook delivery to a deployed public endpoint.

## Limits

Staging uses polling behind Cloudflare Access. Actual signed Paddle webhook
delivery remains a separate production launch gate. Reload recovered the existing
session; a new-device email-link sign-in was not exercised. Playback progress was
observed, but no human listening-quality acceptance is claimed. Full refund is a
test-only reconciliation exercise, not a demonstration of unused-credit support
policy after consumption. No real Paddle charge/refund or public activation.

References:
- https://developer.paddle.com/sdks/sandbox/
- https://developer.paddle.com/build/transactions/create-transaction-adjustments/
