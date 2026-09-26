// Fits the listener's fast-path model (LOOK_MODEL in js/audio/transcriber.js): at each short
// window after an attack, the probability that a candidate key was struck at that attack. Two
// small MLPs: one for expected notes (lesson hints), one for the rest.
//
//   node tests/look-fit.js            collect, fit, print LOOK_MODEL (paste it into transcriber.js)
//   node tests/look-fit.js eval       evaluate the current LOOK_MODEL on the same data
//
// Honest by construction: the data is the Salamander grand (tests/corpus-fetch.js) and the
// additive synth piano only - the benchmark's held-out pianos (upright, YDP) are never used -
// with the benchmark's kinds of material but different seeds (materials({ seed })), in the
// close / stand / stand+talk conditions and in loud rooms (speech, TV, knocks, dishes 10 dB
// below the piano), in lesson (score-informed) and free mode, plus noise-only and "student
// pauses, room goes on" clips as negatives.
//
// Candidates are collected on-policy (DAgger): round 1 with a fast path that never fires (the
// long-window path alone decides which notes are sounding), later rounds with the model of the
// previous round firing, so "is this sounding note struck again?" is seen as it will be in use.
// After each fit, candidates that would fire falsely (and real strikes that never fire) get
// more weight and the model is refined. Label: a note of that key really started within
// -30..+40 ms of the attack.
//
// Env: ROUNDS (default 2), THREADS, SEEDS (default "11,12"), H (hidden units, default 10),
//      NOISEW (weight of noise negatives, default 4), MINE (hard-example rounds, default 2),
//      TRANSCRIBER=path (fit another engine), DUMP=file (save rows, one per line),
//      ROWS=file (start from saved rows), COLLECT=regex (later rounds: only matching jobs),
//      MODEL_OUT=file (the model after every round, as JSON).
// The shipped model: SEEDS=11,12 ROUNDS=2 on all material without the loud rooms, then
// ROWS=<that dump> COLLECT='\+' ROUNDS=2 to add the loud-room material.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { materials } from './bench-material.js';
import { render, hasInstrument } from './bench-sampler.js';
import { applyCondition } from './bench-listen.js';
import { renderPiano } from './synth-piano.js';
import { makeNoise, NOISE_TYPES, pieces } from './noise-eval.js';
import { roomTone, mixInto, activeRms, gainDb } from './noise-sim.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TR_PATH = process.env.TRANSCRIBER ? path.resolve(process.env.TRANSCRIBER) : path.join(here, '../js/audio/transcriber.js');
const SR = 48000;
export const LOOK_KEYS = ['look', 'found', 'sc', 'rank', 'relSal', 'rise', 'riseLow', 'harm', 'snr', 'rel', 'relKnown', 'sub', 'uniqN', 'uniqFrac', 'under', 'excess', 'share', 'active', 'prev', 'ampRatio', 'onset', 'f0', 'nsig', 'tonal', 'flat', 'dev', 'ddev', 'ctr1', 'ctr2', 'expNbr', 'resid', 'residSc', 'blk', 'weak'];
const NEVER = { bias: -50 };

function renderInst(inst, mat) {
  if (inst !== 'synth') return render(inst, mat.notes, { sr: SR, seed: 7, pedal: mat.pedal, length: mat.length });
  // the synth has no pedal: hold the notes until the pedal lifts instead
  const up = (t) => {
    for (const [d, u] of mat.pedal || []) if (t >= d && t < u) return u;
    return t;
  };
  const notes = mat.notes.map((n) => ({ ...n, dur: up(n.t + n.dur) - n.t }));
  return renderPiano(notes, { sr: SR, seed: 7, length: mat.length });
}

