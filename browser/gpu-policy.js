export async function gpuPrecision(gpu, requested = 'auto') {
 const adapter = await gpu?.requestAdapter();
 if (!adapter) throw Error('GPU unavailable');
 const half = adapter.features.has('shader-f16');
 if (requested === 'fp16' && !half) throw Error('FP16 unavailable');
 return requested === 'fp32' ? 'fp32' : half ? 'fp16' : 'fp32';
}
export function validAudio(buffer) {
 const audio = new Int16Array(buffer);
 return audio.length > 2400 && audio.some(v => Math.abs(v) > 10);
}
