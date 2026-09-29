"""Generate each approved preview once. Existing audio and attempts prevent repeats."""
import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

root = Path(__file__).resolve().parents[1] / 'assets/voice-previews'
manifest = json.loads((root / 'manifest.json').read_text())
credentials = service_account.Credentials.from_service_account_file(
    str(Path.home() / '.config/paste2speech/google-tts-service-account.json'),
    scopes=['https://www.googleapis.com/auth/cloud-platform'])
for voice in manifest['voices']:
    target = root / voice['file']
    attempt = root / (voice['id'] + '.attempt.json')
    if target.exists():
        print(voice['id'] + ': reused')
        continue
    if attempt.exists():
        raise SystemExit(voice['id'] + ': already attempted; inspect before retrying')
    record = {'voice': voice['id'], 'passage': manifest['passage'],
              'characters': len(manifest['passage']), 'attemptedAt': datetime.now(timezone.utc).isoformat()}
    attempt.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    with AuthorizedSession(credentials) as session:
        response = session.post('https://texttospeech.googleapis.com/v1/text:synthesize',
            json={'input': {'text': manifest['passage']},
                  'voice': {'languageCode': voice['id'][:5], 'name': voice['id']},
                  'audioConfig': {'audioEncoding': 'MP3', 'sampleRateHertz': 24000, 'speakingRate': 1}}, timeout=60)
    if response.status_code != 200:
        raise SystemExit(f"{voice['id']}: HTTP {response.status_code}; no automatic retry")
    audio = base64.b64decode(response.json()['audioContent'], validate=True)
    target.write_bytes(audio)
    record.update(bytes=len(audio), completedAt=datetime.now(timezone.utc).isoformat())
    attempt.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    print(voice['id'] + ': saved')