async function collect(job, model) {
  const { Transcriber } = await import(pathToFileURL(TR_PATH).href);
  let audio, notes, segs, modes;
  if (job.kind === 'noise' || job.kind === 'pause') {
    const pre = job.kind === 'pause' ? 11 : 1;
    notes = job.kind === 'pause' ? pieces(job.seed).beginner.filter((n) => n.t < 10) : [];
    audio = job.kind === 'pause' ? renderPiano(notes, { sr: SR, seed: job.seed, length: pre + job.sec }) : roomTone(pre + job.sec, { sr: SR, seed: 90 + job.seed }).map((v) => v * 0.00045);
    const x = makeNoise(job.noise, job.sec, { sr: SR, seed: job.seed, level: job.level });
    if (!x) return [];
    mixInto(audio, x, 1, pre * SR);
    segs = null;
    modes = ['free'];
  } else {
    const mat = materials({ quick: true, seed: job.seed }).find((m) => m.name === job.mat && (m.part || 0) === (job.part || 0));
    notes = mat.notes;
    segs = mat.segs;
    audio = applyCondition(renderInst(job.inst, mat), job.cond, 1 + job.seed);
    if (job.noise) {
      // a loud room: the noise at `snr` dB below this piece's active level (as noise-eval does)
      const x = makeNoise(job.noise, audio.length / SR, { sr: SR, seed: job.seed, level: 0 });
      if (!x) return [];
      mixInto(audio, x, activeRms(audio, SR) / activeRms(x, SR) / gainDb(job.snr), 0);
    }
    modes = ['lesson', 'free'];
  }
  const rows = [];
  for (const mode of modes) {
    let tr;
    tr = new Transcriber(SR, {
      lookModel: model || NEVER,
      lookCollect: (c) => {
        let label = 0;
        for (const n of notes) if (n.midi === c.midi && n.t >= c.attackT - 0.03 && n.t <= c.attackT + 0.04) label = 1;
        rows.push({ x: LOOK_KEYS.map((k) => c.x[k]), label, exp: c.exp ? 1 : 0, active: c.active ? 1 : 0, look: c.look, n: c.n, defer: c.defer ? 1 : 0, key: `${job.id}|${mode}|${c.attackT.toFixed(4)}|${c.midi}`, src: `${job.src}|${mode}`, noise: job.kind === 'noise' || job.kind === 'pause' ? 1 : 0 });
      },
    });
    tr.startCalibration();
    let cal = false,
      lo = 0,
      key = '',
      seg = 0;
    for (let i = 0; i + 512 <= audio.length; i += 512) {
      const t = i / SR;
      if (!cal && t > 0.4) {
        tr.finishCalibration();
        cal = true;
      }
      if (mode === 'lesson') {
        while (seg < segs.length - 1 && t > segs[seg].t1) seg++;
        while (lo < notes.length && notes[lo].tn < t - 0.6) lo++;
        const due = [];
        for (let k = lo; k < notes.length && notes[k].tn < t + 0.35; k++) if (notes[k].tn > t - 0.25 && !due.includes(notes[k].midi)) due.push(notes[k].midi);
        const k2 = due.join(',') + '|' + segs[seg].range.join(',');
        if (k2 !== key) {
          key = k2;
          tr.setExpected(due, segs[seg].range);
        }
      }
      tr.push(audio.subarray(i, i + 512), i);
    }
  }
  return rows;
}

if (!isMainThread && workerData && workerData.lookFit) {
  parentPort.on('message', async ({ job, model }) => {
    try {
      parentPort.postMessage(await collect(job, model));
    } catch (e) {
      parentPort.postMessage({ error: String(e.stack) });
    }
  });
}

async function runAll(jobs, model, threads) {
  const out = new Array(jobs.length);
  let next = 0;
  const file = fileURLToPath(import.meta.url);
  await Promise.all(
    Array.from({ length: Math.min(threads, jobs.length) }, async () => {
      const w = new Worker(file, { workerData: { lookFit: true } });
      w.setMaxListeners(0);
      while (next < jobs.length) {
        const i = next++;
        out[i] = await new Promise((res) => {
          w.once('message', res);
          w.postMessage({ job: jobs[i], model });
        });
        if (out[i].error) {
          console.error(out[i].error);
          out[i] = [];
        }
      }
      await w.terminate();
    }),
  );
  return out.flat();
}

