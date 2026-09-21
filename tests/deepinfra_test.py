import base64
import io
import json
import threading
import unittest
import urllib.error
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import soundfile as sf
from server.deepinfra import DeepInfraEngine, HostedSpeechError, MAX_SUBMITTED
from server.app import Speech

class DeepInfraTests(unittest.TestCase):
    def recording(self):
        return SimpleNamespace(cancelled=threading.Event(),submitted_characters=0,provider_cost=0,cost_incomplete=False)

    def response(self,rate=24000):
        buf=io.BytesIO();sf.write(buf,np.full(2400,.2,dtype=np.float32),rate,format='WAV',subtype='PCM_16')
        return io.BytesIO(json.dumps({'audio':'data:audio/wav;base64,'+base64.b64encode(buf.getvalue()).decode(),
            'inference_status':{'status':'succeeded','cost':.00002}}).encode())

    def test_shared_rules_dictionary_and_cost_without_local_model(self):
        recording=self.recording();requests=[]
        def send(request,**kwargs):requests.append(json.loads(request.data));return self.response()
        with patch('pathlib.Path.read_text',return_value='not-a-real-token'),patch('urllib.request.urlopen',side_effect=send):
            engine=DeepInfraEngine(recording)
            data=engine.synthesize(Speech(text='Houthi: At 3:00 PM, astaxanthin.',voice='bf_emma'))
        self.assertTrue(data.startswith(b'RIFF'))
        combined=' '.join(request['text'] for request in requests)
        self.assertIn('[Houthi](/hˈuːti/)',combined)
        self.assertIn('[astaxanthin](/',combined)
        self.assertNotIn('3:00',combined)
        self.assertFalse(hasattr(engine,'pipelines'))
        self.assertTrue(all(r['output_format']=='wav' and r['sample_rate']==24000 and r['service_tier']=='default' for r in requests))
        self.assertEqual(recording.provider_cost,.00002*len(requests))
        self.assertEqual(recording.submitted_characters,sum(len(r['text']) for r in requests))

    def test_no_retry_or_token_leak_on_paid_error(self):
        for code in [401,402,429,500]:
            recording=self.recording()
            with patch('pathlib.Path.read_text',return_value='secret'),patch('urllib.request.urlopen',side_effect=urllib.error.HTTPError('url',code,'secret',{},None)) as call:
                with self.assertRaises(HostedSpeechError) as result:
                    DeepInfraEngine(recording).phrase_audio('Hello','af_heart',1)
            call.assert_called_once();self.assertNotIn('secret',str(result.exception))
            self.assertTrue(recording.cost_incomplete);self.assertEqual(recording.submitted_characters,5)

    def test_cancel_budget_punctuation_and_bad_audio(self):
        with patch('pathlib.Path.read_text',return_value='secret'),patch('urllib.request.urlopen') as call:
            recording=self.recording();engine=DeepInfraEngine(recording)
            self.assertEqual(engine.phrase_audio('*','af_heart',1),[])
            recording.cancelled.set()
            with self.assertRaises(HostedSpeechError):engine.phrase_audio('Hello','af_heart',1)
            recording.cancelled.clear();recording.submitted_characters=MAX_SUBMITTED
            with self.assertRaises(HostedSpeechError):engine.phrase_audio('Hello','af_heart',1)
            call.assert_not_called()
            recording.submitted_characters=0;call.return_value=self.response(rate=22050)
            with self.assertRaises(HostedSpeechError):engine.phrase_audio('Hello','af_heart',1)

    def test_timing_diagnostics_exclude_text_and_credentials(self):
        with patch('pathlib.Path.read_text',return_value='private-token'), \
             patch('urllib.request.urlopen',return_value=self.response()), \
             patch('server.deepinfra.time.monotonic',side_effect=[10,12,12.25]), \
             self.assertLogs('uvicorn.error',level='INFO') as logs:
            DeepInfraEngine(self.recording()).phrase_audio('Private reading','af_heart',1)
        message=' '.join(logs.output)
        self.assertIn('remote_seconds=2.000',message)
        self.assertIn('decode_seconds=0.250',message)
        self.assertIn('audio_seconds=0.100',message)
        self.assertNotIn('Private reading',message)
        self.assertNotIn('private-token',message)
