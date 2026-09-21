import concurrent.futures
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from server.usage import Ledger, InsufficientCredit, PACK_CHARACTERS

class UsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'usage.sqlite3'
        self.ledger = Ledger(self.path)
        self.token = self.ledger.new_account()
        self.account = self.ledger.account(self.token)['id']

    def tearDown(self):
        self.temp.cleanup()

    def grant(self):
        order = self.ledger.new_order(self.account)
        self.ledger.bind_order(order['id'], 'txn_test')
        return order

    def record(self, key, n, job=None, outcome='succeeded'):
        self.ledger.record(key,provider='deepinfra',voice='af_heart',kind='sandbox',
            source_characters=n,submitted_characters=n+10,audio_seconds=2.5,
            provider_cost=.001,cost_incomplete=False,outcome=outcome,job=job)

    def test_purchase_retry_concurrency_and_restart_grants_once(self):
        order = self.grant()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _:self.ledger.fulfill(order['id'],'txn_test'),range(16)))
        self.assertEqual(sum(results),1)
        self.assertEqual(Ledger(self.path).account(self.token)['balance'],PACK_CHARACTERS)
        self.assertFalse(Ledger(self.path).fulfill(order['id'],'txn_test'))
        self.assertEqual(self.path.stat().st_mode & 0o777,0o600)
        self.assertNotIn(self.token,self.path.read_bytes().decode(errors='ignore'))

    def test_concurrent_reservations_cannot_overspend(self):
        order=self.grant();self.ledger.fulfill(order['id'],'txn_test')
        def reserve(n):
            try:self.ledger.reserve(str(n),self.account,800_000);return True
            except InsufficientCredit:return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sum(pool.map(reserve,range(2))),1)
        self.assertEqual(self.ledger.account(self.token)['balance'],200_000)

    def test_partial_success_failure_cancel_and_recovery(self):
        order=self.grant();self.ledger.fulfill(order['id'],'txn_test')
        self.ledger.reserve('job',self.account,100)
        self.record('job:0',30,job='job')
        self.record('job:0',30,job='job') # repeated completion cannot double debit
        self.record('job:1',70,job='job',outcome='failed')
        self.assertEqual(self.ledger.account(self.token)['reserved'],70)
        Ledger(self.path).recover()
        self.assertEqual(self.ledger.account(self.token)['balance'],PACK_CHARACTERS-30)
        self.ledger.release('job')
        self.assertEqual(self.ledger.account(self.token)['balance'],PACK_CHARACTERS-30)
        month=datetime.now(timezone.utc).strftime('%Y-%m')
        rows=self.ledger.summary(month)
        self.assertEqual(rows[0]['sections'],2)
        self.assertEqual(rows[0]['completedCharacters'],30)
        self.assertEqual(rows[0]['submittedCharacters'],120)
        self.assertEqual(rows[0]['seconds'],5)

    def test_invalid_consumption_rolls_back_and_unknown_purchase(self):
        with self.assertRaises(ValueError):self.ledger.fulfill('missing','txn_other')
        with self.assertRaises(ValueError):self.record('bad',100,job='missing')
        with self.ledger.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM usage').fetchone()[0],0)
        self.assertIsNone(self.ledger.account('made-up-cookie'))
        with self.assertRaises(ValueError):self.ledger.reserve('bad',self.account,-1)
        order=self.ledger.new_order(self.account)
        self.assertEqual(self.ledger.new_order(self.account)['id'],order['id'])
        second=self.ledger.account(self.ledger.new_account())['id']
        self.assertIsNone(self.ledger.order(order['id'],second))