export function buildJobs() {
  const insts = [...(hasInstrument('salamander') ? ['salamander'] : []), 'synth'];
  const seeds = (process.env.SEEDS || '11,12').split(',').map(Number);
  const jobs = [];
  for (const seed of seeds)
    for (const inst of insts)
      for (const cond of ['close', 'stand', 'stand+talk'])
        for (const m of materials({ quick: true, seed })) jobs.push({ kind: 'piano', inst, cond, mat: m.name, part: m.part || 0, seed, src: `${inst}|${cond}|${m.name}` });
  for (const noise of [...NOISE_TYPES, ...(hasInstrument('salamander') ? ['real-speech', 'real-radio'] : [])]) {
    jobs.push({ kind: 'noise', noise, level: 'loud', sec: 30, seed: 21, src: `noise|${noise}` });
    jobs.push({ kind: 'pause', noise, level: 'loud', sec: 30, seed: 22, src: `pause|${noise}` });
    jobs.push({ kind: 'pause', noise, level: 'realistic', sec: 30, seed: 23, src: `pause|${noise}` });
  }
  // the piano in a loud room (speech / TV 10 dB below it, knocks and dishes)
  for (const seed of seeds.slice(0, 1))
    for (const inst of insts)
      for (const noise of ['speech', 'tv', 'taps', 'dishes', ...(hasInstrument('salamander') ? ['real-speech', 'real-radio'] : [])])
        for (const mat of ['lesson', 'triads', 'scales16']) jobs.push({ kind: 'piano', inst, cond: 'stand', mat, part: mat === 'lesson' ? 1 : 0, seed, noise, snr: 10, src: `${inst}|stand+${noise}|${mat}` });
  jobs.forEach((j, i) => {
    j.id = i;
    j.fold = i % 5;
  });
  // longest first
  jobs.sort((a, b) => (b.mat === 'lesson' ? 1 : 0) - (a.mat === 'lesson' ? 1 : 0));
  return jobs;
}

// ---- fitting ----------------------------------------------------------------------------------
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
function rngF(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Class-balanced; separately for expected / unexpected candidates and for new / sounding notes
// (each group matters on its own); negatives from noise count double.
function weights(rows, noiseW = 2) {
  const cnt = {};
  const g = (r) => `${r.exp}${r.active}${r.label}`;
  for (const r of rows) cnt[g(r)] = (cnt[g(r)] || 0) + 1;
  return rows.map((r) => ((r.boost || 1) * (r.noise && !r.label ? noiseW : 1)) / cnt[g(r)]);
}

function fitMLP(rows, { H = 10, epochs = 30, lr = 0.01, lam = 1e-4, seed = 1, init = null, noiseW = 2 } = {}) {
  const rand = rngF(seed);
  const D = LOOK_KEYS.length;
  let sw = weights(rows, noiseW);
  const tot = sw.reduce((a, b) => a + b, 0);
  sw = sw.map((v) => (v / tot) * rows.length);
  const P = init
    ? { W1: init.W1.map((r) => [...r]), b1: [...init.b1], w2: [...init.w2], b2: init.b2 }
    : { W1: Array.from({ length: H }, () => Array.from({ length: D }, () => (rand() * 2 - 1) * 0.4)), b1: new Array(H).fill(0), w2: Array.from({ length: H }, () => (rand() * 2 - 1) * 0.4), b2: 0 };
  const ref = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < D; i++) ref.push([P.W1[j], i]);
  for (let j = 0; j < H; j++) ref.push([P.b1, j]);
  for (let j = 0; j < H; j++) ref.push([P.w2, j]);
  ref.push([P, 'b2']);
  const m = new Float64Array(ref.length),
    v = new Float64Array(ref.length);
  let step = 0;
  const idx = rows.map((_, i) => i);
  const B = 512;
  const h = new Float64Array(H);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (let s0 = 0; s0 < idx.length; s0 += B) {
      const g = new Float64Array(ref.length);
      const n = Math.min(B, idx.length - s0);
      for (let q = 0; q < n; q++) {
        const r = idx[s0 + q];
        const x = rows[r].x;
        let z = P.b2;
        for (let j = 0; j < H; j++) {
          let a = P.b1[j];
          const w = P.W1[j];
          for (let i = 0; i < D; i++) a += w[i] * x[i];
          h[j] = Math.tanh(a);
          z += P.w2[j] * h[j];
        }
        const e = (sigmoid(z) - rows[r].label) * sw[r];
        let k = 0;
        for (let j = 0; j < H; j++) {
          const dh = e * P.w2[j] * (1 - h[j] * h[j]);
          for (let i = 0; i < D; i++) g[k++] += dh * x[i];
        }
        for (let j = 0; j < H; j++) g[k++] += e * P.w2[j] * (1 - h[j] * h[j]);
        for (let j = 0; j < H; j++) g[k++] += e * h[j];
        g[k] += e;
      }
      step++;
      for (let k = 0; k < ref.length; k++) {
        const [o, key] = ref[k];
        const gk = g[k] / n + lam * o[key];
        m[k] = 0.9 * m[k] + 0.1 * gk;
        v[k] = 0.999 * v[k] + 0.001 * gk * gk;
        const mh = m[k] / (1 - Math.pow(0.9, step)),
          vh = v[k] / (1 - Math.pow(0.999, step));
        o[key] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
      }
    }
  }
  const r3 = (a) => a.map((u) => +u.toFixed(3));
  return { keys: LOOK_KEYS, W1: P.W1.map(r3), b1: r3(P.b1), w2: r3(P.w2), b2: +P.b2.toFixed(3) };
}

