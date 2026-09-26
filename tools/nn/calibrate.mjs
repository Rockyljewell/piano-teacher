// Tune the JS decoder on the validation mixtures (training pianos only - never the benchmark's
// held-out pianos): per-register onset thresholds for unexpected and for expected notes, the
// confirmation rule, and the confidence calibration (probability at firing -> measured
// precision). Writes them as the decoder section for export.py.
//
//   node tools/nn/calibrate.mjs <weights.bin> [--write decoder.json]
//
// Needs .data/valmix (python tools/nn/dump_val.py). The network runs once per mixture; the
// decoder variants replay its cached outputs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transcriber, setWeights, REGISTERS, regOf } from '../../js/audio/nn/nn-transcriber.js';
import { parseWeights } from '../../js/audio/nn/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VAL = path.join(here, '.data', 'valmix');
const SR = 16000;
const args = process.argv.slice(2);
const wfile = args[0];
const outIdx = args.indexOf('--write');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
setWeights(parseWeights(fs.readFileSync(wfile)));
const NR = REGISTERS.length - 1;

let index = JSON.parse(fs.readFileSync(path.join(VAL, 'index.json'), 'utf8'));
if (process.env.VAL_LIMIT) index = [...index.slice(0, Number(process.env.VAL_LIMIT)), ...index.filter((m) => m.meta.kind === 'noise-only').slice(0, 4)];
const mixes = index.map((m) => {
  const b = fs.readFileSync(path.join(VAL, m.file));
  return { ...m, x: new Float32Array(b.buffer, b.byteOffset, b.length / 4), cache: null };
});

