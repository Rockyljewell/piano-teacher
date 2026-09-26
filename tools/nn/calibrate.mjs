// Tune the JS decoder on the validation mixtures (training pianos only - never the benchmark's
// held-out pianos): onset thresholds for unexpected and expected notes, and the confidence
// calibration (probability at firing -> measured precision), then write them as the decoder
// section of the weights file.
//
//   node tools/nn/calibrate.mjs <weights.bin> [--write decoder.json]
//
// Needs .data/valmix (python tools/nn/dump_val.py).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transcriber, setWeights } from '../../js/audio/nn/nn-transcriber.js';
import { parseWeights } from '../../js/audio/nn/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VAL = path.join(here, '.data', 'valmix');
const SR = 16000;
const args = process.argv.slice(2);
const wfile = args[0];
const outIdx = args.indexOf('--write');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const W = parseWeights(fs.readFileSync(wfile));
setWeights(W);

const index = JSON.parse(fs.readFileSync(path.join(VAL, 'index.json'), 'utf8'));
const mixes = index.map((m) => {
  const b = fs.readFileSync(path.join(VAL, m.file));
  return { ...m, x: new Float32Array(b.buffer, b.byteOffset, b.length / 4) };
});

function listen(mix, decoder, lesson) {
  const ev = [];
  let tr;
  tr = new Transcriber(SR, { decoder, onNoteOn: (midi, t, vel, info) => ev.push({ midi, t, at: tr.pos / SR, p: info.p, conf: info.confidence, exp: info.expected }) });
  tr.startCalibration();
  const notes = mix.notes;
  const lo = Math.min(...notes.map((n) => n.midi), 60),
    hi = Math.max(...notes.map((n) => n.midi), 60);
  let key = '';
  for (let i = 0; i + 512 <= mix.x.length; i += 512) {
    const t = i / SR;
    if (t > 0.4 && tr.calibrating) tr.finishCalibration();
    if (lesson) {
      const due = [...new Set(notes.filter((n) => n.t > t - 0.25 && n.t < t + 0.35).map((n) => n.midi))];
      const k = due.join(',');
      if (k !== key) {
        key = k;
        tr.setExpected(due, [lo, hi]);
      }
    }
    tr.push(mix.x.subarray(i, i + 512), i);
  }
  return ev;
}

function match(notes, ev, tol = 0.08) {
  const pairs = [];
  notes.forEach((n, i) => ev.forEach((e, j) => e.midi === n.midi && Math.abs(e.t - n.t) <= tol && pairs.push([Math.abs(e.t - n.t), i, j])));
  pairs.sort((a, b) => a[0] - b[0]);
  const nh = new Int32Array(notes.length).fill(-1),
    eu = new Int32Array(ev.length).fill(-1);
  for (const [, i, j] of pairs) if (nh[i] < 0 && eu[j] < 0) (nh[i] = j), (eu[j] = i);
  return { nh, eu };
}

function evaluate(decoder, lesson) {
  let n = 0,
    hit = 0,
    nev = 0,
    noiseEv = 0,
    noiseSec = 0,
    err = 0;
  const lat = [],
    fired = [];
  for (const mix of mixes) {
    const ev = listen(mix, decoder, lesson).filter((e) => e.t >= 0.45);
    const notes = mix.notes.filter((n) => n.t >= 0.45 && n.t < mix.x.length / SR - 0.1);
    if (mix.meta.kind === 'noise-only') {
      noiseEv += ev.length;
      noiseSec += mix.x.length / SR;
      for (const e of ev) fired.push([e.p, 0, e.exp]);
      continue;
    }
    const { nh, eu } = match(notes, ev);
    n += notes.length;
    nev += ev.length;
    notes.forEach((nt, i) => {
      if (nh[i] >= 0) {
        hit++;
        lat.push(ev[nh[i]].at - nt.t);
        err += Math.abs(ev[nh[i]].t - nt.t);
      }
    });
    ev.forEach((e, j) => fired.push([e.p, eu[j] >= 0 ? 1 : 0, e.exp]));
  }
  lat.sort((a, b) => a - b);
  const R = hit / n,
    P = hit / Math.max(1, nev);
  return { R, P, F1: (2 * P * R) / (P + R), lat50: lat[lat.length >> 1] * 1000, lat90: lat[Math.floor(lat.length * 0.9)] * 1000, err: (err / hit) * 1000, fpm: (noiseEv / noiseSec) * 60, fired };
}

// isotonic regression (pool adjacent violators) of y on x, returned as piecewise-linear points
function isotonic(pts, bins = 12) {
  pts.sort((a, b) => a[0] - b[0]);
  const per = Math.max(20, Math.floor(pts.length / bins));
  let blocks = [];
  for (let i = 0; i < pts.length; i += per) {
    const s = pts.slice(i, i + per);
    blocks.push({ x: s.reduce((a, p) => a + p[0], 0) / s.length, y: s.reduce((a, p) => a + p[1], 0) / s.length, w: s.length });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i + 1 < blocks.length; i++)
      if (blocks[i].y > blocks[i + 1].y) {
        const a = blocks[i],
          b = blocks[i + 1];
        const w = a.w + b.w;
        blocks.splice(i, 2, { x: (a.x * a.w + b.x * b.w) / w, y: (a.y * a.w + b.y * b.w) / w, w });
        changed = true;
        break;
      }
  }
  return blocks.map((b) => [Math.round(b.x * 1000) / 1000, Math.round(b.y * 1000) / 1000]);
}

const fmt = (r) => `R ${(r.R * 100).toFixed(1)} P ${(r.P * 100).toFixed(1)} F1 ${(r.F1 * 100).toFixed(1)} lat ${r.lat50.toFixed(0)}/${r.lat90.toFixed(0)} ms err ${r.err.toFixed(1)} ms noise ${r.fpm.toFixed(1)}/min`;
const raw = { calib: [[0, 0], [1, 1]], expectedBonus: 0 };
console.log(`${mixes.length} mixtures, ${mixes.reduce((a, m) => a + m.notes.length, 0)} notes`);
let best = null;
for (const thr of [0.3, 0.4, 0.5, 0.6, 0.7]) {
  const r = evaluate({ ...raw, thr, thrStrict: 0 }, false);
  console.log(`free   thr ${thr}: ${fmt(r)}`);
  if (!best || r.F1 > best.r.F1) best = { thr, r };
}
let bestE = null;
for (const thrExp of [0.1, 0.15, 0.2, 0.3, 0.4]) {
  const r = evaluate({ ...raw, thr: best.thr, thrStrict: 0, thrExp }, true);
  console.log(`lesson thrExp ${thrExp}: ${fmt(r)}`);
  if (!bestE || r.F1 > bestE.r.F1) bestE = { thrExp, r };
}
const calib = isotonic(best.r.fired.filter((f) => !f[2]).map((f) => [f[0], f[1]]));
calib.unshift([0, 0]);
calib.push([1, Math.max(calib[calib.length - 1][1], 0.99)]);
console.log('calibration (p at firing -> precision):', JSON.stringify(calib));
const dec = { thr: best.thr, thrExp: bestE.thrExp, calib };
console.log('decoder:', JSON.stringify(dec));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(dec, null, 1));
