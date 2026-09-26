"""Export a trained checkpoint to the compact weights file the browser loads.

    python tools/nn/export.py .data/runs/main/best.pt ../../assets/models/piano-nn.bin

Batch-norm is folded into the preceding 1x1 convolutions (or kept as a per-channel scale /
shift where a residual sits in between); weights are stored as float16. Also writes
tools/nn/fixtures/parity.json: the PyTorch model's outputs (with the float16 weights) on a
deterministic test signal, so tests/nn-model.test.js can check the JS inference against it.
"""
import json
import math
import os
import struct
import sys

import numpy as np
import torch

import frontend as FE
from model import POS0, XOFF, Model

HERE = os.path.dirname(os.path.abspath(__file__))


def bn_fold(bn):
    s = (bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach()
    t = (bn.bias - bn.running_mean * s).detach()
    return s, t


def tensors(m):
    T = {}
    T['mu'] = m.mu
    T['sd'] = m.sd
    s, t = bn_fold(m.a_bn)
    T['a_w'] = m.a.weight[:, :, 0, 0] * s[:, None]
    T['a_b'] = m.a.bias * s + t
    T['b_w'] = m.b.weight[:, 0].reshape(m.b.weight.shape[0], 9)
    T['b_s'], T['b_t'] = bn_fold(m.b_bn)
    s, t = bn_fold(m.k_bn)
    T['k_w'] = m.k.weight[:, :, 0, 0] * s[:, None]
    T['k_b'] = m.k.bias * s + t
    T['kemb'] = m.kemb[0, :, 0, :]
    for i, b in enumerate(m.blocks):
        p = f'blk{i}_'
        if b.kind == 't':
            T[p + 'dw'] = b.dw.weight[:, 0, :, 0]
        else:
            T[p + 'dw'] = b.dw
            T[p + 'g_w'] = b.g.weight
            T[p + 'g_b'] = b.g.bias
        T[p + 'pw_w'] = b.pw.weight[:, :, 0, 0]
        T[p + 'pw_b'] = b.pw.bias
        T[p + 's'], T[p + 't'] = bn_fold(b.bn)
    T['head_w'] = m.head.weight[:, :, 0, 0]
    T['head_b'] = m.head.bias
    return {k: v.detach().float().numpy() for k, v in T.items()}


def write(path, m, decoder=None, f16=True):
    T = tensors(m)
    keep32 = {'mu', 'sd'}
    blobs, meta, off = [], {}, 0
    for k, v in T.items():
        dt = 'f32' if (k in keep32 or not f16) else 'f16'
        b = v.astype('<f4' if dt == 'f32' else '<f2').tobytes()
        pad = (4 - len(b) % 4) % 4
        meta[k] = dict(shape=list(v.shape), dtype=dt, offset=off)
        blobs.append(b + b'\0' * pad)
        off += len(b) + pad
    cfg = dict(m.cfg, harm=m.harm, shifts=m.shifts, xoff=XOFF, pos0=POS0)
    wins = list(m.cfg.get('wins') or FE.WINS)
    header = dict(version=1, cfg=cfg, frontend=dict(sr=FE.SR, hop=FE.HOP, wins=wins, nb=FE.NB, midi0=FE.MIDI0, bps=FE.BPS, eps=FE.EPS),
                  tensors=meta, decoder=decoder or {})
    hb = json.dumps(header, separators=(',', ':')).encode()
    with open(path, 'wb') as f:
        f.write(b'PNN1' + struct.pack('<I', len(hb)) + hb)
        f.write(b'\0' * ((4 - (8 + len(hb)) % 4) % 4))
        for b in blobs:
            f.write(b)
    return os.path.getsize(path)


def round_f16(m):
    """The model as the browser runs it: every exported float16 weight rounded."""
    with torch.no_grad():
        for name, p in list(m.named_parameters()) + [(n, b) for n, b in m.named_buffers() if 'running' in n]:
            p.copy_(p.half().float())
    return m


def test_signal(n=16000 * 3 // 2):
    """Deterministic signal, reproducible in JS (tests/nn-model.test.js): three piano-ish tones
    (C3, E4 + G4 chord) with decaying partials and a little Park-Miller noise."""
    x = np.zeros(n, dtype=np.float64)
    t = np.arange(n) / 16000.0
    seed = 12345
    noise = np.zeros(n)
    for i in range(n):
        seed = (seed * 16807) % 2147483647  # Park-Miller: exact in JS doubles too
        noise[i] = seed / 2147483647 * 2 - 1
    for midi, t0, amp in ((48, 0.2, 0.2), (64, 0.7, 0.12), (67, 0.7, 0.12)):
        f0 = 440 * 2 ** ((midi - 69) / 12)
        on = t >= t0
        tt = np.where(on, t - t0, 0)
        for h in range(1, 9):
            x += on * amp / h * np.exp(-tt * (1.5 + h)) * np.sin(2 * np.pi * f0 * h * tt)
    x += 0.002 * noise
    return x.astype(np.float32)


def parity(m, path):
    x = test_signal()
    feats = FE.features_np(x, tuple(m.cfg.get('wins') or FE.WINS))  # [T, nspec, NB]
    with torch.no_grad():
        out = m(torch.from_numpy(feats).permute(1, 0, 2)[None])[0]  # [C, T, 88]
    frames = [30, 60, 75, 80, 90, 120, 145]
    ref = dict(n=len(x), frames=frames, wins=list(m.cfg.get('wins') or FE.WINS), feats={str(t): [round(float(v), 5) for v in feats[t].reshape(-1)] for t in (10, 75, 145)},
               logits={str(t): [round(float(v), 4) for v in out[:, t].T.reshape(-1)] for t in frames})
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(ref, open(path, 'w'))


if __name__ == '__main__':
    ck = torch.load(sys.argv[1], map_location='cpu')
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', 'assets', 'models', 'piano-nn.bin')
    dec = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else ck.get('decoder')
    m = Model(**{k: v for k, v in ck['cfg'].items()})
    m.load_state_dict(ck['model'])
    m.eval()
    round_f16(m)
    size = write(out, m, dec)
    parity(m, os.path.join(HERE, 'fixtures', 'parity.json'))
    print(f'wrote {out}: {size / 1024:.1f} KB, {sum(p.numel() for p in m.parameters())} params')
