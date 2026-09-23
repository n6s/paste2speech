# Gated production release

Prepared September 23, 2026. Preparation is complete; deployment is not authorized
by this document. Run from `/home/roger/.codex/worktrees/8486/paste2speech` on
`codex/wavenet-mp3-proof`. Preserve the separate main checkout.

## Exact effect

Deploy `wrangler.public.jsonc` to the existing production Worker, LEDGER, AUDIO,
feedback DB, and domain. Change `production-trial` to `production-public` with
`ENABLE_PAYMENTS=0`, `ENABLE_LIVE_SYNTHESIS=0`, and `PUBLIC_LAUNCH_OPEN=0`.
Email sign-in remains enabled. Existing account identity and credit are reused;
no balance import, reset, or new trial grant. Browser voices remain available.
**New owner WaveNet generation also pauses.** Finish active preparation before
deployment. Existing completed recordings retain their normal 24-hour lifetime.
The signature-authenticated billing webhook route and background reconciliation
become available; enabling Paddle delivery is a separately reviewed action.

## Preparation evidence

- Local release build and Wrangler deployment dry run passed; 175 Node tests and
  three Python migration tests passed. No production deployment occurred.
- Config SHA256: `01732a9dd0ddc202ed9dbaa408fa96025743f3d0ac08bdbb124284516cf876ca`.
- All 11 production migrations are applied; no migration is currently needed.
- Current production version observed:
  `8e6fb643-8126-4c84-b877-d8f2cd12d0e1` (includes later secret changes).
- Public HTTP status still reports trial=true, sandbox=false, configured=false,
  checkoutAvailable=false. Secret values were not retrieved.
- Read-only production ledger export restored successfully in local memory;
  integrity check passed, zero foreign-key errors, 32 tables, two accounts,
  one grant, zero orders, zero open reservations, total available credit 75,032.
  This is a point-in-time aggregate, not a promise that ongoing owner use stops.
- Private evidence: `work/gated-release-review/ledger.sql` and
  `snapshot-report.json` (owner-only files, ignored by Git).
  Export SHA256: `2f506ad8f3d8efd7a0f8ce7f5dfd5e590b44c4e596656607e104bd2425bec5c8`.
- Release manifest: `work/production-reader/public-release-manifest.json`, with
  commit, clean-state flag, config, recursive asset and migration hashes.

## Immediately before an approved deployment

Arrange a brief pause in owner generation and finish existing preparations.
Recheck Paddle merchant/domain/default-link/payout status; do not infer approval
from old notes. Confirm the live destination still points to the production
webhook and the intended event list. Do not activate checkout or submit a purchase.

```bash
git status --short
npx wrangler d1 migrations list LEDGER --remote --config cloudflare/reader/wrangler.public.jsonc
npx wrangler deployments list --config cloudflare/reader/wrangler.production.jsonc
npx wrangler d1 execute LEDGER --remote --config cloudflare/reader/wrangler.public.jsonc --command "SELECT COUNT(*) AS open_reservations FROM reservations WHERE state='open';"
```

Require a clean checkout and zero open reservations. If migrations are newly
pending or production changed, stop and review the difference; do not blindly
apply migrations or use the older snapshot. Never migrate feedback binding `DB`.
Take a fresh snapshot immediately before deployment, using a unique directory:

```bash
umask 077
release_review="work/gated-release-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$release_review"
npx wrangler d1 export LEDGER --remote --config cloudflare/reader/wrangler.public.jsonc --output "$release_review/before.sql"
python3 - "$release_review/before.sql" <<'PY'
import sqlite3, sys
from pathlib import Path
db = sqlite3.connect(':memory:')
db.executescript(Path(sys.argv[1]).read_text())
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert not db.execute('PRAGMA foreign_key_check').fetchall()
assert db.execute("SELECT COUNT(*) FROM reservations WHERE state='open'").fetchone()[0] == 0
print('Fresh backup restored; integrity, relationships, and drained reservations verified.')
PY
npm run release:reader:public
cp work/production-reader/public-release-manifest.json "$release_review/manifest.json"
```

Review the resulting manifest: clean commit, expected Worker/origin/catalog,
all three activation booleans false, and the config hash above. Approval must
cover this exact candidate and the temporary pause in owner WaveNet generation.
Only after that approval, run:

```bash
npm run release:reader:public -- --deploy --production-approved
```

## Verify immediately after deployment

```bash
curl -fsS https://speak.rogerpbrown.com/api/billing/status
curl -fsS https://speak.rogerpbrown.com/api/reader
npx wrangler d1 export LEDGER --remote --config cloudflare/reader/wrangler.public.jsonc --output "$release_review/after.sql"
python3 - "$release_review/before.sql" "$release_review/after.sql" <<'PY'
import sqlite3, sys
from pathlib import Path
databases = []
for path in sys.argv[1:]:
    db = sqlite3.connect(':memory:')
    db.executescript(Path(path).read_text())
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    databases.append(db)
tables = ['accounts', 'identities', 'grants', 'account_debt', 'trial_grants',
          'speech_budget', 'speech_admissions', 'usage', 'reservations', 'orders']
for table in tables:
    rows = [sorted(db.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
            for db in databases]
    assert rows[0] == rows[1], f'Review unexpected change in {table}; do not restore automatically'
print('All preserved identity, credit, trial, usage, reservation and order rows match exactly.')
PY
```

Expect trial=false, sandbox=false, configured=false, checkoutAvailable=false,
reader liveEnabled=false. In the existing signed-in browser verify the same email
and balance, disabled checkout and WaveNet generation, working browser voices,
and accessible policies. Anonymous status alone cannot prove identity retention.
Do not submit a paid probe. Record the new deployed version.

Signed Paddle delivery needs its own approved rehearsal. A forged request getting
401 proves rejection only; a synthetic signed event does not prove payment
fulfillment. Verify actual provider delivery, signature acceptance and durable
event deduplication without opening purchasing; complete actual payment credit
proof only during the explicitly approved real purchase/refund test.

## Stop and recovery procedure

Leave all three gates off if validation fails. Preserve the additive database,
webhook inbox, grants and provider admissions. Never restore `before.sql` over
new accounting records. Diagnose any row differences first.

If a later release enables paid paths and must be stopped, set
`ENABLE_PAYMENTS=0`, `ENABLE_LIVE_SYNTHESIS=0`, `PUBLIC_LAUNCH_OPEN=0` in the current
public config, commit, rebuild, review, and use the same approved deployment
command. This keeps identity and reconciliation working. For a code regression,
prepare a reviewed compatible prior public revision with these same gates off.
The old trial Worker is not a general rollback target: it hides public billing
recovery and enables owner synthesis. Do not run a blind version rollback.

No production mutation, notification activation, paid test, or launch permission
is implied by these commands being written down.
