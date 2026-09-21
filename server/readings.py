"""Private progressive recordings. Temporary MP3s expire; source text is never logged."""
import asyncio
import html
import io
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

router = APIRouter()
SAMPLE_RATE = 24000
# Raw streamed MP3 has no Xing/LAME gapless tag: encoder + decoder delay.
MP3_DELAY = 1105 / SAMPLE_RATE
MAX_AUDIO_BYTES = 512 * 1024 * 1024
TTL = 24 * 60 * 60
MAX_JOBS = 3
jobs = {}
RECORDING_ROOT = Path.home() / '.cache/paste2speech/readings'


def new_directory():
    RECORDING_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    RECORDING_ROOT.chmod(0o700)
    return tempfile.mkdtemp(prefix='recording-', dir=RECORDING_ROOT)


def touch_recording(recording):
    recording.touched = time.monotonic()
    try:
        os.utime(recording.directory, None)
    except FileNotFoundError:
        pass


class ReadingRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    chunks: list[str] = Field(min_length=1, max_length=10000)
    voice: str
    provider: Literal['workstation', 'deepinfra'] = 'workstation'
    paragraphStarts: list[int] = Field(default_factory=list, max_length=10000)

@dataclass
class Recording:
    chunks: list
    voice: str
    paragraphs: set
    provider: str = 'workstation'
    provider_cost: float = 0
    submitted_characters: int = 0
    cost_incomplete: bool = False
    id: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    directory: str = field(default_factory=new_directory)
    starts: list = field(default_factory=list)
    state: str = 'generating'
    duration: float = 0
    error: str = ''
    touched: float = field(default_factory=time.monotonic)
    cancelled: threading.Event = field(default_factory=threading.Event)
    process: object = None
    task: object = None
    readers: int = 0

    @property
    def path(self):
        return Path(self.directory) / 'reading.mp3'

    def snapshot(self):
        return {'state': self.state, 'starts': list(self.starts), 'duration': self.duration,
                'completed': len(self.starts), 'total': len(self.chunks), 'error': self.error,
                'provider': self.provider, 'providerCost': self.provider_cost,
                'submittedCharacters': self.submitted_characters, 'costIncomplete': self.cost_incomplete}

    def dispose(self):
        self.cancelled.set()
        if self.process and self.process.poll() is None:
            self.process.terminate()
        shutil.rmtree(self.directory, ignore_errors=True)


def parse_pcm(data):
    with wave.open(io.BytesIO(data)) as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError('Unsupported speech format')
        return wav.readframes(wav.getnframes())


def silence(pcm, leading):
    import struct
    samples = len(pcm) // 2
    quiet = 0
    while quiet < min(samples, 6000):
        index = quiet if leading else samples - quiet - 1
        if abs(struct.unpack_from('<h', pcm, index * 2)[0]) > 3:
            break
        quiet += 1
    return quiet


