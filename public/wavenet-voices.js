// Shared by the cloud reader, admission validation, and Google transport.
export const WAVENET_VOICES = [
 ['US','F','female'],['US','D','male'],['US','A','male'],['US','B','male'],
 ['US','C','female'],['US','E','female'],['US','G','female'],['US','H','female'],
 ['US','I','male'],['US','J','male'],['GB','F','female'],['GB','D','male'],
].map(([region,letter,gender])=>({
 id:`en-${region}-Wavenet-${letter}`,
 name:`${region==='GB'?'UK':'US'} ${gender} ${letter}`,
 group:region==='GB'?'UK English':'US English',
}));
export const WAVENET_VOICE_IDS=WAVENET_VOICES.map(voice=>voice.id);
