"""Local Kokoro speech service. No submitted text or generated audio is persisted."""
import asyncio
import io
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError

VOICES = {
    'af_heart': 'Heart · American English',
    'af_bella': 'Bella · American English',
    'am_michael': 'Michael · American English',
    'am_fenrir': 'Fenrir · American English',
    'bf_emma': 'Emma · British English',
    'bm_george': 'George · British English',
}
ROOT = Path(__file__).resolve().parent.parent
ALLOWED_ORIGINS = set(os.environ.get('P2S_ORIGINS', 'http://127.0.0.1:8766,http://localhost:8766,https://pop-os.tailbd091c.ts.net').split(','))

class Speech(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    text: str = Field(min_length=1, max_length=600)
    voice: str = 'af_heart'
    speed: float = Field(default=1.0, ge=0.5, le=2.0, allow_inf_nan=False)

class Engine:
    def __init__(self):
        import torch
        from kokoro import KPipeline
        torch.set_num_threads(int(os.environ.get('P2S_THREADS', '4')))
        self.pipelines = {}
        self.pipelines['a'] = KPipeline(lang_code='a', device='cpu', repo_id='hexgrad/Kokoro-82M')
        self.pipelines['b'] = KPipeline(lang_code='b', model=self.pipelines['a'].model, repo_id='hexgrad/Kokoro-82M')
        for voice in VOICES:
            self.pipelines[voice[0]].load_voice(voice)
        self.synthesize(Speech(text='Ready to read.'))

    def synthesize(self, job):
        import numpy as np
        import soundfile as sf
        import torch
        with torch.inference_mode():
            arrays = [audio.numpy() for _, _, audio in self.pipelines[job.voice[0]](job.text, voice=job.voice, speed=job.speed) if audio is not None]
        if not arrays:
            raise ValueError('No speech generated')
        output = io.BytesIO()
        sf.write(output, np.concatenate(arrays), 24000, format='WAV', subtype='PCM_16')
        return output.getvalue()

@asynccontextmanager
async def lifespan(app):
    app.state.engine = await asyncio.to_thread(Engine)
    app.state.busy = False
    yield

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware('http')
async def no_cache(request, call_next):
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

@app.get('/health')
@app.get('/api/health')
async def health():
    return {'ready': hasattr(app.state, 'engine'), 'engine': 'Kokoro-82M', 'device': 'cpu'}

@app.get('/voices')
@app.get('/api/voices')
async def voices():
    return {'voices': [{'id': key, 'name': value} for key, value in VOICES.items()]}

@app.post('/speech')
@app.post('/api/speech')
async def speech(request: Request):
    origin = request.headers.get('origin')
    if origin and origin not in ALLOWED_ORIGINS:
        raise HTTPException(403, 'Origin not allowed')
    if request.headers.get('content-type', '').split(';')[0].strip() != 'application/json':
        raise HTTPException(415, 'Send application/json')
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 8192:
            raise HTTPException(413, 'Request too large')
    try:
        job = Speech.model_validate(json.loads(body))
    except (ValidationError, ValueError, UnicodeDecodeError):
        raise HTTPException(422, 'Invalid speech request') from None
    if job.voice not in VOICES or not job.text.strip():
        raise HTTPException(422, 'Choose a supported voice and nonempty text')
    if app.state.busy:
        raise HTTPException(503, 'Speech service is busy. Please retry.', headers={'Retry-After': '2'})
    app.state.busy = True
    try:
        audio = await asyncio.to_thread(app.state.engine.synthesize, job)
        return Response(audio, media_type='audio/wav')
    except Exception:
        # Do not include submitted text in exception responses or logs.
        raise HTTPException(500, 'Could not generate speech. Try another voice.') from None
    finally:
        app.state.busy = False

app.mount('/', StaticFiles(directory=os.environ.get('P2S_PUBLIC', str(ROOT / 'public')), html=True), name='static')
