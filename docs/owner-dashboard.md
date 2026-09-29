# Private owner dashboard

Prepared September 28, 2026. Not deployed by this implementation.

After the normal staging/public release, open `/api/owner` on the reader domain.
Sign in through Account with the email configured in `OWNER_EMAIL`, then return
to the dashboard. Production and staging use separate sessions and databases.
A current `verified` session and enabled owner account are required for the HTML,
JavaScript, and report endpoint. Missing owner configuration fails closed; legacy
browser credentials, anonymous sessions, and other verified users are denied.
All dashboard responses disable caching and indexing. There is no public asset
copy of the dashboard and no new third-party script or tracking.

The dashboard reads existing records only, with manual refresh and UTC calendar
windows (today, seven days including today, or since September 28 launch day).
No migration, provider call, payment reconciliation, credit mutation, or automatic
polling is involved. Production uses the existing feedback/statistics database
for events and the production ledger for accounts, preparations, and orders.
Staging uses its own ledger for both. `OWNER_EMAIL` is an explicit independent
access setting, not the public checkout launch gate.

## Interpretation

- Anonymous page views and playback starts include repeats, owner visits, and
  potentially earlier-domain/private-reader activity sharing the event database.
  They cannot establish unique visitors. Privacy opt-outs and blocked requests
  are omitted. Retention is 90 days, including when Since launch is selected.
- Verified-account counts are current totals, not signups in the chosen window:
  historical signup timestamps do not exist. No customer emails are returned.
- WaveNet preparations are reservations admitted through `public_jobs`, grouped
  by start time. Separate parts of a long reading count separately. Current
  consumed characters and terminal outcomes are shown, including partial usage.
  Private pilot and staging fixture jobs are excluded. Active accounts means
  accounts starting these preparations, not people currently listening.
- Completed purchase counts include refunded/reversed purchases. Reversals count
  orders with revoked credit; they are not necessarily refunds. Order creation
  time determines the window; completion/refund time is not available here.
  Production excludes sandbox orders. Paddle remains authoritative for revenue,
  fees, taxes, and financial reporting.
- Account-based metrics separate the configured owner's account. Other owner
  aliases/accounts cannot automatically be recognized. Current operational
  counts cover all accounts and history, independent of the selected window.
- Since launch begins at midnight UTC on September 28, including launch-day
  testing. It is not an exact timestamp for opening public purchasing.

## Validation and release

`node --test tests/owner-dashboard.test.js` checks access through the Worker,
read-only SQL aggregation, owner separation, sandbox exclusion, reversals, empty
results, and UTC windows against the real migration schema.
`node scripts/owner-dashboard/check.mjs` checks desktop/mobile rendering, period
selection, error handling, and session expiry using explicitly synthetic data.
Screenshots are written to `work/owner-dashboard/` and are not live usage reports.

Run the normal preparation and staging-to-public promotion in
[reader-release.md](reader-release.md). Deploy only after Roger authorizes it.
After deployment, verify `/api/owner` and `/api/owner/report` deny signed-out
access, sign in as the owner, and compare the displayed report with the existing
records. This implementation's validation uses fixtures, not production data.
