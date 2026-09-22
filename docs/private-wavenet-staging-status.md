# Staging status — September 22, 2026

The user approved private staging deployment and credential setup, then paused
setup to discuss costs and personal requirements. No further provisioning or
subscription activation should proceed until that discussion is resolved.

Completed before the pause:

- Created dedicated D1 `private-wavenet-reader-staging`, ID
  `74f0d55c-b7ab-4d6b-aa26-cf06bfa9036f` in the existing Cloudflare account.
- Applied all five reader migrations remotely. Cloudflare's REST statement
  splitter rejected CASE expressions inside triggers despite local acceptance.
  Equivalent WHERE-based RAISE guards and COALESCE identity selection applied
  successfully. Fifteen reader tests and two offline migration tests passed.
- Verified remote triggers with synthetic data: 5,000 credit became 4,999 after
  one successful character, 1,004,999 after a synthetic pack, and 4,999 after its
  full synthetic refund. Removed every synthetic account/order/grant/reservation.
  Read-back: zero accounts, grants and orders; five applied migrations.
- No production database, balance, route, Worker, or running checkout changed.

Blocked prerequisites discovered:

- R2 API reports `10042: Please enable R2 through the Cloudflare Dashboard`.
- Access API reports `9999: access.api.error.not_enabled`.
- R2 requires subscription checkout and enables usage billing. Zero Trust requires
  onboarding and payment details even when selecting its Free plan. Neither has
  been activated by this task.
- Account subscription lookup returned an authentication error. The current
  Workers billing plan has not been verified.

No staging Worker, R2 bucket, Access organization/application, or public hostname
has been created. No provider credential was copied or installed. Speech, email,
and payment flags remain disabled and the speech budget remains zero.

References checked live:

- https://developers.cloudflare.com/r2/get-started/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/learning-paths/secure-internet-traffic/initial-setup/create-zero-trust-org/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://cloud.google.com/text-to-speech/pricing
- https://resend.com/pricing
