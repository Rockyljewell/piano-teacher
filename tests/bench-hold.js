// Hold fidelity benchmark: does the listener keep a struck note "on" for as long as the key is
// held, and let go soon after the key is released?
//
//   node tests/bench-hold.js                 held-out pianos (upright, ydp), stand, normal level
//   ENGINE=dsp|hybrid|/path/to/module.js     engine (default: hybrid)
//   INST=upright,ydp,salamander              pianos     COND=stand|close|stand+talk    (default stand)
//   GAIN_DB=-25 FLOOR_DB=-80                 quiet piano / mic floor, as in bench-listen.js
//   JSON=out.json                            also write the numbers
//
// Why: the free-play display lights a key from the note-on until the note-off. A held chord whose
// upper note is released after 0.8 s shows two notes while three keys are down. The other
// benchmarks score attacks only.
//
// Material: single notes and 2-, 3- and 4-note chords, each held for 0.5, 1, 2 or 3 s (key down
// to key up, dampers as in the benchmark sampler), 5.5 s apart, no pedal.
// Per note (what the listener reported for that attack):
//   heard     a note-on within 80 ms of the attack
//   kept      of the heard notes: still on at (key up - 0.25 s), i.e. not released early
//   early     released more than 0.25 s before the key went up
//   late      released more than 0.6 s after the key went up
//   stuck     never released within 4 s of the key going up
//   lag       median (release - key up) over the notes released on time (ms)
// For chords also: `whole` = every note of the chord heard and kept.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { render, hasInstrument } from './bench-sampler.js';
import { applyCondition } from './bench-listen.js';
import { rng } from './synth-piano.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SR = 48000;
const HOLDS = [0.5, 1, 2, 3];
const GAP = 5.5;
const SHAPES = {
  1: [[0]],
  2: [[0, 7], [0, 4], [0, 5], [0, 12]],
  3: [[0, 4, 7], [0, 3, 7], [4, 7, 12], [7, 12, 16]],
  4: [[0, 4, 7, 12], [0, 4, 7, 10], [0, 3, 7, 10]],
};
const ENGINES = { dsp: '../js/audio/transcriber.js', hybrid: '../js/audio/nn/hybrid-transcriber.js' };

export function holdMaterial(size, seed, count = 16) {
  const r = rng(seed);
  const notes = [];
  let g = 1;
  let t = 1.2;
  for (let k = 0; k < count; k++) {
    const shape = SHAPES[size][k % SHAPES[size].length];
    const dur = HOLDS[k % HOLDS.length];
    const root = 36 + Math.floor(r() * 32); // C2 .. G4
    const v0 = 0.5 + r() * 0.25;
    for (const x of shape) notes.push({ midi: root + x, t: t + r() * 0.02, tn: t, dur, vel: v0 * (0.85 + r() * 0.3), g });
    g++;
    t += GAP;
  }
  return { name: `hold${size}`, notes, length: t + 1 };
}

export async function loadEngine(spec) {
  const file = ENGINES[spec] ? path.join(here, ENGINES[spec]) : path.resolve(spec);
  return (await import(pathToFileURL(file).href)).Transcriber;
}

// Run the listener over `audio`, returning its note-ons and note-offs (audio-clock seconds).
export function runHold(Transcriber, audio) {
  const ons = [];
  const offs = [];
  const tr = new Transcriber(SR, { onNoteOn: (m, t) => ons.push({ m, t }), onNoteOff: (m, t) => offs.push({ m, t }) });
  tr.startCalibration && tr.startCalibration();
  let cal = false;
  for (let i = 0; i + 256 <= audio.length; i += 256) {
    if (!cal && i / SR > 0.4) {
      tr.finishCalibration && tr.finishCalibration();
      cal = true;
    }
    tr.push(audio.subarray(i, i + 256), i);
  }
  return { ons, offs };
}

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);

