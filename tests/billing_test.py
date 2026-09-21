import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from server import billing
from server.usage import Ledger, PACK_CHARACTERS

ORIGIN={'Origin':'https://pop-os.tailbd091c.ts.net'}
TXN='txn_'+'a'*26

def purchase(order):
    return {'id':TXN,'status':'completed','custom_data':{'p2s_order':order},'currency_code':'USD',
        'subscription_id':None,'discount_id':None,'items':[{'quantity':1,'price':{
        'id':billing.PRICE,'product_id':billing.PRODUCT,'billing_cycle':None,
        'unit_price':{'amount':'1000','currency_code':'USD'}}}],
        'details':{'totals':{'subtotal':'1000','discount':'0'}}}

class BillingTests(unittest.TestCase):
    def setUp(self):
        self.adjustments=patch('server.billing.adjustments',return_value=[]);self.adjustments.start();self.addCleanup(self.adjustments.stop)
        self.temp=tempfile.TemporaryDirectory()
        self.app=FastAPI();self.app.include_router(billing.router)
        self.app.state.usage=Ledger(Path(self.temp.name)/'usage.db')
        self.client=TestClient(self.app)
        self.client.post('/api/billing/session',headers=ORIGIN)

    def tearDown(self):self.client.close();self.temp.cleanup()

    def test_transaction_created_on_server_and_verified_once(self):
        with patch('server.billing.paddle',return_value={'id':TXN}) as api:
            order=self.client.post('/api/billing/order',headers=ORIGIN).json()
            again=self.client.post('/api/billing/order',headers=ORIGIN).json()
        self.assertEqual(order,again);self.assertEqual(api.call_count,1)
        sent=api.call_args.args[1]
        self.assertEqual(sent['items'],[{'price_id':billing.PRICE,'quantity':1}])
        self.assertEqual(sent['custom_data']['p2s_order'],order['order'])
        with patch('server.billing.paddle',return_value=purchase(order['order'])) as api:
            first=self.client.post('/api/billing/reconcile',json={'order':order['order']},headers=ORIGIN)
            repeat=self.client.post('/api/billing/reconcile',json={'order':order['order']},headers=ORIGIN)
        self.assertTrue(first.json()['newCredit']);self.assertFalse(repeat.json()['newCredit']);self.assertEqual(api.call_count,2)
        status=self.client.get('/api/billing/status',headers=ORIGIN).json()
        self.assertEqual(status['account']['balance'],PACK_CHARACTERS)
        self.assertNotIn('id',status['account'])

    def test_unpaid_wrong_pack_amount_quantity_and_owner_rejected(self):
        with patch('server.billing.paddle',return_value={'id':TXN}):
            order=self.client.post('/billing/order',headers=ORIGIN).json()['order']
        with patch('server.billing.paddle',return_value={'id':TXN,'status':'paid'}):
            result=self.client.post('/billing/reconcile',json={'order':order},headers=ORIGIN)
            self.assertFalse(result.json()['credited'])
        base=purchase(order)
        variants=[]
        for key,value in [('currency_code','EUR'),('subscription_id','sub_bad'),('discount_id','dsc_bad'),('custom_data',{'p2s_order':'wrong'})]:
            variants.append(base|{key:value})
        bad=copy.deepcopy(base);bad['items'][0]['quantity']=2;variants.append(bad)
        bad=copy.deepcopy(base);bad['items'][0]['price']['id']='pri_other';variants.append(bad)
        bad=copy.deepcopy(base);bad['items'][0]['price']['unit_price']['amount']='500';variants.append(bad)
        for data in variants:
            with patch('server.billing.paddle',return_value=data):
                self.assertEqual(self.client.post('/billing/reconcile',json={'order':order},headers=ORIGIN).status_code,502)
        other=TestClient(self.app);other.post('/billing/session',headers=ORIGIN)
        with patch('server.billing.paddle') as api:
            self.assertEqual(other.post('/billing/reconcile',json={'order':order},headers=ORIGIN).status_code,404)
            api.assert_not_called()
        self.assertEqual(self.client.get('/billing/status',headers=ORIGIN).json()['account']['balance'],0)

    def test_origin_session_cookie_and_body_boundaries(self):
        self.assertEqual(self.client.post('/billing/order').status_code,403)
        self.assertEqual(self.client.get('/billing/status',headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.client.post('/billing/mode',json={'enabled':'yes'},headers=ORIGIN).status_code,422)
        self.assertEqual(self.client.post('/billing/mode',json={'enabled':True},headers=ORIGIN).status_code,200)
        self.assertEqual(self.client.post('/billing/reconcile',content='x'*2049,headers=ORIGIN).status_code,413)
        self.assertTrue(self.client.get('/billing/status',headers=ORIGIN).json()['account']['enabled'])
        r=self.client.post('/billing/session',headers=ORIGIN)
        self.assertIn('HttpOnly',r.headers['set-cookie']);self.assertIn('SameSite=strict',r.headers['set-cookie'])
        no_session=TestClient(self.app)
        self.assertEqual(no_session.post('/billing/order',headers=ORIGIN).status_code,401)

    def test_credentials_never_return_server_key_or_live_client_token(self):
        with patch('server.billing.credential',side_effect=lambda name:'live_secret' if 'client' in name else 'API_SUPER_SECRET'):
            text=self.client.get('/billing/status',headers=ORIGIN).text
        self.assertNotIn('API_SUPER_SECRET',text);self.assertNotIn('live_secret',text)
        with patch('server.billing.credential',return_value='pdl_live_apikey_secret'),patch('urllib.request.urlopen') as send:
            with self.assertRaises(Exception):billing.paddle('/transactions')
            send.assert_not_called()
