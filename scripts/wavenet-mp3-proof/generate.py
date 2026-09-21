"""Explicit, bounded paid synthetic probe. Never imports the running app.

Use --generate once; subsequent analysis reuses the saved bytes. An attempted
request is recorded BEFORE submission; retries require deliberate intervention.
"""
import argparse
import base64
import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

SECTIONS = [
    'The first section begins beside a quiet river. Mara opens her notebook.',
    'At 9:30 a.m. on September 21, 2026, the next train leaves the station.',
    'She writes: "Bring the blue bag, the map, and a bottle of water."',
    'A short pause follows.',
    'Beyond the bridge, the path climbs gently through the trees. The air feels cool.',
    'One, two, three. These short sentences should remain clear and separate.',
    'The final paragraph begins here; the traveler checks the route once more.',
    'This is the last section. The notebook closes, and the journey ends.',
]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--generate', action='store_true', required=True)
    p.add_argument('--output', default='work/wavenet-mp3-proof')
    p.add_argument('--voice', choices=['en-US-Wavenet-F', 'en-GB-Wavenet-F'])
    args = p.parse_args()
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    attempt = root / 'attempt.json'
    if attempt.exists():
        raise SystemExit('Probe already attempted. Reuse cached audio; no automatic regeneration.')
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    voices = [args.voice] if args.voice else ['en-US-Wavenet-F', 'en-GB-Wavenet-F']
    chars = sum(map(len, SECTIONS)) * len(voices)
    attempt.write_text(json.dumps({'characters': chars, 'listPriceUSD': chars * 4e-6,
                                   'voices': voices, 'sections': SECTIONS}, indent=2))
    started = time.monotonic()
    def generate(item):
        voice, index, text = item
        credentials = service_account.Credentials.from_service_account_file(
            str(Path.home() / '.config/paste2speech/google-tts-service-account.json'),
            scopes=['https://www.googleapis.com/auth/cloud-platform'])
        # No application retries. Never print response/error bodies or credentials.
        with AuthorizedSession(credentials) as session:
            sent = time.monotonic() - started
            response = session.post('https://texttospeech.googleapis.com/v1/text:synthesize',
                json={'input': {'text': text}, 'voice': {'languageCode': voice[:5], 'name': voice},
                      'audioConfig': {'audioEncoding': 'MP3', 'sampleRateHertz': 24000}}, timeout=60)
            if response.status_code != 200:
                raise RuntimeError(f'Synthesis failed with HTTP {response.status_code}; no automatic retry.')
            data = base64.b64decode(response.json()['audioContent'], validate=True)
        ready = time.monotonic() - started
        name = f'{voice}-{index:02}.mp3'
        (root / name).write_bytes(data)
        result = {'voice': voice, 'index': index, 'text': text, 'file': name,
                  'sentSeconds': sent, 'readySeconds': ready, 'bytes': len(data)}
        (root / f'{name}.json').write_text(json.dumps(result, indent=2))
        print(json.dumps({k: result[k] for k in ('voice', 'index', 'readySeconds', 'bytes')}), flush=True)
        return result
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(generate, [(v, i, t) for v in voices for i, t in enumerate(SECTIONS)]))
    (root / 'generated.json').write_text(json.dumps({'characters': chars, 'listPriceUSD': chars * 4e-6,
        'concurrency': 3, 'elapsedSeconds': time.monotonic() - started, 'sections': results}, indent=2))

if __name__ == '__main__':
    main()
