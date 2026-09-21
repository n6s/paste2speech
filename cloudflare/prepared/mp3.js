// Private proof only. Web-standard JS: no encoder, subprocess, Node APIs, or keys.
// Deliberately reject formats that have not been validated by this experiment.
export function inspectMp3(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 8 * 1024 * 1024)
    throw Error('Expected a bounded, nonempty MP3 section');
  let offset = 0, frames = 0, reservoirBytes = 0;
  const bitrates = new Set();
  while (offset < bytes.length) {
    const a = bytes[offset], b = bytes[offset + 1], c = bytes[offset + 2], d = bytes[offset + 3];
    // MPEG-2 Layer III, no CRC, 24 kHz, mono. ID3/Xing/VBRI rejected,
    // not silently copied into the middle of a continuous audio stream.
    if (a !== 255 || b !== 243 || (c & 12) !== 4 || (d >> 6) !== 3)
      throw Error(`Unsupported MP3 header at byte ${offset}`);
    const bitrate = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0][c >> 4];
    if (bitrate !== 64 || (c & 3) || (d & 3) === 2)
      throw Error('Only observed 64 kbps, unpadded frames are accepted');
    const length = 72000 * bitrate / 24000;
    if (offset + length > bytes.length) throw Error('Truncated MP3 frame');
    const sideBytes = 9;
    const mainDataBegin = bytes[offset + 4];
    if (mainDataBegin > reservoirBytes) throw Error('Section references unavailable bit reservoir');
    const marker = String.fromCharCode(...bytes.subarray(offset + 4 + sideBytes, offset + 4 + sideBytes + 4));
    const vbri = String.fromCharCode(...bytes.subarray(offset + 36, offset + 40));
    if (['Info','Xing'].includes(marker) || vbri === 'VBRI') throw Error('Per-file metadata needs separate handling');
    reservoirBytes += length - 4 - sideBytes;
    offset += length; frames++; bitrates.add(bitrate);
  }
  return {frames, samples: frames * 576, duration: frames * 576 / 24000,
    sampleRate: 24000, channels: 1, bitrates: [...bitrates], bytes: bytes.length,
    metadata: 'none', delayPaddingMetadata: false};
}

export function assemble(sections) {
  if (!sections.length) throw Error('No sections');
  let samples = 0;
  const starts = [], inspection = [];
  for (const bytes of sections) {
    const info = inspectMp3(bytes);
    starts.push(samples / 24000);
    samples += info.samples;
    inspection.push(info);
  }
  // Blob/ReadableStream can deliver the original arrays incrementally in a Worker.
  // All encoder padding is retained. No gapless or silence-trimming claim.
  return {starts, duration: samples / 24000, inspection};
}

export function captions(texts, timeline) {
  if (texts.length !== timeline.starts.length) throw Error('Text/timeline mismatch');
  const timestamp = seconds => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
  };
  const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/\r?\n/g,' ');
  return 'WEBVTT\n\n' + texts.map((text, i) => `${i+1}\n${timestamp(timeline.starts[i])} --> ${timestamp(timeline.starts[i+1] ?? timeline.duration)}\n${escape(text)}\n`).join('\n');
}