// Score the reported notes against the material.
export function scoreHold(mat, { ons, offs }) {
  const c = { n: 0, heard: 0, kept: 0, early: 0, late: 0, stuck: 0, lags: [], chords: 0, whole: 0, byRole: {}, byHold: {} };
  const groups = new Map();
  for (const n of mat.notes) (groups.get(n.g) || groups.set(n.g, []).get(n.g)).push(n);
  for (const grp of groups.values()) {
    const sorted = [...grp].sort((a, b) => a.midi - b.midi);
    let whole = true;
    sorted.forEach((n, i) => {
      const role = sorted.length === 1 ? 'single' : i === 0 ? 'lowest' : i === sorted.length - 1 ? 'top' : 'inner';
      const R = (c.byRole[role] ||= { n: 0, heard: 0, kept: 0 });
      const H = (c.byHold[n.dur] ||= { n: 0, heard: 0, kept: 0 });
      c.n++;
      R.n++;
      H.n++;
      const on = ons.find((e) => e.m === n.midi && Math.abs(e.t - n.t) <= 0.08);
      if (!on) {
        whole = false;
        return;
      }
      c.heard++;
      R.heard++;
      H.heard++;
      const keyUp = n.t + n.dur;
      const off = offs.find((e) => e.m === n.midi && e.t >= on.t);
      const offT = off ? off.t : Infinity;
      if (offT >= keyUp - 0.25) {
        c.kept++;
        R.kept++;
        H.kept++;
      } else {
        c.early++;
        whole = false;
      }
      if (offT > keyUp + 4) c.stuck++;
      else if (offT > keyUp + 0.6) c.late++;
      if (offT >= keyUp - 0.25 && offT <= keyUp + 0.6) c.lags.push((offT - keyUp) * 1000);
    });
    if (grp.length > 1) {
      c.chords++;
      if (whole) c.whole++;
    }
  }
  return c;
}

export function addScore(a, b) {
  for (const k of ['n', 'heard', 'kept', 'early', 'late', 'stuck', 'chords', 'whole']) a[k] = (a[k] || 0) + b[k];
  a.lags = (a.lags || []).concat(b.lags);
  for (const key of ['byRole', 'byHold'])
    for (const [r, v] of Object.entries(b[key])) {
      const x = ((a[key] ||= {})[r] ||= { n: 0, heard: 0, kept: 0 });
      x.n += v.n;
      x.heard += v.heard;
      x.kept += v.kept;
    }
  return a;
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

async function main() {
  const engine = process.env.ENGINE || 'hybrid';
  const Transcriber = await loadEngine(engine);
  const insts = (process.env.INST || 'upright,ydp').split(',').filter((i) => hasInstrument(i));
  const cond = process.env.COND || 'stand';
  // (GAIN_DB / FLOOR_DB are applied by applyCondition, from the environment)
  const gain = Number(process.env.GAIN_DB || 0);
  const floor = process.env.FLOOR_DB ? Number(process.env.FLOOR_DB) : null;
  console.log(`hold fidelity: engine ${engine}, ${insts.join('+')}, ${cond}${gain ? `, level ${gain} dB` : ''}${floor != null ? `, floor ${floor} dBFS` : ''}`);
  console.log('size     heard   kept  early  late stuck | release lag ms (median) | whole chord kept | kept by role (lowest / inner / top) | kept by hold 0.5 / 1 / 2 / 3 s');
  const out = {};
  for (const size of [1, 2, 3, 4]) {
    const tot = {};
    for (const inst of insts) {
      const mat = holdMaterial(size, 100 + size);
      const dry = render(inst, mat.notes, { sr: SR, seed: 7, pedal: false, length: mat.length });
      const audio = applyCondition(dry, cond, 1);
      addScore(tot, scoreHold(mat, runHold(Transcriber, audio)));
    }
    out[size] = tot;
    const role = ['lowest', 'inner', 'top'].map((r) => (tot.byRole[r] ? pct(tot.byRole[r].kept, tot.byRole[r].n) : '–')).join(' / ');
    const single = tot.byRole.single ? pct(tot.byRole.single.kept, tot.byRole.single.n) : null;
    const hold = HOLDS.map((h) => pct(tot.byHold[h].kept, tot.byHold[h].n)).join(' / ');
    const lag = median(tot.lags);
    console.log(
      `${size}-note  ${pct(tot.heard, tot.n).padStart(5)} ${pct(tot.kept, tot.n).padStart(6)} ${pct(tot.early, tot.heard).padStart(6)} ${pct(tot.late, tot.heard).padStart(5)} ${pct(tot.stuck, tot.heard).padStart(5)} | ${(lag == null ? '–' : Math.round(lag)).toString().padStart(6)} | ${size > 1 ? pct(tot.whole, tot.chords).padStart(5) : '    –'} | ${size > 1 ? role : single} | ${hold}`,
    );
  }
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(out, null, 1));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
