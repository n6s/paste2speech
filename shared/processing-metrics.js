const object = value => value && typeof value==='object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value>=0 && value<=2147483647;
function record(value,comparison=false) {
 const numbers=comparison?['loadMs','firstMs','repeatMs','audioMs']:['loadMs','probeMs','generateMs','audioMs','characters','elapsedMs'];
 const fields=['backend','dtype','status',...numbers,...(comparison?[]:['fallback','hidden'])];
 return object(value) && Object.keys(value).every(key=>fields.includes(key)) &&
 ['cpu','gpu'].includes(value.backend) && ['q8','fp16','fp32'].includes(value.dtype) &&
 (value.backend==='cpu'?value.dtype==='q8':value.dtype!=='q8') && ['ok','failed'].includes(value.status) &&
 numbers.every(key=>value[key]===undefined||integer(value[key])) &&
 (comparison || (typeof value.fallback==='boolean' && typeof value.hidden==='boolean'));
}
export function validProcessing(value) {
 return object(value) && Object.keys(value).every(key=>['version','engine','scope','requestedGPU','chunks','generationMs','audioMs','last','comparison','operation'].includes(key)) &&
 (value.version===1 || (value.version===2 && value.engine==='kokoro' && value.scope==='current-selection')) && typeof value.requestedGPU==='boolean' && ['chunks','generationMs','audioMs'].every(key=>integer(value[key])) &&
 (value.operation===undefined || (object(value.operation) && Object.keys(value.operation).every(key=>['type','status','elapsedMs','hidden'].includes(key)) && ['load','synthesize','benchmark'].includes(value.operation.type) && ['running','ok','failed','cancelled'].includes(value.operation.status) && integer(value.operation.elapsedMs) && typeof value.operation.hidden==='boolean')) &&
 (value.last===undefined || record(value.last)) &&
 (value.comparison===undefined || (Array.isArray(value.comparison) && value.comparison.length<=3 && value.comparison.every(row=>record(row,true))));
}
export function processingSummary(value) {
 if(!value)return '';
 return (value.version===2?'\nOn-device processing since the latest engine, text, or voice/speed change (comparison entries are standalone benchmarks): ':'\nLegacy on-device page-session metrics; may predate the selected engine or reading: ')+JSON.stringify(value);
}
