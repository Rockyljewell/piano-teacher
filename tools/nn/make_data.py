"""Render the training clips: piano content -> sampler -> room. Noise, microphone EQ, gain and
clipping are added later, at training time (train.py), so every epoch hears new mixtures.

    python tools/nn/make_data.py --hours 40 --workers 2           # training shards
    python tools/nn/make_data.py --hours 1.5 --split val --seed 999 # validation (same pianos,
                                                                    # other music and rooms)
Output: .data/clips/<split>-NNN.npz with
    audio  int16, all clips concatenated (16 kHz, peak-safe scale; train.py rescales)
    clips  int64 [n, 2]  (offset, length)
    notes  float32 [m, 5] (clip, midi, onset s, sounding end s, velocity)
    meta   json: per clip {inst, kind, rt60}
"""
import argparse
import json
import os
import time
from multiprocessing import Pool

import numpy as np

import content
import room
import synth

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '.data', 'clips')
SR = 16000
CLIP_SEC = 12.0
INST_W = dict(salamander=0.24, musescore=0.16, fluid=0.14, gu=0.12, iowa=0.26, synth=0.08)

_insts = None


def insts():
    global _insts
    if _insts is None:
        _insts = synth.load_instruments()
    return _insts


def one_clip(rng):
    I = insts()
    names = [k for k in INST_W if k in I]
    p = np.array([INST_W[k] for k in names])
    iname = names[rng.choice(len(names), p=p / p.sum())]
    inst = I[iname]
    kind, notes, pedal = content.sample(rng, CLIP_SEC)
    detune = rng.uniform(-30, 30) if rng.random() < 0.8 else 0.0
    audio, labels = synth.render(inst, notes, CLIP_SEC, rng, pedal=pedal, detune=detune)
    rt = 0.0
    if rng.random() < 0.8:
        audio, rt = room.reverb(audio, rng)
    return audio, labels, dict(inst=iname, kind=kind, rt60=round(float(rt), 3), detune=round(float(detune), 1))


def shard(args):
    split, idx, n_clips, seed = args
    path = os.path.join(OUT, f'{split}-{idx:03d}.npz')
    if os.path.exists(path):
        return path, 0.0
    os.environ.setdefault('OMP_NUM_THREADS', '1')
    rng = np.random.default_rng(seed * 100003 + idx)
    t0 = time.time()
    auds, clips, notes, meta = [], [], [], []
    off = 0
    for c in range(n_clips):
        a, labels, m = one_clip(rng)
        pk = float(np.max(np.abs(a))) + 1e-9
        a = a * (0.9 / pk)  # int16 storage at full scale; train.py sets the level
        q = np.clip(np.round(a * 32767), -32767, 32767).astype(np.int16)
        auds.append(q)
        clips.append((off, len(q)))
        off += len(q)
        for midi, on, end, vel in labels:
            notes.append((c, midi, on, end, vel))
        meta.append(m)
    np.savez(path + '.tmp.npz', audio=np.concatenate(auds), clips=np.array(clips, dtype=np.int64),
             notes=np.array(notes, dtype=np.float32).reshape(-1, 5), meta=json.dumps(meta))
    os.replace(path + '.tmp.npz', path)
    return path, time.time() - t0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=float, default=40)
    ap.add_argument('--split', default='train')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--workers', type=int, default=2)
    ap.add_argument('--per-shard', type=int, default=100)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    n = int(np.ceil(a.hours * 3600 / CLIP_SEC / a.per_shard))
    jobs = [(a.split, i, a.per_shard, a.seed) for i in range(n)]
    t0 = time.time()
    with Pool(a.workers) as pool:
        for k, (p, dt) in enumerate(pool.imap_unordered(shard, jobs)):
            print(f'{k + 1}/{n} {os.path.basename(p)} {dt:.0f} s  (elapsed {time.time() - t0:.0f} s)', flush=True)