function logit(M, x) {
  let z = M.b2;
  for (let j = 0; j < M.b1.length; j++) {
    let a = M.b1[j];
    for (let i = 0; i < x.length; i++) a += M.W1[j][i] * x[i];
    z += M.w2[j] * Math.tanh(a);
  }
  return z;
}

// Candidate-level report with the transcriber's emission rule (strictness 0.5): an expected
// note fires at p >= 0.55, an unexpected one at p >= 0.875 once seen in two windows and when
// the piano's level is known; a sounding note is re-struck at 0.6 (expected) / 0.85.
// Emission rule of _lookDecide at strictness 0.5: expected new notes at p >= 0.925, sounding
// notes struck again at 0.85 (unexpected ones only in free play); unexpected new notes only in free play, once
// seen in two windows, when the piano's level is known, at p >= 0.875.
export function fires(r, p) {
  const relKnown = r.x[LOOK_KEYS.indexOf('relKnown')];
  if (r.defer) return false;
  if (r.active) return r.exp ? p >= 0.85 : !r.src.endsWith('|lesson') && p >= 0.85;
  if (r.exp) return p >= 0.925;
  return !r.src.endsWith('|lesson') && relKnown && r.n >= 2 && p >= 0.875;
}

function report(rows, M, title) {
  const by = new Map();
  for (const r of rows) {
    let c = by.get(r.key);
    if (!c) by.set(r.key, (c = { label: r.label, exp: r.exp, active: r.active, noise: r.noise, src: r.src, fired: false }));
    const p = sigmoid(logit(r.exp ? M.exp : M.free, r.x));
    if (fires(r, p)) c.fired = true;
  }
  const agg = {};
  for (const c of by.values()) {
    const g = `${c.noise ? 'noise ' : ''}${c.exp ? 'expected' : 'unexpected'} ${c.active ? 'sounding' : 'new'}`;
    const a = (agg[g] ||= { pos: 0, tp: 0, neg: 0, fp: 0 });
    if (c.label) {
      a.pos++;
      if (c.fired) a.tp++;
    } else {
      a.neg++;
      if (c.fired) a.fp++;
    }
  }
  console.log(`${title}: candidates fired (recall of real strikes / false among the others)`);
  for (const [g, a] of Object.entries(agg).sort()) console.log(`  ${g.padEnd(28)} ${a.pos ? ((a.tp / a.pos) * 100).toFixed(1).padStart(5) : '    -'}% of ${String(a.pos).padStart(6)}   false ${String(a.fp).padStart(5)} of ${a.neg}`);
}

