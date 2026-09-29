# Private email sign-in

The private sandbox can attach an existing browser balance to a verified email.
Request a fresh link on each device and open it in the same browser that requested
it. Links expire after 15 minutes, are single use, and require a confirmation click.
An email scanner opening a link does not sign in or consume it.

The first verification preserves that browser account's balance, reservations and
orders. A subsequent sign-in with the same email creates a separate session for the
same account. Signing out revokes only that session; other devices retain access.
Sessions expire after 30 days. Verification replaces the original browser credential.
Email spelling is case-insensitive; plus aliases and Gmail dots are not rewritten.
Separate paid balances or pending orders are never silently merged or abandoned.
If they conflict with an existing email account, the UI reports the conflict.

## Sender setup

Owner-only `~/.config/paste2speech/email-signin.json` (mode 600):

```json
{
  "host": "smtp.resend.com",
  "port": 465,
  "username": "resend",
  "password_file": "resend-api-key",
  "sender": "signin@pastetospeech.com",
  "billing_url": "https://pop-os.tailbd091c.ts.net/speak/api/billing"
}
```

Save the sending-only Resend API key in the named sibling file, mode 600. SMTP uses
TLS with certificate validation. Other SMTP providers can use `password` instead
of `password_file`, and port 465 or 587. Never commit credentials. Configuration is
read for each request. The configured link origin must be an allowed HTTPS origin;
it is never inferred from an untrusted Host header.

In Resend, verify `pastetospeech.com` with the exact DNS records supplied
for that domain. Keep receiving disabled and click/open tracking disabled. Set Resend TLS to
Enforced so sign-in mail is not delivered over an unencrypted connection. Sending
authentication does not require changing the website record or the root DMARC policy.
The private link requires Tailscale on the target device.

## Storage and boundaries

The existing owner-only SQLite ledger gains identities, expiring sessions, login
links and rate limits. Emails are stored privately for identity; no reading text
or audio is added. Session/link tokens and browser challenges are stored as hashes.
Link tokens travel in URL fragments, are removed from browser history immediately,
and are submitted in a POST body. The confirmation page has no third-party scripts,
no referrer, no caching, and a restrictive content-security policy.

Requests are limited to 5/hour per email, 20/hour per source address, and 90/day
across this private service. Rate limits survive restart and apply even to failed
email sends. Behind Tailscale, several devices may share the observed proxy address;
this conservative private limit is intentional. No account-existence lookup is
exposed. Failed email delivery removes the unused token without logging it.

This remains a private pilot, not public authentication infrastructure. Public
launch still needs per-account usage views, a public hosting/authentication review,
webhook/refund handling, recovery support for conflicting balances, retention policy,
and abuse controls appropriate to public traffic. The usage totals currently remain
Roger's private aggregate dashboard. Sandbox-mode selection is account-wide after
sign-in. Public code is not deployed by this setup.

## Verification

- Python auth tests cover preserved balance, independent sessions, logout, expiry,
  wrong-browser rejection, one-use concurrency, rate limits, delivery failure and
  separate-balance conflicts.
- `node tests/auth-browser.mjs` uses the real endpoints and a temporary SQLite
  ledger, with fake email delivery, in two isolated Chrome contexts. It verifies
  account recovery, logout isolation, token removal, reuse rejection and mobile layout.
- Actual email delivery and Pixel link handling require live checks, separately from
  these automated tests. Never label the mocked delivery test as inbox validation.

Live check on 2026-09-21: the actual Resend email reached Gmail with SPF and DKIM
passing, but landed in Spam. Following it in Chrome linked the existing 6-million
character balance successfully. Roger then confirmed that the emailed link works
on Pixel and recovers the same 6-million-character balance. Consistent inbox
placement remains an open acceptance check.

September 28 domain move: Resend verified pastetospeech.com. Production and staging
EMAIL_FROM now use `PasteToSpeech <signin@pastetospeech.com>`. The workstation SMTP
sender uses the same address, retaining its private Tailscale billing URL. The
existing sending-only key covers all domains; no key was rotated. Gmail received
the authorized sign-in test in Inbox with SPF, DKIM and DMARC passing. The original
verified account was recovered at the new domain without changing its credit.
