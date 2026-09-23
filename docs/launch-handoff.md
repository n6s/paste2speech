> September 23 update: owner-only progressive playback is now deployed to production with billing still disabled. See [the production verification and rollback report](mse-production.md). The earlier production version references below are historical; public billing/access still require a separate decision.

# Resume public billing launch

Updated: 2026-09-23. Start here, then consult gated-production-release.md for the
prepared disabled release and public-launch-release.md for wider launch context.

## September 23 verified progress

- Sandbox purchase, 122-character speech, free replay and automatic full refund
  passed; see sandbox-rehearsal-2026-09-23.md. Signed public webhook delivery is
  still unproven. No real Paddle transaction was made.
- Gated public release built locally with all three switches off; 175 Node tests,
  three migration tests and Wrangler dry run passed. No deployment authorized.
- Production migrations already current (all 11). Fresh preparation-time backup
  restore passed; aggregate credit 75,032, two accounts, no orders or open
  reservations. Refresh the backup and balances immediately before deployment.
- Current production version after secret changes is
  8e6fb643-8126-4c84-b877-d8f2cd12d0e1. HTTP status still confirms trial mode and
  disabled checkout. The gated public release would pause owner synthesis too.

## Workspace and committed work

Use `/home/roger/.codex/worktrees/8486/paste2speech`, branch
`codex/wavenet-mp3-proof`. Implementation and Paddle setup notes are committed.
Main checkout `/home/roger/workarea/paste2speech` has unrelated Python/container
edits; preserve them. No push, merge, or public activation was performed here.

## Current state

- Production still runs owner-only production-trial. Last HTTP read-back:
  trial=true, configured=false, checkoutAvailable=false.
- Public candidate config has live product/price IDs, all launch/payment/synthesis
  switches off. Pricing and policies are already published.
- Live API key, client token, and webhook secret are installed in Cloudflare on
  paste2speech-reader-production. Secret-list read-back confirmed all bindings.
  Owner-only local copies live in ~/.config/paste2speech/paddle-live-*; never print
  their values or commit them. Temporary handoff copies were removed.
- Live $10 USD one-time pack for 1,000,000 characters verified via Paddle API.
- Notification destination ntfset_01m35ct3p29vxze92gt4tmwfdd is INACTIVE;
  endpoint /api/billing/webhook only works in production-public mode. Twelve
  transaction/adjustment events selected. Delivery/signature validation not done.
- Merchant and speak.rogerpbrown.com domain approval were pending at last check.
  Default payment link did not persist. Payout form was incomplete. Recheck live
  state before treating these as current blockers.
- Limited API key expires Dec 21, 2026 (dashboard showed 9:10pm; timezone unverified).
- New client token and webhook secret format checked; token suffix matched UI.
  Exact webhook-secret match must still be proven by signed delivery.

## Next necessary work

1. Recheck Paddle approval/default payment URL and payout status.
2. Prepare fresh ledger backup and exact gated release, preserving owner balance.
   Review existing release instructions and evidence before deployment.
3. Deploy gated billing endpoint when authorized, verify signed notifications,
   activate delivery/reconciliation while customer purchasing remains disabled.
4. Prove purchase -> exactly-one credit grant -> speech consumption -> refund
   reconciliation in sandbox, then one explicitly approved live test.
5. Obtain final approval to open public purchasing. No live purchase/refund or
   public activation is authorized by this session close.

## Scope and authorization

User approved creation of limited live API key, client token and webhook
credentials, and their installation in Cloudflare with purchasing disabled.
Do not ask to approve those completed actions again. Public deployment/activation
remains governed by the launch gates; do not infer final launch approval.
User prefers essential launch work, not broad polish or repeated checks.

User reports another session built rogerpbrown.com with a link to the reader;
not verified here. Email domain migration was discussed but not requested; keep
existing sending setup. Payout banking details should be entered by the owner.

## Validation already done

Implementation checkpoint: 175 Node tests plus 3 Python migration tests passed
(previous session evidence). Latest catalog configuration change: all 13
reader-public tests passed. Credential-only updates verified with Wrangler
secret list and read-only catalog check; no paid calls or financial transactions.
Do not equate these checks with fresh end-to-end acceptance.
