"""Render the benchmark's material generator (other seeds) on the TRAINING instruments for the
free-play arbiter (arbiter_rec.mjs set `inst`): 16 kHz, dry (the recorder upsamples and applies
the benchmark's room / iPad conditions).

    node tools/nn/arbiter_rec.mjs dump-mats      # -> .data/arb/mats.json
    tools/nn/.venv/bin/python tools/nn/arbiter_dry.py
"""
import json
import zlib
import os

import numpy as np

import synth

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, '.data', 'arb')

if __name__ == '__main__':
    mats = json.load(open(os.path.join(D, 'mats.json')))
    out = os.path.join(D, 'dry')
    os.makedirs(out, exist_ok=True)
    insts = synth.load_instruments(['musescore', 'fluid', 'gu', 'iowa'])
    for name in ['musescore', 'fluid', 'gu', 'iowa', 'synth']:
        for m in mats:
            f = os.path.join(out, f"{name}-{m['id']}.f32")
            if os.path.exists(f):
                continue
            rng = np.random.default_rng(zlib.crc32(f"{name}-{m['id']}".encode()))
            inst = insts[name] if name != 'synth' else synth.AdditivePiano(seed=int(rng.integers(1 << 30)))
            notes = [dict(midi=n['midi'], t=n['t'], dur=n['dur'], vel=n['vel']) for n in m['notes']]
            y, _ = synth.render(inst, notes, m['length'], rng, pedal=[tuple(p) for p in (m['pedal'] or [])])
            y.astype('<f4').tofile(f)
        print(name, flush=True)
