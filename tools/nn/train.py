"""Train the listening model on the rendered clips, mixing in noise / mic / level augmentation on
the fly (every batch is a new mixture).

    OMP_NUM_THREADS=2 python tools/nn/train.py --steps 3000 --out .data/runs/main

Targets per frame t (window ending at sample 160 (t+1)) and key:
  onset  1 if the key was struck within the last K = 4 frames (the attack is in the window of
         frame t0 .. t0+3). A causal model can say "yes" as soon as it is sure, up to 30-40 ms
         after the attack: that is its look-ahead.
  age    which of those K frames the attack was in (for the time stamp)
  frame  the key is sounding
Loss: BCE(onset) with positives up-weighted (early, 0-10 ms frames count half), BCE(frame),
cross-entropy(age) on onset frames. The first frames of every crop (no history) are masked.
"""
import argparse
import glob
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from frontend import HOP, SR, TorchFrontend
from model import K_ONSET, NKEY, Model, macs
from room import mic_eq_curve

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, '.data', 'clips')
NOISE = os.path.join(HERE, '.data', 'noise')
WARM = 48  # masked frames at the start of every crop (STFT window + receptive field)
PIANO_PEAK_RMS = 5.7  # peak / rms of a mezzo-forte passage (tests/noise-eval.js PIANO_REF)

CONTINUOUS = {'speech': 3, 'sim-speech': 2, 'sim-tv': 1.5, 'sim-tvmusic': 0.7, 'radio': 1.2, 'sim-hum': 0.6, 'sim-bark': 0.5}
IMPULSIVE = {'sim-claps': 1, 'sim-taps': 1, 'sim-footsteps': 0.6, 'sim-dishes': 1, 'sim-typing': 0.8}


