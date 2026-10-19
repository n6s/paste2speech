# Security hardening trial — October 19, 2026

Roger approved login-abuse mitigation and dependency maintenance for staging only.
Production deployment, account security settings, credentials and provider controls
are outside this release. The existing staged speech recovery remains enabled.

## Login capacity and privacy

Staging migration `0015_login_fair_allowance.sql` retains the 90-link rolling-day
shared public allowance and adds five reserved links per rolling day for each
existing enabled verified identity. A member uses its own reserve first, then the
shared pool when available. One identity cannot spend another's reserve. Existing
five-per-email/hour and twenty-per-IP/hour checks apply to both routes. Shared
pool exhaustion therefore no longer blocks every existing member's login.
The maximum allowance is 90 plus five per eligible identity in the rolling window,
not an unlimited mail budget or a fixed deployment-time identity count.

The migration checks the staging-only unified control before any mutation. It
replaces only the two quota triggers, retaining all identities, sessions, links,
limit history, wallets, reservations, payments and usage. Reapplying it does not
refill capacity. Old global entries still count until they age out. It is forward
compatible with the previous Worker; no financial schema or credit change is
involved. There is deliberately no pending production migration in this change.

`LOGIN_FAIR_ALLOWANCE=1` is enabled only in `wrangler.staging.jsonc`, and the
Worker independently requires `READER_MODE=staging`. Validly formatted requests
receive the same response and browser-flow cookie before admission or mail
delivery finishes. This prevents quota-dependent account enumeration through
status, response shape, cookie presence, or provider response time. Quota failure
and mail failure are logged as allowlisted categories without email, tokens or
provider details. Failed delivery cancels its link but retains attempted-mail
quota. Malformed addresses and hostile request origins still fail immediately.
Production ignores this flag and retains its original synchronous behavior.

Hosted staging reuses only a well-formed `__Host-p2s_login_flow` cookie: Secure,
HttpOnly, SameSite=Strict, Path=/ and no Domain attribute. A suppressed resend
therefore preserves earlier valid links without trusting a cookie planted by a
sibling domain. Hosted confirmation also requires that host-only cookie, without
a legacy-cookie fallback. Old staging links using the ordinary flow cookie need
a fresh sign-in request after rollout; existing authenticated sessions remain
valid. Production retains the original cookie behavior. Each
emailed token still expires independently after 15 minutes and is single-use;
refreshing the flow cookie does not extend it. Confirmation and logout clear both
cookie names. Local loopback fixtures use the ordinary cookie name.

The change does not grant authentication through reserve eligibility. A valid,
unused, unexpired link and its same-browser flow are still required. The queued
request runs under best-effort Cloudflare waitUntil, not a durable delivery queue.
Termination or slow delivery can leave the mail unsent and quota consumed until
its rolling expiry. The successful HTTP response means the
request was received, not that an email was delivered. Users may need to wait or
retry when limited or when mail delivery fails.

Residual limits: an attacker can still exhaust public registration capacity or
target the hourly allowance of a known address. IP controls can affect users who
share an IP, and provider delivery quotas can still prevent mail even with app
capacity available. Per-account reserves mitigate broad cross-member lockout, not every
possible denial of service. A stronger public signup bot-control integration
would require a separately authorized provider/account setup; none was created.
Account MFA and provider spending policy are unchanged.

## Dependency changes

- Wrangler 4.135.0 → 4.151.2, including its patched Miniflare/Undici chain.
- Explicit sharp override 0.35.4 → 0.35.5. Its maintainer advisory is
  <https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w>.
- Under `onnxruntime-node` only, override installer proxy `global-agent` to 4.1.3.
  Its maintained package removes the roarr/sprintf-js chain. The installation
  script uses its still-supported `bootstrap` export; the override is not global
  to application dependencies. See
  <https://github.com/gajus/global-agent/releases/tag/v4.1.3> and
  <https://github.com/advisories/GHSA-hp3w-g68c-fv3c>.

Release tooling now requires Node.js 22 or newer (verified on 24.16.0).
Transformers remains 3.8.1, ONNX Runtime remains 1.21.0, browser ONNX remains pinned,
and the speech model/API are unchanged. No forced major Transformers upgrade or
runtime patch is necessary. Installation used `--ignore-scripts`; no remote
native installer or model download was run. Patched sharp decodes a synthetic
1×1 SVG to PNG, ONNX CPU executes a generated Identity graph, Transformers imports,
and the installer proxy bootstrap routes a synthetic HTTP request to a loopback
proxy. No external model/provider was contacted.

The refreshed audit reports zero known vulnerabilities. This reflects the
registry snapshot, not a guarantee that the packages have no unknown flaws.

## Verification and deployment

`tests/login-fair-allowance.test.js` exercises the actual SQLite triggers and
bundled Worker: normal signup and sign-in, preserved balances, valid/incorrect
browser flows and replay, exhausted shared pool, independent account reserves,
hour/day rollover, concurrency, per-email/IP limits, disabled identities,
failed-delivery accounting, uniform queued responses, hostile origins and
production isolation. Mail is mocked; no real sign-in messages are sent.

Run the complete prescribed staging release gates, preserve extension file hashes
and production configuration/deployment metadata, export and integrity-check the
private staging ledger, apply only staging migration 0015, deploy the clean tested
commit to staging, and verify served metadata/assets through the existing Access
session. A staging release never implies production approval. Historical links
and financial records must be preserved; do not restore a backup over new work.
Evidence lives in ignored `work/security-hardening-staging-2026-10-19/`.
