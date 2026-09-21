import asyncio
import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import billing
from server.payment_sync import sync_once, revoked_characters
from server.usage import Ledger, PACK_CHARACTERS, InsufficientCredit
from tests.billing_test import purchase, TXN


def adjustment(amount='1000', *, key='a', status='approved', action='refund'):
    return {'id':'adj_'+key*26,'transaction_id':TXN,'currency_code':'USD',
            'status':status,'action':action,'totals':{'subtotal':amount}}

class PaymentSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.ledger=Ledger(Path(self.temp.name)/'ledger.db')
        self.token=self.ledger.new_account();self.account=self.ledger.account(self.token)['id']
        self.order=self.ledger.new_order(self.account)
        self.ledger.bind_order(self.order['id'],TXN)
        self.remote=purchase(self.order['id'])

    def run_sync(self, rows=()):
        with patch('server.billing.paddle',return_value=self.remote),patch('server.billing.adjustments',return_value=list(rows)):
            return asyncio.run(sync_once(self.ledger))

    def balance(self):return self.ledger.account(self.token)

    def test_closed_browser_and_restart_credit_once(self):
        self.assertEqual(self.run_sync(),{'checked':1,'failed':0})
        self.ledger=Ledger(self.ledger.path)
        self.run_sync()
        self.assertEqual(self.balance()['balance'],PACK_CHARACTERS)
        self.assertEqual(self.ledger.payment_status(self.account)['needsAttention'],False)

    def test_refund_before_credit_never_exposes_refunded_allowance(self):
        self.run_sync([adjustment()]);self.run_sync([adjustment()])
        self.assertEqual(self.balance()['balance'],0)
        self.assertEqual(self.balance()['shortfall'],0)

    def test_pending_rejected_partial_multiple_and_tax_only(self):
        self.run_sync([adjustment(status='pending_approval')])
        self.assertEqual(self.balance()['balance'],PACK_CHARACTERS)
        self.run_sync([adjustment(status='rejected')])
        self.assertEqual(self.balance()['balance'],PACK_CHARACTERS)
        rows=[adjustment('250'),adjustment('125',key='b'),adjustment('0',key='c')]
        self.run_sync(rows);self.run_sync(rows)
        self.assertEqual(self.balance()['balance'],625000)
        self.assertEqual(self.ledger.payment_status(self.account)['revokedCharacters'],375000)

    def test_refund_of_spent_credit_and_future_pack(self):
        self.run_sync();self.ledger.reserve('job',self.account,1000000)
        self.ledger.record('chunk',provider='deepinfra',voice='af_heart',kind='sandbox',source_characters=1000000,submitted_characters=1000000,audio_seconds=1,job='job')
        self.ledger.release('job');self.run_sync([adjustment()])
        self.assertEqual(self.balance()['shortfall'],1000000)
        with self.assertRaises(InsufficientCredit):self.ledger.reserve('next',self.account,1)
        order=self.ledger.new_order(self.account);txn='txn_'+'b'*26;self.ledger.bind_order(order['id'],txn)
        self.ledger.sync_payment(order['id'],txn,'completed')
        self.assertEqual(self.balance()['balance'],0);self.assertEqual(self.balance()['shortfall'],0)

    def test_inflight_refund_stops_next_chunk_and_release_cannot_restore_credit(self):
        self.run_sync();self.ledger.reserve('job',self.account,1000000)
        self.run_sync([adjustment()])
        with self.assertRaises(InsufficientCredit):self.ledger.check_reservation('job')
        self.ledger.release('job')
        self.assertEqual(self.balance()['balance'],0);self.assertEqual(self.balance()['shortfall'],0)
        self.ledger.recover();self.assertEqual(self.balance()['balance'],0)

    def test_restart_refund_reservation_and_chargeback_reversal(self):
        self.run_sync();self.ledger.reserve('job',self.account,1000000)
        self.run_sync([adjustment(action='chargeback')]);self.ledger.recover()
        self.assertEqual(self.balance()['balance'],0)
        rows=[adjustment(action='chargeback',status='reversed'),adjustment(action='chargeback_reverse',key='b')]
        self.run_sync(rows);self.run_sync(rows)
        self.assertEqual(self.balance()['balance'],PACK_CHARACTERS)

    def test_provider_failure_preserves_credit_and_retries(self):
        self.run_sync()
        with patch('server.billing.paddle',side_effect=RuntimeError('unavailable')):
            self.assertEqual(asyncio.run(sync_once(self.ledger))['failed'],1)
        self.assertTrue(self.ledger.payment_status(self.account)['needsAttention'])
        self.assertEqual(self.balance()['balance'],PACK_CHARACTERS)
        self.run_sync([adjustment()]);self.assertEqual(self.balance()['balance'],0)
        self.assertFalse(self.ledger.payment_status(self.account)['needsAttention'])

    def test_canceled_order_allows_new_checkout(self):
        self.remote={'id':TXN,'status':'canceled'};self.run_sync()
        self.assertNotEqual(self.ledger.new_order(self.account)['id'],self.order['id'])

    def test_adjustment_validation_and_tax_inclusive_principal(self):
        remote=self.remote.copy();remote['details']={'totals':{'subtotal':'800'}}
        self.assertEqual(revoked_characters(remote,[adjustment('400')]),500000)
        for rows in ([adjustment(),adjustment()], [adjustment()|{'currency_code':'EUR'}],
                     [adjustment()|{'transaction_id':'wrong'}],[adjustment('-1')]):
            with self.assertRaises(ValueError):revoked_characters(self.remote,rows)

    def test_concurrent_replays_apply_refund_once(self):
        self.run_sync()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _:self.ledger.sync_payment(self.order['id'],TXN,'completed',500000),range(8)))
        self.assertEqual(self.balance()['balance'],500000)

    def test_adjustment_pagination_complete_or_no_changes(self):
        pages=[{'data':[adjustment(key='a')],'meta':{'pagination':{'has_more':True}}},
               {'data':[adjustment(key='b')],'meta':{'pagination':{'has_more':False}}}]
        with patch('server.billing.paddle_request',side_effect=pages) as api:
            self.assertEqual(len(billing.adjustments(TXN)),2)
            self.assertIn('after=adj_'+'a'*26,api.call_args.args[0])
        with patch('server.billing.paddle_request',return_value={'data':[]}):
            with self.assertRaises(ValueError):billing.adjustments(TXN)

    def test_inflight_success_after_refund_keeps_consumed_shortfall(self):
        self.run_sync();self.ledger.reserve('job',self.account,1000000)
        self.run_sync([adjustment()])
        self.ledger.record('inflight',provider='deepinfra',voice='af_heart',kind='sandbox',
            source_characters=100000,submitted_characters=100000,audio_seconds=1,job='job')
        self.ledger.release('job')
        self.assertEqual(self.balance()['balance'],0)
        self.assertEqual(self.balance()['shortfall'],100000)

    def test_incomplete_adjustments_cannot_grant_purchase(self):
        with patch('server.billing.paddle',return_value=self.remote),patch('server.billing.adjustments',side_effect=ValueError('incomplete')):
            self.assertEqual(asyncio.run(sync_once(self.ledger))['failed'],1)
        self.assertEqual(self.balance()['balance'],0)
        self.run_sync();self.assertEqual(self.balance()['balance'],PACK_CHARACTERS)

    def test_legacy_order_survives_migration_and_refund(self):
        # Recreate the previous schema, then reopen through the real migration.
        with self.ledger.connect() as db:
            db.execute('ALTER TABLE orders DROP COLUMN characters')
        self.ledger = Ledger(self.ledger.path)
        old = self.ledger.order(self.order['id'], self.account)
        self.assertEqual(old['characters'], 3000000)
        self.remote['items'][0]['price']['id'] = billing.LEGACY_PRICE
        self.run_sync()
        self.assertEqual(self.balance()['balance'], 3000000)
        self.run_sync([adjustment('500')])
        self.assertEqual(self.balance()['balance'], 1500000)
        new = self.ledger.new_order(self.account)
        self.assertEqual(new['characters'], 1000000)
        self.assertEqual(billing.order_price(new), billing.PRICE)
        self.assertEqual(billing.order_price(old), billing.LEGACY_PRICE)
