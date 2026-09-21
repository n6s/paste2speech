import threading
import tempfile
import unittest
from pathlib import Path
from server import readings
from server.app import Speech
from server.usage import Ledger, PACK_CHARACTERS
from tests.readings_test import wav

class ForkEngine:
    def __init__(self, recording, generate):
        self.recording, self.generate = recording, generate
    def fork(self, recording):
        return ForkEngine(recording, self.generate).synthesize
    def synthesize(self, job):
        self.recording.submitted_characters += len(job.text)
        self.recording.provider_cost += .001
        result = self.generate(job.text)
        self.recording.provider_audio_seconds += len(readings.parse_pcm(result))/48000
        return result

class ParallelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.ledger = Ledger(Path(self.temp.name)/'usage.db')
        self.token = self.ledger.new_account()
        self.account = self.ledger.account(self.token)
        order = self.ledger.new_order(self.account['id'])
        self.ledger.bind_order(order['id'], 'txn_parallel')
        self.ledger.fulfill(order['id'], 'txn_parallel')
        self.recording = readings.Recording(['one', 'two', 'three', 'four'], 'af_heart', {1}, provider='deepinfra')
        self.recording.ledger = self.ledger
        self.recording.reserved = True
        self.ledger.reserve(self.recording.id, self.account['id'], 15)
    def tearDown(self):
        self.recording.dispose()
        self.temp.cleanup()
    def test_out_of_order_completion_preserves_cues_and_exact_charges(self):
        second = threading.Event()
        def generate(text):
            if text == 'one':
                self.assertTrue(second.wait(3))
            if text == 'two':
                second.set()
            return wav([1000] * (2400 * (['one','two','three','four'].index(text)+1)))
        readings.synthesize_recording(self.recording, ForkEngine(self.recording, generate).synthesize, Speech)
        self.assertEqual(self.recording.state, 'ready')
        for got,want in zip(self.recording.starts,[0,.35,.55,.85]):
            self.assertAlmostEqual(got,want+readings.MP3_DELAY)
        self.assertEqual(self.ledger.account(self.token)['balance'], PACK_CHARACTERS-15)
        self.assertEqual(self.ledger.account(self.token)['reserved'], 0)
        self.assertEqual(self.recording.submitted_characters,15)
        self.assertAlmostEqual(self.recording.provider_cost,.004)
    def test_stop_drains_at_most_three_started_sections_before_release(self):
        barrier = threading.Barrier(4)
        release = threading.Event()
        calls=[]
        def generate(text):
            calls.append(text)
            barrier.wait(3)
            self.assertTrue(release.wait(3))
            return wav([1000]*2400)
        thread=threading.Thread(target=readings.synthesize_recording,args=(self.recording,ForkEngine(self.recording,generate).synthesize,Speech))
        thread.start()
        try:
            barrier.wait(3)
            self.recording.cancelled.set()
        finally:
            release.set()
            thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(set(calls),{'one','two','three'})
        self.assertEqual(self.recording.state,'cancelled')
        self.assertEqual(self.ledger.account(self.token)['balance'],PACK_CHARACTERS-11)
        self.assertEqual(self.ledger.account(self.token)['reserved'],0)
        self.assertAlmostEqual(self.recording.provider_cost,.003)

    def test_failure_settles_other_started_sections_without_starting_more(self):
        barrier=threading.Barrier(3)
        calls=[]
        def generate(text):
            calls.append(text)
            barrier.wait(3)
            if text=='one':
                raise ValueError('private text')
            return wav([1000]*2400)
        readings.synthesize_recording(self.recording,ForkEngine(self.recording,generate).synthesize,Speech)
        self.assertEqual(self.recording.state,'failed')
        self.assertNotIn('private text',self.recording.error)
        self.assertEqual(set(calls),{'one','two','three'})
        self.assertEqual(self.ledger.account(self.token)['balance'],PACK_CHARACTERS-8)
        self.assertEqual(self.ledger.account(self.token)['reserved'],0)
        self.assertAlmostEqual(self.recording.provider_cost,.003)
        with self.ledger.connect() as db:
            rows=db.execute('select outcome from usage').fetchall()
        self.assertEqual(sorted(row['outcome'] for row in rows),['failed','succeeded','succeeded'])

    def test_expanded_budget_is_checked_before_parallel_requests(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from unittest.mock import patch
        app=FastAPI();app.include_router(readings.router)
        with patch('server.deepinfra.MAX_SUBMITTED',5), patch('server.deepinfra.DeepInfraEngine') as engine:
            response=TestClient(app).post('/readings',headers={'Origin':'http://localhost:8766'},
                json={'chunks':['Houthi'], 'voice':'af_heart','provider':'deepinfra'})
        self.assertEqual(response.status_code,422)
        engine.assert_not_called()
