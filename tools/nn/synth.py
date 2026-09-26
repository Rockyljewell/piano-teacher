"""Piano rendering for training data: a multi-sample sampler over the instrument banks built by
fetch_data.py, plus the additive synth of tests/synth-piano.js. Everything at 16 kHz.

Physics (as tests/bench-sampler.js / tests/corpus-piano.js, generalised and randomised):
  - the region is picked by key and velocity; notes between samples are pitch shifted from the
    nearest sample (Catmull-Rom resampling, anti-aliased when shifting up);
  - SoundFont regions keep their loops and their volume-envelope decay;
  - velocity -> gain curve, and single-layer instruments get darker when soft;
  - note-off applies the damper (slower in the bass; none above F6: those strings ring on);
  - sustain pedal: note-offs wait for the pedal; undamped strings resonate sympathetically
    (unlabelled); pedal thumps (unlabelled).
"""
import json
import os

import numpy as np
from scipy.signal import lfilter, sosfilt, butter

SR = 16000
HERE = os.path.dirname(os.path.abspath(__file__))
INST = os.path.join(HERE, '.data', 'inst')
INSTRUMENTS = ['salamander', 'musescore', 'fluid', 'gu', 'iowa']


def tc2s(tc):
    return 0.0 if tc <= -12000 else 2.0 ** (tc / 1200.0)


