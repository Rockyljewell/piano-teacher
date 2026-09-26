"""What gets played in the training clips: the app's own pieces (content.json from
dump_content.mjs: the generator for all 40 levels, warm-ups, rhythm drills, the song library)
plus synthetic material aimed at what is hard to hear: block chords from dyads to 6 notes,
octaves, both-hands chords, clusters, scales, arpeggios, trills, repeated notes, fast runs,
pedalled textures and random "note soup" across the whole keyboard.

Every generator returns (notes, pedal): notes = [{midi, t, dur, vel}], pedal = [(down, up)].
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]
LO, HI = 21, 108

_content = None


def app_pieces():
    global _content
    if _content is None:
        f = os.path.join(HERE, '.data', 'content.json')
        _content = json.load(open(f))['pieces'] if os.path.exists(f) else []
    return _content


def clampm(m):
    return int(min(HI, max(LO, m)))


def human(rng):
    """A player: timing sloppiness, chord spread, dynamics."""
    return dict(jit=rng.uniform(0.004, 0.03), spread=rng.uniform(0.0, 0.018), vel=rng.uniform(0.3, 0.8), vvar=rng.uniform(0.04, 0.15))


def vel_of(rng, h, accent=0.0):
    return float(np.clip(h['vel'] + accent + rng.normal(0, h['vvar']), 0.08, 1.0))


def from_app(rng, length):
    P = app_pieces()
    if not P:
        return soup(rng, length)
    p = P[rng.integers(len(P))]
    h = human(rng)
    spb = 60.0 / (p['bpm'] * rng.uniform(0.75, 1.35))
    legato = rng.uniform(0.55, 1.0)
    notes = []
    groups = {}
    for m, beat, dur, hand in p['notes']:
        groups.setdefault(round(beat, 4), []).append((m, dur, hand))
    beats = sorted(groups)
    # start somewhere inside long pieces
    t_first = beats[0] * spb
    total = (beats[-1] - beats[0]) * spb
    off = 0.0
    if total > length - 1.5:
        off = rng.uniform(0, total - (length - 1.5)) + t_first
    else:
        off = t_first
    t_lead = rng.uniform(0.3, 1.2)
    for b in beats:
        tn = b * spb - off + t_lead
        if tn < -2 or tn > length:
            continue
        jit = rng.normal(0, h['jit'])
        acc = 0.07 if abs(b % p['beatsPer']) < 1e-6 else 0.0
        for m, dur, hand in groups[b]:
            t = tn + jit + rng.uniform(-1, 1) * h['spread']
            notes.append(dict(midi=int(m), t=t, dur=max(0.06, dur * spb * legato), vel=vel_of(rng, h, acc - (0.06 if hand else 0))))
    notes = [n for n in notes if n['t'] >= 0.05]
    pedal = []
    if rng.random() < 0.3:
        pedal = bar_pedal(rng, spb * p['beatsPer'], t_lead - off % (spb * p['beatsPer']), length)
    return notes, pedal


def bar_pedal(rng, bar, t0, length):
    """Pedal changed on every bar (or half bar)."""
    per = bar / (2 if rng.random() < 0.3 else 1)
    pedal = []
    t = t0
    while t < length:
        if t + per > 0:
            pedal.append((max(0.0, t + rng.uniform(0.02, 0.12)), t + per - rng.uniform(0.0, 0.06)))
        t += per
    return pedal


def chord_shapes(rng):
    """A chord voicing (intervals above the lowest note)."""
    r = rng.random()
    if r < 0.12:
        return [0, rng.choice([3, 4, 5, 7, 8, 9, 12, 15, 16])]  # dyad
    if r < 0.22:
        return [0, 12]  # octave
    if r < 0.30:
        return [0, 12, rng.choice([7, 4, 16, 19, 24])] if rng.random() < 0.6 else [0, 7, 12]
    if r < 0.55:
        tri = rng.choice([[0, 4, 7], [0, 3, 7], [0, 3, 6], [0, 4, 8], [0, 5, 9], [0, 3, 8], [0, 4, 9], [0, 5, 8], [0, 2, 7], [0, 5, 7]])
        return list(tri)
    if r < 0.70:
        return list(rng.choice([[0, 4, 7, 10], [0, 4, 7, 11], [0, 3, 7, 10], [0, 3, 6, 9], [0, 4, 7, 12], [0, 3, 7, 12], [0, 5, 9, 12], [0, 2, 4, 7]]))
    if r < 0.80:
        # cluster
        n = rng.integers(2, 5)
        s = [0]
        for _ in range(n - 1):
            s.append(s[-1] + int(rng.choice([1, 2, 2, 3])))
        return s
    # random 2..6 notes within 2 octaves
    n = rng.integers(2, 7)
    return sorted(set([0] + list(rng.integers(1, 25, n - 1))))


def both_hands(rng):
    """LH (1-3 notes) + RH (2-4 notes), like the benchmark's hardest case and real pieces."""
    root = int(rng.integers(28, 56))
    minor = rng.random() < 0.4
    third = 3 if minor else 4
    lh = [[0], [0, 7], [0, 12], [0, 7, 12], [0, third + 12], [0, 7, third + 12]][rng.integers(6)]
    rt = root + int(rng.choice([12, 24, 24, 36]))
    rh = [[0, third, 7], [third, 7, 12], [7, 12, 12 + third], [0, third, 7, 12], [0, 7, 12 + third], [0, 12], [third, 12 + third]][rng.integers(7)]
    if rng.random() < 0.3:
        rh = [x + int(rng.choice([2, 5, 9, 10, 11])) if i == len(rh) - 1 else x for i, x in enumerate(rh)]
    return [root + x for x in lh] + [rt + x for x in rh]


