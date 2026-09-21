"""Private, bounded Cloudflare voice auditions; credentials never reach the client."""
import asyncio
import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

router = APIRouter()
ROOT = Path(__file__).resolve().parent / 'audition'
TOKEN_FILE = Path.home() / '.config/paste2speech/cloudflare-ai-token'
ACCOUNT = 'c71dba5be3cc617a904adc61e767704d'
ORIGINS = {'https://pop-os.tailbd091c.ts.net', 'http://127.0.0.1:8766', 'http://localhost:8766'}
MODELS = {
    'melo': ('@cf/myshell-ai/melotts', ['en']),
    'aura1': ('@cf/deepgram/aura-1', ['asteria', 'luna', 'orion', 'angus']),
    'aura2': ('@cf/deepgram/aura-2-en', ['luna', 'athena', 'orion', 'asteria']),
}
lock = asyncio.Lock()

class Audition(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    model: Literal['melo', 'aura1', 'aura2']
    voice: str
    text: str = Field(min_length=1, max_length=2000)


def generate(job):
    try:
        token = TOKEN_FILE.read_text().strip()
    except OSError:
        raise HTTPException(503, 'Workers AI credential is not configured on the workstation.') from None
    if not token:
        raise HTTPException(503, 'Workers AI credential is not configured on the workstation.')
    model, voices = MODELS[job.model]
    if job.voice not in voices or not job.text.strip():
        raise HTTPException(422, 'Choose a supported voice and enter text.')
    payload = {'prompt': job.text, 'lang': 'en'} if job.model == 'melo' else {
        'text': job.text, 'speaker': job.voice, 'encoding': 'mp3',
    }
    request = urllib.request.Request(
        f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/run/{model}',
        data=json.dumps(payload).encode(), headers={
            'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
        })
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=90) as upstream:
            data = upstream.read(16 * 1024 * 1024 + 1)
            content_type = upstream.headers.get('Content-Type', '')
        if len(data) > 16 * 1024 * 1024:
            raise ValueError('oversize')
        if 'json' in content_type:
            result = json.loads(data)
            if result.get('success') is False:
                raise ValueError('provider failure')
            result = result.get('result', result)
            data = base64.b64decode(result['audio'], validate=True)
        if data.startswith(b'RIFF') and data[8:12] == b'WAVE':
            mime = 'audio/wav'
        elif data.startswith(b'ID3') or (len(data) > 2 and data[0] == 255 and data[1] & 224 == 224):
            mime = 'audio/mpeg'
        else:
            raise ValueError('invalid audio')
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise HTTPException(503, 'Cloudflare rejected the credential. Check Workers AI permissions.') from None
        if error.code == 429:
            raise HTTPException(429, 'Cloudflare usage or rate limit reached. Try later.') from None
        raise HTTPException(502, 'Cloudflare could not generate this sample. Try a shorter passage or another voice.') from None
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(502, 'Cloudflare returned no usable audio or the request timed out. Try again.') from None
    return data, mime, round((time.monotonic() - started) * 1000)


@router.get('/api/audition')
async def page():
    return FileResponse(ROOT / 'index.html')


@router.get('/api/audition.js')
async def script():
    return FileResponse(ROOT / 'app.js', media_type='text/javascript')


@router.post('/api/audition/speech')
async def speech(request: Request):
    if request.headers.get('origin') not in ORIGINS:
        raise HTTPException(403, 'Origin not allowed')
    if request.headers.get('content-type', '').split(';')[0] != 'application/json':
        raise HTTPException(415, 'Send application/json')
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 12000:
            raise HTTPException(413, 'Sample is too large.')
    try:
        job = Audition.model_validate(json.loads(body))
    except (ValidationError, ValueError):
        raise HTTPException(422, 'Use a supported model and at most 2,000 characters.') from None
    if job.voice not in MODELS[job.model][1] or not job.text.strip():
        raise HTTPException(422, 'Choose a supported voice and enter text.')
    if lock.locked():
        raise HTTPException(409, 'Another audition is generating. Wait for it to finish.')
    async with lock:
        data, mime, elapsed = await asyncio.to_thread(generate, job)
    return Response(data, media_type=mime, headers={'X-Generation-Ms': str(elapsed)})
