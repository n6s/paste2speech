import {planPlaylist} from './playlist-plan.js';
import {PlaylistSession} from './playlist-session.js';

export function setupVideoDownload({getText, getVoice, getPrepared, isGoogle}) {
  const $ = id => document.getElementById(id);
  const panel = $('video-download'), status = $('video-status'), list = $('video-parts');
  let preparedText, preparedVoice;
  let session, signature, busy = false, stopRequested = false, controller, videoURL, captionURL, cachedExport;
  const message = text => { status.textContent = text; };
  function releaseVideo() {
    if (videoURL) URL.revokeObjectURL(videoURL);
    if (captionURL) URL.revokeObjectURL(captionURL);
    videoURL = captionURL = cachedExport = null;
    $('open-video').hidden = true; $('save-video').hidden = true;
    $('video-preview').pause(); $('video-preview').removeAttribute('src');
    $('video-preview').replaceChildren(); $('video-preview').load(); $('video-preview').hidden = true;
  }
  function render() {
    const ready = session?.records.length && session.records.every(r => r.state === 'ready');
    $('clear').disabled = busy;
    $('prepare-video').disabled = busy || !getText().trim();
    $('download-video').disabled = busy || !ready;
    $('cancel-video').hidden = !busy;
    $('video-split-limit').disabled = busy;
    list.replaceChildren();
    session?.records.forEach((record, i) => {
      const li = document.createElement('li'); li.textContent = `Part ${i + 1}: ${record.state || 'waiting'}`;
      if (record.state === 'ready') {
        const a = document.createElement('a'); a.textContent = ' · Audio';
        a.href = `/api/readings/${record.id}/download/mp3`; a.download = `part-${i + 1}.mp3`; li.append(a);
      }
      list.append(li);
    });
  }
  async function prepare() {
    if (busy) return;
    busy = true; stopRequested = false; releaseVideo(); render();
    let cancelled = false;
    try {
      let parts = planPlaylist(getText(), Number($('video-split-limit').value));
      if (!parts.length) throw Error('Paste or import some text first.');
      const voice = getVoice();
      if (!['en-US-Wavenet-F', 'en-GB-Wavenet-F'].includes(voice)) throw Error('Choose a WaveNet voice first.');
      const prepared = getPrepared();
      if (prepared?.complete && prepared.settings?.voice === voice && JSON.stringify(parts.flatMap(p=>p.chunks)) === JSON.stringify(prepared.chunks)) {
        parts = [{chunks: [...prepared.chunks], characters: prepared.chunks.reduce((n,c)=>n+c.length,0)}];
      }
      preparedText = getText(); preparedVoice = voice;
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({parts, voice}))))].map(n => n.toString(16).padStart(2, '0')).join('');
      const key = 'paste2speech.video.' + hash;
      if (!session || signature !== hash) {
        let records = [];
        try { records = JSON.parse(sessionStorage.getItem(key) || '[]'); } catch {}
        if (parts.length === 1 && prepared?.complete && prepared.settings?.voice === voice &&
            JSON.stringify(parts[0].chunks) === JSON.stringify(prepared.chunks)) {
          records = [{id: prepared.id, state: 'ready', duration: prepared.duration}];
        }
        session = new PlaylistSession(parts, voice, {records,
          save: value => { sessionStorage.setItem(key, JSON.stringify(value)); },
          changed: () => { render(); message(`Preparing audio part ${(session.active || 0) + 1} of ${parts.length}…`); }});
        signature = hash;
      }
      if (stopRequested) { message('Preparation stopped.'); return; }
      await session.prepare();
      cancelled = session.stopped;
      if (cancelled) {
        await session.cancelPending(); message('Preparation stopped. Completed audio parts are listed below.');
      } else message('Audio ready. Download video joins all parts into one MP4 with embedded subtitles.');
    } catch (error) {
      if (session?.stopped && !cancelled) {
        try { await session.cancelPending(); } catch (cancelError) { message(cancelError.message); return; }
      }
      message(error.message || String(error));
    } finally { busy = false; window.dispatchEvent(new Event('speech-credit-change')); render(); }
  }
  $('prepare-video').onclick = prepare;
  $('download-video').onclick = async () => {
    if (busy || !session) return;
    busy = true; controller = new AbortController(); render();
    try {
      if (!cachedExport) {
        const {exportVideo} = await import('./video-export.js');
        cachedExport = await exportVideo(session.records, {signal: controller.signal, update: message});
        videoURL = URL.createObjectURL(cachedExport.blob);
        captionURL = URL.createObjectURL(new Blob([cachedExport.vtt], {type: 'text/vtt'}));
      }
      const save = $('save-video'); save.href = videoURL;
      save.download = `paste-to-speech-${cachedExport.label.slice(10, 26).replaceAll(':', '').replace(' ', '-')}.mp4`;
      save.hidden = false;
      $('open-video').hidden = false;
      message('Video ready. One MP4 contains all audio and selectable subtitles. Download again reuses this file.');
      save.click();
    } catch (error) { message(controller.signal.aborted ? 'Video conversion cancelled. Prepared audio is still available.' : error.message || String(error)); }
    finally { controller = null; busy = false; render(); }
  };
  $('open-video').onclick = event => {
    event.preventDefault(); getPrepared()?.pause?.(); const video = $('video-preview'); video.src = videoURL;
    video.replaceChildren(); const track = document.createElement('track');
    track.kind = 'captions'; track.label = 'English'; track.srclang = 'en'; track.src = captionURL; track.default = true;
    video.append(track); video.hidden = false; void video.play().catch(() => {});
  };
  $('cancel-video').onclick = () => {
    stopRequested = true; controller ? controller.abort() : session?.stop();
    message('Stopping…');
  };
  function update() {
    panel.hidden = !isGoogle();
    $('video-prepared-note').textContent = session && (getText() !== preparedText || getVoice() !== preparedVoice) ? 'The prepared video audio belongs to your previous text or voice selection. Prepare again to use the current selection.' : '';
    if (!busy) {
      try {
        const parts = planPlaylist(getText(), Number($('video-split-limit').value));
        $('video-plan').textContent = parts.length ? `${parts.length} audio part${parts.length === 1 ? '' : 's'} → one video · ${parts.reduce((n, p) => n + p.chunks.reduce((a, c) => a + [...c].length, 0), 0).toLocaleString()} speech characters. Splits prefer paragraph boundaries.` : 'Paste text or import a file to prepare a video.';
      } catch (error) { $('video-plan').textContent = error.message; }
    }
    render();
  }
  $('clear').addEventListener('click', async () => {
    if (busy) return;
    busy = true; releaseVideo(); render();
    try {
      const key = 'paste2speech.video.' + signature;
      for (const record of session?.records || []) if (record.id) {
        const response = await fetch(`/api/readings/${record.id}`, {method:'DELETE', signal:AbortSignal.timeout(15000)});
        if (!response.ok && response.status !== 404) throw Error('Could not confirm removal of the video audio. Try Clear again.');
      }
      sessionStorage.removeItem(key); session = null; signature = null;
      message('Video and its prepared audio cleared.');
    } catch(error) { message(error.message); }
    finally { busy = false; render(); }
  });
  $('video-split-limit').onchange = update;
  // Preparation uses an immutable text/voice snapshot; edits do not change it.
  // The preview below always describes the current editor, while the prepared
  // parts remain available until another preparation is explicitly requested.
  panel.addEventListener('toggle', update);
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  $('video-split-settings').hidden = new URLSearchParams(location.search).get('testing') !== '1';
  function usePrepared(prepared) {
    if (busy || session || !prepared?.complete || prepared.settings?.voice !== getVoice()) return;
    const chunks = planPlaylist(getText(), 20000).flatMap(p => p.chunks);
    if (JSON.stringify(chunks) !== JSON.stringify(prepared.chunks)) return;
    preparedText = getText(); preparedVoice = getVoice();
    session = new PlaylistSession([{chunks}], preparedVoice, {records:[{id:prepared.id,state:'ready',duration:prepared.duration}]});
    message('Existing audio is ready for video download. No new speech is needed.'); render();
  }
  update(); return {update, usePrepared};
}
