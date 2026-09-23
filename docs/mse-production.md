# Owner-only progressive production reader

Roger authorized promotion on September 23, 2026, with billing still disabled. This release keeps `production-trial`, the verified-owner restriction, existing balances and the 100,000-character lifetime ceiling. Public checkout remains disabled. It introduces no migrations, grants, paid verification calls or public-launch changes. Private staging and the working Tailscale experiment are unchanged.

Supported browsers default to Progressive; Prepare everything first remains available. Production accepts a delivery choice only; concurrency stays three. Staging scenarios, fixtures, concurrency controls and test authentication are unavailable. Older creation requests still use full preparation. Explicit fallback reuses the same reading.

## Validation and recovery

185 automated tests passed, including funded non-owner rejection, production option validation, durable section ownership, byte equality, repeat-request identity and settlement. Production Chrome assets passed a synthetic three-section test: early playback, buffering while paused, exactly three appends, one source load, unchanged MediaSource and 16.392-second frame-aligned completion. No provider calls were made. The prior deployed staging live matrix and Pixel listening results are recorded in `mse-staging-verification.md`; they were not repeated or charged again.

Pixel requires playback to become audible before locking. Other mobile devices remain unverified; the reader provides capability detection and explicit full-file fallback.

Previous compatible production version: `8e6fb643-8126-4c84-b877-d8f2cd12d0e1`. Private recovery files are in this checkout's ignored `work/mse-production/` directory. The exported ledger was restored in memory and passed SQLite integrity and foreign-key checks (three accounts). Backup SHA-256: `27862b3121a9a87e96ddf969908c2e723dad20e356ad8a27d5cb6e3f6cc873d4`. Before deployment: 37,900/100,000 lifetime characters; 62,100 aggregate available credit; zero open reservations; zero orders.

Build with `npm run build:reader:production`. Run `node scripts/mse-production/check.mjs` for the isolated synthetic Chrome check. Release uses `npm run release:reader:production -- --deploy --production-approved` after committing.

To stop new progressive readings while preserving existing jobs, set `MSE_NEW_READINGS=0`, keep `PROGRESSIVE_READER=1`, build with `node cloudflare/reader/build.mjs --production` (without the progressive flag), and deploy that production configuration directly with Wrangler. Do not use the normal release script for this fallback because it rebuilds progressive assets. Existing pages attempting new progressive jobs will receive an explicit rejection until refreshed. Existing section delivery and accounting remain available.

For a broader rollback, pause new admissions, account for in-flight jobs and then restore the recorded compatible version. Preserve D1/R2 state; never restore the backup over newer transactions. Billing activation and public WaveNet access remain separate decisions.
