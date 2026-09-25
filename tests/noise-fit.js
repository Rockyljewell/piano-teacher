// Fits the listener's confidence model (CONF_MODEL in js/audio/transcriber.js) on labelled
// data: every note hypothesis the transcriber forms is recorded (features at every frame it is
// watched) and labelled "piano" if a note of that pitch was really played within 80 ms of its
// attack, otherwise "noise".
//
//   node tests/noise-fit.js            fit and print weights (paste them into CONF_MODEL)
//   node tests/noise-fit.js eval       evaluate the current CONF_MODEL on the same data
//
// Data: sampled grand (if the corpus is cached) + synth piano pieces, clean and mixed with
// every noise type; noise-only clips of every type. Different seeds from noise-eval.js.
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { Transcriber, CONF_MODEL } from '../js/audio/transcriber.js';
import { pieces, renderPiece, makeNoise, NOISE_TYPES } from './noise-eval.js';
import { loadCorpus } from './corpus-piano.js';
import { roomTone, mixInto, activeRms, gainDb } from './noise-sim.js';

const SR = 48000;
const KEYS = ['sal', 'tonal', 'tonalHi', 'dev', 'drift', 'driftMax', 'rise', 'riseMed', 'harm', 'swell', 'sustain', 'slope', 'span', 'attackFrac', 'peakAge', 'snr', 'rel', 'age', 'nsig', 'vib', 'rough'];

function collect(audio, sr, notes, { expectedFrac = 0 } = {}) {
  const rows = [];
  const tr = new Transcriber(sr, {
    collect: true,
    onCandidate: (c) => {
      let label = 0;
      if (notes) for (const n of notes) if (n.midi === c.midi && Math.abs(n.t - c.attackT) < 0.08) label = 1;
      rows.push({ midi: c.midi, age: c.age, nf: c.nf, expected: c.expected ? 1 : 0, x: c.x, raw: c.raw, label, attackT: c.attackT, final: c.decision !== 'observe' });
    },
  });
  // score-informed prior for a fraction of the notes (like the practice engine does)
  const exp = notes && expectedFrac > 0 ? notes.filter((_, i) => (i * 7919) % 100 < expectedFrac * 100) : [];
  tr.startCalibration();
  let calibrated = false;
  for (let i = 0; i + 128 <= audio.length; i += 128) {
    const t = i / sr;
    if (!calibrated && t > 0.4) {
      tr.finishCalibration();
      calibrated = true;
    }
    if (exp.length && i % 4096 === 0) tr.setExpected(exp.filter((n) => n.t > t - 0.3 && n.t < t + 0.4).map((n) => n.midi));
    tr.push(audio.subarray(i, i + 128), i);
  }
  return rows;
}

function job(j) {
  const sr = SR;
  if (j.kind === 'pause') {
    const P = pieces(j.pieceSeed);
    const notes = P.beginner.filter((n) => n.t < 10);
    const pre = 11;
    const audio = renderPiece(j.engine, notes, { sr, seed: j.seed, length: pre + j.sec });
    const x = makeNoise(j.noise, j.sec, { sr, seed: j.seed, level: j.level, engine: j.engine });
    if (!x) return [];
    mixInto(audio, x, 1, pre * sr);
    return collect(audio, sr, notes).map((r) => ({ ...r, src: r.attackT > pre ? `pause:${j.noise}` : `${j.engine}:pause-piano`, fold: j.fold, job: j.id }));
  }
  if (j.kind === 'noise') {
    const pre = 1;
    const x = makeNoise(j.noise, j.sec, { sr, seed: j.seed, level: j.level });
    if (!x) return [];
    const audio = roomTone(pre + j.sec, { sr, seed: 98 });
    for (let i = 0; i < audio.length; i++) audio[i] *= 0.00045;
    mixInto(audio, x, 1, pre * sr);
    return collect(audio, sr, null).map((r) => ({ ...r, src: j.noise, fold: j.fold, job: j.id }));
  }
  const P = pieces(j.pieceSeed);
  const notes = P[j.piece];
  const ropts = { sr, seed: j.seed, ...(j.render || {}) };
  if (j.piece === 'pedal') ropts.pedal = P.pedalTimes;
  const audio = renderPiece(j.engine, notes, ropts);
  if (j.noise) {
    const x = makeNoise(j.noise, audio.length / sr, { sr, seed: j.seed, level: 0, engine: j.engine });
    if (x) mixInto(audio, x, activeRms(audio, sr) / activeRms(x, sr) / gainDb(j.snr), 0);
  }
  return collect(audio, sr, notes, { expectedFrac: j.expectedFrac || 0 }).map((r) => ({ ...r, src: `${j.engine}:${j.piece}${j.noise ? '+' + j.noise : ''}`, fold: j.fold, job: j.id }));
}

