# Private WaveNet reader

See [implementation, verification and approval boundaries](../../docs/private-wavenet-reader.md).

- `worker.js`: private reader and account routes
- `../prepared/durable.js`: durable full preparation and R2 files
- `ledger.js`, `migrations/`: account, credit, refund debt and hard speech budget
- `payments-do.js`, `providers.js`: serialized sandbox checkout/reconciliation and gated email delivery
- `access.js`: fail-closed Cloudflare Access verification
- `build.mjs`: shared established reader and account/sign-in assets
- `import-ledger.py`: offline, read-only-source migration rehearsal
- `wrangler.local.jsonc`: cached, credential-free local validation
- `wrangler.staging.jsonc`: approved isolated private staging configuration

Production trial preparation and approval details: [release review](../../docs/production-reader-release.md).
`npm run release:reader:production` performs local tests/build/dry run only.

Do not use the repository's ordinary deploy command for this reader. Deployment
uses the approved isolated staging configuration only. Production requires separate approval.
