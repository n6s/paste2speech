import {ProgressivePlayer} from './progressive-player.js';
const $=id=>document.getElementById(id);
const manifests=await(await fetch('/manifest.json')).json();
let metrics={},started=0,rows=[],settings;
const audio=$('audio');
const render=()=>{$('metrics').textContent=JSON.stringify(metrics,null,2);};
// A finished streamed response may report buffered bytes without exposing a
// usable seek range. Reopen the identical completed file before the first seek.
class ProofPlayer extends ProgressivePlayer {
  seekTo(time){
    if(this.complete && !this.seekableFile){
      this.seekableFile=true;this.audio.src=this.url+'?complete=1';this.audio.load();
    }
    super.seekTo(time);
  }
}
const player=new ProofPlayer(p=>{
  $('status').textContent=`${p.state} · section ${Math.min(p.index+1,8)} / 8 · ${audio.currentTime.toFixed(3)} / ${p.duration.toFixed(3)} seconds`;
  rows.forEach((row,i)=>row.setAttribute('aria-current',String(i===p.index)));
  if(p.complete && !metrics.completeMs){metrics.completeMs=performance.now()-started;metrics.duration=p.duration;render();}
  for(const kind of ['mp3','vtt']){const link=$(kind);link.hidden=!p.complete;if(p.complete)link.href=player.download(kind);}
},{audio,pollMs:100});
for(const event of ['loadstart','playing','waiting','ended','error','seeked'])audio.addEventListener(event,()=>{
  metrics.events??=[];metrics.events.push({event,elapsedMs:performance.now()-started,time:audio.currentTime,duration:Number.isFinite(audio.duration)?audio.duration:null,complete:player.complete,source:audio.getAttribute('src')});
  if(event==='playing' && !metrics.firstPlayingMs)metrics.firstPlayingMs=performance.now()-started;
  render();
});
audio.addEventListener('timeupdate',()=>{
  if(audio.currentTime>.05 && !metrics.firstAdvanceMs){metrics.firstAdvanceMs=performance.now()-started;render();}
});
function showText(){
  const manifest=manifests.find(m=>m.voice===$('voice').value);
  $('sections').replaceChildren();
  rows=manifest.sections.map((s,i)=>{const li=document.createElement('li');li.textContent=s.text;li.onclick=()=>player.seekTo(player.starts[i]);$('sections').append(li);return li;});
  return manifest;
}
showText();$('voice').onchange=showText;
$('start').onclick=async()=>{
  const manifest=showText();
  metrics={mode:$('mode').value,voice:$('voice').value,userAgent:navigator.userAgent};started=performance.now();
  settings={provider:$('mode').value,delivery:$('mode').value.endsWith('full')?'complete':'progressive',voice:$('voice').value,rate:Number($('rate').value)};
  await player.start(manifest.sections.map(s=>s.text),settings);render();
};
$('pause').onclick=()=>player.pause();$('resume').onclick=()=>player.resume(settings);
$('rate').onchange=()=>player.setRate(Number($('rate').value));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test){const deadline=performance.now()+12000;while(!test()){if(performance.now()>deadline)throw Error('Playback check timed out');await sleep(25);}}
function check(condition,message){if(!condition)throw Error(message);metrics.checks.push(message);render();}
$('checks').onclick=async()=>{
  metrics.checks=[];
  try {
    await until(()=>player.complete && !audio.paused && audio.currentTime>.05);
    if(settings.delivery==='complete')check(metrics.events.filter(e=>e.source).every(e=>e.complete && e.source.endsWith('?complete=1')),'Full preparation opens only the completed recording');
    player.pause();const paused=audio.currentTime;await sleep(300);
    check(audio.currentTime===paused,'Pause holds audio clock');
    check(rows.every((r,i)=>r.textContent===player.chunks[i]),'Highlight text matches original sections exactly');
    const status=await(await fetch(player.endpoint(`/${player.id}`))).json();metrics.serverReadyMs=status.readyMs;
    player.setRate(1.5);check(audio.playbackRate===1.5,'Speed changes without regenerating audio');
    for(const index of [0,4,7,2]){
      player.seekTo(player.starts[index]+.2);await until(()=>!audio.seeking && Math.abs(audio.currentTime-player.starts[index]-.2)<.06);
      player.sync();check(player.index===index && rows[index].getAttribute('aria-current')==='true',`Seek and highlight section ${index+1}`);
    }
    player.seekTo(player.starts[3]-.35);await until(()=>!audio.seeking);player.resume(settings);
    await until(()=>audio.currentTime>player.starts[3]+.2);
    check(player.index===3,'Highlight crosses section boundary on audio clock');
    player.pause();player.setRate(1);
    const download=await(await fetch(player.download('mp3'))).arrayBuffer();
    const captions=await(await fetch(player.download('vtt'))).text();
    check(captions.split(' --> ').length-1===8,'VTT includes every original section');
    check(download.byteLength>0,'Flat MP3 export is available');
    // Decode both ways in the actual browser; count samples and compare joins.
    const context=new AudioContext({sampleRate:24000});
    const buffer=await context.decodeAudioData(download.slice(0));
    metrics.browserDecodedDuration=buffer.duration;metrics.browserDecodedSamples=buffer.length;
    check(Math.abs(buffer.duration-player.duration)<1/24000,'Browser decoded duration matches frame-count timeline');
    if(!metrics.mode.startsWith('live-')){
      const originals=await Promise.all(Array.from({length:8},async(_,i)=>new Uint8Array(await(await fetch(`/samples/${metrics.voice}-${String(i).padStart(2,'0')}.mp3`)).arrayBuffer())));
      const flat=new Uint8Array(download);let offset=0,maxDifference=0,sampleOffset=0;
      for(const original of originals){
        check(original.every((byte,i)=>byte===flat[offset+i]),`Export retains original bytes for section ${offset===0?1:originals.indexOf(original)+1}`);
        offset+=original.length;
        const section=await context.decodeAudioData(original.buffer.slice(0));
        const a=section.getChannelData(0),b=buffer.getChannelData(0);
        for(let i=0;i<a.length;i++)maxDifference=Math.max(maxDifference,Math.abs(a[i]-b[sampleOffset+i]));
        sampleOffset+=a.length;
      }
      metrics.browserMaxJoinDifference=maxDifference;
      check(sampleOffset===buffer.length && maxDifference<.00001,'Browser section joins preserve decoded audio');
    }
    await context.close();
    player.seekTo(player.duration-.4);await until(()=>!audio.seeking);player.resume(settings);
    await until(()=>audio.ended);check(player.state==='done','Playback reaches the real final frame');
    metrics.nativeDuration=audio.duration;
    check(Math.abs(audio.duration-player.duration)<1/24000,'Native completed-file duration agrees with captions');
    metrics.result='PASS';
  }catch(error){metrics.result='FAIL';metrics.error=error.message;}
  render();await fetch('/metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metrics)});
};
