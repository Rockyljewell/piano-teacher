// Multi-sample piano sampler for the listening benchmark (tests/bench-listen.js).
//
// Instruments:
//  - salamander: the Salamander grand from tests/corpus-fetch.js (one velocity layer, a sample
//    every minor third). In-sample: the listener's confidence model was fitted on it.
//  - upright:    Upright Piano KW (Kawai upright recorded in a living room), 2 velocity layers.
//  - ydp:        YDP grand (Yamaha Disklavier Pro), 5 velocity layers.
// The last two are held out (never used for fitting) and come from tests/bench-fetch.js.
//
// Rendering (same physics as tests/corpus-piano.js, generalised):
//  - the region is picked by key and velocity layer; notes between samples are pitch shifted
//    from the nearest sample by resampling (Catmull-Rom),
//  - the samples of every layer are level-normalised, so loudness follows the velocity curve of
//    corpus-piano.js ((vel / 0.8)^1.7) and the layer only gives the timbre; single-layer
//    instruments also get darker when soft (one-pole low-pass),
//  - note-off applies the damper (slower in the bass; none above F6, those strings ring on),
//  - sustain pedal: note-offs wait for the pedal to lift; undamped strings resonate
//    sympathetically; pedal thumps,
//  - each instrument is scaled so a mezzo-forte reference passage has the same active RMS as
//    noise-eval's PIANO_REF, so noise levels relative to "the piano" mean the same for all.
import fs from 'node:fs';
import path from 'node:path';
import { rng } from './synth-piano.js';
import { loadCorpus } from './corpus-piano.js';
import { benchManifest, BENCH } from './bench-fetch.js';
import { Biquad, activeRms } from './noise-sim.js';

export const INSTRUMENTS = ['salamander', 'upright', 'ydp'];
export const HELD_OUT = ['upright', 'ydp'];
export const PIANO_REF_RMS = 0.0415; // noise-eval.js PIANO_REF.rms

// Trim leading silence so the attack sits at t = 0 (+1 ms).
function trim(x, sr) {
  let pk = 0;
  for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  let first = 0;
  for (let i = 0; i < x.length; i++)
    if (Math.abs(x[i]) > pk * 0.03) {
      first = i;
      break;
    }
  return x.subarray(Math.max(0, first - Math.round(sr * 0.001)));
}

const cache = new Map();
export function hasInstrument(name) {
  return !!loadInstrument(name);
}

export function loadInstrument(name) {
  if (cache.has(name)) return cache.get(name);
  let inst = null;
  if (name === 'salamander') {
    const c = loadCorpus();
    if (c) {
      const regions = [];
      for (const [midi, s] of c.piano) regions.push({ lokey: midi - 1, hikey: midi + 1, lovel: 0, hivel: 127, key: midi, tune: 0, cutoff: 0, data: s.data, sr: 48000 });
      inst = { name, regions, layers: 1 };
    }
  } else {
    const man = benchManifest();
    const spec = man && man.instruments && man.instruments[name];
    if (spec) {
      const files = new Map();
      const regions = [];
      let ok = true;
      for (const r of spec.regions) {
        const f = path.join(BENCH, r.file);
        if (!fs.existsSync(f)) {
          ok = false;
          break;
        }
        if (!files.has(f)) {
          const b = fs.readFileSync(f);
          files.set(f, trim(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), r.sr));
        }
        regions.push({ ...r, data: files.get(f) });
      }
      const layers = new Set(spec.regions.map((r) => r.lovel)).size;
      if (ok && regions.length) inst = { name, regions, layers, license: spec.license };
    }
  }
  if (inst) inst.gain = 1;
  if (inst) inst.gain = PIANO_REF_RMS / referenceRms(inst);
  cache.set(name, inst);
  return inst;
}

// The mezzo-forte reference passage (beginner piece of noise-eval.js, first 24 notes).
function referenceRms(inst) {
  const r = rng(3);
  const notes = [];
  let t = 0.8;
  for (let bar = 0; bar < 4; bar++) {
    for (let b = 0; b < 4; b++) {
      notes.push({ midi: 60 + [0, 2, 4, 5, 7, 9, 7, 5][Math.floor(r() * 8)], t: t + b * 0.7, dur: 0.63, vel: 0.45 + r() * 0.3 });
      if (b % 2 === 0) notes.push({ midi: 48 + [0, 5, 7, 4][Math.floor(r() * 4)], t: t + b * 0.7, dur: 1.26, vel: 0.4 + r() * 0.3 });
    }
    t += 2.8;
  }
  return activeRms(render(inst, notes, { sr: 48000, seed: 7 }), 48000);
}

