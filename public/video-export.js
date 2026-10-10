import {FFmpeg} from '@ffmpeg/ffmpeg';
import {generatedLabel, videoArguments} from './playlist-plan.js';
import {loadPreparedMedia} from './prepared-media.js';

async function get(url, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw Error(`Could not load prepared audio or video tools (${response.status}). Sign in again if necessary.`);
  return response;
}
async function titleCard(label) {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101b28'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center'; ctx.fillStyle = '#f3f6fa'; ctx.font = '42px sans-serif';
  ctx.fillText('PasteToSpeech', 480, 175);
  ctx.fillStyle = '#b5c9df'; ctx.font = '26px sans-serif'; ctx.fillText('pastetospeech.com', 480, 225);
  ctx.font = '22px sans-serif'; ctx.fillText(label, 480, 270);
  // Leave the lower portion empty for player-rendered selectable subtitles.
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Could not create the title card.');
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportVideo(records, {signal, assets, update = () => {}} = {}) {
  const ffmpeg = new FFmpeg(); let wasmURL;
  const cancel = () => ffmpeg.terminate(); signal?.addEventListener('abort', cancel, {once: true});
  const check = () => signal?.throwIfAborted();
  try {
    check(); update('Loading video tools on this device…');
    const manifest = await (await get('/video/core.json', signal)).json();
    const segments = [];
    for (const name of manifest.parts) { check(); segments.push(await (await get(`/video/${name}`, signal)).arrayBuffer()); }
    wasmURL = URL.createObjectURL(new Blob(segments, {type: 'application/wasm'}));
    segments.length = 0;
    await ffmpeg.load({classWorkerURL: new URL('/video/worker.js', location.href).href,
      coreURL: new URL('/video/ffmpeg-core.js', location.href).href, wasmURL});
    check();
    const {blob,vtt,duration}=await loadPreparedMedia(records,{assets,signal,update});
    const joined=new Uint8Array(await blob.arrayBuffer());
    const label = generatedLabel();
    await ffmpeg.writeFile('audio.mp3', joined);
    await ffmpeg.writeFile('captions.vtt', new TextEncoder().encode(vtt));
    await ffmpeg.writeFile('card.png', await titleCard(label));
    ffmpeg.on('progress', ({time}) => update(`Creating your video… ${Math.min(99, Math.max(0, Math.floor(time / 1000000 / duration * 100)))}%`));
    update('Creating your video…'); check();
    const result = await ffmpeg.exec(videoArguments(duration));
    if (result !== 0) throw Error('Video conversion failed on this device. Prepared audio is still available; you can retry without generating speech again.');
    check(); const bytes = await ffmpeg.readFile('part.mp4');
    return {blob: new Blob([bytes], {type: 'video/mp4'}), vtt, duration, label};
  } finally {
    signal?.removeEventListener('abort', cancel); ffmpeg.terminate();
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }
}
