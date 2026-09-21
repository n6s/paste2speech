"""Private WaveNet adapter. Credentials stay on the workstation."""
import base64
import io
from pathlib import Path
from server.deepinfra import DeepInfraEngine, HostedSpeechError

VOICES = {'en-US-Wavenet-F', 'en-GB-Wavenet-F'}
KEY_FILE = Path.home() / '.config/paste2speech/google-tts-service-account.json'

class GoogleTTSEngine(DeepInfraEngine):
    def __init__(self, recording):
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
        self.recording = recording
        try:
            credentials = service_account.Credentials.from_service_account_file(
                str(KEY_FILE), scopes=['https://www.googleapis.com/auth/cloud-platform'])
            self.session = AuthorizedSession(credentials)
        except (OSError, ValueError):
            raise HostedSpeechError('Google speech credentials are unavailable.') from None

    def fork(self, recording):
        # Separate authenticated sessions for concurrent section requests.
        return type(self)(recording).synthesize

    def pronunciation(self, text, voice):
        # Kokoro-specific phoneme markup must never reach Google.
        return text

    def phrase_audio(self, text, voice, speed):
        import numpy as np
        import soundfile as sf
        if self.recording.cancelled.is_set():
            raise HostedSpeechError('Preparation cancelled.')
        if not any(c.isalnum() for c in text):
            return []
        if voice not in VOICES or len(text.encode('utf-8')) > 5000:
            raise HostedSpeechError('Unsupported Google voice or section length.')
        self.recording.submitted_characters += len(text)
        # List-price estimate, before free allowance; Google returns no call cost.
        self.recording.provider_cost += len(text) * 4 / 1_000_000
        try:
            response = self.session.post('https://texttospeech.googleapis.com/v1/text:synthesize',
                json={'input': {'text': text}, 'voice': {'languageCode': voice[:5], 'name': voice},
                      'audioConfig': {'audioEncoding': 'LINEAR16', 'sampleRateHertz': 24000,
                                      'speakingRate': speed}}, timeout=60)
            response.raise_for_status()
            data = base64.b64decode(response.json()['audioContent'], validate=True)
            pcm, rate = sf.read(io.BytesIO(data), dtype='float32')
            if rate != 24000 or pcm.ndim != 1 or not len(pcm) or not np.isfinite(pcm).all():
                raise ValueError('Invalid audio')
            self.recording.provider_audio_seconds += len(pcm) / rate
            return [pcm]
        except Exception:
            self.recording.cost_incomplete = True
            raise HostedSpeechError('Google speech failed or timed out. Preparation stopped; retrying may incur new charges.') from None
