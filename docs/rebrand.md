# PasteToSpeech domain move

September 28, 2026. Product name: **PasteToSpeech**. Canonical website:
**https://pastetospeech.com**. Changes are prepared on the current shared release
branch, not the older main/Tailscale checkout.

## Inventory and changes

The initial case-insensitive search found 193 matching lines outside the lockfile.
It covered `paste2speech`, `Paste2Speech`, `Paste to Speech`, and the former public
hostname. The lockfile package identity was separately retained.

- Page titles, main heading, About copy, pricing/terms/account/license pages,
  sign-in display names and subjects, media-session titles, feedback notifications,
  and systemd descriptions use PasteToSpeech.
- Downloaded MP4 artwork and title/album/artist/comment metadata use PasteToSpeech
  and pastetospeech.com. Download names start with `pastetospeech-`.
- Both public build paths generate canonical links, robots sitemap references,
  and sitemap URLs for pastetospeech.com.
- Production-trial and future public-launch configurations use the new reader
  and feedback origins while keeping both custom domains on the same Worker.
- The former hostname displays a six-second informative redirect. Pricing and
  terms keep their destinations; account/sign-in pages lead to a fresh account
  sign-in. Other public paths lead home. Queries and tokens are never forwarded.
  Old API calls and writes return 410 rather than replaying across origins.
- The workstation frontend's hosted feedback origin and the corresponding
  browser mocks use the new domain. Reader tests and MP4 checks match the brand.
- Roger's portfolio repository changes its project heading, description metadata,
  and reader link to PasteToSpeech / pastetospeech.com.

## Intentionally preserved

- Repository directories, npm package and lockfile name, imports, module names,
  `P2S_*` environment variables, cookies, local/session storage and cache keys.
- Worker names, D1 databases/IDs, R2 bucket names, Durable Object classes and
  bindings, migration history, resource IDs, prices, balances and account data.
- Systemd filenames/unit dependencies, filesystem/config/credential paths,
  Telegram bot handle, temporary-directory prefixes and historical user-agent.
- Staging and Tailscale hostnames. The legacy root wrangler.jsonc and its Worker
  tests/release runbook remain on the old origin for rollback/reference; do not
  use that legacy deployment path for the new site.
- Historical deployment, incident, DNS-verification and billing records retain
  their original facts. Current migration instructions supersede old hostnames.
- Mail sender credentials and Paddle-controlled receipt/statement wording require
  verified provider changes; editing display text does not migrate those services.

## Cutover and validation

Use the shared staging-to-production release procedure. Keep owner-only trial
and disabled checkout settings. Keep all existing data/resources. Attach the new
custom domain through Cloudflare Workers so Cloudflare manages DNS and TLS.
Update the portfolio only once the new reader is reachable.

Configure and verify the new sending domain in Resend before switching EMAIL_FROM
or the workstation sender. Keep tracking and receiving disabled, enforced TLS,
and existing credentials unless their domain scope requires replacement.

Update Paddle product branding, website approval, default payment link, and live
webhook destination to the new domain. Do not activate checkout. A new domain may
need Paddle review. Update receipt wording only after confirming the catalog;
leave the bank/card descriptor factual until changed at Paddle. Old webhook URLs
must be updated before enabling payments; the old hostname does not replay APIs.

Cookies, cached models, browser preferences, saved reading IDs, and pending
sign-in challenges are origin-scoped. Existing verified accounts remain in the
same database and can be recovered by requesting a fresh sign-in at the new site.
Finish existing readings before the move; no cross-domain browser-state transfer
is implemented. No balances are migrated or recreated.

Local checks: 223 Node tests; legacy build; staging/production builds; synthetic
Chrome playback/parity and Resume/Clear checks; mobile portfolio/redirect layout,
automatic redirect, generated canonicals/sitemaps; staging and production Wrangler
dry runs. These do not establish real email delivery or a paid transaction.
