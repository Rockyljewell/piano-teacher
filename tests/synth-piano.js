// A crude but realistic-enough additive piano model used to test the transcriber offline:
// inharmonic partials, per-partial decay, weak fundamentals in the bass, hammer noise and
// background room noise. Deterministic via a seeded RNG.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function B(midi) {
  if (midi >= 40) return Math.pow(10, -3.9 + 0.028 * (midi - 40));
  return Math.pow(10, -3.9 - 0.01 * (midi - 40));
}

// notes: [{midi, t, dur, vel}]
export function renderPiano(notes, { sr = 48000, length, seed = 7, noise = 0.0015, tuningCents = 0, bScale = 1 } = {}) {
  const rand = rng(seed);
  const end = length ?? Math.max(...notes.map((n) => n.t + n.dur)) + 0.5;
  const N = Math.ceil(end * sr);
  const out = new Float32Array(N);
  for (const n of notes) {
    const f0 = 440 * Math.pow(2, (n.midi - 69 + tuningCents / 100) / 12);
    const b = B(n.midi) * bScale * (0.7 + rand() * 0.8);
    const vel = n.vel ?? 0.6;
    const tau0 = Math.max(0.5, 4.5 * Math.pow(2, -(n.midi - 36) / 18));
    const p = 0.8 + rand() * 0.7;
    const start = Math.floor(n.t * sr);
    const relEnd = Math.floor((n.t + n.dur) * sr);
    const stop = Math.min(N, relEnd + Math.floor(0.12 * sr));
    const partials = [];
    for (let h = 1; h < 40; h++) {
      const f = h * f0 * Math.sqrt(1 + b * h * h);
      if (f > sr * 0.45) break;
      let a = Math.pow(h, -p) * Math.pow(10, (rand() - 0.5) * 0.6);
      if (n.midi < 45 && h === 1) a *= 0.15 + rand() * 0.3;
      if (n.midi < 40 && h === 2) a *= 0.5;
      // brighter when louder
      a *= Math.pow(vel, 0.3 + 0.05 * h);
      const tau = tau0 / (1 + 0.25 * h);
      partials.push({ w: (2 * Math.PI * f) / sr, a, tau, ph: rand() * 6.283 });
    }
    const amp = 0.25 * vel;
    for (let i = start; i < stop; i++) {
      const tt = (i - start) / sr;
      const att = Math.min(1, tt / 0.003);
      let rel = 1;
      if (i > relEnd) rel = Math.exp(-((i - relEnd) / sr) / 0.03);
      let s = 0;
      for (const q of partials) {
        const env = 0.75 * Math.exp(-tt / q.tau) + 0.25 * Math.exp(-tt / (q.tau * 5));
        s += q.a * env * Math.sin(q.w * (i - start) + q.ph);
      }
      out[i] += amp * att * rel * s;
    }
    // hammer thump
    let lp = 0;
    const hl = Math.floor(0.015 * sr);
    for (let i = 0; i < hl && start + i < N; i++) {
      lp += 0.3 * ((rand() * 2 - 1) - lp);
      out[start + i] += amp * 0.25 * lp * Math.exp(-i / (0.004 * sr));
    }
  }
  // pink-ish background noise + a little hum
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < N; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] += noise * (b0 + b1 + b2 + w * 0.1848) * 0.3 + noise * 0.3 * Math.sin((2 * Math.PI * 60 * i) / sr);
  }
  return out;
}

export function toWav(samples, sr) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
