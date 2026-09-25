// Synthetic but physically motivated recordings of the things a real piano room contains
// besides the piano: people talking, a TV/radio playing music, clapping, taps and knocks,
// footsteps, dishes and cutlery, fan / AC / mains hum, a barking dog, keyboard typing, plus
// room reverb for the piano itself. Everything is deterministic (seeded) and fast enough to
// generate minutes of audio in well under a second.
//
// Every generator returns a Float32Array at `sr` normalised to a documented reference level:
//  - continuous sounds (speech, tv, hum, bark) to RMS 1 over their *active* parts,
//  - impulsive sounds (claps, taps, footsteps, dishes, typing) to peak 1,
// so callers can mix them at a level relative to the piano with gainDb().
import { rng } from './synth-piano.js';

const TAU = 2 * Math.PI;

// ---------------------------------------------------------------------------------------------
// small DSP helpers
export class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = this.b2 = this.a1 = this.a2 = 0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  _set(b0, b1, b2, a0, a1, a2) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }
  bp(f, q, sr) {
    const w = (TAU * f) / sr,
      al = Math.sin(w) / (2 * q);
    return this._set(al, 0, -al, 1 + al, -2 * Math.cos(w), 1 - al);
  }
  lp(f, q, sr) {
    const w = (TAU * f) / sr,
      al = Math.sin(w) / (2 * q),
      c = Math.cos(w);
    return this._set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }
  hp(f, q, sr) {
    const w = (TAU * f) / sr,
      al = Math.sin(w) / (2 * q),
      c = Math.cos(w);
    return this._set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  // two-pole resonator with unity peak gain (formant filter)
  reson(f, bw, sr) {
    const r = Math.exp((-Math.PI * bw) / sr);
    const a1 = -2 * r * Math.cos((TAU * f) / sr),
      a2 = r * r;
    const g = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos((2 * TAU * f) / sr) + r * r);
    this.b0 = g;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = a1;
    this.a2 = a2;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  apply(buf) {
    for (let i = 0; i < buf.length; i++) buf[i] = this.run(buf[i]);
    return buf;
  }
}

export function gainDb(db) {
  return Math.pow(10, db / 20);
}

