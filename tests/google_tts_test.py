import base64
import io
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
import numpy as np
import soundfile as sf
from server.google_tts import GoogleTTSEngine
from server.deepinfra import HostedSpeechError
from server.readings import ReadingRequest

class GoogleTests(unittest.TestCase):
    def setUp(self):
        self.engine = object.__new__(GoogleTTSEngine)
        self.engine.recording = SimpleNamespace(cancelled=threading.Event(),submitted_characters=0,provider_cost=0,provider_audio_seconds=0,cost_incomplete=False)
        self.engine.session = Mock()
        data=io.BytesIO();sf.write(data,np.ones(2400)*.1,24000,format='WAV')
        self.engine.session.post.return_value.json.return_value={'audioContent':base64.b64encode(data.getvalue()).decode()}
    def test_original_pronunciation_and_payload(self):
        text='Houthis and astaxanthin'
        self.assertEqual(self.engine.pronunciation(text,'en-US-Wavenet-F'),text)
        pcm=self.engine.phrase_audio(text,'en-US-Wavenet-F',1)
        payload=self.engine.session.post.call_args.kwargs['json']
        self.assertEqual(payload['input'],{'text':text})
        self.assertEqual(payload['audioConfig']['sampleRateHertz'],24000)
        self.assertEqual(len(pcm[0]),2400)
        self.assertAlmostEqual(self.engine.recording.provider_cost,len(text)*.000004)
    def test_failure_not_retried_and_cost_uncertain(self):
        self.engine.session.post.side_effect=TimeoutError()
        with self.assertRaises(HostedSpeechError):self.engine.phrase_audio('Hello','en-GB-Wavenet-F',1)
        self.assertEqual(self.engine.session.post.call_count,1)
        self.assertTrue(self.engine.recording.cost_incomplete)
    def test_cancelled_and_unsupported_do_not_submit(self):
        with self.assertRaises(HostedSpeechError):self.engine.phrase_audio('Hello','af_heart',1)
        self.engine.recording.cancelled.set()
        with self.assertRaises(HostedSpeechError):self.engine.phrase_audio('Hello','en-US-Wavenet-F',1)
        self.engine.session.post.assert_not_called()
    def test_provider_schema(self):
        self.assertEqual(ReadingRequest(chunks=['Hello'],voice='en-US-Wavenet-F',provider='google').provider,'google')

    def test_divider_only_section_is_silent_and_never_calls_google(self):
        from server.app import Speech
        from server.readings import parse_pcm
        for text in ['—', '——', ' — — ']:
            pcm = parse_pcm(self.engine.synthesize(Speech(text=text, voice='en-US-Wavenet-F')))
            self.assertEqual(pcm, bytes(4800))
        self.engine.session.post.assert_not_called()
        self.assertEqual(self.engine.recording.submitted_characters, 0)

    def test_recording_continues_after_divider(self):
        from server.app import Speech
        from server.readings import Recording, synthesize_recording, captions
        recording = Recording(['Before.', '—', 'After.'], 'en-US-Wavenet-F', set(), provider='google')
        self.engine.recording = recording
        self.engine.fork = None
        try:
            synthesize_recording(recording, self.engine.synthesize, Speech)
            self.assertEqual(recording.state, 'ready')
            self.assertEqual(len(recording.starts), 3)
            self.assertEqual(self.engine.session.post.call_count, 2)
            self.assertIn('—', captions(recording))
        finally:
            recording.dispose()
