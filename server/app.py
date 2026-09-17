"""Local Kokoro speech service. No submitted text or generated audio is persisted."""
import asyncio
import io
import json
import os
import re
import subprocess
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

# Kokoro/Misaki phonemes: explicit pronunciations, independent of capitalization.
PRONUNCIATIONS = {
    'a': {'ubtech': 'jˈubˌitɛk', 'waymo': 'wˈAmO', 'robotaxi': 'rˈObOtˌæksi', 'robotaxis': 'rˈObOtˌæksiz'},
    'b': {'ubtech': 'jˈuːbˌiːtɛk', 'waymo': 'wˈAmQ', 'robotaxi': 'rˈQbQtˌaksiː', 'robotaxis': 'rˈQbQtˌaksiːz'},
}


def pronunciation_text(text, voice):
    entries = PRONUNCIATIONS[voice[0]]
    pattern = r'\b(?:' + '|'.join(re.escape(word) for word in entries) + r')\b'
    def correct(part):
        return re.sub(pattern, lambda match: f'[{match[0]}](/{entries[match[0].lower()]}/)', part, flags=re.I)
    # Apply only at the synthesis boundary, after pause planning and cleanup.
    return ''.join(part if re.match(r'(?:https?://|www\.)', part, re.I) else correct(part)
                   for part in re.split(r'((?:https?://|www\.)[^\s]+)', text, flags=re.I))


def spoken_text(text):
    """Speech-only expansion; preserve URLs and nonnumeric identifiers."""
    digits = ('zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine')
    def expand(part):
        def unit(match):
            number, name, period = match.groups()
            word = ('pound' if float(number.replace(',', '')) == 1 else 'pounds') if name.lower().startswith('lb') else ('square feet' if name.lower().startswith('sq') else 'feet')
            following = part[match.end():].lstrip()
            # An abbreviation dot before continuing prose isn't a sentence end.
            end = period if not following or not following[0].islower() else ''
            return f'{number} {word}{end}'
        part = re.sub(r'(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)[ \t]*[-‑–]?[ \t]*(lbs?|sq\.?[ \t]*[-‑–]?[ \t]*ft|ft)\b(\.?)', unit, part, flags=re.I)
        def grouped(match):
            from num2words import num2words
            integer, dot, fraction = match[0].replace(',', '').partition('.')
            try:
                words = num2words(int(integer), lang='en', to='cardinal')
            except OverflowError:
                return match[0]
            words = ' '.join(word for word in words.replace(',', '').replace('-', ' ').split() if word != 'and')
            return words + (' point ' + ' '.join(digits[int(d)] for d in fraction) if dot else '')
        # Preserve the comma's quantity cue instead of letting a four-digit
        # cardinal fall back to the model's year-style pronunciation.
        part = re.sub(r'(?<![\w.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\w|,\d|\.\w)', grouped, part)
        return re.sub(r'(?<![\w.])(\d+)\.(\d+)(?!\w|\.\w)',
                      lambda m: m[1] + ' point ' + ' '.join(digits[int(d)] for d in m[2]), part)
    return ''.join(part if re.match(r'(?:https?://|www\.)', part, re.I) else expand(part)
                   for part in re.split(r'((?:https?://|www\.)[^\s]+)', text, flags=re.I))


def speech_phrases(text):
    """Plan pauses within one reading section; ignore unpaired quotation marks."""
    boundaries = {}
    for match in re.finditer(r':(?=\s|$)', text):
        boundaries[match.end()] = 6000  # 250 ms at 24 kHz
    for match in re.finditer(r"—+", text):
        boundaries[match.end()] = max(boundaries.get(match.end(), 0), 3600)  # 150 ms
    stack = []
    pairs = {'“': '”', '‘': '’', '"': '"'}
    for index, char in enumerate(text):
        before = text[index - 1] if index else ''
        after = text[index + 1] if index + 1 < len(text) else ''
        # Apostrophes, possessives and inch marks are not quote delimiters.
        if char in '‘’' and before.isalnum() and after.isalnum():
            continue
        if stack and char == stack[-1][1]:
            start, _ = stack.pop()
            if not stack and any(c.isalnum() for c in text[start + 1:index]):
                # Keep trailing punctuation with the quote, not in its own
                # synthesis request. Use only outer pairs for nested quotes.
                end = index + 1
                while end < len(text) and text[end] in ',.;:!?…':
                    end += 1
                if start and text[:start].strip():
                    boundaries[start] = max(boundaries.get(start, 0), 1200)
                if text[end:].strip():
                    boundaries[end] = max(boundaries.get(end, 0), 1200)
        elif char in pairs and not before.isalnum():
            stack.append((index, pairs[char]))
    phrases = []
    start = 0
    for end, pause in sorted(boundaries.items()):
        phrase = text[start:end].replace('—', ' ').strip()
        if phrase:
            phrases.append([phrase, pause])
        elif phrases:
            phrases[-1][1] = max(phrases[-1][1], pause)
        start = end
    tail = text[start:].replace('—', ' ').strip()
    if tail:
        phrases.append([tail, 0])
    return phrases


