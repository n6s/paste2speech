import concurrent.futures
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from server import auth, billing
from server.usage import Ledger, AccountConflict

ORIGIN = {'Origin':'https://pop-os.tailbd091c.ts.net'}

class AuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.ledger = Ledger(Path(self.temp.name)/'ledger.db')
        app = FastAPI(); app.include_router(billing.router); app.state.usage = self.ledger
        self.client = TestClient(app)
        self.app = app
        self.client.post('/billing/session', headers=ORIGIN)
        self.original = self.client.cookies.get(billing.COOKIE)
        self.account = self.ledger.account(self.original)['id']
        with self.ledger.connect() as db:
            db.execute('UPDATE accounts SET balance=6000000 WHERE id=?', (self.account,))

    def tearDown(self):
        self.client.close(); self.temp.cleanup()

    def request(self, client, email='reader@example.com'):
        with patch('server.auth.settings', return_value={'configured':True}), patch('server.auth.send_link') as send:
            response=client.post('/billing/login/request',json={'email':email},headers=ORIGIN)
        self.assertEqual(response.status_code,200,response.text)
        self.assertNotIn('token',response.text)
        return send.call_args.args[2]

    def confirm(self, client, token):
        return client.post('/billing/login/confirm',json={'token':token},headers=ORIGIN)

    def test_existing_credit_recovery_in_independent_browser_and_logout(self):
        token=self.request(self.client)
        self.assertIsNone(self.ledger.account(self.original)['email'])
        self.assertEqual(self.confirm(self.client,token).status_code,200)
        signed=self.client.cookies.get(billing.COOKIE)
        self.assertIsNone(self.ledger.account(self.original))
        other=TestClient(self.app)
        other.post('/billing/session',headers=ORIGIN)
        token2=self.request(other)
        self.assertEqual(self.confirm(other,token2).status_code,200)
        second=other.cookies.get(billing.COOKIE)
        self.assertNotEqual(signed,second)
        self.assertEqual(self.ledger.account(second)['id'],self.account)
        self.assertEqual(self.ledger.account(second)['balance'],6000000)
        self.client.post('/billing/logout',headers=ORIGIN)
        self.assertIsNone(self.ledger.account(signed))
        self.assertEqual(self.ledger.account(second)['balance'],6000000)
        # Reopening the SQLite database preserves identity and session.
        self.assertEqual(Ledger(self.ledger.path).account(second)['email'],'reader@example.com')
        other.close()

    def test_wrong_browser_expiry_and_reuse(self):
        token=self.request(self.client)
        other=TestClient(self.app)
        self.assertEqual(self.confirm(other,token).status_code,400)
        # Email scanners visiting GET cannot consume a fragment token.
        self.assertEqual(self.client.get('/billing/signin').status_code,200)
        self.assertEqual(self.confirm(self.client,token).status_code,200)
        self.assertEqual(self.confirm(self.client,token).status_code,400)
        token=self.request(other)
        with patch('server.usage.time.time',return_value=time.time()+901):
            self.assertEqual(self.confirm(other,token).status_code,400)
        other.close()

    def test_one_time_atomic_under_concurrency(self):
        token=self.ledger.login_request('reader@example.com','flow',self.account,'ip')
        def attempt(_):
            try:return self.ledger.login_confirm(token,'flow')
            except ValueError:return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(attempt,range(4)))
        self.assertEqual(sum(x is not None for x in results),1)
        self.assertEqual(self.ledger.account(next(x for x in results if x))['balance'],6000000)

    def test_other_accounts_credit_never_silently_merged(self):
        first=self.ledger.login_request('reader@example.com','one',self.account,'ip')
        self.ledger.login_confirm(first,'one')
        original2=self.ledger.new_account(); account2=self.ledger.account(original2)['id']
        with self.ledger.connect() as db:db.execute('UPDATE accounts SET balance=42 WHERE id=?',(account2,))
        token=self.ledger.login_request('reader@example.com','two',account2,'ip')
        with self.assertRaises(AccountConflict):self.ledger.login_confirm(token,'two')
        self.assertEqual(self.ledger.account(original2)['balance'],42)

    def test_rate_limits_survive_restart_and_tokens_are_hashed(self):
        for _ in range(5):token=self.ledger.login_request('reader@example.com','flow',self.account,'ip')
        with self.assertRaises(ValueError):Ledger(self.ledger.path).login_request('reader@example.com','flow',None,'another')
        self.assertNotIn(token.encode(),self.ledger.path.read_bytes())
        with self.ledger.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM identities').fetchone()[0],0)

    def test_failed_email_no_usable_token_and_no_secret_in_error(self):
        with patch('server.auth.settings',return_value={'secret':'SECRET'}),patch('server.auth.send_link',side_effect=RuntimeError('SECRET')):
            response=self.client.post('/billing/login/request',json={'email':'reader@example.com'},headers=ORIGIN)
        self.assertEqual(response.status_code,503);self.assertNotIn('SECRET',response.text)
        with self.ledger.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM login_links').fetchone()[0],0)

    def test_origin_validation_and_session_expiration(self):
        self.assertEqual(self.client.post('/billing/login/request',json={'email':'reader@example.com'}).status_code,403)
        for email in ('x\r\nBcc: victim@example.com','bad','a@b.com\n',42):
            self.assertEqual(self.client.post('/billing/login/request',json={'email':email},headers=ORIGIN).status_code,422)
        token=self.request(self.client);self.confirm(self.client,token)
        session=self.client.cookies.get(billing.COOKIE)
        with patch('server.usage.time.time',return_value=time.time()+31*86400):self.assertIsNone(self.ledger.account(session))