def block_chords(rng, length):
    h = human(rng)
    notes = []
    t = rng.uniform(0.2, 1.0)
    gap_lo, gap_hi = sorted(rng.uniform(0.12, 1.4, 2))
    center = rng.uniform(36, 84)
    while t < length - 0.2:
        if rng.random() < 0.35:
            ms = both_hands(rng)
        else:
            base = int(np.clip(rng.normal(center, 12), 24, 100))
            ms = [base + x for x in chord_shapes(rng)]
        ms = sorted(set(clampm(m) for m in ms))
        gap = rng.uniform(gap_lo, gap_hi)
        dur = gap * rng.uniform(0.3, 1.3)
        v = vel_of(rng, h)
        rep = 1 if rng.random() < 0.8 else int(rng.integers(2, 5))  # repeated chords
        for _ in range(rep):
            for m in ms:
                notes.append(dict(midi=m, t=t + rng.uniform(-1, 1) * h['spread'], dur=dur / rep, vel=float(np.clip(v + rng.normal(0, 0.06), 0.08, 1))))
            t += gap / rep if rep > 1 else gap
        if rng.random() < 0.15:
            center = rng.uniform(36, 84)
    pedal = bar_pedal(rng, rng.uniform(1.5, 3.5), 0.0, length) if rng.random() < 0.2 else []
    return notes, pedal


def scale_notes(tonic, octs, minor=False, chromatic=False):
    if chromatic:
        up = list(range(tonic, tonic + 12 * octs + 1))
    else:
        sc = MINOR if minor else MAJOR
        up = [tonic + 12 * o + s for o in range(octs) for s in sc] + [tonic + 12 * octs]
    return up


