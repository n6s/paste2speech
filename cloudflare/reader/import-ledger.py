"""Offline migration rehearsal. Reads an explicit SQLite snapshot read-only.

Never discovers/opens the running ledger, contacts Cloudflare, or overwrites an
output. Refuses in-flight reservations. The owner-only output is an isolated
SQLite ledger for verification, not an instruction to apply it to any service.
"""
import argparse
import os
import sqlite3
from pathlib import Path
from urllib.parse import quote


def migrate(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or output.exists():
        raise ValueError('Output must be a new, separate file')
    src = sqlite3.connect('file:' + quote(str(source)) + '?mode=ro', uri=True)
    src.row_factory = sqlite3.Row
    src.execute('BEGIN')
    if src.execute('SELECT COUNT(*) FROM reservations WHERE remaining>0').fetchone()[0]:
        src.close()
        raise ValueError('Snapshot has active reservations; quiesce and snapshot first')
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    dst = sqlite3.connect(output)
    try:
        for migration in sorted(Path(__file__).with_name('migrations').glob('*.sql')):
            dst.executescript(migration.read_text())
        with dst:
            accounts = src.execute('SELECT * FROM accounts').fetchall()
            for a in accounts:
                dst.execute('INSERT INTO accounts VALUES(?,?,?,?)', (a['id'], 'Reader', a['enabled'], 0))
                dst.execute('INSERT INTO legacy_accounts VALUES(?,?)', (a['token_hash'], a['id']))
                if not a['enabled']:
                    dst.execute('INSERT INTO legacy_pilots VALUES(?)', (a['id'],))
                    dst.execute('UPDATE accounts SET enabled=0 WHERE id=?', (a['id'],))
            for row in src.execute('SELECT * FROM identities'):
                dst.execute('INSERT INTO identities VALUES(?,?)', tuple(row))
            for row in src.execute('SELECT * FROM sessions'):
                dst.execute('INSERT INTO sessions VALUES(?,?,?,?)', (row['token_hash'], row['account'], round(row['expires'] * 1000), 'verified'))
            for row in src.execute('SELECT * FROM orders'):
                dst.execute('INSERT INTO orders VALUES(?,?,?,?,?,?,?)', (row['id'], row['account'], row['transaction_id'], row['created'], row['status'], row['characters'], 'bound' if row['transaction_id'] else 'submitting'))
            for row in src.execute('SELECT * FROM grants'):
                dst.execute('INSERT INTO grants VALUES(?,?,?)', (row['transaction_id'], row['account'], row['characters']))
            # Grants are historical evidence, not additional credits. Restore the
            # exact snapshot balances only after all grant triggers have run.
            for row in accounts:
                dst.execute('UPDATE accounts SET balance=? WHERE id=?', (row['balance'], row['id']))
            for row in src.execute('SELECT * FROM account_debt'):
                dst.execute('INSERT INTO account_debt VALUES(?,?) ON CONFLICT(account) DO UPDATE SET characters=excluded.characters', tuple(row))
            for row in src.execute('SELECT * FROM payment_sync'):
                dst.execute('INSERT INTO payment_sync VALUES(?,?,?,?)', (row['order_id'], round(row['checked'] * 1000), row['revoked'], row['state']))
            for row in src.execute('SELECT * FROM usage'):
                dst.execute('INSERT INTO legacy_usage VALUES(?,?,?,?,?,?,?,?,?,?,?)', tuple(row))
            for row in src.execute('SELECT * FROM login_limits'):
                dst.execute('INSERT INTO login_limits VALUES(?,?)', (row['scope'], round(row['created'] * 1000)))
            # Do not re-send mail or extend old links. Retain existing hashes and
            # expiry; future requests create their own fresh browser-bound link.
            triggers = dst.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name IN ('login_limit_check','login_limit_record')").fetchall()
            dst.execute('DROP TRIGGER login_limit_check')
            dst.execute('DROP TRIGGER login_limit_record')
            for row in src.execute('SELECT * FROM login_links'):
                dst.execute('INSERT INTO login_links VALUES(?,?,?,?,?,?,?,?)', (row['token_hash'], row['email'], row['flow_hash'], row['source_account'], round(row['expires'] * 1000), 0, 'imported-email', 'imported-ip'))
            for (trigger,) in triggers:
                dst.execute(trigger)
            if dst.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Imported ledger has broken references')
            for row in accounts:
                actual = dst.execute('SELECT balance,enabled FROM accounts WHERE id=?', (row['id'],)).fetchone()
                if actual != (row['balance'], row['enabled']):
                    raise ValueError('Balance verification failed')
        return {'accounts': len(accounts), 'balancesVerified': True, 'sourceModified': False}
    except Exception:
        dst.close()
        output.unlink()
        raise
    finally:
        dst.close()
        src.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        result = migrate(args.snapshot, args.output)
        print('Offline migration verified for', result['accounts'], 'accounts. Source unchanged; no deployment.')
    except Exception:
        raise SystemExit('Migration refused or verification failed. Source unchanged; inspect the snapshot locally.') from None