class Instrument:
    def __init__(self, name):
        d = os.path.join(INST, name)
        meta = json.load(open(os.path.join(d, 'regions.json')))
        self.name = name
        self.data = np.load(os.path.join(d, 'bank.npz'))['data'].astype(np.float32)
        self.regions = meta['regions']
        self.license = meta['license']
        R = self.regions
        # normalise the instrument: median attack peak of mid-range regions -> 0.25
        pk = []
        for r in R:
            if 48 <= r['key'] <= 84:
                x = self.data[r['off']: r['off'] + min(r['n'], SR // 5)]
                pk.append(np.max(np.abs(x)) * 10 ** (-r['atten'] / 20))
        self.norm = 0.25 / (np.median(pk) + 1e-9)
        # how many distinct samples a key has across velocities
        layers = {}
        for r in R:
            for k in range(max(21, r['lokey']), min(108, r['hikey']) + 1):
                layers.setdefault(k, set()).add(r['off'])
        self.layers = int(np.median([len(v) for v in layers.values()]))
        # region lookup table [midi, vel]
        keys = np.arange(128)[:, None]
        vels = np.arange(128)[None, :]
        best = np.full((128, 128), 1e18)
        self.table = np.zeros((128, 128), dtype=np.int32)
        for i, r in enumerate(R):
            dv = np.where(vels < r['lovel'], r['lovel'] - vels, np.where(vels > r['hivel'], vels - r['hivel'], 0))
            dk = np.where(keys < r['lokey'], r['lokey'] - keys, np.where(keys > r['hikey'], keys - r['hikey'], 0))
            dist = dv * 100.0 + dk * 10.0 + np.abs(keys - r['key']) + 0 * vels
            m = dist < best
            best[m] = dist[m]
            self.table[m] = i
        # natural end of each (unlooped) sample: smoothed level 45 dB under its peak
        self.nat_end = []
        for r in R:
            if r['loop']:
                self.nat_end.append(None)
                continue
            x = np.abs(self.data[r['off']: r['off'] + r['n']])
            hop = 160
            nb = len(x) // hop
            e = x[: nb * hop].reshape(nb, hop).max(axis=1) if nb else np.array([0.0])
            pk = e.max() + 1e-12
            above = np.nonzero(e > pk / 180)[0]
            self.nat_end.append(((above[-1] + 1) * hop if len(above) else hop) / SR)
        self._aa = {}

    def region(self, midi, vel):
        return self.table[int(np.clip(midi, 0, 127)), int(np.clip(round(vel * 127), 1, 127))]

    def _source(self, ri, step):
        """Region samples, low-passed when they will be read faster than 1x (anti-aliasing)."""
        r = self.regions[ri]
        x = self.data[r['off']: r['off'] + r['n']]
        if step <= 1.06:
            return x
        b = int(round(step * 20))  # cache per 5 % step bucket
        k = (ri, b)
        if k not in self._aa:
            if len(self._aa) > 400:
                self._aa.clear()
            sos = butter(8, min(0.95, 0.9 / (b / 20.0)), output='sos')
            self._aa[k] = sosfilt(sos, x).astype(np.float32)
        return self._aa[k]

    def note(self, midi, vel, dur, rng, *, detune=0.0, damped=True, vel_exp=1.7, attack_ramp=0.0, max_sec=8.0):
        """Render one note (dry, starting at its attack). Returns (signal, sounding_seconds)."""
        ri = self.region(midi, vel)
        r = self.regions[ri]
        step = 2.0 ** ((midi - r['key'] + (r['tune'] + detune) / 100.0) / 12.0)
        x = self._source(ri, step)
        tau = (0.06 + (0.25 * (60 - midi) / 39 if midi < 60 else 0.0)) * rng.uniform(0.6, 1.6)
        damped = damped and midi < 89
        if r['loop']:
            nat = max_sec
        else:
            nat = min(max_sec, (r['n'] - 4) / step / SR, self.nat_end[ri] / step)
        length = min(nat, dur + 7 * tau) if damped else nat
        n = max(8, int(length * SR))
        pos = step * np.arange(n, dtype=np.float64)
        if r['loop']:
            sl, el = r['sl'], r['el']
            L = el - sl
            m = pos >= el
            pos[m] = sl + np.mod(pos[m] - sl, L)
        else:
            n = min(n, int((r['n'] - 4) / step))
            pos = pos[:n]
        k = pos.astype(np.int64)
        f = (pos - k).astype(np.float32)
        xm = x[np.maximum(k - 1, 0)]
        x0 = x[k]
        x1 = x[k + 1]
        x2 = x[np.minimum(k + 2, len(x) - 1)]
        y = x0 + 0.5 * f * (x1 - xm + f * (2 * xm - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - xm)))
        t = np.arange(len(y), dtype=np.float32) / SR
        env = np.ones(len(y), dtype=np.float32)
        # SoundFont volume envelope: hold, then a linear-in-dB decay to the sustain level
        dec = tc2s(r['decay'] + r['k2decay'] * (60 - midi))
        sus = min(100.0, max(0.0, r['sustain'] / 10.0))
        if sus > 0 and dec > 0:
            hold = tc2s(r['hold'] + r['k2hold'] * (60 - midi))
            db = -np.minimum(sus, 100.0 * np.maximum(0.0, t - hold) / dec)
            env *= (10.0 ** (db / 20.0)).astype(np.float32)
        if damped:
            env *= np.exp(-np.maximum(t - dur, 0) / tau).astype(np.float32)
        if attack_ramp > 0:
            env *= (1 - np.exp(-t / attack_ramp)).astype(np.float32)
        y = y * env
        if self.layers <= 1:
            # one layer: darker when soft (one-pole low-pass)
            fc = min(7600.0, 1200.0 * 2 ** (vel * 4.5))
            a = 1 - np.exp(-2 * np.pi * fc / SR)
            y = lfilter([a], [1, a - 1], y).astype(np.float32)
        g = self.norm * (vel / 0.8) ** vel_exp * 10 ** (-r['atten'] / 20) * rng.uniform(0.9, 1.1)
        sounding = min(len(y) / SR, dur + 2 * tau) if damped else len(y) / SR
        return (y * g).astype(np.float32), sounding


class AdditivePiano:
    """tests/synth-piano.js, vectorised and widened into a family of pianos: every instance
    (seed) is a different instrument - string stiffness from a concert grand to a small
    upright (inharmonicity x0.6..x6, more in the bass), 1-3 slightly detuned strings per key
    (beating, double decay), its own spectral tilt, decay times and hammer noise."""
    name = 'synth'
    layers = 1

    def __init__(self, seed=7):
        self.seed = seed
        r = np.random.default_rng(seed)
        self.bscale = float(np.exp(r.uniform(np.log(0.6), np.log(4.0))))
        self.bbass = float(np.exp(r.uniform(0, np.log(2.0))))  # extra stiffness of short bass strings
        self.tilt = float(r.uniform(0.6, 1.5))
        self.decay = float(r.uniform(0.5, 1.6))
        self.hammer = float(r.uniform(0.1, 0.8))
        self.thump = float(r.uniform(0.0, 1.0))
        self.detune_c = float(r.uniform(0.3, 2.5))  # unison detuning (cents)
        self.fund = float(r.uniform(0.1, 0.6))  # fundamental strength in the bass

    @staticmethod
    def B(midi):
        return 10 ** (-3.9 + 0.028 * (midi - 40)) if midi >= 40 else 10 ** (-3.9 - 0.01 * (midi - 40))

    def note(self, midi, vel, dur, rng, *, detune=0.0, damped=True, vel_exp=1.0, attack_ramp=0.0, max_sec=6.0, bscale=None):
        kr = np.random.default_rng(self.seed * 131 + midi * 7919)
        f0 = 440 * 2 ** ((midi - 69 + detune / 100) / 12)
        bs = self.bscale * (bscale if bscale is not None else 1.0) * (self.bbass ** ((48 - midi) / 27) if midi < 48 else 1.0)
        b = self.B(midi) * bs * (0.7 + kr.random() * 0.8)
        tau0 = max(0.4, 4.5 * self.decay * 2 ** (-(midi - 36) / 18))
        p = self.tilt * (0.8 + kr.random() * 0.5)
        damped = damped and midi < 89
        length = min(max_sec, dur + 0.25) if damped else min(max_sec, 5 * tau0)
        n = int(length * SR)
        t = np.arange(n, dtype=np.float32) / SR
        y = np.zeros(n, dtype=np.float32)
        strings = 1 if midi < 30 else 2 if midi < 42 else 3
        dets = [0.0] + list(kr.normal(0, self.detune_c, strings - 1))
        for h in range(1, 40):
            fh = h * f0 * np.sqrt(1 + b * h * h)
            if fh > SR * 0.47:
                break
            a = h ** (-p) * 10 ** ((kr.random() - 0.5) * 0.6 + (rng.random() - 0.5) * 0.1)
            if midi < 45 and h == 1:
                a *= self.fund * (0.5 + kr.random())
            if midi < 40 and h == 2:
                a *= 0.5 + 0.5 * kr.random()
            a *= vel ** (0.3 + 0.05 * h)
            if a < 1e-4:
                continue
            tau = tau0 / (1 + 0.25 * h)
            ns = strings if h <= 8 else 1
            for j in range(ns):
                fj = fh * 2 ** (dets[j] / 1200)
                # prompt sound (fast decay) and aftersound (slow): the unison strings drift apart
                env = (0.75 * np.exp(-t / tau) + 0.25 * np.exp(-t / (tau * (3 + 4 * kr.random())))) / ns
                y += (a * env * np.sin(2 * np.pi * fj * t + rng.random() * 6.283)).astype(np.float32)
        att = np.minimum(1, t / 0.002)
        y *= 0.25 * vel * att
        if damped:
            y *= np.exp(-np.maximum(t - dur, 0) / (0.03 + (0.1 if midi < 48 else 0) * kr.random())).astype(np.float32)
        hl = int(0.02 * SR)
        noise = lfilter([0.3], [1, -0.7], rng.uniform(-1, 1, hl)).astype(np.float32)
        y[:hl] += self.hammer * 0.25 * vel * noise * np.exp(-np.arange(hl) / (0.004 * SR))
        if self.thump > 0 and midi < 60:  # the low "thunk" of a hammer / key bed
            k = np.arange(int(0.06 * SR))
            y[: len(k)] += (self.thump * 0.1 * vel * np.exp(-k / (0.012 * SR)) * np.sin(2 * np.pi * rng.uniform(60, 140) * k / SR)).astype(np.float32)[: n]
        if attack_ramp > 0:
            y *= (1 - np.exp(-t / attack_ramp)).astype(np.float32)
        sounding = min(length, dur + 0.06) if damped else length
        return y * 1.6, sounding


def load_instruments(names=None):
    out = {}
    for n in names or INSTRUMENTS:
        if os.path.exists(os.path.join(INST, n, 'regions.json')):
            out[n] = Instrument(n)
    out['synth'] = AdditivePiano()
    return out


def render(inst, notes, length, rng, *, pedal=(), detune=0.0, stretch=True, sympathetic=None, vel_exp=None, thumps=True):
    """notes: list of dicts {midi, t, dur, vel}. pedal: [(down, up)] seconds.
    Returns (audio float32, labels [(midi, onset_s, sounding_end_s, vel)])."""
    N = int(length * SR)
    out = np.zeros(N + SR * 9, dtype=np.float32)
    if vel_exp is None:
        vel_exp = 1.7 if getattr(inst, 'layers', 1) <= 1 else rng.uniform(0.8, 1.7)
    symp = (rng.random() < 0.8) if sympathetic is None else sympathetic
    labels = []
    # per-key tuning imperfection (a real piano is never perfectly in tune) and stretch tuning
    key_dev = rng.normal(0, 3.0, 128)
    st_amt = rng.uniform(0, 1.2) if stretch else 0.0

    def stretch_c(m):
        if m < 48:
            return -(48 - m) * 0.8 * st_amt
        if m > 60:
            return ((m - 60) / 48) ** 2 * 40 * st_amt
        return 0.0

    def pedal_up(t):
        for d, u in pedal:
            if d <= t < u:
                return u
        return t

    for n in notes:
        midi, t0, dur, vel = n['midi'], n['t'], n['dur'], n['vel']
        off = pedal_up(t0 + dur)
        det = detune + key_dev[midi] + stretch_c(midi)
        y, snd = inst.note(midi, vel, off - t0, rng, detune=det, vel_exp=vel_exp)
        i0 = int(round(t0 * SR))
        if i0 < 0:
            y = y[-i0:]
            i0 = 0
        out[i0: i0 + len(y)] += y[: len(out) - i0]
        labels.append((midi, t0, t0 + snd, vel))
        if symp and off > t0 + dur + 1e-6:
            for iv, db in ((12, -30), (19, -36), (24, -38), (-12, -40)):
                m = midi + iv
                if m < 21 or m > 108 or rng.random() < 0.3:
                    continue
                ys, _ = inst.note(m, vel * 0.6, off - t0, rng, detune=det, vel_exp=vel_exp, attack_ramp=rng.uniform(0.02, 0.08))
                ys *= 10 ** ((db + rng.uniform(-6, 4)) / 20)
                out[i0: i0 + len(ys)] += ys[: len(out) - i0]
    if thumps:
        for d, u in pedal:
            for tt, amp in ((d, 0.02), (u, 0.012)):
                if tt < 0 or tt > length:
                    continue
                i0 = int(tt * SR)
                k = np.arange(int(0.25 * SR))
                f = 55 + rng.random() * 30
                a = amp * rng.uniform(0.3, 2.0)
                th = a * np.exp(-k / SR / 0.05) * np.sin(2 * np.pi * f * k / SR)
                b, aa = butter(2, 900 / (SR / 2))
                th += lfilter(b, aa, rng.uniform(-1, 1, len(k)) * a * 0.4 * np.exp(-k / SR / 0.08))
                out[i0: i0 + len(k)] += th[: len(out) - i0].astype(np.float32)
    return out[:N], labels
