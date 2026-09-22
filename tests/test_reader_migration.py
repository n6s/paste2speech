import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path
from server.usage import Ledger

spec = importlib.util.spec_from_file_location('reader_import', 'cloudflare/reader/import-ledger.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class MigrationTest(unittest.TestCase):
    def test_exact_balances_sessions_legacy_packs_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory)/'source.sqlite', Path(directory)/'private.sqlite'
            ledger = Ledger(source)
            token = ledger.new_account()
            account = ledger.account(token)['id']
            order = ledger.new_order(account)
            ledger.bind_order(order['id'], 'txn_synthetic')
            ledger.fulfill(order['id'], 'txn_synthetic')
            with ledger.connect() as db:
                db.execute('UPDATE accounts SET balance=12345,enabled=1')
                db.execute('INSERT INTO sessions VALUES(?,?,?)', ('a'*64, account, 2000000000))
                db.execute('INSERT INTO identities VALUES(?,?)', ('reader@example.invalid', account))
                db.execute('INSERT INTO login_links VALUES(?,?,?,?,?)', ('linkhash', 'reader@example.invalid', 'flowhash', account, 2000000000))
                db.executemany('INSERT INTO login_limits VALUES(?,?)', [('global', 1999999900)] * 90)
            before = source.read_bytes()
            result = module.migrate(source, target)
            self.assertTrue(result['balancesVerified'])
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            with sqlite3.connect(target) as db:
                self.assertEqual(db.execute('SELECT balance FROM accounts').fetchone()[0], 12345)
                self.assertEqual(db.execute('SELECT expires FROM sessions').fetchone()[0], 2000000000000)
                self.assertEqual(db.execute('SELECT characters FROM grants').fetchone()[0], 1000000)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM login_limits').fetchone()[0], 90)
                self.assertEqual(db.execute('SELECT expires FROM login_links').fetchone()[0], 2000000000000)
                self.assertEqual(db.execute('SELECT token_hash FROM legacy_accounts').fetchone()[0], Ledger.digest(token))
            with self.assertRaises(ValueError):
                module.migrate(source, target)

    def test_active_reservations_refuse_without_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory)/'source.sqlite', Path(directory)/'private.sqlite'
            ledger = Ledger(source)
            token = ledger.new_account()
            account = ledger.account(token)['id']
            with ledger.connect() as db:
                db.execute('INSERT INTO reservations VALUES(?,?,?)', ('active', account, 10))
            with self.assertRaises(ValueError):
                module.migrate(source, target)
            self.assertFalse(target.exists())

if __name__ == '__main__':
    unittest.main()
