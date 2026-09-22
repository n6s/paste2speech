# Private WaveNet reader

See [implementation, verification and approval boundaries](../../docs/private-wavenet-reader.md).

- `worker.js`: private reader and account routes
- `../prepared/durable.js`: durable full preparation and R2 files
- `ledger.js`, `migrations/`: account, credit, refund debt and hard speech budget
- `payments-do.js`, `providers.js`: serialized sandbox checkout/reconciliation and gated email delivery
- `access.js`: fail-closed Cloudflare Access verification
- `site/`: full-preparation reader, shared existing account/sign-in assets
- `import-ledger.py`: offline, read-only-source migration rehearsal
- `wrangler.local.jsonc`: cached, credential-free local validation
- `wrangler.staging.jsonc`: deliberately unconfigured private staging template

Do not use the repository's ordinary deploy command for this reader. Deployment
requires a separately approved isolated staging configuration.
