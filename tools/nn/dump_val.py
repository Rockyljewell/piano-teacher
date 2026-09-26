"""Write augmented validation mixtures (training pianos only, validation music / rooms / noise
seeds) as 16 kHz float32 files plus their notes, for tuning the JS decoder (calibrate.mjs).

    python tools/nn/dump_val.py --clips 120
"""
import argparse
import json
import os

import numpy as np

import train as T

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '.data', 'valmix')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--clips', type=int, default=120)
    ap.add_argument('--noise-only', type=int, default=12)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    clips = T.Clips('val')
    noise = T.NoiseBank()
    rng = np.random.default_rng(777)
    index = []
    n = int(12.0 * T.SR)
    for i in range(a.clips + a.noise_only):
        if i < a.clips:
            piano, nt, meta = clips.crop(rng, n, idx=int(rng.integers(len(clips.items))))
            # the crop starts inside the clip: keep only notes that start inside
            notes = [dict(midi=int(m), t=float(on), end=float(end), vel=float(v)) for m, on, end, v in nt if 0.0 <= on < n / T.SR]
            x = T.augment(rng, piano, noise)
        else:
            meta = dict(inst='none', kind='noise-only')
            x = T.augment(rng, np.zeros(n, np.float32), noise, p_noise=1.0)
            notes = []
        f = f'mix-{i:03d}.f32'
        x.astype('<f4').tofile(os.path.join(OUT, f))
        index.append(dict(file=f, notes=notes, meta=meta))
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'))
    print(f'{len(index)} mixtures in {OUT}')
