// Coarse diagnostics only: never include the raw user agent or reading content.
export function feedbackContext({navigator, environment, release, engine, voice, playback}) {
 const ua=navigator.userAgent || '';
 const browser=/Edg(?:e|A|iOS)?\//.test(ua)?'Edge':/OPR\/|Opera/.test(ua)?'Opera':/Firefox\/|FxiOS\//.test(ua)?'Firefox':/Chrome\/|CriOS\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Other';
 const mobile=navigator.userAgentData?.mobile ?? (/Android|iPhone|iPad|iPod|Mobile/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
 return {environment,browser,device:mobile?'mobile':'desktop',release,engine,voice:String(voice||'Device default').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120),playback};
}