class Clips:
    def __init__(self, split):
        self.audio, self.items = [], []
        for f in sorted(glob.glob(os.path.join(CLIPS, f'{split}-*.npz'))):
            a = os.path.join(f[:-4] + '.audio.npy')
            if not os.path.exists(a):
                continue
            z = np.load(f)
            si = len(self.audio)
            self.audio.append(np.load(a, mmap_mode='r'))
            clips, notes = z['clips'], z['notes']
            meta = json.loads(str(z['meta']))
            for c, (off, n) in enumerate(clips):
                self.items.append((si, int(off), int(n), notes[notes[:, 0] == c, 1:], meta[c]))
        print(f'{split}: {len(self.items)} clips, {sum(i[2] for i in self.items) / SR / 3600:.1f} h', flush=True)

    def crop(self, rng, n, idx=None):
        si, off, L, notes, meta = self.items[rng.integers(len(self.items)) if idx is None else idx]
        start = int(rng.integers(-SR // 2, max(1, L - n)))
        x = np.zeros(n, dtype=np.float32)
        a, b = max(0, start), min(L, start + n)
        if b > a:
            x[a - start: b - start] = self.audio[si][off + a: off + b].astype(np.float32) / 32767.0
        nt = notes.copy()
        nt[:, 1:3] -= start / SR
        return x, nt, meta


class NoiseBank:
    def __init__(self):
        self.kinds = {}
        for f in sorted(glob.glob(os.path.join(NOISE, '*.f32'))):
            b = os.path.basename(f)[:-4]
            kind = b.rsplit('-', 1)[0]
            x = np.fromfile(f, dtype='<f4')
            if kind in IMPULSIVE:
                x = x / (np.max(np.abs(x)) + 1e-9)
            else:
                # normalise to the RMS of the active parts (like noise-sim.js)
                fr = x[: len(x) // 1600 * 1600].reshape(-1, 1600)
                e = np.sqrt((fr ** 2).mean(axis=1))
                act = e[e > 0.1 * e.max()]
                x = x / (np.sqrt((act ** 2).mean()) + 1e-9)
            self.kinds.setdefault(kind, []).append(x.astype(np.float16))
        print('noise:', {k: len(v) for k, v in self.kinds.items()}, flush=True)

    def get(self, rng, kind, n):
        x = self.kinds[kind][rng.integers(len(self.kinds[kind]))]
        s = int(rng.integers(0, max(1, len(x) - n)))
        seg = x[s: s + n].astype(np.float32)
        if len(seg) < n:
            seg = np.resize(seg, n)
        return seg


def tick(rng):
    """The metronome tick as the mic might hear it: a noise burst, mostly above the 16 kHz band;
    what leaks is a faint high click."""
    n = int(0.05 * SR)
    w = rng.uniform(-1, 1, n)
    X = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    X *= 1 / (1 + (rng.uniform(4500, 7000) / np.maximum(f, 1)) ** 8)
    y = np.fft.irfft(X, n) * np.exp(-np.arange(n) / (0.01 * SR))
    return y.astype(np.float32)


def augment(rng, piano, noise, *, p_noise=0.8):
    n = len(piano)
    r = float(np.sqrt(np.mean(piano ** 2)))
    target = 0.03 * 10 ** (rng.uniform(-20, 20) / 20)
    mix = piano * (target / r) if r > 1e-5 else piano.copy()
    ref = target
    mix += noise.get(rng, 'sim-room', n) * ref * 10 ** (rng.uniform(-75, -38) / 20)
    if rng.random() < p_noise:
        for _ in range(int(rng.integers(1, 3))):
            if rng.random() < 0.65:
                kinds = list(CONTINUOUS)
                p = np.array([CONTINUOUS[k] for k in kinds])
                k = kinds[rng.choice(len(kinds), p=p / p.sum())]
                if k not in noise.kinds:
                    continue
                lvl = ref * 10 ** (rng.uniform(-42, -3) / 20)
            else:
                kinds = list(IMPULSIVE)
                p = np.array([IMPULSIVE[k] for k in kinds])
                k = kinds[rng.choice(len(kinds), p=p / p.sum())]
                if k not in noise.kinds:
                    continue
                lvl = ref * PIANO_PEAK_RMS * 10 ** (rng.uniform(-26, 3) / 20)
            seg = noise.get(rng, k, n) * lvl
            if rng.random() < 0.3:  # only part of the time
                a = int(rng.integers(0, n))
                b = int(min(n, a + rng.integers(SR // 2, n)))
                seg[:a] = 0
                seg[b:] = 0
            mix += seg
    if rng.random() < 0.12:
        per = rng.uniform(0.3, 1.0)
        t = rng.uniform(0, per)
        amp = ref * PIANO_PEAK_RMS * 10 ** (rng.uniform(-30, 0) / 20)
        tk = tick(rng)
        while t < n / SR:
            i = int(t * SR)
            mix[i: i + len(tk)] += tk[: n - i] * amp
            t += per
    if rng.random() < 0.85:
        X = np.fft.rfft(mix)
        X *= mic_eq_curve(rng, len(X))
        mix = np.fft.irfft(X, n).astype(np.float32)
    if rng.random() < 0.03:
        c = rng.uniform(0.3, 0.9) * np.max(np.abs(mix))
        mix = np.clip(mix, -c, c)
    return mix.astype(np.float32)


BASS = 48  # keys below C3 may get a longer onset window (k_bass)


def targets(notes, T, k_on=K_ONSET, k_bass=0):
    """notes [m, 4] (midi, onset s, end s, vel) -> onset [T, 88], age [T, 88] (-1 = none), frame [T, 88]"""
    onset = np.zeros((T, NKEY), dtype=np.float32)
    age = np.full((T, NKEY), -1, dtype=np.int64)
    frame = np.zeros((T, NKEY), dtype=np.float32)
    for midi, on, end, vel in notes:
        k = int(midi) - 21
        if k < 0 or k >= NKEY:
            continue
        s_on = on * SR
        t0 = int(np.ceil(s_on / HOP)) - 1  # first frame whose window ends at/after the attack
        for a in range(k_bass if (k_bass and midi < BASS) else k_on):
            t = t0 + a
            if 0 <= t < T:
                onset[t, k] = 1
                age[t, k] = a
        f0 = max(0, t0)
        f1 = min(T, int(np.ceil(end * SR / HOP)) - 1)
        if f1 > f0:
            frame[f0:f1, k] = 1
    return onset, age, frame


K_BASS = 0
K_ON = K_ONSET


def batch(rng, clips, noise, fe, B, T, p_noise=0.8):
    n = (T + WARM) * HOP
    X, O, A, Fr = [], [], [], []
    for _ in range(B):
        piano, nt, _ = clips.crop(rng, n)
        X.append(augment(rng, piano, noise, p_noise=p_noise))
        o, a, f = targets(nt, T + WARM, k_on=K_ON, k_bass=K_BASS)
        O.append(o), A.append(a), Fr.append(f)
    x = torch.from_numpy(np.stack(X))
    with torch.no_grad():
        feats = fe(x)
    return feats, torch.from_numpy(np.stack(O)), torch.from_numpy(np.stack(A)), torch.from_numpy(np.stack(Fr))


POS_W = 4.0


def loss_fn(out, onset, age, frame, pos_w=None):
    pos_w = POS_W if pos_w is None else pos_w
    # out [B, 2+K, T, 88]; targets [B, T, 88]
    lo = out[:, 0, WARM:]
    lf = out[:, 1, WARM:]
    la = out[:, 2:, WARM:]
    on = onset[:, WARM:]
    ag = age[:, WARM:]
    fr = frame[:, WARM:]
    w = torch.where(on > 0, pos_w * torch.where(ag == 0, 0.5, 1.0), torch.ones_like(on))
    l_on = F.binary_cross_entropy_with_logits(lo, on, weight=w)
    l_fr = F.binary_cross_entropy_with_logits(lf, fr)
    m = ag >= 0
    if m.any():
        l_age = F.cross_entropy(la.permute(0, 2, 3, 1)[m], ag[m])
    else:
        l_age = torch.zeros(())
    return l_on + 0.5 * l_fr + 0.2 * l_age, (l_on.item(), l_fr.item(), l_age.item())


def decode(p_on, thr=0.5, low=None, refr=5):
    """Onset probabilities [T, 88] -> [(frame, key, peak)] at the first crossing of thr; re-armed
    once the probability falls below `low` (and at least `refr` frames later)."""
    low = thr * 0.5 if low is None else low
    T, K = p_on.shape
    ev = []
    armed = np.ones(K, bool)
    last = np.full(K, -100)
    for t in range(T):
        p = p_on[t]
        hit = armed & (p >= thr) & (t - last >= refr)
        for k in np.nonzero(hit)[0]:
            ev.append((t, int(k), float(p[k])))
            armed[k] = False
            last[k] = t
        armed |= p < low
    return ev


def evaluate(model, fe, clips, noise, n=48, T=700, seed=12345, thr=(0.3, 0.4, 0.5, 0.6, 0.7)):
    rng = np.random.default_rng(seed)
    model.eval()
    res = {t: [0, 0, 0, []] for t in thr}  # hit, n_true, n_ev, latencies (frames)
    tot = 0.0
    with torch.no_grad():
        for i in range(n):
            feats, on, ag, fr = batch(rng, clips, noise, fe, 1, T)
            out = model(feats)
            l, _ = loss_fn(out, on, ag, fr)
            tot += l.item()
            p = torch.sigmoid(out[0, 0]).numpy()
            # true onsets: (frame t0, key)
            o = on[0].numpy()
            a = ag[0].numpy()
            true = [(t, k) for t, k in zip(*np.nonzero(a == 0)) if t >= WARM]
            for th in thr:
                ev = [e for e in decode(p, th) if e[0] >= WARM]
                used = set()
                hit = 0
                for (t0, k) in true:
                    best = None
                    for j, (te, ke, _) in enumerate(ev):
                        if ke == k and j not in used and -2 <= te - t0 <= 10:
                            best = j
                            break
                    if best is not None:
                        used.add(best)
                        hit += 1
                        res[th][3].append(ev[best][0] - t0)
                r = res[th]
                r[0] += hit
                r[1] += len(true)
                r[2] += len(ev)
    model.train()
    out = {'loss': tot / n}
    for th, (h, nt, ne, lat) in res.items():
        R = h / max(1, nt)
        P = h / max(1, ne)
        out[f'f1@{th}'] = 2 * P * R / max(1e-9, P + R)
        out[f'p@{th}'] = P
        out[f'r@{th}'] = R
        out[f'lat@{th}'] = float(np.median(lat)) if lat else -1
    return out


def init_from(model, path, wins):
    """Warm start from an earlier checkpoint whose configuration may lack STFT windows or age
    classes: shared weights are copied, the new input channels start at zero (so the network
    starts out computing exactly what it did), new age outputs keep their fresh init."""
    from model import HARM
    ck = torch.load(path, map_location='cpu')
    old, ocfg = ck['model'], ck['cfg']
    owins = list(ocfg.get('wins') or [2048, 512])
    wins = list(wins)
    H = len(HARM)
    sd = model.state_dict()
    for k, v in old.items():
        if k not in sd:
            continue
        if sd[k].shape == v.shape:
            sd[k] = v.clone()
        elif k in ('mu', 'sd'):
            for i, W in enumerate(owins):
                if W in wins:
                    sd[k][wins.index(W)] = v[i]
        elif k == 'a.weight':
            new = torch.zeros_like(sd[k])
            for i, W in enumerate(owins):
                if W in wins:
                    j = wins.index(W)
                    new[:, j * H:(j + 1) * H] = v[:, i * H:(i + 1) * H]
            if ocfg.get('diff'):
                new[:, len(wins) * H:] = v[:, len(owins) * H:]
            sd[k] = new
        elif k.startswith('head.'):
            new = sd[k].clone()
            new[: v.shape[0]] = v
            sd[k] = new
    model.load_state_dict(sd)
    print(f'warm start from {path} (step {ck.get("step")}, windows {owins} -> {wins})', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--steps', type=int, default=3000)
    ap.add_argument('--batch', type=int, default=16)
    ap.add_argument('--frames', type=int, default=400)
    ap.add_argument('--lr', type=float, default=3e-3)
    ap.add_argument('--out', default=os.path.join(HERE, '.data', 'runs', 'main'))
    ap.add_argument('--c1', type=int, default=16)
    ap.add_argument('--c2', type=int, default=24)
    ap.add_argument('--blocks', default='t1,x,t2,t4,x,t8')
    ap.add_argument('--eval-every', type=int, default=250)
    ap.add_argument('--resume', default='')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--wins', default='2048,512', help='STFT windows, longest first')
    ap.add_argument('--k-onset', type=int, default=4, help='onset window (frames): the most the model may take to decide')
    ap.add_argument('--k-bass', type=int, default=0, help='onset window (frames) below C3 (0: same as above)')
    ap.add_argument('--pos-weight', type=float, default=4.0, help='weight of positive onset frames')
    ap.add_argument('--init-from', default='', help='warm start from a checkpoint of a smaller configuration')
    a = ap.parse_args()
    global K_BASS, POS_W, K_ON
    K_BASS = a.k_bass
    K_ON = a.k_onset
    POS_W = a.pos_weight
    wins = tuple(int(w) for w in a.wins.split(','))
    torch.set_num_threads(2)
    os.makedirs(a.out, exist_ok=True)
    rng = np.random.default_rng(a.seed)
    torch.manual_seed(a.seed)
    train, val = Clips('train'), Clips('val')
    noise = NoiseBank()
    fe = TorchFrontend(wins)
    model = Model(c1=a.c1, c2=a.c2, blocks=a.blocks.split(','), wins=wins, k_bass=a.k_bass or None, k_onset=a.k_onset)
    # fixed input normalisation from a few batches
    with torch.no_grad():
        fs = torch.cat([batch(rng, train, noise, fe, 8, 200)[0] for _ in range(4)])
        model.mu.copy_(fs.mean(dim=(0, 2, 3)))
        model.sd.copy_(fs.std(dim=(0, 2, 3)))
    if a.init_from:
        init_from(model, a.init_from, wins)
    step0 = 0
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    if a.resume:
        ck = torch.load(a.resume)
        model.load_state_dict(ck['model'])
        opt.load_state_dict(ck['opt'])
        step0 = ck['step']
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=a.steps, pct_start=0.05, last_epoch=step0 - 1 if step0 else -1)
    print(f'model: {sum(p.numel() for p in model.parameters())} params, {macs(model)} MACs/frame, receptive field {model.rf()} frames; cfg {model.cfg}', flush=True)
    log = open(os.path.join(a.out, 'log.jsonl'), 'a')
    best = -1
    t0 = time.time()
    run = []
    for step in range(step0, a.steps):
        feats, on, ag, fr = batch(rng, train, noise, fe, a.batch, a.frames)
        out = model(feats)
        loss, parts = loss_fn(out, on, ag, fr)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        run.append(parts)
        if (step + 1) % 25 == 0:
            m = np.mean(run, axis=0)
            run = []
            print(f'step {step + 1} loss on {m[0]:.4f} fr {m[1]:.4f} age {m[2]:.3f} lr {sched.get_last_lr()[0]:.2e} {(time.time() - t0) / (step + 1 - step0):.2f} s/step', flush=True)
        if (step + 1) % a.eval_every == 0 or step + 1 == a.steps:
            ev = evaluate(model, fe, val, noise)
            ev['step'] = step + 1
            ev['time'] = time.time() - t0
            log.write(json.dumps(ev) + '\n')
            log.flush()
            f1 = max(v for k, v in ev.items() if k.startswith('f1@'))
            print('eval', {k: round(v, 4) if isinstance(v, float) else v for k, v in ev.items()}, flush=True)
            ck = dict(model=model.state_dict(), opt=opt.state_dict(), step=step + 1, cfg=model.cfg, eval=ev)
            torch.save(ck, os.path.join(a.out, 'last.pt'))
            if f1 > best:
                best = f1
                torch.save(ck, os.path.join(a.out, 'best.pt'))


if __name__ == '__main__':
    main()
