import {chunkText} from './text.js';

// UTF-16 lengths deliberately match validateInput's 20,000-character ceiling.
// The smaller speech chunks also stay comfortably below Google's byte limit.
export function planPlaylist(text, limit = 20000) {
  if (!Number.isInteger(limit) || limit < 100 || limit > 20000) throw Error('Choose a split limit from 100 to 20,000.');
  const parts = [];
  let current = [], size = 0;
  const flush = () => { if (current.length) parts.push({chunks: current, characters: size}); current = []; size = 0; };
  for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).filter(p => p.trim())) {
    const chunks = chunkText(paragraph, Math.min(500, limit));
    const length = chunks.reduce((n, chunk) => n + chunk.length, 0);
    if (size + length > limit) flush();
    // Keep an ordinary paragraph whole. Oversized paragraphs use the existing
    // sentence/phrase/word splitter, without losing or duplicating speech text.
    for (const chunk of chunks) {
      if (size + chunk.length > limit) flush();
      current.push(chunk); size += chunk.length;
    }
  }
  flush();
  return parts;
}

export function generatedLabel(date = new Date()) {
  return `generated ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function videoArguments(duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw Error('Invalid recording duration.');
  return ['-loop', '1', '-framerate', '1', '-i', 'card.png', '-i', 'audio.mp3', '-i', 'captions.vtt',
    '-map', '0:v:0', '-map', '1:a:0', '-map', '2:s:0', '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
    '-metadata', 'title=PasteToSpeech recording',
    '-metadata', 'artist=pastetospeech.com',
    '-metadata', 'album=PasteToSpeech',
    '-metadata', 'album_artist=pastetospeech.com',
    '-metadata', 'comment=Created with PasteToSpeech — https://pastetospeech.com',
    '-disposition:s:0', 'default', '-movflags', '+faststart', '-y', 'part.mp4'];
}

// Keep cue text/escaping intact; only rebase timestamps onto the joined audio.
export function joinCaptions(files, durations) {
  if (files.length !== durations.length) throw Error('Caption/duration mismatch.');
  const seconds = stamp => stamp.split(':').reduce((n, v) => n * 60 + Number(v), 0);
  const timestamp = seconds => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  let offset = 0, count = 0; const cues = [];
  files.forEach((file, i) => {
    if (!file.startsWith('WEBVTT') || !Number.isFinite(durations[i]) || durations[i] <= 0) throw Error('Invalid caption track.');
    for (const block of file.replaceAll('\r', '').split(/\n\s*\n/).slice(1)) {
      const lines = block.trim().split('\n'), line = lines.findIndex(s => s.includes(' --> '));
      if (line < 0) continue;
      const match = lines[line].match(/^([\d:.]+) --> ([\d:.]+)$/);
      if (!match) throw Error('Unsupported subtitle timing.');
      const start = seconds(match[1]), end = seconds(match[2]);
      if (!(start >= 0 && end > start && end <= durations[i] + .002)) throw Error('Subtitle exceeds its audio part.');
      cues.push(`${++count}\n${timestamp(offset + start)} --> ${timestamp(offset + end)}\n${lines.slice(line + 1).join('\n')}`);
    }
    offset += durations[i];
  });
  if (!cues.length) throw Error('No subtitles found.');
  return 'WEBVTT\n\n' + cues.join('\n\n') + '\n';
}

// Split the reader's existing chunks without changing its sentence indexes.
export function splitReadingChunks(chunks, paragraphStarts = [0], limit = 20000) {
  if (!Number.isInteger(limit) || limit < 100 || limit > 20000) throw Error('Invalid audio part size.');
  const boundaries = [...new Set([0, ...paragraphStarts.filter(n => Number.isInteger(n) && n >= 0 && n < chunks.length), chunks.length])].sort((a,b)=>a-b);
  const parts = []; let current = [], size = 0;
  const flush = () => {if(current.length)parts.push({chunks:current,characters:size});current=[];size=0;};
  for(let p=0;p<boundaries.length-1;p++) {
    const paragraph=chunks.slice(boundaries[p],boundaries[p+1]), length=paragraph.reduce((n,t)=>n+t.length,0);
    if(size+length>limit || current.length+paragraph.length>10000)flush();
    for(const chunk of paragraph) {
      if(chunk.length>limit)throw Error('A speech section exceeds the part size.');
      if(size+chunk.length>limit || current.length===10000)flush();
      current.push(chunk);size+=chunk.length;
    }
  }
  flush();return parts;
}