def runs(rng, length):
    """Scales, arpeggios, trills, repeated notes, broken octaves, Alberti bass - fast."""
    h = human(rng)
    notes = []
    t = rng.uniform(0.2, 0.8)
    while t < length - 0.5:
        kind = rng.choice(['scale', 'arp', 'trill', 'repeat', 'chrom', 'brokenoct', 'alberti', 'scale'])
        dt = rng.uniform(0.055, 0.2)  # 5..18 notes per second
        tonic = int(rng.integers(28, 88))
        seq = []
        if kind == 'scale' or kind == 'chrom':
            up = scale_notes(tonic, int(rng.integers(1, 4)), rng.random() < 0.3, kind == 'chrom')
            seq = up + up[-2::-1] if rng.random() < 0.6 else (up if rng.random() < 0.5 else up[::-1])
        elif kind == 'arp':
            tri = [0, 3 if rng.random() < 0.4 else 4, 7]
            if rng.random() < 0.3:
                tri.append(10)
            up = [tonic + 12 * o + x for o in range(int(rng.integers(1, 4))) for x in tri]
            up.append(up[0] + 12 * (len(up) // len(tri)))
            seq = up + up[-2::-1]
        elif kind == 'trill':
            b = tonic + int(rng.choice([1, 2]))
            seq = [tonic if i % 2 == 0 else b for i in range(int(rng.integers(8, 24)))]
            dt = rng.uniform(0.055, 0.13)
        elif kind == 'repeat':
            seq = [tonic] * int(rng.integers(4, 16))
            dt = rng.uniform(0.07, 0.2)
        elif kind == 'brokenoct':
            seq = []
            for s in scale_notes(tonic, 1)[: int(rng.integers(4, 9))]:
                seq += [s, s + 12]
        else:  # alberti
            root = int(rng.integers(36, 60))
            third = 3 if rng.random() < 0.4 else 4
            seq = [root, root + 7, root + third, root + 7] * int(rng.integers(2, 6))
        both = rng.random() < 0.25 and kind in ('scale', 'arp', 'chrom')
        interval = int(rng.choice([-12, -24, -9, -16]))
        for m in seq:
            if t > length - 0.3:
                break
            tt = t + rng.normal(0, h['jit'] * 0.4)
            v = vel_of(rng, h)
            notes.append(dict(midi=clampm(m), t=tt, dur=dt * rng.uniform(0.7, 1.3), vel=v))
            if both and LO <= m + interval <= HI:
                notes.append(dict(midi=clampm(m + interval), t=tt + rng.uniform(-1, 1) * h['spread'], dur=dt * rng.uniform(0.7, 1.3), vel=vel_of(rng, h)))
            t += dt
        t += rng.uniform(0.2, 1.2)
    pedal = bar_pedal(rng, rng.uniform(1.0, 3.0), 0.0, length) if rng.random() < 0.15 else []
    # a held bass note or chord under the run
    if rng.random() < 0.3:
        for m in ms_hold(rng):
            notes.append(dict(midi=m, t=rng.uniform(0.1, 0.4), dur=rng.uniform(1.5, length), vel=vel_of(rng, h)))
    return notes, pedal


def ms_hold(rng):
    root = int(rng.integers(26, 55))
    return [root] if rng.random() < 0.5 else [root, root + 7] if rng.random() < 0.5 else [root, root + 12]


def pedal_texture(rng, length):
    """Broken chords over 2-3 octaves with the pedal held per harmony, sometimes a melody on top."""
    h = human(rng)
    notes, pedal = [], []
    t = rng.uniform(0.2, 0.8)
    dt = rng.uniform(0.1, 0.3)
    while t < length - 0.5:
        root = int(rng.integers(28, 60))
        shape = rng.choice([[0, 7, 12, 16, 19, 24], [0, 7, 16, 12, 19, 28], [0, 4, 7, 12, 16, 19], [0, 3, 7, 12, 15, 19], [0, 12, 19, 24, 28, 31]])
        bar = dt * len(shape) * int(rng.integers(1, 3))
        pedal.append((t + rng.uniform(0.01, 0.06), t + bar - rng.uniform(0.0, 0.05)))
        k = 0
        tt = t
        while tt < t + bar - 1e-6:
            m = root + shape[k % len(shape)]
            notes.append(dict(midi=clampm(m), t=tt + rng.normal(0, h['jit'] * 0.5), dur=dt * 0.9, vel=vel_of(rng, h, -0.05)))
            k += 1
            tt += dt
        if rng.random() < 0.6:  # melody notes on top
            for j in range(int(rng.integers(1, 4))):
                mt = t + j * bar / 3
                notes.append(dict(midi=clampm(root + 24 + int(rng.choice([4, 7, 9, 11, 12, 14, 16]))), t=mt, dur=bar / 3, vel=vel_of(rng, h, 0.1)))
        t += bar
    return notes, pedal


def soup(rng, length):
    """Random notes and chords anywhere on the keyboard (covers A0..C8 evenly)."""
    h = human(rng)
    rate = rng.uniform(1.5, 10)
    notes = []
    t = rng.uniform(0.1, 0.6)
    while t < length - 0.1:
        k = 1 if rng.random() < 0.55 else int(rng.integers(2, 7))
        if rng.random() < 0.5:
            ms = rng.integers(LO, HI + 1, k)
        else:
            c = rng.normal(64, 16)
            ms = np.clip(np.round(rng.normal(c, 7, k)), LO, HI).astype(int)
        spread = h['spread'] * (1 if k > 1 else 0)
        for m in set(int(x) for x in ms):
            notes.append(dict(midi=m, t=t + rng.uniform(-1, 1) * spread, dur=float(rng.exponential(0.5) + 0.05), vel=float(rng.uniform(0.1, 1.0))))
        t += rng.exponential(1.0 / rate) + 0.03
    pedal = bar_pedal(rng, rng.uniform(1.0, 3.0), 0.0, length) if rng.random() < 0.2 else []
    return notes, pedal


def extremes(rng, length):
    """Single notes and octaves at the edges of the keyboard (A0-C2, C6-C8)."""
    h = human(rng)
    notes = []
    t = rng.uniform(0.2, 0.6)
    while t < length - 0.2:
        m = int(rng.integers(21, 37)) if rng.random() < 0.5 else int(rng.integers(84, 109))
        ms = [m, m + 12] if rng.random() < 0.25 and m + 12 <= HI else [m]
        for x in ms:
            notes.append(dict(midi=x, t=t, dur=rng.uniform(0.1, 1.2), vel=vel_of(rng, h)))
        t += rng.uniform(0.15, 0.9)
    return notes, []


def silence(rng, length):
    return [], []


GENERATORS = dict(app=from_app, chords=block_chords, runs=runs, pedal=pedal_texture, soup=soup, extremes=extremes, silence=silence)
WEIGHTS = dict(app=0.34, chords=0.2, runs=0.14, pedal=0.08, soup=0.14, extremes=0.04, silence=0.06)


def sample(rng, length):
    names = list(WEIGHTS)
    p = np.array([WEIGHTS[k] for k in names])
    k = names[rng.choice(len(names), p=p / p.sum())]
    notes, pedal = GENERATORS[k](rng, length)
    notes = [n for n in notes if 0.02 <= n['t'] < length - 0.05 and LO <= n['midi'] <= HI]
    # no two strikes of one key closer than 45 ms (a real key can't repeat faster)
    notes.sort(key=lambda n: n['t'])
    last = {}
    keep = []
    for n in notes:
        if n['t'] - last.get(n['midi'], -1) >= 0.045:
            keep.append(n)
            last[n['midi']] = n['t']
    return k, keep, pedal
