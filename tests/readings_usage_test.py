import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from server import readings, billing
from server.usage import Ledger, PACK_CHARACTERS
from tests.readings_test import wav

class MeteredReadingsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.ledger=Ledger(Path(self.temp.name)/'usage.db')
        self.app=FastAPI();self.app.include_router(readings.router);self.app.include_router(billing.router)
        self.app.state.usage=self.ledger;self.app.state.usage_kind='development'
        self.app.state.busy=False;self.app.state.engine=SimpleNamespace(synthesize=lambda job:wav([1000]*2400))
        self.origin={'Origin':'http://localhost:8766'}
        self.client=TestClient(self.app);self.client.__enter__()
        self.client.post('/billing/session',headers=self.origin)
        self.account=self.ledger.account(self.client.cookies.get(billing.COOKIE))
        self.client.post('/billing/mode',json={'enabled':True},headers=self.origin)

    def tearDown(self):
        self.client.__exit__(None,None,None)
        for r in readings.jobs.values():r.dispose()
        readings.jobs.clear();self.temp.cleanup()

    def fund(self):
        order=self.ledger.new_order(self.account['id']);self.ledger.bind_order(order['id'],'txn_test')
        self.ledger.fulfill(order['id'],'txn_test')

    def test_no_credit_prevents_provider_call(self):
        engine=SimpleNamespace(synthesize=lambda job:None)
        with patch('server.deepinfra.DeepInfraEngine',return_value=engine):
            r=self.client.post('/readings',headers=self.origin,json={'chunks':['Hello.'],'voice':'af_heart','provider':'deepinfra'})
        self.assertEqual(r.status_code,402);self.assertFalse(readings.jobs)

    def test_partial_generation_charged_once_and_unused_allowance_released(self):
        self.fund()
        def factory(recording):
            def generate(job):
                recording.submitted_characters+=len(job.text)+10
                recording.provider_cost+=.0001
                if job.text=='fails':
                    recording.cost_incomplete=True
                    raise ValueError('source text must not be stored')
                return wav([1000]*2400)
            return SimpleNamespace(synthesize=generate)
        with patch('server.deepinfra.DeepInfraEngine',side_effect=factory):
            r=self.client.post('/readings',headers=self.origin,json={'chunks':['Hello.','fails','unused'],'voice':'af_heart','provider':'deepinfra'})
            self.assertEqual(r.status_code,200)
            key=r.json()['id']
            for _ in range(100):
                if not self.app.state.busy:break
                time.sleep(.02)
        self.assertFalse(self.app.state.busy)
        self.assertEqual(readings.jobs[key].state,'failed')
        account=self.ledger.account(self.client.cookies.get(billing.COOKIE))
        self.assertEqual(account['balance'],PACK_CHARACTERS-6);self.assertEqual(account['reserved'],0)
        self.client.delete('/readings/'+key,headers=self.origin)
        self.assertEqual(self.ledger.account(self.client.cookies.get(billing.COOKIE))['balance'],PACK_CHARACTERS-6)
        with self.ledger.connect() as db:
            rows=db.execute('SELECT * FROM usage ORDER BY id').fetchall()
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['kind'],'sandbox')
        self.assertAlmostEqual(sum(row['provider_cost'] for row in rows),.0002)
        self.assertNotIn('Hello',self.ledger.path.read_bytes().decode(errors='ignore'))

    def test_workstation_tracks_without_using_sandbox_balance(self):
        r=self.client.post('/readings',headers=self.origin,json={'chunks':['Hello.'],'voice':'af_heart'})
        self.assertEqual(r.status_code,200)
        for _ in range(100):
            if not self.app.state.busy:break
            time.sleep(.02)
        with self.ledger.connect() as db:row=db.execute('SELECT * FROM usage').fetchone()
        self.assertEqual(row['provider'],'workstation');self.assertEqual(row['kind'],'development')
        self.assertEqual(row['source_characters'],6);self.assertAlmostEqual(row['audio_seconds'],.1)