if (!isMainThread && workerData && workerData.fit) {
  parentPort.on('message', (j) => {
    try {
      parentPort.postMessage(job(j));
    } catch (e) {
      parentPort.postMessage({ error: String(e.stack) });
    }
  });
}

async function runAll(jobs) {
  const out = new Array(jobs.length);
  let next = 0;
  const file = fileURLToPath(import.meta.url);
  await Promise.all(
    Array.from({ length: Math.min(os.cpus().length, jobs.length) }, async () => {
      const w = new Worker(file, { workerData: { fit: true } });
      w.setMaxListeners(0);
      while (next < jobs.length) {
        const i = next++;
        out[i] = await new Promise((res) => {
          w.once('message', res);
          w.postMessage(jobs[i]);
        });
        if (out[i].error) console.error(out[i].error);
      }
      await w.terminate();
    }),
  );
  return out.flat().filter((r) => r && r.x);
}

export function buildJobs() {
  const engines = loadCorpus() ? ['sampled', 'synth'] : ['synth'];
  const jobs = [];
  for (const engine of engines)
    for (const pieceSeed of [21, 22]) {
      for (const piece of ['singles', 'soft', 'triads', 'twohand', 'repeated', 'scale', 'pedal', 'beginner', 'melody', 'dynamics'])
        jobs.push({ kind: 'piano', engine, piece, pieceSeed, seed: pieceSeed + 5, expectedFrac: piece === 'beginner' ? 0.5 : 0 });
      jobs.push({ kind: 'piano', engine, piece: 'melody', pieceSeed, seed: 3, render: { reverb: { rt60: 0.9, wet: 0.5 } } });
      for (const noise of [...NOISE_TYPES, ...(engine === 'sampled' ? ['real-speech', 'real-radio'] : [])])
        for (const snr of [15, 6]) jobs.push({ kind: 'piano', engine, piece: pieceSeed === 21 ? 'beginner' : 'melody', pieceSeed, seed: pieceSeed + snr, noise, snr });
    }
  for (const noise of [...NOISE_TYPES, ...(loadCorpus() ? ['real-speech', 'real-radio'] : [])])
    for (const [level, seed] of [
      ['realistic', 11],
      ['loud', 12],
      [-3, 13],
    ])
      jobs.push({ kind: 'noise', noise, level, sec: 40, seed });
  for (const noise of [...NOISE_TYPES, ...(loadCorpus() ? ['real-speech', 'real-radio'] : [])])
    jobs.push({ kind: 'pause', engine: engines[0], noise, level: 'loud', sec: 30, seed: 31, pieceSeed: 23 });
  jobs.forEach((j, i) => {
    j.fold = i % 5;
    j.id = i;
  });
  return jobs;
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function vec(r) {
  return KEYS.map((k) => r.x[k] || 0);
}

// Sample weights: classes balanced; noise-only material counts double (a false note while
// nobody plays is the most annoying failure).
function weights(rows) {
  const pos = rows.filter((r) => r.label).length,
    neg = rows.length - pos;
  return rows.map((r) => (r.boost || 1) * (r.label ? 0.5 / pos : ((r.src.includes(':') && !r.src.startsWith('pause:') ? 1 : 2) * 0.5) / neg));
}

function rngF(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// One-hidden-layer tanh MLP, logistic output, Adam, L2.
function fitMLP(rows, { H = 12, epochs = 40, lr = 0.01, lam = 1e-4, seed = 1, init = null } = {}) {
  const rand = rngF(seed);
  const X = rows.map(vec),
    y = rows.map((r) => r.label);
  let sw = weights(rows);
  const tot = sw.reduce((a, b) => a + b, 0);
  sw = sw.map((v) => (v / tot) * rows.length); // mean weight 1
  const D = KEYS.length;
  const P = init
    ? { W1: init.W1.map((r) => [...r]), b1: [...init.b1], w2: [...init.w2], b2: init.b2 }
    : { W1: Array.from({ length: H }, () => Array.from({ length: D }, () => (rand() * 2 - 1) * 0.5)), b1: new Array(H).fill(0), w2: Array.from({ length: H }, () => (rand() * 2 - 1) * 0.5), b2: 0 };
  const params = [];
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
        const x = X[r];
        let z = P.b2;
        for (let j = 0; j < H; j++) {
          let a = P.b1[j];
          const w = P.W1[j];
          for (let i = 0; i < D; i++) a += w[i] * x[i];
          h[j] = Math.tanh(a);
          z += P.w2[j] * h[j];
        }
        const e = (sigmoid(z) - y[r]) * sw[r];
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
  void params;
  const r3 = (a) => a.map((u) => +u.toFixed(3));
  return { keys: KEYS, W1: P.W1.map(r3), b1: r3(P.b1), w2: r3(P.w2), b2: +P.b2.toFixed(3), expected: 1 };
}

function mlp(M, r) {
  let z = M.b2;
  for (let j = 0; j < M.b1.length; j++) {
    let a = M.b1[j];
    for (let i = 0; i < M.keys.length; i++) a += M.W1[j][i] * (r.x[M.keys[i]] || 0);
    z += M.w2[j] * Math.tanh(a);
  }
  return z;
}

// The transcriber's rule for unexpected notes (strictness 0.5): emitted as soon as a snapshot at
// age >= 0.1 s reaches `fast`, else at the end if max(final, (best + final) / 2) >= `emit`.
function emitted(snaps, fast = 0.95, emit = 0.5) {
  let best = 0,
    fin = 0;
  for (const s of snaps) {
    if (s.age >= 0.1 && s.p >= fast) return true;
    if (s.age >= 0.1) best = Math.max(best, s.p);
    fin = s.p;
  }
  return Math.max(fin, (fin + best) / 2) >= emit;
}

function reportCands(rows, predict) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.job}|${r.midi}|${r.attackT}`;
    let c = by.get(k);
    if (!c) by.set(k, (c = { src: r.src, label: r.label, snaps: [] }));
    c.snaps.push({ age: r.age, p: predict(r) });
  }
  for (const c of by.values()) c.emitted = emitted(c.snaps);
  const agg = {};
  for (const c of by.values()) {
    const g = c.src.includes(':') && !c.src.startsWith('pause:') ? c.src.split(':')[0] + (c.src.includes('+') ? '+noise' : '') : c.src;
    const a = (agg[g] ||= { pos: 0, tp: 0, neg: 0, fp: 0 });
    if (c.label) {
      a.pos++;
      if (c.emitted) a.tp++;
    } else {
      a.neg++;
      if (c.emitted) a.fp++;
    }
  }
  console.log('candidate-level (emission rule):');
  for (const [g, a] of Object.entries(agg).sort()) console.log(`  ${g.padEnd(22)} recall ${a.pos ? ((a.tp / a.pos) * 100).toFixed(1) : '-'}%  false ${a.fp}/${a.neg}`);
}

function report(rows, predict) {
  // at the final decision of each hypothesis
  const fin = rows.filter((r) => r.final);
  const bySrc = {};
  for (const r of fin) {
    const p = predict(r);
    const k = r.src;
    const b = (bySrc[k] ||= { pos: 0, neg: 0, tp: {}, fp: {} });
    if (r.label) b.pos++;
    else b.neg++;
    for (const th of [0.3, 0.5, 0.7]) {
      if (p >= th) {
        if (r.label) b.tp[th] = (b.tp[th] || 0) + 1;
        else b.fp[th] = (b.fp[th] || 0) + 1;
      }
    }
  }
  console.log('source'.padEnd(34) + 'pos  neg | recall@.3 .5 .7 | fp@.3 .5 .7');
  for (const [k, b] of Object.entries(bySrc).sort()) {
    const rc = (th) => (b.pos ? (((b.tp[th] || 0) / b.pos) * 100).toFixed(0) : '-').padStart(4);
    const fp = (th) => String(b.fp[th] || 0).padStart(4);
    console.log(k.padEnd(34) + String(b.pos).padStart(4) + String(b.neg).padStart(5) + ' | ' + rc(0.3) + rc(0.5) + rc(0.7) + '    | ' + fp(0.3) + fp(0.5) + fp(0.7));
  }
}

async function main() {
  const mode = process.argv[2] || 'fit';
  const t0 = Date.now();
  let rows;
  if (process.env.ROWS) rows = JSON.parse((await import('node:fs')).readFileSync(process.env.ROWS, 'utf8'));
  else rows = await runAll(buildJobs());
  console.log(`${rows.length} snapshots (${rows.filter((r) => r.label).length} piano) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify(rows));
  const expBonus = (M, r) => (r.expected ? (M.expected ?? 1) : 0);
  if (mode === 'eval') return report(rows, (r) => sigmoid(mlp(CONF_MODEL, r) + expBonus(CONF_MODEL, r)));
  // Train on every snapshot (early and late) so the model works at any decision time.
  const train = rows.filter((r) => r.fold !== 0),
    val = rows.filter((r) => r.fold === 0);
  const data = process.env.FULL ? rows : train;
  let M = fitMLP(data, { H: +(process.env.H || 12), epochs: +(process.env.EPOCHS || 40) });
  // Hard-negative mining: a note hypothesis is emitted as soon as ONE snapshot is confident
  // enough, so noise hypotheses whose best snapshot scores high get more weight, as do real
  // notes whose final snapshot scores low; then refine.
  for (let round = 0; round < +(process.env.ROUNDS ?? 2); round++) {
    const byCand = new Map();
    for (const r of data) {
      const k = `${r.job}|${r.midi}|${r.attackT}`;
      let c = byCand.get(k);
      if (!c) byCand.set(k, (c = { rows: [], snaps: [] }));
      c.rows.push(r);
      c.snaps.push({ age: r.age, p: sigmoid(mlp(M, r)), final: r.final });
    }
    let hn = 0,
      hp = 0;
    for (const c of byCand.values()) {
      const lab = c.rows[0].label;
      const em = emitted(c.snaps);
      if (!lab && em) {
        hn++;
        for (const r of c.rows) r.boost = (r.boost || 1) * +(process.env.HNB || 1.7);
      } else if (lab && !em) {
        hp++;
        for (const r of c.rows) r.boost = (r.boost || 1) * 1.7;
      }
    }
    console.log(`round ${round + 1}: ${hn} hard negatives, ${hp} hard positives`);
    M = fitMLP(data, { H: +(process.env.H || 12), epochs: 15, init: M, lr: 0.005 });
  }
  const pred = (r) => sigmoid(mlp(M, r) + expBonus(M, r));
  console.log('\nvalidation fold:');
  report(val, pred);
  reportCands(val, pred);
  console.log('\nall data:');
  report(rows, pred);
  console.log('\nexport const CONF_MODEL = ' + JSON.stringify(M) + ';');
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) main();