export function rms(x, from = 0, to = x.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

// RMS over the "active" part only: 20 ms blocks louder than -35 dB re. the loudest block.
export function activeRms(x, sr = 48000) {
  const n = Math.floor(sr * 0.02);
  const blocks = [];
  for (let i = 0; i + n <= x.length; i += n) blocks.push(rms(x, i, i + n));
  const mx = Math.max(...blocks, 1e-12);
  const act = blocks.filter((b) => b > mx * 0.0178);
  return Math.sqrt(act.reduce((a, b) => a + b * b, 0) / Math.max(1, act.length));
}

export function peak(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

function normalize(x, to) {
  const g = to > 0 ? 1 / to : 1;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

// out += src * gain (starting at `at` samples)
export function mixInto(out, src, gain = 1, at = 0) {
  const n = Math.min(src.length, out.length - at);
  for (let i = 0; i < n; i++) out[at + i] += src[i] * gain;
  return out;
}

function pinkNoise(n, rand) {
  const out = new Float32Array(n);
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
  }
  return out;
}

// Background room tone (air handling, distant traffic): pink noise, RMS 1.
export function roomTone(sec, { sr = 48000, seed = 1 } = {}) {
  const x = pinkNoise(Math.ceil(sec * sr), rng(seed));
  new Biquad().hp(40, 0.7, sr).apply(x);
  return normalize(x, rms(x));
}

// A bank of exponentially decaying sinusoids (struck objects: glass, wood, plates, glass screen).
function modal(out, at, modes, sr, amp = 1) {
  for (const m of modes) {
    const n = Math.min(out.length - at, Math.ceil(m.tau * 7 * sr));
    const w = (TAU * m.f) / sr;
    const d = Math.exp(-1 / (m.tau * sr));
    let e = amp * m.a;
    const ph = m.ph || 0;
    for (let i = 0; i < n; i++) {
      out[at + i] += e * Math.sin(w * i + ph);
      e *= d;
    }
  }
}

function noiseBurst(out, at, len, rand, { amp = 1, decay = len / 4, filter = null }) {
  const n = Math.min(out.length - at, len);
  const f = filter;
  for (let i = 0; i < n; i++) {
    let v = (rand() * 2 - 1) * amp * Math.exp(-i / decay);
    if (f) v = f.run(v);
    out[at + i] += v;
  }
}

// ---------------------------------------------------------------------------------------------
// Voice: glottal source (Rosenberg pulses with jitter/shimmer + breath noise) -> 5 formant
// resonators; syllables with consonant noise, intonation (declination + pitch accents + glides).
const VOWELS = [
  [730, 1090, 2440, 3400], // a
  [270, 2290, 3010, 3700], // i
  [300, 870, 2240, 3300], // u
  [530, 1840, 2480, 3500], // e
  [570, 840, 2410, 3300], // o
  [660, 1720, 2410, 3400], // ae
  [490, 1350, 1690, 3300], // er
  [440, 1020, 2240, 3300], // uh
];

// plan: [{t0, t1, f0(t)->Hz, amp(t)->0..1, vowel(t)->[F1..F4], voiced, noise(t)->0..1, noiseBand}]
function voiceRender(n, sr, rand, segs, { breath = 0.03, jitter = 0.01, shimmer = 0.06, formantScale = 1 } = {}) {
  const out = new Float32Array(n);
  const res = [new Biquad(), new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  const fric = new Biquad();
  let phase = 0,
    period = 0.008,
    ampJ = 1,
    prevG = 0;
  for (const s of segs) {
    const i0 = Math.max(0, Math.floor(s.t0 * sr)),
      i1 = Math.min(n, Math.floor(s.t1 * sr));
    for (let i = i0; i < i1; i++) {
      const t = i / sr;
      if ((i - i0) % 32 === 0) {
        const F = s.vowel(t);
        for (let k = 0; k < 4; k++) res[k].reson(F[k] * formantScale, 60 + F[k] * 0.06, sr);
        res[4].reson(4300 * formantScale, 300, sr);
        if (s.noiseBand) fric.bp(s.noiseBand, 1.2, sr);
      }
      const A = s.amp(t);
      let src = 0;
      if (s.voiced && A > 0) {
        const f0 = s.f0(t);
        phase += 1 / (period * sr);
        if (phase >= 1) {
          phase -= 1;
          period = (1 / f0) * (1 + (rand() * 2 - 1) * jitter);
          ampJ = 1 + (rand() * 2 - 1) * shimmer;
        }
        // Rosenberg pulse, open quotient 0.6
        const tp = 0.4,
          tn = 0.18;
        let g = 0;
        if (phase < tp) g = 0.5 * (1 - Math.cos((Math.PI * phase) / tp));
        else if (phase < tp + tn) g = Math.cos((Math.PI * (phase - tp)) / (2 * tn));
        const dg = g - prevG; // lip radiation
        prevG = g;
        src = dg * 8 * ampJ * A + (rand() * 2 - 1) * breath * A * (0.5 + g);
      }
      let v = src;
      let y = 0;
      for (let k = 0; k < 5; k++) y += res[k].run(v) * [1, 0.7, 0.45, 0.3, 0.15][k];
      if (s.noise) {
        const nz = s.noise(t);
        if (nz > 0) y += fric.run((rand() * 2 - 1) * nz * 0.6);
      }
      out[i] += y;
    }
  }
  return out;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Conversational speech: phrases of syllables with intonation.
export function speech(sec, { sr = 48000, seed = 1, speaker = 'mixed' } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const segs = [];
  let t = 0.1;
  let who = 0;
  while (t < sec - 0.5) {
    // Alternate speakers (a conversation): male ~110 Hz, female ~210 Hz, child ~280 Hz.
    const kinds = speaker === 'male' ? [0] : speaker === 'female' ? [1] : [0, 1, 0, 2];
    const kind = kinds[who++ % kinds.length];
    const base = [105, 205, 270][kind] * Math.pow(2, (rand() - 0.5) * 0.3);
    const phraseLen = 1.2 + rand() * 2.6;
    const t0 = t;
    const accents = [];
    for (let k = 0; k < 3; k++) accents.push({ at: t0 + rand() * phraseLen, h: (rand() * 5 - 1) / 12, w: 0.08 + rand() * 0.12 });
    const question = rand() < 0.25;
    const f0 = (tt) => {
      const x = (tt - t0) / phraseLen;
      let st = -2.5 * x; // declination, semitones
      for (const a of accents) st += 12 * a.h * Math.exp(-(((tt - a.at) / a.w) ** 2));
      if (question) st += 6 * smoothstep(0.8, 1, x);
      st += 0.4 * Math.sin(TAU * 3.1 * tt + kind);
      return base * Math.pow(2, st / 12);
    };
    let st = t0;
    let prevV = VOWELS[Math.floor(rand() * VOWELS.length)];
    while (st < t0 + phraseLen && st < sec - 0.3) {
      const cons = rand();
      const cLen = cons < 0.3 ? 0 : 0.03 + rand() * 0.07;
      const vLen = 0.07 + rand() * 0.17 * (rand() < 0.15 ? 2.5 : 1);
      const v = VOWELS[Math.floor(rand() * VOWELS.length)];
      const pv = prevV;
      const a = st,
        vb = st + cLen,
        e = vb + vLen;
      const stress = 0.35 + rand() * 0.65;
      const band = cons < 0.55 ? 5500 + rand() * 2000 : 2500 + rand() * 1500; // s / sh
      if (cLen > 0 && cons < 0.8) {
        // fricative or plosive burst (unvoiced)
        const plos = cons > 0.65;
        segs.push({
          t0: a,
          t1: vb + 0.01,
          voiced: false,
          amp: () => 0,
          f0,
          vowel: () => pv,
          noiseBand: plos ? 1500 : band,
          noise: (tt) => (plos ? 3 * Math.exp(-(tt - a) / 0.008) : 0.9 * smoothstep(a, a + 0.015, tt) * (1 - smoothstep(vb - 0.01, vb + 0.01, tt))) * stress,
        });
      }
      const rise = 0.012 + rand() * 0.03,
        fall = 0.03 + rand() * 0.05;
      // Each syllable has its own pitch movement (rise-fall, fall, rise); ~1 in 4 is flat
      // (hesitations, monotone speakers) which is the hardest case for a pitch detector.
      const flat = rand() < 0.25;
      const slope = flat ? 0 : (rand() * 2 - 1) * 4,
        curv = flat ? 0 : -rand() * 6;
      const sylF0 = (tt) => {
        const x = Math.max(-0.2, Math.min(1.2, (tt - vb) / vLen)) - 0.5;
        return f0(tt) * Math.pow(2, (slope * x + curv * (x * x - 0.08)) / 12);
      };
      segs.push({
        t0: cLen > 0 && cons >= 0.8 ? a : vb, // voiced consonant (m, n, l) extends voicing
        t1: e + fall,
        voiced: true,
        f0: sylF0,
        vowel: (tt) => {
          const x = smoothstep(vb, vb + 0.05, tt);
          return [0, 1, 2, 3].map((k) => pv[k] + (v[k] - pv[k]) * x);
        },
        amp: (tt) => {
          const s0 = cLen > 0 && cons >= 0.8 ? a : vb;
          const nasal = tt < vb ? 0.3 : 1;
          return stress * nasal * smoothstep(s0, s0 + rise, tt) * (1 - smoothstep(e - 0.005, e + fall, tt));
        },
      });
      prevV = v;
      st = e + (rand() < 0.3 ? 0.02 + rand() * 0.08 : 0);
    }
    t = st + 0.25 + rand() * 0.7; // pause between phrases / turns
  }
  const out = voiceRender(n, sr, rand, segs, { formantScale: 1 });
  new Biquad().hp(70, 0.7, sr).apply(out);
  return normalize(out, activeRms(out, sr));
}

// Singing voice following a melody (MIDI notes), with vibrato and portamento.
function singing(n, sr, rand, melody, { base = 0 } = {}) {
  const segs = [];
  for (let i = 0; i < melody.length; i++) {
    const m = melody[i];
    const prev = melody[i - 1];
    const f = (mm) => 440 * Math.pow(2, (mm + base - 69) / 12);
    const v = VOWELS[Math.floor(rand() * 6)];
    const t0 = m.t,
      t1 = m.t + m.dur;
    segs.push({
      t0,
      t1: t1 + 0.06,
      voiced: true,
      f0: (tt) => {
        const port = prev && m.t - (prev.t + prev.dur) < 0.05 ? 1 - smoothstep(t0, t0 + 0.06, tt) : 0;
        const st = prev ? port * (prev.midi - m.midi) : 0;
        const vib = 0.4 * smoothstep(t0 + 0.12, t0 + 0.3, tt) * Math.sin(TAU * 5.6 * (tt - t0));
        const scoop = -0.6 * (1 - smoothstep(t0, t0 + 0.05, tt));
        return f(m.midi) * Math.pow(2, (st + vib + scoop) / 12);
      },
      vowel: () => v,
      amp: (tt) => smoothstep(t0, t0 + 0.04, tt) * (1 - smoothstep(t1 - 0.02, t1 + 0.06, tt)) * (0.8 + 0.2 * Math.sin(TAU * 5.6 * (tt - t0))),
    });
  }
  return voiceRender(n, sr, rand, segs, { breath: 0.02, jitter: 0.004, shimmer: 0.03 });
}

// ---------------------------------------------------------------------------------------------
// TV / radio music through a small speaker: pad chords with vibrato, plucked bass, drums and a
// sung melody, plus talk segments between songs.
export function tv(sec, { sr = 48000, seed = 2, talk = true } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const out = new Float32Array(n);
  const bpm = 92 + Math.floor(rand() * 40);
  const beat = 60 / bpm;
  const key = 55 + Math.floor(rand() * 10);
  const prog = [
    [0, 4, 7],
    [9, 12, 16],
    [5, 9, 12],
    [7, 11, 14],
  ];
  const songLen = talk ? 14 : sec;
  const melody = [];
  const scale = [0, 2, 4, 5, 7, 9, 11, 12];
  for (let s0 = 0; s0 < sec; s0 += songLen + (talk ? 6 : 0)) {
    const s1 = Math.min(sec, s0 + songLen);
    // pad (strings / organ): sum of harmonics, slow attack, vibrato
    for (let bar = 0; s0 + bar * 4 * beat < s1; bar++) {
      const ch = prog[bar % 4];
      const tb = s0 + bar * 4 * beat;
      for (const iv of ch) {
        const f0 = 440 * Math.pow(2, (key + iv - 12 - 69) / 12);
        const i0 = Math.floor(tb * sr),
          len = Math.floor(4 * beat * sr);
        const vph = rand() * TAU;
        let ph = 0;
        for (let i = 0; i < len && i0 + i < n; i++) {
          const tt = i / sr;
          const env = smoothstep(0, 0.25, tt) * (1 - smoothstep(4 * beat - 0.3, 4 * beat, tt));
          const f = f0 * (1 + 0.006 * Math.sin(TAU * 5 * tt + vph));
          ph += (TAU * f) / sr;
          let v = 0;
          for (let h = 1; h <= 10; h++) v += Math.sin(h * ph) / (h * 1.3);
          out[i0 + i] += 0.05 * env * v;
        }
      }
      // plucked bass on beats 1 and 3
      for (const b of [0, 2]) {
        const f0 = 440 * Math.pow(2, (key + prog[bar % 4][0] - 24 - 69) / 12);
        const i0 = Math.floor((tb + b * beat) * sr);
        modal(
          out,
          i0,
          [1, 2, 3, 4].map((h) => ({ f: f0 * h, a: 0.12 / h ** 1.2, tau: 0.35 / h, ph: 0 })),
          sr,
        );
      }
      // drums
      for (let b = 0; b < 4; b++) {
        const tt = tb + b * beat;
        const i0 = Math.floor(tt * sr);
        if (b % 2 === 0) {
          // kick: pitch-swept sine
          let ph = 0;
          for (let i = 0; i < 0.25 * sr && i0 + i < n; i++) {
            const f = 45 + 90 * Math.exp(-i / (0.03 * sr));
            ph += (TAU * f) / sr;
            out[i0 + i] += 0.35 * Math.exp(-i / (0.09 * sr)) * Math.sin(ph);
          }
        } else {
          // snare: tone + band noise
          modal(out, i0, [{ f: 190, a: 0.12, tau: 0.05 }], sr);
          noiseBurst(out, i0, Math.floor(0.2 * sr), rand, { amp: 0.25, decay: 0.045 * sr, filter: new Biquad().bp(2500, 0.6, sr) });
        }
        for (const off of [0, 0.5]) {
          const j = Math.floor((tt + off * beat) * sr);
          noiseBurst(out, j, Math.floor(0.06 * sr), rand, { amp: 0.08, decay: 0.012 * sr, filter: new Biquad().hp(7000, 0.7, sr) });
        }
      }
    }
    // sung melody (on the scale, phrases of 4 bars)
    let tm = s0 + 2 * beat;
    let deg = 4;
    while (tm < s1 - 1) {
      const d = [0.5, 1, 1, 1.5, 2][Math.floor(rand() * 5)] * beat;
      deg = Math.max(0, Math.min(7, deg + Math.floor(rand() * 5) - 2));
      melody.push({ midi: key + scale[deg], t: tm, dur: d * 0.92 });
      tm += d;
      if (rand() < 0.12) tm += 2 * beat;
    }
  }
  const voc = singing(n, sr, rand, melody);
  mixInto(out, voc, 0.9 / Math.max(1e-9, activeRms(voc, sr)) * 0.12);
  if (talk) {
    // DJ / presenter between songs
    const sp = speech(sec, { sr, seed: seed + 100 });
    for (let s0 = songLen; s0 < sec; s0 += songLen + 6) {
      const i0 = Math.floor(s0 * sr),
        i1 = Math.min(n, Math.floor((s0 + 6) * sr));
      for (let i = i0; i < i1; i++) out[i] += sp[i] * 0.12;
    }
  }
  // small TV speaker: band-limited, slightly driven
  new Biquad().hp(140, 0.8, sr).apply(out);
  new Biquad().lp(7500, 0.7, sr).apply(out);
  const pk = peak(out);
  for (let i = 0; i < n; i++) out[i] = Math.tanh((1.5 * out[i]) / pk);
  return normalize(out, activeRms(out, sr));
}

// ---------------------------------------------------------------------------------------------
// Hand claps: single claps, applause-like bursts, and clapping along to a beat.
export function claps(sec, { sr = 48000, seed = 3 } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const out = new Float32Array(n);
  const clap = (t, a) => {
    const i0 = Math.floor(t * sr);
    const fc = 900 + rand() * 1600;
    for (let k = 0; k < 3; k++) {
      // several micro-bursts (the hands' air pocket collapses in stages)
      const j = i0 + Math.floor(k * (0.002 + rand() * 0.006) * sr);
      noiseBurst(out, j, Math.floor(0.05 * sr), rand, { amp: a * (1 - k * 0.25), decay: (0.004 + rand() * 0.006) * sr, filter: new Biquad().bp(fc * (0.8 + rand() * 0.4), 1.2, sr) });
    }
    modal(out, i0, [{ f: 180 + rand() * 250, a: a * 0.3, tau: 0.012 }], sr);
  };
  let t = 0.3;
  while (t < sec - 1) {
    const mode = rand();
    if (mode < 0.4) {
      // clapping along to a beat
      const period = 0.4 + rand() * 0.4;
      const cnt = 4 + Math.floor(rand() * 8);
      for (let i = 0; i < cnt && t < sec - 0.2; i++, t += period * (0.97 + rand() * 0.06)) clap(t, 0.6 + rand() * 0.4);
    } else if (mode < 0.7) {
      clap(t, 0.7 + rand() * 0.3);
      t += 0.2;
    } else {
      // applause: 2 s of dense random claps
      const end = Math.min(sec - 0.2, t + 1.5 + rand());
      for (; t < end; t += 0.02 + rand() * 0.07) clap(t, 0.2 + rand() * 0.5);
    }
    t += 0.8 + rand() * 2.5;
  }
  return normalize(out, peak(out));
}

// Taps on the iPad glass (UI taps!), pencil taps on the music stand, knuckle knocks on the
// piano lid or a door.
export function taps(sec, { sr = 48000, seed = 4 } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const out = new Float32Array(n);
  let t = 0.3;
  while (t < sec - 0.5) {
    const kind = rand();
    const i0 = Math.floor(t * sr);
    const a = 0.5 + rand() * 0.5;
    if (kind < 0.45) {
      // finger tap on the iPad screen: structure-borne, very close to the mic
      const base = 150 + rand() * 120;
      modal(
        out,
        i0,
        [1, 2.7, 6.1, 11.3, 19].map((r, k) => ({ f: base * r * (0.9 + rand() * 0.2), a: a * [0.5, 0.6, 0.4, 0.25, 0.15][k], tau: 0.004 + rand() * 0.012, ph: rand() * 6 })),
        sr,
      );
      noiseBurst(out, i0, Math.floor(0.004 * sr), rand, { amp: a * 0.5, decay: 0.0008 * sr });
      t += rand() < 0.3 ? 0.12 + rand() * 0.2 : 0; // double taps
    } else if (kind < 0.7) {
      // knuckle knock on wood (piano lid / door): 1-3 knocks
      const cnt = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < cnt; k++) {
        const j = i0 + Math.floor(k * (0.15 + rand() * 0.06) * sr);
        const base = 90 + rand() * 160;
        modal(
          out,
          j,
          [1, 1.9, 3.3, 5.2, 8.1].map((r, q) => ({ f: base * r * (0.92 + rand() * 0.16), a: a * [0.8, 0.6, 0.4, 0.3, 0.2][q], tau: 0.012 + rand() * 0.04 })),
          sr,
        );
        noiseBurst(out, j, Math.floor(0.003 * sr), rand, { amp: a * 0.4, decay: 0.0007 * sr });
      }
    } else {
      // pencil / pen tap on the music stand
      const base = 900 + rand() * 1500;
      modal(
        out,
        i0,
        [1, 2.4, 4.3].map((r) => ({ f: base * r, a: a * 0.4, tau: 0.006 + rand() * 0.02 })),
        sr,
      );
      noiseBurst(out, i0, Math.floor(0.002 * sr), rand, { amp: a * 0.6, decay: 0.0005 * sr });
    }
    t += 0.25 + rand() * 1.6;
  }
  return normalize(out, peak(out));
}

// Footsteps on a wooden floor: heel thump (low modes) + toe click, walks of several steps.
export function footsteps(sec, { sr = 48000, seed = 5 } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const out = new Float32Array(n);
  let t = 0.4;
  while (t < sec - 1) {
    const steps = 4 + Math.floor(rand() * 8);
    const period = 0.45 + rand() * 0.2;
    const heavy = 0.5 + rand() * 0.5;
    for (let s = 0; s < steps && t < sec - 0.3; s++, t += period * (0.93 + rand() * 0.14)) {
      const i0 = Math.floor(t * sr);
      const a = heavy * (0.7 + rand() * 0.3);
      modal(
        out,
        i0,
        [1, 1.6, 2.5, 3.8].map((r, k) => ({ f: (45 + rand() * 40) * r, a: a * [1, 0.6, 0.35, 0.2][k], tau: 0.03 + rand() * 0.05 })),
        sr,
      );
      noiseBurst(out, i0, Math.floor(0.03 * sr), rand, { amp: a * 0.5, decay: 0.006 * sr, filter: new Biquad().lp(400, 0.7, sr) });
      noiseBurst(out, i0 + Math.floor((0.05 + rand() * 0.04) * sr), Math.floor(0.01 * sr), rand, { amp: a * 0.15, decay: 0.002 * sr, filter: new Biquad().bp(2000, 1, sr) });
    }
    t += 1 + rand() * 4;
  }
  return normalize(out, peak(out));
}

// Dishes and cutlery: glass/ceramic rings (inharmonic modes, long decay), cutlery on plates
// (short bright clinks), clatter bursts.
export function dishes(sec, { sr = 48000, seed = 6 } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const out = new Float32Array(n);
  let t = 0.3;
  const clink = (tt, kind, a) => {
    const i0 = Math.floor(tt * sr);
    if (kind === 'glass') {
      const f1 = 1100 + rand() * 2400;
      modal(
        out,
        i0,
        [1, 2.32, 4.25, 6.63].map((r, k) => ({ f: f1 * r * (0.98 + rand() * 0.04), a: a * [1, 0.5, 0.3, 0.15][k], tau: (0.25 + rand() * 0.6) / (1 + k * 0.7), ph: rand() * 6 })),
        sr,
      );
    } else if (kind === 'plate') {
      const f1 = 600 + rand() * 1600;
      modal(
        out,
        i0,
        [1, 1.71, 2.9, 3.4, 4.8, 6.2].map((r, k) => ({ f: f1 * r * (0.97 + rand() * 0.06), a: a * (0.9 - k * 0.12), tau: 0.03 + rand() * 0.12, ph: rand() * 6 })),
        sr,
      );
    } else {
      // cutlery: bright, short
      const f1 = 2500 + rand() * 4000;
      modal(
        out,
        i0,
        [1, 1.37, 2.1, 2.9].map((r, k) => ({ f: f1 * r, a: a * (0.8 - k * 0.15), tau: 0.02 + rand() * 0.08, ph: rand() * 6 })),
        sr,
      );
    }
    noiseBurst(out, i0, Math.floor(0.004 * sr), rand, { amp: a * 0.3, decay: 0.001 * sr, filter: new Biquad().hp(2000, 0.7, sr) });
  };
  while (t < sec - 1) {
    const r = rand();
    if (r < 0.5) {
      // clatter: several clinks
      const cnt = 2 + Math.floor(rand() * 6);
      for (let k = 0; k < cnt; k++) clink(t + k * (0.04 + rand() * 0.15), ['glass', 'plate', 'cutlery'][Math.floor(rand() * 3)], 0.3 + rand() * 0.7);
    } else clink(t, ['glass', 'plate', 'cutlery'][Math.floor(rand() * 3)], 0.5 + rand() * 0.5);
    t += 0.8 + rand() * 3;
  }
  return normalize(out, peak(out));
}

// Fan / air conditioner / fridge with mains hum. `mains` 50 or 60 Hz; the compressor switches
// on and off smoothly (no attack), the fan has blade-pass tones and wobble.
export function hum(sec, { sr = 48000, seed = 7, mains = 60 } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const out = pinkNoise(n, rand);
  new Biquad().bp(500, 0.4, sr).apply(out);
  for (let i = 0; i < n; i++) out[i] *= 0.7;
  const harm = [];
  for (let h = 1; h <= 16; h++) harm.push({ f: mains * h, a: (h === 2 ? 1 : h % 2 ? 0.5 : 0.25) / h ** 0.7 * (0.5 + rand()), ph: rand() * TAU });
  const blade = 18 + rand() * 12;
  const bladeH = [5, 10, 15].map((h) => ({ f: blade * h, a: 0.25 / (h / 5), ph: rand() * TAU }));
  const inc = TAU / sr;
  let onEnv = 0;
  let state = 1,
    next = 3 + rand() * 6;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t > next) {
      state = 1 - state;
      next = t + 4 + rand() * 8;
    }
    onEnv += (state - onEnv) * (1 / (0.8 * sr)); // ~1 s fade (compressor spin-up)
    let v = 0;
    for (const h of harm) v += h.a * Math.sin(TAU * h.f * t + h.ph);
    const wob = 1 + 0.15 * Math.sin(TAU * 0.7 * t);
    let b = 0;
    const fm = 1 + 0.004 * Math.sin(TAU * 0.7 * t); // fan speed wobble
    for (const h of bladeH) {
      h.ph += inc * h.f * fm;
      b += h.a * Math.sin(h.ph);
    }
    out[i] = out[i] * (0.6 + 0.4 * onEnv) + 0.35 * v * (0.3 + 0.7 * onEnv) + 0.3 * b * wob;
  }
  return normalize(out, rms(out));
}

// Dog barks: harsh voiced bursts with a rising-falling pitch contour, in groups.
export function bark(sec, { sr = 48000, seed = 8 } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const segs = [];
  let t = 0.3;
  while (t < sec - 1) {
    const cnt = 1 + Math.floor(rand() * 4);
    const big = rand() < 0.5;
    const base = big ? 350 + rand() * 250 : 650 + rand() * 400;
    for (let k = 0; k < cnt && t < sec - 0.4; k++) {
      const t0 = t,
        d = 0.1 + rand() * 0.15;
      const peakT = t0 + d * (0.25 + rand() * 0.3);
      const F = big ? [600, 1300, 2500, 3600] : [900, 1900, 3200, 4200];
      segs.push({
        t0,
        t1: t0 + d + 0.03,
        voiced: true,
        f0: (tt) => base * (0.75 + 0.45 * Math.exp(-(((tt - peakT) / (d * 0.4)) ** 2))),
        vowel: () => F,
        amp: (tt) => smoothstep(t0, t0 + 0.008, tt) * (1 - smoothstep(t0 + d * 0.5, t0 + d + 0.03, tt)),
        noiseBand: 2000,
        noise: (tt) => 0.5 * smoothstep(t0, t0 + 0.005, tt) * (1 - smoothstep(t0 + d * 0.3, t0 + d, tt)),
      });
      t += d + 0.15 + rand() * 0.35;
    }
    t += 1.5 + rand() * 5;
  }
  const out = voiceRender(n, sr, rand, segs, { breath: 0.25, jitter: 0.05, shimmer: 0.2 });
  return normalize(out, activeRms(out, sr));
}

// Keyboard typing: press + bottom-out clicks, bursts of words, louder spacebar.
export function typing(sec, { sr = 48000, seed = 9 } = {}) {
  const rand = rng(seed);
  const n = Math.ceil(sec * sr);
  const out = new Float32Array(n);
  let t = 0.3;
  while (t < sec - 0.5) {
    const word = 2 + Math.floor(rand() * 8);
    for (let k = 0; k <= word && t < sec - 0.2; k++) {
      const space = k === word;
      const a = (space ? 1 : 0.5 + rand() * 0.4) * (0.8 + rand() * 0.2);
      const i0 = Math.floor(t * sr);
      const f = space ? 1200 + rand() * 500 : 2500 + rand() * 2000;
      modal(out, i0, [{ f, a: a * 0.4, tau: 0.004 + rand() * 0.004 }, { f: f * 1.8, a: a * 0.2, tau: 0.003 }], sr);
      noiseBurst(out, i0, Math.floor(0.004 * sr), rand, { amp: a * 0.6, decay: 0.0007 * sr, filter: new Biquad().hp(800, 0.7, sr) });
      const j = i0 + Math.floor((0.025 + rand() * 0.04) * sr);
      noiseBurst(out, j, Math.floor(0.004 * sr), rand, { amp: a * 0.35, decay: 0.0008 * sr, filter: new Biquad().hp(1500, 0.7, sr) });
      t += 0.08 + rand() * 0.18;
    }
    t += 0.2 + rand() * (rand() < 0.2 ? 3 : 0.8);
  }
  return normalize(out, peak(out));
}

// ---------------------------------------------------------------------------------------------
// Room reverb (8-line feedback delay network with frequency dependent decay). Returns a new
// buffer: dry + wet.
export function reverb(x, { sr = 48000, rt60 = 0.7, wet = 0.35, predelay = 0.012, seed = 11 } = {}) {
  const rand = rng(seed);
  const lens = [1031, 1327, 1523, 1777, 2011, 2293, 2531, 2803].map((l) => Math.round((l * sr) / 48000 * (0.9 + rand() * 0.2)));
  const lines = lens.map((l) => new Float32Array(l));
  const idx = new Int32Array(8);
  const g = lens.map((l) => Math.pow(10, (-3 * l) / (sr * rt60)));
  const lp = new Float64Array(8);
  const damp = 0.35;
  const pd = Math.round(predelay * sr);
  const out = new Float32Array(x.length);
  const v = new Float64Array(8);
  for (let i = 0; i < x.length; i++) {
    const inp = i >= pd ? x[i - pd] : 0;
    let sum = 0;
    for (let k = 0; k < 8; k++) {
      v[k] = lines[k][idx[k]];
      sum += v[k];
    }
    const hh = (2 / 8) * sum; // Householder
    let y = 0;
    for (let k = 0; k < 8; k++) {
      let s = (v[k] - hh) * g[k];
      lp[k] += (1 - damp) * (s - lp[k]);
      s = lp[k];
      lines[k][idx[k]] = s + inp * 0.35;
      idx[k] = (idx[k] + 1) % lens[k];
      y += v[k] * (k % 2 ? -1 : 1);
    }
    out[i] = x[i] + wet * y * 0.35;
  }
  return out;
}

export const NOISES = { speech, tv, claps, taps, footsteps, dishes, hum, bark, typing };

// Level of each noise type in a real practice room, in dB relative to a piano played mezzo-forte
// with the iPad on the music stand (see noise-eval.js for how the piano reference is measured).
// `realistic`: what is normally around; `loud`: someone/something unusually close or loud.
// Continuous sounds are relative to piano RMS; impulsive ones relative to the piano's peak.
export const LEVELS = {
  speech: { realistic: -20, loud: -10, ref: 'rms' }, // conversation across the room / right next to you
  tv: { realistic: -20, loud: -10, ref: 'rms' },
  claps: { realistic: -6, loud: 0, ref: 'peak' },
  taps: { realistic: -6, loud: 0, ref: 'peak' }, // tapping the iPad screen is structure-borne: loud
  footsteps: { realistic: -12, loud: -6, ref: 'peak' },
  dishes: { realistic: -14, loud: -6, ref: 'peak' },
  hum: { realistic: -35, loud: -22, ref: 'rms' },
  bark: { realistic: -12, loud: -3, ref: 'rms' },
  typing: { realistic: -18, loud: -10, ref: 'peak' },
};
