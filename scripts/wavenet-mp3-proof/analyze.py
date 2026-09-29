"""Offline validation only: decode for measurements; NEVER re-encode exports."""
import json
import subprocess
from pathlib import Path
import numpy as np

ROOT = Path('work/wavenet-mp3-proof')

def decode(path):
    return np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-']), dtype='<f4')

results = []
for manifest in json.loads((ROOT / 'manifest.json').read_text()):
    voice = manifest['voice']
    together = decode(ROOT / f'{voice}.mp3')
    parts = [decode(ROOT / s['file']) for s in manifest['sections']]
    separate = np.concatenate(parts)
    assert len(together) == len(separate) == round(manifest['duration'] * 24000)
    error = together - separate
    boundaries = []
    for i, start in enumerate(manifest['starts'][1:], 1):
        position = round(start * 24000)
        a, b = parts[i-1], parts[i]
        # Threshold is an objective quiet-region proxy, not a listening verdict.
        activeA = np.flatnonzero(np.abs(a) > .001)
        activeB = np.flatnonzero(np.abs(b) > .001)
        tail = (len(a)-1-activeA[-1])/24000
        lead = activeB[0]/24000
        delta = error[position-2400:position+2400]
        boundaries.append({'section': i, 'time': start, 'previousQuietTailMs': tail*1000,
            'nextQuietLeadMs': lead*1000, 'combinedQuietMs': (tail+lead)*1000,
            'maxJoinDecodeDifference': float(np.max(np.abs(delta))),
            'joinSampleStep': float(abs(together[position]-together[position-1]))})
    result = {'voice': voice, 'decodedSamples': len(together), 'decodedDuration': len(together)/24000,
        'maxDecodeDifference': float(np.max(np.abs(error))), 'boundaries': boundaries}
    results.append(result)
print(json.dumps(results, indent=2))
(ROOT / 'analysis.json').write_text(json.dumps(results, indent=2))