def synthesize_recording(recording, synthesize, speech_type):
    """One encoder across all chunks preserves one sample clock and all pauses."""
    try:
        with recording.path.open('wb') as output:
            recording.process = subprocess.Popen([
                'ffmpeg', '-v', 'error', '-f', 's16le', '-ar', str(SAMPLE_RATE), '-ac', '1',
                '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '64k', '-write_xing', '0',
                '-id3v2_version', '0', '-flush_packets', '1', '-f', 'mp3', 'pipe:1',
            ], stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL)
            samples, trailing = 0, 0
            for index, text in enumerate(recording.chunks):
                if recording.cancelled.is_set():
                    return
                pcm = parse_pcm(synthesize(speech_type(text=text, voice=recording.voice, speed=1.0)))
                if recording.cancelled.is_set():
                    return
                gap = max(0, 6000 - trailing - silence(pcm, True)) if index in recording.paragraphs and index else 0
                recording.process.stdin.write(bytes(gap * 2) + pcm)
                recording.process.stdin.flush()
                recording.starts.append((samples + gap) / SAMPLE_RATE + MP3_DELAY)
                samples += gap + len(pcm) // 2
                recording.duration = samples / SAMPLE_RATE + MP3_DELAY
                touch_recording(recording)
                trailing = silence(pcm, False)
                if recording.path.stat().st_size > MAX_AUDIO_BYTES:
                    raise ValueError('Recording too large')
            recording.process.stdin.close()
            if recording.process.wait(timeout=30) != 0:
                raise ValueError('Encoder failed')
        # CBR frame count includes final padding. Native media controls use this
        # same complete timeline; cue boundaries retain sample-accurate starts.
        result = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                          '-of', 'default=nw=1:nk=1', str(recording.path)], timeout=15)
        recording.duration = float(result)
        recording.state = 'ready'
    except Exception as error:
        if not recording.cancelled.is_set():
            recording.error = getattr(error, 'public_message', None) or 'Recording stopped before completion. Press Play to retry the reading.'
            recording.state = 'failed'
    finally:
        if recording.process:
            if recording.process.poll() is None:
                recording.process.kill()
            recording.process.wait()
            if recording.process.stdin and not recording.process.stdin.closed:
                recording.process.stdin.close()
        if recording.cancelled.is_set():
            recording.state = 'cancelled'


def expire_recordings():
    now = time.monotonic()
    for key, recording in list(jobs.items()):
        if recording.state != 'generating' and not recording.readers and now - recording.touched > TTL:
            jobs.pop(key, None)
            recording.dispose()
    # Also remove expired recordings left by a power loss or forced service exit.
    if RECORDING_ROOT.exists():
        active = {r.directory for r in jobs.values()}
        for directory in RECORDING_ROOT.glob('recording-*'):
            if str(directory) not in active and not directory.is_symlink() and directory.is_dir():
                if time.time() - directory.stat().st_mtime > TTL:
                    shutil.rmtree(directory, ignore_errors=True)


async def cleanup_loop():
    while True:
        expire_recordings()
        await asyncio.sleep(60)


def origin_check(request):
    from server.app import ALLOWED_ORIGINS
    if request.headers.get('origin') not in ALLOWED_ORIGINS:
        raise HTTPException(403, 'Origin not allowed')


def get_recording(key, request):
    origin = request.headers.get('origin')
    if origin:
        origin_check(request)
    if request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, 'Origin not allowed')
    recording = jobs.get(key)
    if not recording:
        raise HTTPException(404, 'Recording expired. Prepare it again.')
    touch_recording(recording)
    return recording


@router.post('/readings')
@router.post('/api/readings')
async def create(request: Request):
    from server.app import VOICES, Speech
    origin_check(request)
    if request.headers.get('content-type', '').split(';')[0] != 'application/json':
        raise HTTPException(415, 'Send application/json')
    body = bytearray()
    async for part in request.stream():
        body.extend(part)
        if len(body) > 4_000_000:
            raise HTTPException(413, 'This reading is too large. Split it into chapters.')
    try:
        job = ReadingRequest.model_validate(json.loads(body))
    except (ValidationError, ValueError, UnicodeDecodeError):
        raise HTTPException(422, 'Invalid reading') from None
    if (job.voice not in VOICES or any(not text.strip() or len(text) > 600 for text in job.chunks)
            or sum(map(len, job.chunks)) > 1_000_000
            or any(index < 0 or index >= len(job.chunks) for index in job.paragraphStarts)):
        raise HTTPException(422, 'Choose a voice and reading sections of at most 600 characters.')
    if job.provider == 'deepinfra':
        from server.deepinfra import VOICES as HOSTED_VOICES, MAX_INPUT
        if job.voice not in HOSTED_VOICES or sum(map(len, job.chunks)) > MAX_INPUT:
            raise HTTPException(422, 'Private DeepInfra testing supports Heart and Emma, up to 20,000 characters per reading.')
    if request.app.state.busy:
        raise HTTPException(503, 'The workstation is busy. Wait a moment and press Play.')
    if not shutil.which('ffmpeg'):
        raise HTTPException(503, 'Audio encoding is unavailable on the workstation.')
    expire_recordings()
    if len(jobs) >= MAX_JOBS:
        raise HTTPException(409, 'Three readings are already open. Clear an earlier reading before starting another.')
    recording = Recording(job.chunks, job.voice, set(job.paragraphStarts), provider=job.provider)
    synthesize = request.app.state.engine.synthesize
    if job.provider == 'deepinfra':
        from server.deepinfra import DeepInfraEngine, HostedSpeechError
        try:
            synthesize = DeepInfraEngine(recording).synthesize
        except HostedSpeechError as error:
            recording.dispose()
            raise HTTPException(503, error.public_message) from None
    jobs[recording.id] = recording
    request.app.state.busy = True
    async def run():
        try:
            await asyncio.to_thread(synthesize_recording, recording, synthesize, Speech)
        finally:
            request.app.state.busy = False
    recording.task = asyncio.create_task(run())
    return {'id': recording.id}