class Engine:
    def __init__(self):
        import torch
        from kokoro import KPipeline
        torch.set_num_threads(int(os.environ.get('P2S_THREADS', '4')))
        self.device = os.environ.get('P2S_DEVICE', 'cpu')
        if self.device not in ('cpu', 'cuda'):
            raise ValueError('P2S_DEVICE must be cpu or cuda')
        if self.device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('P2S_DEVICE=cuda requires a CUDA-enabled PyTorch installation and available NVIDIA GPU')
        self.pipelines = {}
        self.pipelines['a'] = KPipeline(lang_code='a', device=self.device, repo_id='hexgrad/Kokoro-82M')
        self.pipelines['b'] = KPipeline(lang_code='b', model=self.pipelines['a'].model, repo_id='hexgrad/Kokoro-82M')
        for voice in VOICES:
            self.pipelines[voice[0]].load_voice(voice)
        self.synthesize(Speech(text='Ready to read.'))

    def synthesize(self, job):
        import numpy as np
        import soundfile as sf
        import torch
        arrays = []
        previous_pause = 0
        previous_trailing = 0
        with torch.inference_mode():
            for phrase, pause in speech_phrases(spoken_text(job.text)):
                generated = [audio.cpu().numpy() for _, _, audio in self.pipelines[job.voice[0]](pronunciation_text(phrase, job.voice), voice=job.voice, speed=job.speed) if audio is not None]
                if not generated:
                    raise ValueError('No speech generated')
                pcm = np.concatenate(generated)
                audible = np.flatnonzero(np.abs(pcm) > 0.0001)
                leading = int(audible[0]) if len(audible) else len(pcm)
                trailing = len(pcm) - int(audible[-1]) - 1 if len(audible) else len(pcm)
                if previous_pause in (1200, 3600) and arrays and len(audible) and previous_trailing < len(arrays[-1]):
                    # Independent synthesis adds substantial edge silence. Cap
                    # quote/dash gaps at their targets, keeping 5 ms beside each speech edge.
                    excess = max(0, previous_trailing + leading - previous_pause)
                    trim_end = min(excess, max(0, previous_trailing - 120))
                    if trim_end:
                        arrays[-1] = arrays[-1][:-trim_end]
                        previous_trailing -= trim_end
                    trim_start = min(excess - trim_end, max(0, leading - 120))
                    if trim_start:
                        pcm = pcm[trim_start:]
                        leading -= trim_start
                # Count silence on both sides; coincident boundaries use the
                # larger target instead of adding colon and quote pauses.
                missing = max(0, previous_pause - previous_trailing - leading)
                if missing:
                    arrays.append(np.zeros(missing, dtype=pcm.dtype))
                arrays.append(pcm)
                previous_pause, previous_trailing = pause, trailing
        missing = max(0, previous_pause - previous_trailing)
        if missing and arrays:
            arrays.append(np.zeros(missing, dtype=arrays[-1].dtype))
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
    return {'ready': hasattr(app.state, 'engine'), 'engine': 'Kokoro-82M', 'device': app.state.engine.device}

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

def extract_pdf(data):
    try:
        result = subprocess.run(
            ['pdftotext', '-enc', 'UTF-8', '-', '-'], input=data,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30,
            check=False,
        )
    except FileNotFoundError:
        raise HTTPException(503, 'PDF import is unavailable on this workstation.') from None
    except subprocess.TimeoutExpired:
        raise HTTPException(422, 'This PDF took too long to read. Try a smaller PDF.') from None
    if result.returncode:
        raise HTTPException(422, 'Could not read this PDF. It may be damaged or password-protected.')
    pages = result.stdout.decode('utf-8', errors='replace').split('\f')
    if pages and not pages[-1].strip():
        pages.pop()
    text = '\n\n'.join(page.strip() for page in pages if page.strip())
    if not text:
        raise HTTPException(422, 'No readable text found. This version does not recognize text in scanned images (no OCR).')
    if len(text) > 1_000_000:
        raise HTTPException(413, 'Too much text. Try a smaller PDF or a section of it.')
    return {'text': text, 'pages': len(pages), 'emptyPages': sum(not page.strip() for page in pages)}

@app.post('/pdf-text')
@app.post('/api/pdf-text')
async def pdf_text(request: Request):
    origin = request.headers.get('origin')
    if origin and origin not in ALLOWED_ORIGINS:
        raise HTTPException(403, 'Origin not allowed')
    if request.headers.get('content-type', '').split(';')[0].strip() != 'application/pdf':
        raise HTTPException(415, 'Choose a PDF file.')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(413, 'Choose a PDF smaller than 20 MB.')
    if not data.startswith(b'%PDF-'):
        raise HTTPException(422, 'This file does not look like a PDF.')
    if getattr(app.state, 'pdf_busy', False):
        raise HTTPException(503, 'Another PDF is being read. Try again shortly.')
    app.state.pdf_busy = True
    try:
        return await asyncio.to_thread(extract_pdf, bytes(data))
    finally:
        app.state.pdf_busy = False

app.mount('/', StaticFiles(directory=os.environ.get('P2S_PUBLIC', str(ROOT / 'public')), html=True), name='static')
