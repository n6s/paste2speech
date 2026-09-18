import { validProcessing } from '../shared/processing-metrics.js';
import { defaults } from './text.js';
// Coarse diagnostics only: never include the raw user agent or reading content.
export function feedbackContext({navigator, environment, release, engine, voice, playback, cleanup, processing}) {
 const ua=navigator.userAgent || '';
 const browser=/Edg(?:e|A|iOS)?\//.test(ua)?'Edge':/OPR\/|Opera/.test(ua)?'Opera':/Firefox\/|FxiOS\//.test(ua)?'Firefox':/Chrome\/|CriOS\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Other';
 const mobile=navigator.userAgentData?.mobile ?? (/Android|iPhone|iPad|iPod|Mobile/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
 const settings = cleanup === undefined ? {} : {cleanup: Object.fromEntries(Object.keys(defaults).map(key=>[key, cleanup[key] === true]))};
 return {...settings,...(engine==='kokoro' && processing!==undefined && validProcessing(processing)?{processing:structuredClone(processing)}:{}),environment,browser,device:mobile?'mobile':'desktop',release,engine,voice:String(voice||'Device default').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120),playback};
}
