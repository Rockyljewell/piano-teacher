// Real-piano sampler for offline tests, built on the Salamander Grand Piano samples
// (Alexander Holm, CC-BY 3.0) that `node tests/corpus-fetch.js` downloads into tests/.cache/.
//
//  - one sample every minor third; in-between notes are pitch shifted by +-1 semitone by
//    resampling (cubic interpolation),
//  - velocity -> gain and a gentle low-pass (soft notes are darker),
//  - note-off applies the damper (faster in the treble, none above F6 like a real piano),
//  - optional sustain pedal (notes ring until the pedal is released), sympathetic resonance
//    of undamped strings, pedal thumps, room reverb and background room noise.
//
// loadCorpus() returns null when the cache is missing so tests can skip gracefully.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from './synth-piano.js';
import { reverb as fdnReverb, Biquad } from './noise-sim.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.join(here, '.cache');

let cached;
export function loadCorpus() {
  if (cached !== undefined) return cached;
  cached = null;
  const manFile = path.join(CACHE, 'manifest.json');
  if (!fs.existsSync(manFile)) return null;
  try {
    const man = JSON.parse(fs.readFileSync(manFile, 'utf8'));
    const piano = new Map();
    const speech = [];
    const radio = [];
    for (const [key, v] of Object.entries(man)) {
      const f = path.join(CACHE, 'pcm', v.file);
      if (!fs.existsSync(f)) continue;
      const b = fs.readFileSync(f);
      const data = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
      if (v.kind === 'piano') piano.set(v.midi, prepSample(data));
      else if (v.kind === 'speech') speech.push({ key, data });
      else if (v.kind === 'radio') radio.push({ key, data });
    }
    if (piano.size < 30) return null;
    cached = { piano, speech, radio, sr: 48000 };
  } catch {
    cached = null;
  }
  return cached;
}

export function hasCorpus() {
  return !!loadCorpus();
}

// Trim the leading silence so the attack sits at t = 0 (+1 ms).
function prepSample(x) {
  let pk = 0;
  for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  let first = 0;
  for (let i = 0; i < x.length; i++)
    if (Math.abs(x[i]) > pk * 0.03) {
      first = i;
      break;
    }
  const start = Math.max(0, first - 48);
  return { data: x.subarray(start), peak: pk };
}

function sampleFor(corpus, midi) {
  const s = Math.max(21, Math.min(108, 21 + 3 * Math.round((midi - 21) / 3)));
  return { s, sm: corpus.piano.get(s) };
}

// notes: [{midi, t, dur, vel}]
// opts.pedal: true (held throughout) or [[down, up], ...] in seconds.
export function renderSampled(notes, opts = {}) {
  const corpus = loadCorpus();
  if (!corpus) throw new Error('corpus missing: run node tests/corpus-fetch.js');
  const {
    sr = 48000,
    seed = 7,
    noise = 0.0015,
    tuningCents = 0,
    pedal = null,
    sympathetic = pedal ? 1 : 0,
    pedalThumps = !!pedal,
    reverb = null,
  } = opts;
  const rand = rng(seed);
  const end = opts.length ?? Math.max(...notes.map((n) => n.t + n.dur)) + 1.0;
  const N = Math.ceil(end * sr);
  const out = new Float32Array(N);
  const pedals = pedal === true ? [[-1, 1e9]] : pedal || [];
  const pedalUp = (t) => {
    for (const [d, u] of pedals) if (t >= d && t < u) return u;
    return t;
  };

  const voice = (midi, t0, off, gain, { attack = 0, vel = 0.7 } = {}) => {
    const { s, sm } = sampleFor(corpus, midi);
    const x = sm.data;
    const step = Math.pow(2, (midi - s + tuningCents / 100) / 12) * (48000 / sr);
    const i0 = Math.round(t0 * sr);
    const iOff = Math.round(off * sr);
    const damped = midi < 89; // no dampers above F6
    const tauD = 0.06 + (midi < 60 ? (0.25 * (60 - midi)) / 39 : 0);
    const dDec = Math.exp(-1 / (tauD * sr));
    // darker when soft: one-pole low-pass
    const fc = Math.min(18000, 1200 * Math.pow(2, vel * 4.5));
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    let lp = 0;
    let damp = 1;
    let pos = 0;
    const atk = attack > 0 ? Math.exp(-1 / (attack * sr)) : 0;
    let env = attack > 0 ? 0 : 1;
    for (let i = i0; i < N; i++) {
      const k = Math.floor(pos);
      if (k + 2 >= x.length) break;
      const f = pos - k;
      const xm = k > 0 ? x[k - 1] : x[k];
      const x0 = x[k],
        x1 = x[k + 1],
        x2 = x[k + 2];
      // Catmull-Rom
      const v = x0 + 0.5 * f * (x1 - xm + f * (2 * xm - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - xm)));
      lp += a * (v - lp);
      if (attack > 0) env = 1 - (1 - env) * atk;
      if (damped && i >= iOff) {
        damp *= dDec;
        if (damp < 1e-4) break;
      }
      if (i >= 0) out[i] += lp * gain * damp * env;
      pos += step;
    }
  };

  for (const n of notes) {
    const vel = n.vel ?? 0.6;
    const gain = Math.pow(vel / 0.8, 1.7) * (0.9 + rand() * 0.2);
    const off = pedalUp(n.t + n.dur);
    voice(n.midi, n.t, off, gain, { vel });
    if (sympathetic && off > n.t + n.dur + 1e-6) {
      // Undamped strings whose partials coincide with the struck note's partials resonate.
      [
        [12, -30],
        [19, -36],
        [24, -38],
        [-12, -40],
      ].forEach(([iv, db]) => {
        const m = n.midi + iv;
        if (m < 21 || m > 108) return;
        voice(m, n.t, off, gain * Math.pow(10, db / 20) * sympathetic, { attack: 0.05, vel: vel * 0.6 });
      });
    }
  }
  if (pedalThumps) {
    // Pedal mechanism: a low thump and a damper "whoosh" on every press / release.
    for (const [d, u] of pedals) {
      for (const [t, a] of [
        [d, 0.02],
        [u, 0.012],
      ]) {
        if (t < 0 || t > end) continue;
        const i0 = Math.floor(t * sr);
        const f = 55 + rand() * 30;
        const lpf = new Biquad().lp(900, 0.7, sr);
        for (let i = 0; i < 0.25 * sr && i0 + i < N; i++) {
          const tt = i / sr;
          out[i0 + i] += a * Math.exp(-tt / 0.05) * Math.sin(2 * Math.PI * f * tt) + lpf.run((rand() * 2 - 1) * a * 0.4 * Math.exp(-tt / 0.08));
        }
      }
    }
  }
  let y = out;
  if (reverb) y = fdnReverb(out, { sr, ...reverb });
  if (noise > 0) {
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < N; i++) {
      const w = rand() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      y[i] += noise * (b0 + b1 + b2 + w * 0.1848) * 0.3;
    }
  }
  return y;
}

// A real recording (speech / radio) from the corpus, looped to `sec` seconds, resampled to sr.
export function corpusNoise(kind, idx, sec, { sr = 48000 } = {}) {
  const c = loadCorpus();
  if (!c) return null;
  const list = c[kind];
  if (!list || !list.length) return null;
  const src = list[idx % list.length].data;
  const N = Math.ceil(sec * sr);
  const out = new Float32Array(N);
  const step = 48000 / sr;
  for (let i = 0; i < N; i++) {
    const p = (i * step) % (src.length - 2);
    const k = Math.floor(p);
    out[i] = src[k] + (src[k + 1] - src[k]) * (p - k);
  }
  return out;
}