function pickRegion(inst, midi, v) {
  let best = null,
    bd = 1e9;
  for (const r of inst.regions) {
    const dv = v < r.lovel ? r.lovel - v : v > r.hivel ? v - r.hivel : 0;
    const dk = midi < r.lokey ? r.lokey - midi : midi > r.hikey ? midi - r.hikey : 0;
    const d = dv * 100 + dk * 10 + Math.abs(midi - r.key);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

// notes: [{midi, t, dur, vel}]; opts.pedal: true or [[down, up], ...] (seconds).
// Returns the dry piano signal (no room, no noise).
export function render(inst, notes, opts = {}) {
  if (typeof inst === 'string') inst = loadInstrument(inst);
  if (!inst) throw new Error('instrument missing: run node tests/bench-fetch.js');
  const { sr = 48000, seed = 7, tuningCents = 0, pedal = null } = opts;
  const sympathetic = opts.sympathetic ?? (pedal ? 1 : 0);
  const rand = rng(seed);
  const end = opts.length ?? Math.max(...notes.map((n) => n.t + n.dur)) + 1.2;
  const N = Math.ceil(end * sr);
  const out = new Float32Array(N);
  const pedals = pedal === true ? [[-1, 1e9]] : pedal || [];
  const pedalUp = (t) => {
    for (const [d, u] of pedals) if (t >= d && t < u) return u;
    return t;
  };
  const G = inst.gain;

  const voice = (midi, t0, off, gain, { attack = 0, vel = 0.7 } = {}) => {
    const reg = pickRegion(inst, midi, Math.round(vel * 127));
    const x = reg.data;
    const step = Math.pow(2, (midi - reg.key + (tuningCents + reg.tune) / 100) / 12) * (reg.sr / sr);
    const i0 = Math.round(t0 * sr);
    const iOff = Math.round(off * sr);
    const damped = midi < 89; // no dampers above F6
    const tauD = 0.06 + (midi < 60 ? (0.25 * (60 - midi)) / 39 : 0);
    const dDec = Math.exp(-1 / (tauD * sr));
    // single-layer samplers: darker when soft (one-pole low-pass)
    const fc = inst.layers > 1 ? 20000 : Math.min(18000, 1200 * Math.pow(2, vel * 4.5));
    const a = fc >= 20000 ? 1 : 1 - Math.exp((-2 * Math.PI * fc) / sr);
    const flt = reg.cutoff ? new Biquad().lp(reg.cutoff, 0.707, sr) : null;
    const g = gain * (reg.volume ? Math.pow(10, reg.volume / 20) : 1);
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
      let v = x0 + 0.5 * f * (x1 - xm + f * (2 * xm - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - xm)));
      if (flt) v = flt.run(v);
      lp += a * (v - lp);
      if (attack > 0) env = 1 - (1 - env) * atk;
      if (damped && i >= iOff) {
        damp *= dDec;
        if (damp < 1e-4) break;
      }
      if (i >= 0) out[i] += lp * g * damp * env;
      pos += step;
    }
  };

  for (const n of notes) {
    const vel = n.vel ?? 0.6;
    const gain = G * Math.pow(vel / 0.8, 1.7) * (0.9 + rand() * 0.2);
    const off = pedalUp(n.t + n.dur);
    voice(n.midi, n.t, off, gain, { vel });
    if (sympathetic && off > n.t + n.dur + 1e-6) {
      // undamped strings whose partials coincide with the struck note's resonate
      for (const [iv, db] of [
        [12, -30],
        [19, -36],
        [24, -38],
        [-12, -40],
      ]) {
        const m = n.midi + iv;
        if (m < 21 || m > 108) continue;
        voice(m, n.t, off, gain * Math.pow(10, db / 20) * sympathetic, { attack: 0.05, vel: vel * 0.6 });
      }
    }
  }
  if (pedals.length && opts.pedalThumps !== false) {
    for (const [d, u] of pedals) {
      for (const [t, amp] of [
        [d, 0.02],
        [u, 0.012],
      ]) {
        if (t < 0 || t > end) continue;
        const i0 = Math.floor(t * sr);
        const f = 55 + rand() * 30;
        const lpf = new Biquad().lp(900, 0.7, sr);
        const A = amp * G;
        for (let i = 0; i < 0.25 * sr && i0 + i < N; i++) {
          const tt = i / sr;
          out[i0 + i] += A * Math.exp(-tt / 0.05) * Math.sin(2 * Math.PI * f * tt) + lpf.run((rand() * 2 - 1) * A * 0.4 * Math.exp(-tt / 0.08));
        }
      }
    }
  }
  return out;
}
