"""Bounded private pilot: hosted inference, shared normalization and pause rules."""
import base64
import io
import json
import math
import urllib.error
import urllib.request
from pathlib import Path

from server.app import Engine

TOKEN_FILE = Path.home() / '.config/paste2speech/deepinfra-api-token'
VOICES = {'af_heart', 'bf_emma'}
MAX_INPUT = 20000
MAX_SUBMITTED = 30000

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
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw=response.read(16*1024*1024+1)
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
