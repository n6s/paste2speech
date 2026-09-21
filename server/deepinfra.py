"""Bounded private pilot: hosted inference, shared normalization and pause rules."""
import copy
import base64
import io
import json
import math
import logging
import time
import urllib.error
import urllib.request
from pathlib import Path

from server.app import Engine

TOKEN_FILE = Path.home() / '.config/paste2speech/deepinfra-api-token'
VOICES = {'af_heart', 'bf_emma'}
MAX_INPUT = 20000
MAX_SUBMITTED = 30000
logger = logging.getLogger("uvicorn.error")

class HostedSpeechError(Exception):
    def __init__(self, message):
        self.public_message = message
        super().__init__(message)

class DeepInfraEngine(Engine):
    def __init__(self, recording):
        self.recording = recording
        try:
            self.token = TOKEN_FILE.read_text().strip()
        except OSError:
            self.token = ''
        if not self.token:
            raise HostedSpeechError('DeepInfra is not configured on the workstation.')

    def fork(self, recording):
        engine = copy.copy(self)
        engine.recording = recording
        return engine.synthesize

    def phrase_audio(self, text, voice, speed):
        import numpy as np
        import soundfile as sf
        if self.recording.cancelled.is_set():
            raise HostedSpeechError('Preparation cancelled.')
        # Preserve the local formatting-only gap without a paid empty-phoneme call.
        if not any(char.isalnum() for char in text):
            return []
        if voice not in VOICES or len(text) > 10000:
            raise HostedSpeechError('Unsupported hosted voice or section length.')
        if self.recording.submitted_characters + len(text) > MAX_SUBMITTED:
            raise HostedSpeechError('This reading reached the private hosted-test limit. Use a shorter passage.')
        # Count attempted characters even if the response is lost; never retry a
        # paid request automatically or pretend that a timeout cannot be billed.
        self.recording.submitted_characters += len(text)
        payload = {'text':text, 'preset_voice':[voice], 'output_format':'wav',
                   'sample_rate':24000, 'speed':speed, 'stream':False, 'service_tier':'default'}
        request = urllib.request.Request('https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M',
            data=json.dumps(payload).encode(), headers={'Content-Type':'application/json',
                                                       'Authorization':'Bearer '+self.token})
        started = time.monotonic()
        received = None
        audio_seconds = 0
        outcome = "failed"
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw=response.read(16*1024*1024+1)
            received = time.monotonic()
            if len(raw)>16*1024*1024:
                raise ValueError('oversize')
            result=json.loads(raw)
            info=result['inference_status']
            if info['status']!='succeeded':
                raise ValueError('failed')
            cost=info.get('cost')
            if isinstance(cost,(int,float)) and not isinstance(cost,bool) and math.isfinite(cost) and cost>=0:
                self.recording.provider_cost += cost
            else:
                self.recording.cost_incomplete = True
            encoded=result['audio']
            if encoded.startswith('data:'):
                prefix,encoded=encoded.split(',',1)
                if prefix not in ('data:audio/wav;base64','data:audio/x-wav;base64','data:audio/wave;base64'):
                    raise ValueError('format')
            data=base64.b64decode(encoded,validate=True)
            if not data.startswith(b'RIFF') or data[8:12]!=b'WAVE':
                raise ValueError('format')
            pcm,rate=sf.read(io.BytesIO(data),dtype='float32')
            if rate!=24000 or pcm.ndim!=1 or not len(pcm) or not np.isfinite(pcm).all():
                raise ValueError('audio')
            self.recording.provider_audio_seconds = getattr(self.recording, 'provider_audio_seconds', 0) + len(pcm)/rate
            audio_seconds = len(pcm)/rate
            outcome = "succeeded"
            return [pcm]
        except urllib.error.HTTPError as error:
            self.recording.cost_incomplete = True
            messages={401:'DeepInfra rejected the credential.',403:'DeepInfra rejected access.',
                      402:'DeepInfra prepaid credit is exhausted.',429:'DeepInfra rate limit reached.'}
            raise HostedSpeechError(messages.get(error.code,'DeepInfra could not generate this section.') +
                                    ' Preparation stopped; retrying the reading may incur new charges.') from None
        except (OSError,ValueError,KeyError,TypeError,AttributeError,RuntimeError):
            self.recording.cost_incomplete = True
            raise HostedSpeechError('DeepInfra returned no usable audio or timed out. Preparation stopped; retrying may incur new charges.') from None

        finally:
            finished = time.monotonic()
            # Numeric diagnostics only: never log source text, credentials, or
            # provider responses. Remote time includes network and provider wait.
            logger.info(
                "deepinfra_timing outcome=%s characters=%d remote_seconds=%.3f decode_seconds=%.3f audio_seconds=%.3f",
                outcome, len(text), (received or finished) - started,
                finished - received if received is not None else 0, audio_seconds)
