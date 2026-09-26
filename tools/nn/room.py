"""Rooms and microphones for the training clips (16 kHz).

reverb(): synthetic room impulse responses - direct sound, a few early reflections and an
exponentially decaying noise tail whose treble dies faster than its bass (rt60 0.15-1.2 s), at
a random direct-to-reverberant ratio.
mic_eq(): the iPad microphone and its placement - a 60-150 Hz high-pass, random peaking /
shelving EQ, sometimes a top-end roll-off. Applied at training time (train.py) in the frequency
domain to the mix of piano and noise.
"""
import numpy as np
from scipy.signal import butter, sosfilt, oaconvolve

SR = 16000


def room_ir(rng, rt60=None):
    rt60 = rng.uniform(0.15, 1.2) if rt60 is None else rt60
    n = int(SR * min(2.0, rt60 * 1.1 + 0.05))
    t = np.arange(n) / SR
    ir = np.zeros(n, dtype=np.float64)
    ir[0] = 1.0
    for _ in range(int(rng.integers(3, 10))):
        d = int(rng.uniform(0.002, 0.03) * SR)
        ir[d] += rng.uniform(0.15, 0.6) * rng.choice([-1, 1])
    # late tail in three bands with their own decay
    pre = rng.uniform(0.005, 0.02)
    tail = np.zeros(n)
    for (lo, hi), k in (((None, 500), rng.uniform(1.0, 1.4)), ((500, 3000), 1.0), ((3000, None), rng.uniform(0.35, 0.8))):
        w = rng.normal(0, 1, n)
        if lo is None:
            sos = butter(2, hi / (SR / 2), 'low', output='sos')
        elif hi is None:
            sos = butter(2, lo / (SR / 2), 'high', output='sos')
        else:
            sos = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos')
        tail += sosfilt(sos, w) * np.exp(-6.9 * t / (rt60 * k))
    tail *= np.clip((t - pre) / 0.01, 0, 1)
    drr = rng.uniform(-3, 12)  # direct-to-reverberant ratio, dB
    e_dir = np.sum(ir ** 2)
    tail *= np.sqrt(e_dir / (np.sum(tail ** 2) + 1e-12) * 10 ** (-drr / 10))
    return (ir + tail).astype(np.float32), rt60


def reverb(x, rng, rt60=None):
    ir, rt = room_ir(rng, rt60)
    y = oaconvolve(x, ir)[: len(x)]
    return y.astype(np.float32), rt


def mic_eq_curve(rng, nbins, sr=SR):
    """Random magnitude response (linear) at nbins frequencies 0..sr/2."""
    f = np.linspace(0, sr / 2, nbins)
    db = np.zeros(nbins)
    # high-pass (iPad voice path / small capsule), 2nd or 4th order Butterworth magnitude
    fc = rng.uniform(60, 150)
    order = rng.choice([2, 4])
    db += 10 * np.log10(1 / (1 + (fc / np.maximum(f, 1)) ** (2 * order)))
    for _ in range(int(rng.integers(1, 5))):
        f0 = np.exp(rng.uniform(np.log(100), np.log(7000)))
        g = rng.uniform(-8, 8)
        q = rng.uniform(0.5, 3.0)
        bw = f0 / q
        db += g / (1 + ((f - f0) / (bw / 2)) ** 2)
    if rng.random() < 0.5:  # tilt / shelf
        db += rng.uniform(-4, 4) * np.log2(np.maximum(f, 50) / 1000) / 3
    if rng.random() < 0.3:  # top-end roll-off
        fl = rng.uniform(4000, 7500)
        db += 10 * np.log10(1 / (1 + (f / fl) ** 4))
    return (10 ** (db / 20)).astype(np.float32)