// DUMP files: one JSON row per line (older dumps: one JSON array)
function readRows(file) {
  const txt = fs.readFileSync(file, 'utf8');
  if (txt[0] === '[') return JSON.parse(txt);
  return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const mode = process.argv[2] || 'fit';
  const threads = Number(process.env.THREADS || os.cpus().length);
  const jobs = buildJobs();
  const t0 = Date.now();
  const { LOOK_MODEL } = await import(pathToFileURL(TR_PATH).href);
  if (mode === 'eval') {
    const rows = process.env.ROWS ? readRows(process.env.ROWS) : await runAll(jobs, null, threads);
    report(rows, LOOK_MODEL, 'current LOOK_MODEL');
    return;
  }
  let M = null;
  let rows = process.env.ROWS ? readRows(process.env.ROWS) : null;
  const rounds = Number(process.env.ROUNDS || 2);
  const H = Number(process.env.H || 10);
  for (let round = 1; round <= rounds; round++) {
    // DAgger: keep every round's rows, add the ones the latest model runs into
    // (COLLECT=regex: only jobs whose source matches, e.g. new material added to a ROWS dump)
    const coll = process.env.COLLECT ? jobs.filter((j) => new RegExp(process.env.COLLECT).test(j.src)) : jobs;
    if (!rows || round > 1) rows = [...(rows || []), ...(await runAll(coll, M, threads))];
    console.log(`round ${round}: ${rows.length} candidate rows (${rows.filter((r) => r.label).length} real strikes), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const byJob = (r) => Number(r.key.split('|')[0]) % 5;
    const train = rows.filter((r) => byJob(r) !== 0),
      val = rows.filter((r) => byJob(r) === 0);
    const data = process.env.FULL ? rows : train;
    const ep = Number(process.env.EPOCHS || 30);
    const fitBoth = (init, epochs, lr) => ({
      exp: fitMLP(data.filter((r) => r.exp), { H, epochs, lr, init: init ? init.exp : null }),
      free: fitMLP(data.filter((r) => !r.exp), { H, epochs, lr, init: init ? init.free : null, noiseW: Number(process.env.NOISEW || 4) }),
    });
    M = fitBoth(M, ep, 0.01);
    // Hard examples: a candidate fires as soon as ONE look is confident enough, so candidates
    // that fire falsely get more weight (all their looks), as do real strikes that never fire.
    for (let hm = 0; hm < Number(process.env.MINE ?? 2); hm++) {
      const by = new Map();
      for (const r of data) {
        let c = by.get(r.key);
        if (!c) by.set(r.key, (c = { rows: [], fired: false, label: r.label }));
        c.rows.push(r);
        if (fires(r, sigmoid(logit(r.exp ? M.exp : M.free, r.x)))) c.fired = true;
      }
      let hn = 0,
        hp = 0;
      for (const c of by.values()) {
        if (!c.label && c.fired) {
          hn++;
          for (const r of c.rows) r.boost = (r.boost || 1) * 2;
        } else if (c.label && !c.fired) {
          hp++;
          for (const r of c.rows) r.boost = (r.boost || 1) * 1.5;
        }
      }
      console.log(`  hard examples: ${hn} false fires, ${hp} misses`);
      M = fitBoth(M, 12, 0.005);
    }
    report(val, M, `round ${round}, validation fold`);
    if (process.env.MODEL_OUT) fs.writeFileSync(process.env.MODEL_OUT, JSON.stringify(M));
  }
  if (process.env.DUMP) {
    // one row per line (a single JSON string of this many rows is too long for V8)
    const fd = fs.openSync(process.env.DUMP, 'w');
    for (const r of rows) fs.writeSync(fd, JSON.stringify(r) + '\n');
    fs.closeSync(fd);
  }
  report(rows, M, 'all data');
  console.log('\nexport const LOOK_MODEL = ' + JSON.stringify(M) + ';');
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) main();