function listen(mix, decoder, lesson) {
  const ev = [];
  let tr;
  tr = new Transcriber(SR, { decoder, onNoteOn: (midi, t, vel, info) => ev.push({ midi, t, at: tr.pos / SR, p: info.p, conf: info.confidence, exp: info.expected }) });
  if (mix.cache) {
    let i = 0;
    tr.model.step = () => mix.cache[i++];
  } else {
    mix.cache = [];
    const step = tr.model.step.bind(tr.model);
    tr.model.step = (f) => {
      const o = step(f);
      mix.cache.push(Float32Array.from(o));
      return o;
    };
  }
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

const zero = () => ({ n: 0, hit: 0, ev: 0, fpNoise: 0, fpExp: 0, evExp: 0, fpUnexp: 0, evUnexp: 0, lat: [], err: 0 });
function evaluate(decoder, lesson) {
  const reg = Array.from({ length: NR }, zero);
  let noiseSec = 0;
  const fired = [];
  for (const mix of mixes) {
    const ev = listen(mix, decoder, lesson).filter((e) => e.t >= 0.45);
    if (mix.meta.kind === 'noise-only') {
      noiseSec += mix.x.length / SR;
      for (const e of ev) {
        reg[regOf(e.midi)].fpNoise++;
        fired.push([e.p, 0, e.exp]);
      }
      continue;
    }
    const notes = mix.notes.filter((n) => n.t >= 0.45 && n.t < mix.x.length / SR - 0.1);
    const { nh, eu } = match(notes, ev);
    notes.forEach((nt, i) => {
      const R = reg[regOf(nt.midi)];
      R.n++;
      if (nh[i] >= 0) {
        R.hit++;
        R.lat.push(ev[nh[i]].at - nt.t);
        R.err += Math.abs(ev[nh[i]].t - nt.t);
      }
    });
    ev.forEach((e, j) => {
      const R = reg[regOf(e.midi)];
      R.ev++;
      if (e.exp) R.evExp++;
      else R.evUnexp++;
      if (eu[j] < 0) {
        if (e.exp) R.fpExp++;
        else R.fpUnexp++;
      }
      fired.push([e.p, eu[j] >= 0 ? 1 : 0, e.exp]);
    });
  }
  return { reg, noiseMin: noiseSec / 60, fired };
}

function summary(regs, noiseMin) {
  const a = zero();
  for (const r of regs) {
    for (const k of ['n', 'hit', 'ev', 'fpNoise', 'fpExp', 'evExp', 'fpUnexp', 'evUnexp', 'err']) a[k] += r[k];
    a.lat.push(...r.lat);
  }
  a.lat.sort((x, y) => x - y);
  const R = a.hit / Math.max(1, a.n),
    P = a.hit / Math.max(1, a.ev);
  return {
    R,
    P,
    F1: (2 * P * R) / Math.max(1e-9, P + R),
    Pexp: a.evExp ? 1 - a.fpExp / a.evExp : null,
    Punexp: a.evUnexp ? 1 - a.fpUnexp / a.evUnexp : null,
    lat50: (a.lat[a.lat.length >> 1] || 0) * 1000,
    lat90: (a.lat[Math.floor(a.lat.length * 0.9)] || 0) * 1000,
    err: (a.err / Math.max(1, a.hit)) * 1000,
    fpm: a.fpNoise / noiseMin,
  };
}
const pc = (v) => (v == null ? '  - ' : (v * 100).toFixed(1));
const fmt = (s) => `R ${pc(s.R)} P ${pc(s.P)} F1 ${pc(s.F1)} (P exp ${pc(s.Pexp)} / unexp ${pc(s.Punexp)}) lat ${s.lat50.toFixed(0)}/${s.lat90.toFixed(0)} ms err ${s.err.toFixed(1)} ms noise ${s.fpm.toFixed(1)}/min`;
// objective per register: F1 minus a penalty for false notes in noise-only mixtures
function regScore(r, noiseMin) {
  const R = r.hit / Math.max(1, r.n),
    P = r.hit / Math.max(1, r.ev);
  return (2 * P * R) / Math.max(1e-9, P + R) - 0.004 * (r.fpNoise / noiseMin);
}

const raw = { calib: [[0, 0], [1, 1]], expectedBonus: 0, thrStrict: 0 };
const t0 = Date.now();
console.log(`${mixes.length} mixtures, ${mixes.reduce((a, m) => a + m.notes.length, 0)} notes`);
evaluate({ ...raw }, false); // fills the caches
console.log(`network pass ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// 1. free play: per-register thresholds (and the confirmation rule)
const grid = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
let bestFree = null;
for (const confirm of [1, 2]) {
  const runs = grid.map((thr) => ({ thr, r: evaluate({ ...raw, thr, confirm }, false) }));
  for (const { thr, r } of runs) console.log(`free thr ${thr} confirm ${confirm}: ${fmt(summary(r.reg, r.noiseMin))}`);
  const thrReg = [];
  for (let g = 0; g < NR; g++) {
    let b = runs[0];
    for (const x of runs) if (regScore(x.r.reg[g], x.r.noiseMin) > regScore(b.r.reg[g], b.r.noiseMin)) b = x;
    thrReg.push(b.thr);
  }
  const r = evaluate({ ...raw, thrReg, confirm }, false);
  const s = summary(r.reg, r.noiseMin);
  console.log(`free per-register ${JSON.stringify(thrReg)} confirm ${confirm}: ${fmt(s)}`);
  if (!bestFree || s.F1 - 0.002 * s.fpm > bestFree.s.F1 - 0.002 * bestFree.s.fpm) bestFree = { thrReg, confirm, r, s };
}

// 1b. attack gate for unexpected notes (a high-band energy jump near the estimated attack)
for (const gateRise of [1.5, 2, 3, 4]) {
  const r = evaluate({ ...raw, thrReg: bestFree.thrReg, confirm: bestFree.confirm, gateRise }, false);
  const s = summary(r.reg, r.noiseMin);
  console.log(`free gateRise ${gateRise}: ${fmt(s)}`);
  if (s.F1 - 0.002 * s.fpm > bestFree.s.F1 - 0.002 * bestFree.s.fpm) bestFree = { ...bestFree, gateRise, r, s };
}
console.log(`free choice: ${JSON.stringify({ thrReg: bestFree.thrReg, confirm: bestFree.confirm, gateRise: bestFree.gateRise || 0 })}`);

// 2. lesson mode: per-register thresholds for expected notes
const gridE = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5];
const runsE = gridE.map((thrExp) => ({ thrExp, r: evaluate({ ...raw, thrReg: bestFree.thrReg, confirm: bestFree.confirm, gateRise: bestFree.gateRise || 0, thrExp }, true) }));
for (const { thrExp, r } of runsE) console.log(`lesson thrExp ${thrExp}: ${fmt(summary(r.reg, r.noiseMin))}`);
const thrExpReg = [];
for (let g = 0; g < NR; g++) {
  let b = runsE[0];
  for (const x of runsE) if (regScore(x.r.reg[g], x.r.noiseMin) > regScore(b.r.reg[g], b.r.noiseMin)) b = x;
  thrExpReg.push(b.thrExp);
}
const rl = evaluate({ ...raw, thrReg: bestFree.thrReg, confirm: bestFree.confirm, gateRise: bestFree.gateRise || 0, thrExpReg }, true);
console.log(`lesson per-register ${JSON.stringify(thrExpReg)}: ${fmt(summary(rl.reg, rl.noiseMin))}`);

// 3. confidence: precision of unexpected notes as a function of p at firing (free play)
const calib = isotonic(bestFree.r.fired.filter((f) => !f[2]).map((f) => [f[0], f[1]]));
calib.unshift([0, 0]);
calib.push([1, Math.max(calib[calib.length - 1][1], 0.99)]);
console.log('calibration (p at firing -> precision):', JSON.stringify(calib));
const dec = { thrReg: bestFree.thrReg, confirm: bestFree.confirm, gateRise: bestFree.gateRise || 0, thrExpReg, calib, thr: median(bestFree.thrReg), thrExp: median(thrExpReg) };
console.log('decoder:', JSON.stringify(dec));
for (const lesson of [false, true]) {
  const r = evaluate({ ...dec, thrStrict: 0 }, lesson);
  console.log(`final ${lesson ? 'lesson' : 'free'}: ${fmt(summary(r.reg, r.noiseMin))}`);
  r.reg.forEach((g, i) => console.log(`   ${REGISTERS[i]}-${REGISTERS[i + 1] - 1}: n ${g.n} R ${pc(g.hit / Math.max(1, g.n))} P ${pc(g.hit / Math.max(1, g.ev))} noise ${g.fpNoise}`));
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(dec, null, 1));

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

// isotonic regression (pool adjacent violators) of y on x, as piecewise-linear points
function isotonic(pts, bins = 12) {
  pts.sort((a, b) => a[0] - b[0]);
  const per = Math.max(20, Math.floor(pts.length / bins));
  const blocks = [];
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
