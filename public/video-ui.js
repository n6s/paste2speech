import {planPlaylist} from './playlist-plan.js';
import {PlaylistSession} from './playlist-session.js';

export function setupVideoDownload({getText, getVoice, getPrepared, isGoogle, onChange = () => {}}) {
  const $ = id => document.getElementById(id);
  const panel = $('video-download'), status = $('video-status');
  let preparedText, preparedVoice, session, signature;
  let busy = false, stopRequested = false, borrowedPreparation = false, controller, videoURL, captionURL;
  const message = text => { status.textContent = text; };
  const matchesEditor = () => preparedText === getText() && preparedVoice === getVoice();
  function releaseVideo() {
    if (videoURL) URL.revokeObjectURL(videoURL);
    if (captionURL) URL.revokeObjectURL(captionURL);
    videoURL = captionURL = null;
    $('open-video').hidden = true; $('open-video').removeAttribute('href'); $('open-video').removeAttribute('download');
    $('video-preview').pause(); $('video-preview').removeAttribute('src');
    $('video-preview').replaceChildren(); $('video-preview').load(); $('video-preview').hidden = true;
  }
  function render() {
    $('clear').disabled = busy;
    $('download-video').hidden = busy || !!videoURL && matchesEditor();
    $('download-video').disabled = busy || !getText().trim();
    $('cancel-video').hidden = !busy;
    $('video-split-limit').disabled = busy;
    $('video-prepared-note').textContent = session && !matchesEditor()
      ? 'This recording uses your previous text or voice. Download again to use the current selection.' : '';
    onChange();
  }
  async function prepare() {
    // Prefer the whole existing job, even if only its first few sections are
    // ready. Poll its final state; never snapshot starts/download partial audio.
    let parts = planPlaylist(getText(), Number($('video-split-limit').value));
    if (!parts.length) throw Error('Paste or import some text first.');
    const voice = getVoice(), text = getText(), prepared = getPrepared();
    const waitingForCreation = prepared && !prepared.id && prepared.state === 'preparing';
    while (prepared && !prepared.id && prepared.state === 'preparing') {
      if (stopRequested) return false;
      message('Waiting for the current audio preparation…');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (waitingForCreation && !prepared.id) throw Error('The current audio preparation could not be confirmed. No replacement speech was started.');
    if (!['en-US-Wavenet-F', 'en-GB-Wavenet-F', 'en-US-Wavenet-D', 'en-GB-Wavenet-D'].includes(voice)) throw Error('Choose a WaveNet voice first.');
    const reuse = prepared?.id && prepared.settings?.voice === voice &&
      JSON.stringify(parts.flatMap(p => p.chunks)) === JSON.stringify(prepared.chunks);
    if(reuse)borrowedPreparation=true;
    const group=reuse && prepared.getVideoPreparation?.();
    if(group) {
      borrowedPreparation=true;preparedText=text;preparedVoice=voice;
      while(!group.done && !stopRequested) {
        const completed=group.session.records.reduce((n,r)=>n+(r.completed||0),0);
        message(`Preparing complete audio… ${Math.floor(completed/prepared.chunks.length*100)}%`);
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      if(stopRequested)return false;
      if(group.error)throw group.error;
      if(group.cancelled)throw Error('Reading preparation was cancelled.');
      session=group.session;signature=group.key.slice('paste2speech.video.'.length);
      return session.records.length===session.parts.length && session.records.every(r=>r.state==='ready');
    }
    if (reuse) parts = [{chunks: [...prepared.chunks], characters: prepared.chunks.reduce((n,c)=>n+c.length,0)}];
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({parts, voice}))))].map(n => n.toString(16).padStart(2, '0')).join('');
    const key = 'paste2speech.video.' + hash;
    if (!session || signature !== hash) {
      let records = [];
      try { records = JSON.parse(sessionStorage.getItem(key) || '[]'); } catch {}
      if (reuse) records = [{id: prepared.id, state: prepared.complete ? 'ready' : 'preparing', borrowed: true}];
      session = new PlaylistSession(parts, voice, {records,
        save: value => sessionStorage.setItem(key, JSON.stringify(value)),
        changed: () => {
          render();
          const total = parts.reduce((n,p)=>n+p.chunks.length,0);
          const done = session.records.reduce((n,r,i)=>n+(r.state==='ready'?parts[i].chunks.length:Math.min(r.completed||0,parts[i].chunks.length)),0);
          message(done === total ? 'Audio complete. Preparing video…' : `Preparing complete audio… ${Math.floor(done/total*100)}%`);
        }});
      signature = hash;
    }
    preparedText = text; preparedVoice = voice;
    if (stopRequested) return false;
    await session.prepare();
    return !session.stopped && session.records.length === session.parts.length && session.records.every(r => r.state === 'ready');
  }
  $('download-video').onclick = async () => {
    if (busy) return;
    busy = true; stopRequested = false; borrowedPreparation = false; releaseVideo(); message('Preparing complete audio…'); render();
    try {
      if (!await prepare()) return;
      if (stopRequested) return;
      controller = new AbortController();
      const {exportVideo} = await import('./video-export.js');
      const result = await exportVideo(session.records, {signal: controller.signal, update: message});
      videoURL = URL.createObjectURL(result.blob);
      captionURL = URL.createObjectURL(new Blob([result.vtt], {type:'text/vtt'}));
      const link = $('open-video'); link.href = videoURL;
      link.textContent = `paste-to-speech-${result.label.slice(10, 26).replaceAll(':', '').replace(' ', '-')}.mp4`;
      link.download = link.textContent;
      link.hidden = false;
      message('Ready. Open the recording, or right-click the link and choose Save link as.');
    } catch (error) {
      message(stopRequested ? 'Processing cancelled. Prepared audio is kept for another attempt.' : error.message || String(error));
    } finally {
      // A borrowed job also serves the reader: cancelling this download must
      // not stop its playback/preparation. Stop only scheduling our own work;
      // already-admitted audio is retained and reused on another Download.
      if (stopRequested) message('Processing cancelled. Prepared audio is kept for another attempt.');
      controller = null; busy = false; window.dispatchEvent(new Event('speech-credit-change')); render();
    }
  };
  $('open-video').onclick = event => {
    // The anchor is a real MP4 Blob URL, so context-menu Save link as and
    // the download attribute supplies its filename. Plain clicks still show captions.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); getPrepared()?.pause?.();
    const video = $('video-preview'); video.src = videoURL; video.replaceChildren();
    const track = document.createElement('track');
    track.kind = 'captions'; track.label = 'English'; track.srclang = 'en'; track.src = captionURL; track.default = true;
    video.append(track); video.hidden = false; void video.play().catch(() => {});
  };
  $('cancel-video').onclick = () => {
    stopRequested = true; if(!borrowedPreparation)session?.stop(); controller?.abort(); message('Stopping…');
  };
  function update() { panel.hidden = !isGoogle(); panel.closest('.download-card').hidden = !isGoogle(); render(); }
  $('clear').addEventListener('click', async () => {
    if (busy) return;
    busy = true; releaseVideo(); render();
    try {
      for (const record of session?.records || []) if (record.id) {
        const response = await fetch(`/api/readings/${record.id}`, {method:'DELETE', signal:AbortSignal.timeout(15000)});
        if (!response.ok && response.status !== 404) throw Error('Could not confirm removal of the video audio. Try Clear again.');
      }
      sessionStorage.removeItem('paste2speech.video.' + signature); session = null; signature = null;
      message('Recording cleared.');
    } catch(error) { message(error.message); }
    finally { busy = false; render(); }
  });
  $('video-split-limit').onchange = update;
  $('voice').addEventListener('change', update);
  panel.addEventListener('toggle', update);
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  $('video-split-settings').hidden = new URLSearchParams(location.search).get('testing') !== '1';
  update(); return {update, get preparingAudio(){return busy && !borrowedPreparation && !controller;}};
}
