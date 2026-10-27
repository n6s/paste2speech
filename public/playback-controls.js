export const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2];
export function presetRate(value) {
  if (!Number.isFinite(value)) return 1;
  return SPEED_PRESETS.reduce((best, rate) => Math.abs(rate - value) < Math.abs(best - value) ? rate : best);
}
export function preparedChunkCount(player) {
  if (player.mode === 'full' && !player.finalized) return 0;
  const starts = player.starts || [];
  const duration = player.duration || 0;
  let count = 0;
  while (count < player.chunks.length && Number.isFinite(starts[count]) && starts[count] < duration) count++;
  return count;
}

// Only verified source timing is converted. Section seeking remains in source time.
export function playbackTimeline(player,{rate=1,natural=true,selected=null}={}) {
 const speed=Number.isFinite(rate)&&rate>0?rate:1;
 const clock=seconds=>{const n=Math.max(0,Math.floor(seconds/speed)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=String(n%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;};
 if(!natural)return {label:'— / —',detail:'Browser voice timing unavailable',position:null,duration:null};
 const duration=Number.isFinite(player.duration)&&player.duration>0?player.duration:null;
 const source=selected===null?player.audio?.currentTime:player.starts?.[selected];
 const position=Number.isFinite(source)&&source>=0?source:null;
 const complete=player.complete===true||player.finalized===true&&player.status?.state==='ready';
 return {label:`${position===null?'—':clock(position)} / ${duration===null?'—':complete?clock(duration):'—'}`,
  detail:duration&&!complete?`${clock(duration)} audio prepared · total duration unknown`:`${speed}× playback time`,position,duration:complete?duration:null};
}

// The end of a growing prepared prefix is not the end of the source reading.
export function explicitEndSeek(player,target,max,{browser=false}={}) {
  return !!player&&player.state==='playing'&&!player.starting&&
    (browser||!!player.audio&&!player.audio.paused&&!player.audio.ended)&&
    Number.isFinite(target)&&Number.isFinite(max)&&max>0&&target>=max&&
    (browser?player.chunks.length:preparedChunkCount(player))===player.chunks.length;
}