@router.get('/readings/{key}')
@router.get('/api/readings/{key}')
async def status(key: str, request: Request):
    return get_recording(key, request).snapshot()


@router.delete('/readings/{key}')
@router.delete('/api/readings/{key}')
async def remove(key: str, request: Request):
    origin_check(request)
    recording = get_recording(key, request)
    jobs.pop(key, None)
    recording.dispose()
    if recording.task:
        await asyncio.shield(recording.task)
    return Response(status_code=204)


@router.get('/readings/{key}/audio')
@router.get('/api/readings/{key}/audio')
async def audio(key: str, request: Request):
    recording = get_recording(key, request)
    if recording.state == 'ready':
        return FileResponse(recording.path, media_type='audio/mpeg', headers={'Content-Disposition': 'inline'})
    if recording.state != 'generating':
        raise HTTPException(409, 'This recording did not finish. Prepare it again.')
    async def stream():
        offset = 0
        recording.readers += 1
        try:
            while not recording.cancelled.is_set():
                if recording.path.exists():
                    try:
                        with recording.path.open('rb') as source:
                            source.seek(offset)
                            data = source.read(65536)
                    except FileNotFoundError:
                        break
                    if data:
                        offset += len(data)
                        touch_recording(recording)
                        yield data
                        continue
                if recording.state != 'generating':
                    break
                await asyncio.sleep(.1)
        finally:
            recording.readers -= 1
    return StreamingResponse(stream(), media_type='audio/mpeg', headers={'X-Accel-Buffering': 'no', 'Accept-Ranges': 'none'})


def timestamp(seconds):
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3600000)
    minutes, millis = divmod(millis, 60000)
    seconds, millis = divmod(millis, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02}.{millis:03}'


def captions(recording):
    lines = ['WEBVTT', '']
    for index, text in enumerate(recording.chunks):
        end = recording.starts[index + 1] if index + 1 < len(recording.starts) else recording.duration
        lines.extend([str(index + 1), f'{timestamp(recording.starts[index])} --> {timestamp(end)}',
                      html.escape(' '.join(text.split()), quote=False), ''])
    return '\n'.join(lines)


@router.get('/readings/{key}/download/{kind}')
@router.get('/api/readings/{key}/download/{kind}')
async def download(key: str, kind: str, request: Request):
    recording = get_recording(key, request)
    if recording.state != 'ready':
        raise HTTPException(409, 'Wait until the whole reading is prepared before downloading.')
    if kind == 'mp3':
        return FileResponse(recording.path, media_type='audio/mpeg', filename='reading.mp3')
    if kind == 'vtt':
        return Response(captions(recording), media_type='text/vtt', headers={'Content-Disposition': 'attachment; filename="reading.vtt"'})
    raise HTTPException(404, 'Unknown download format')
