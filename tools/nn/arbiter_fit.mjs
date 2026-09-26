// Fit the hybrid listener's free-play arbiter (js/audio/nn/arbiter.js) on recordings of the
// TRAINING pianos (tools/nn/arbiter_rec.mjs: sets sal, valmix, noise), and replay it - or the
// previous fixed rules - offline, scored as the benchmark scores (same key, onset within 80 ms).
//
//   node tools/nn/arbiter_fit.mjs fit [--write]     fit on sal + valmix + noise, print, write
//                                                   js/audio/nn/arbiter-model.js
//   node tools/nn/arbiter_fit.mjs thr <model.json> <out.json>  search only the thresholds
//   node tools/nn/arbiter_fit.mjs write <model.json>      write that model as the shipped one
//   node tools/nn/arbiter_fit.mjs eval <set> [model.json|legacy|dsp|current]
//   node tools/nn/arbiter_fit.mjs diag <set> [...]  what the false notes / misses are
//
// The `heldout` set (the benchmark's held-out pianos) is only ever evaluated, never fitted on.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { FreeArbiter, FEATS } from '../../js/audio/nn/arbiter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ARB = path.join(here, '.data', 'arb');

// ---- data ---------------------------------------------------------------------------------------
export function load(set) {
  const dir = path.join(ARB, set);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  return files.map((f) => {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const b = fs.readFileSync(path.join(dir, f.replace(/\.json$/, '.bin')));
    r.bin = new Uint8Array(b.buffer, b.byteOffset, b.length);
    r.set = set;
    r.mat = r.job.mat || (r.job.noiseOnly ? 'noise' : r.job.kind === 'pause' ? 'pause' : set === 'valmix' ? (r.job.noise ? 'noise' : 'valmix') : 'x');
    r.cond = r.job.cond || '';
    return r;
  });
}

function frameArrays(r, i) {
  if (!r.PP) {
    const b = r.bin,
      n = r.ft.length;
    r.PP = new Float32Array(n * 88);
    r.PF = new Float32Array(n * 88);
    for (let f = 0; f < n; f++)
      for (let k = 0; k < 88; k++) {
        const o = f * 264;
        r.PP[f * 88 + k] = (b[o + 2 * k] | (b[o + 2 * k + 1] << 8)) / 65535;
        r.PF[f * 88 + k] = b[o + 176 + k] / 255;
      }
  }
  return [r.PP.subarray(i * 88, i * 88 + 88), r.PF.subarray(i * 88, i * 88 + 88)];
}

// timeline in the order the live hybrid sees it within one audio chunk: DSP onsets, DSP notes,
// network notes, then the network frame
function timeline(r) {
  if (r._tl) return r._tl;
  const tl = [];
  for (const o of r.onsets) tl.push({ at: o.at, o: 0, kind: 'onset', e: o });
  for (const e of r.dsp) tl.push({ at: e.at, o: 1, kind: 'dsp', e });
  for (const e of r.nn) tl.push({ at: e.at, o: 2, kind: 'nn', e });
  r.ft.forEach((at, i) => tl.push({ at, o: 3, kind: 'frame', i }));
  tl.sort((a, b) => a.at - b.at || a.o - b.o);
  return (r._tl = tl);
}

// ---- policies -----------------------------------------------------------------------------------
// the rules the hybrid had before the arbiter (trustP / octave partners / wait)
function legacy(r, { trustP = 0.995, octP = 0.7, octPLow = 0.5, wait = 0.25 } = {}) {
  const out = [];
  let held = [];
  let lastP = null;
  const has = (m, t) => out.some((x) => x.midi === m && Math.abs(x.t - t) <= 0.08);
  const partner = (m, t) => out.some((x) => Math.abs(x.t - t) <= 0.04 && (x.midi === m - 12 || x.midi === m + 12 || x.midi === m - 24));
  const check = (now) => {
    const keep = [];
    for (const h of held) {
      if (has(h.midi, h.t)) continue;
      if (lastP) h.pmax = Math.max(h.pmax, lastP[h.midi - 21]);
      const oP = h.midi < 60 ? octPLow : octP;
      if (h.pmax >= trustP || (h.pmax >= oP && partner(h.midi, h.t))) out.push({ midi: h.midi, t: h.t, at: now, src: 'nn', p: h.pmax });
      else if (now < h.until) keep.push(h);
    }
    held = keep;
  };
  for (const x of timeline(r)) {
    if (x.kind === 'dsp') {
      const e = x.e;
      if (!e.restrike && out.some((o) => o.src === 'nn' && o.midi === e.midi && Math.abs(o.t - e.t) <= 0.08)) continue;
      out.push({ ...e, src: 'dsp' });
      check(x.at);
    } else if (x.kind === 'nn') {
      const e = x.e;
      if (e.restrike || has(e.midi, e.t)) continue;
      held.push({ midi: e.midi, t: e.t, pmax: e.p, until: x.at + wait });
      check(x.at);
    } else if (x.kind === 'frame') {
      lastP = frameArrays(r, x.i)[0];
      check(x.at);
    }
  }
  return out;
}

export function replay(r, model, collect = null) {
  if (model === 'legacy') return legacy(r);
  if (model === 'dsp') return r.dsp.map((e) => ({ ...e, src: 'dsp' }));
  const out = [];
  let now = 0;
  const A = new FreeArbiter((midi, t, vel, info, src) => out.push({ midi, t, at: now, src, conf: info.confidence, restrike: !!info.restrike }), model, { collect });
  for (const x of timeline(r)) {
    now = x.at;
    if (x.kind === 'onset') A.onset(x.e.t, x.e.s);
    else if (x.kind === 'dsp') A.dsp(x.e.midi, x.e.t, 0.5, { confidence: x.e.conf, restrike: x.e.restrike, path: x.e.path }, now);
    else if (x.kind === 'nn') A.nn(x.e.midi, x.e.t, 0.5, { p: x.e.p, confidence: x.e.p, restrike: x.e.restrike }, now);
    else {
      const [P, Pf] = frameArrays(r, x.i);
      A.frame(now, P, Pf);
    }
  }
  return out;
}

// ---- scoring (tests/bench-listen.js match / scoreCell) ------------------------------------------
export function match(notes, events, tol = 0.08) {
  const pairs = [];
  for (let i = 0; i < notes.length; i++)
    for (let j = 0; j < events.length; j++) {
      if (events[j].midi !== notes[i].midi) continue;
      const d = Math.abs(events[j].t - notes[i].t);
      if (d <= tol) pairs.push([d, i, j]);
    }
  pairs.sort((a, b) => a[0] - b[0]);
  const noteHit = new Int32Array(notes.length).fill(-1);
  const evUsed = new Int32Array(events.length).fill(-1);
  for (const [, i, j] of pairs) {
    if (noteHit[i] >= 0 || evUsed[j] >= 0) continue;
    noteHit[i] = j;
    evUsed[j] = i;
  }
  return { noteHit, evUsed };
}

const pct = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};

function newAcc() {
  return { n: 0, hit: 0, ex: 0, lo: [], up: [], sec: 0, fp: 0, oct: 0, octHit: 0 };
}

export function evaluate(recs, model) {
  const acc = {}; // key: `${cond}|${mat}` and totals
  const get = (k) => (acc[k] ||= newAcc());
  for (const r of recs) {
    const ev = replay(r, model);
    if (r.fpFrom != null || r.job.noise) {
      // noise-only / pause: every note after fpFrom is false
      const from = r.fpFrom ?? 0.45;
      const fp = ev.filter((e) => e.t > from).length;
      for (const k of [`noise|${r.job.kind || 'valnoise'}`, `noise|${r.job.kind === 'noise' ? r.job.level : 'x'}`, 'noise|all']) {
        const a = get(k);
        a.fp += fp;
        a.sec += r.sec - from;
      }
      if (r.job.kind === 'noise') {
        const a = get(`noise|${r.job.noise}-${r.job.level}`);
        a.fp += fp;
        a.sec += r.sec - from;
      }
      continue;
    }
    const notes = r.notes.filter((n) => n.t >= 0.45);
    const evs = ev.filter((e) => e.t >= 0.3);
    const { noteHit, evUsed } = match(notes, evs);
    const octMat = /^oct(aves|melody)/.test(r.mat);
    for (const k of [`${r.cond}|${r.mat}`, `${r.cond}|all`, `all|${r.mat}`, 'all|all', ...(octMat ? ['all|octs'] : [])]) {
      const a = get(k);
      a.n += notes.length;
      notes.forEach((n, i) => {
        if (noteHit[i] < 0) return;
        a.hit++;
        const l = (evs[noteHit[i]].at - n.t) * 1000;
        (n.midi < 48 ? a.lo : a.up).push(l);
      });
      a.ex += evs.filter((_, j) => evUsed[j] < 0).length;
      const G = new Map();
      notes.forEach((n, i) => n.g > 0 && (G.has(n.g) ? G.get(n.g).push(i) : G.set(n.g, [i])));
      for (const ix of G.values())
        for (const i of ix)
          for (const j of ix)
            if (notes[j].midi - notes[i].midi === 12) {
              a.oct++;
              if (noteHit[i] >= 0 && noteHit[j] >= 0) a.octHit++;
            }
    }
  }
  const S = {};
  for (const [k, a] of Object.entries(acc)) {
    if (a.sec) S[k] = { fpm: (a.fp / a.sec) * 60 };
    else {
      const R = a.hit / Math.max(1, a.n),
        P = a.hit / Math.max(1, a.hit + a.ex);
      S[k] = { oct: a.oct ? a.octHit / a.oct : null, n: a.n, R, P, F: (2 * P * R) / Math.max(1e-9, P + R), up: [pct(a.up, 0.5), pct(a.up, 0.9)], lo: [pct(a.lo, 0.5), pct(a.lo, 0.9)] };
    }
  }
  return S;
}

const f1 = (v) => (v * 100).toFixed(1);
export function show(S, keys = null) {
  const lines = [];
  for (const k of keys || Object.keys(S).sort()) {
    const s = S[k];
    if (!s) continue;
    if (s.fpm != null) lines.push(`${k.padEnd(34)} ${s.fpm.toFixed(1)}/min`);
    else lines.push(`${k.padEnd(34)} R ${f1(s.R)} P ${f1(s.P)} F ${f1(s.F)} n ${s.n}  lat>=C3 ${Math.round(s.up[0])}/${Math.round(s.up[1])} <C3 ${Math.round(s.lo[0])}/${Math.round(s.lo[1])}${s.oct != null ? ' oct ' + f1(s.oct) : ''}`);
  }
  return lines.join('\n');
}

// ---- diagnosis ----------------------------------------------------------------------------------
function diag(recs, model) {
  const cat = {};
  const add = (k) => (cat[k] = (cat[k] || 0) + 1);
  const miss = {};
  const addM = (k) => (miss[k] = (miss[k] || 0) + 1);
  for (const r of recs) {
    if (r.fpFrom != null || r.job.noise) continue;
    const notes = r.notes.filter((n) => n.t >= 0.45);
    const ev = replay(r, model).filter((e) => e.t >= 0.3);
    const { noteHit, evUsed } = match(notes, ev);
    ev.forEach((e, j) => {
      if (evUsed[j] >= 0) return;
      // what is this false note?
      const src = e.src + (e.restrike ? '-re' : '') + (e.path === 'fast' ? '-fast' : '');
      let why = 'other';
      const near = notes.filter((n) => Math.abs(n.t - e.t) <= 0.08);
      if (notes.some((n) => n.midi === e.midi && Math.abs(n.t - e.t) <= 0.3)) why = 'dup/late';
      else if (near.some((n) => [12, 19, 24, 28, 31, 36].includes(e.midi - n.midi))) why = 'partial-above';
      else if (near.some((n) => [12, 19, 24].includes(n.midi - e.midi))) why = 'below';
      else if (near.some((n) => Math.abs(n.midi - e.midi) <= 2)) why = 'neighbour';
      else if (near.length) why = 'other-interval';
      else if (notes.some((n) => Math.abs(n.t - e.t) <= 0.5)) why = 'near-in-time';
      add(`${r.mat.padEnd(10)} ${src.padEnd(10)} ${why}`);
      add(`ALL        ${src.padEnd(10)} ${why}`);
    });
    notes.forEach((n, i) => {
      if (noteHit[i] >= 0) return;
      const dsp = r.dsp.some((e) => e.midi === n.midi && Math.abs(e.t - n.t) <= 0.08);
      const nn = r.nn.find((e) => e.midi === n.midi && Math.abs(e.t - n.t) <= 0.08);
      const reg = n.midi < 48 ? 'lo' : n.midi < 72 ? 'mid' : 'hi';
      const k = dsp ? 'dsp-had' : nn ? `nn-had p${nn.p < 0.5 ? '<.5' : nn.p < 0.9 ? '<.9' : nn.p < 0.99 ? '<.99' : '>.99'}` : 'neither';
      addM(`${r.mat.padEnd(10)} ${reg.padEnd(4)} ${k}`);
      addM(`ALL        ${reg.padEnd(4)} ${k}`);
    });
  }
  console.log('false notes by material / source / kind:');
  for (const [k, v] of Object.entries(cat).sort()) console.log(`  ${k.padEnd(44)} ${v}`);
  console.log('misses by material / register / what the engines had:');
  for (const [k, v] of Object.entries(miss).sort()) console.log(`  ${k.padEnd(44)} ${v}`);
}

// ---- fitting -----------------------------------------------------------------------------------
// Snapshots of every decision the arbiter takes on a recording, labelled: is there a true note
// at that key within 80 ms of the candidate's attack?
export function collect(recs, model, setW = {}) {
  const D = { dsp: [], nn: [] };
  for (const r of recs) {
    const w0 = setW[r.set] ?? 1;
    const perCand = new Map();
    replay(r, model, (kind, x, c) => {
      if (c.t < 0.45) return;
      const y = r.notes.some((n) => n.midi === c.midi && Math.abs(n.t - c.t) <= 0.08) ? 1 : 0;
      const s = { x: Float32Array.from(x), y, w: w0, partner: c.partner };
      D[kind].push(s);
      if (kind === 'nn') {
        const key = `${c.midi}@${c.t.toFixed(3)}`;
        if (!perCand.has(key)) perCand.set(key, []);
        perCand.get(key).push(s);
      }
    });
    // a network candidate counts once, however many frames it was looked at
    for (const L of perCand.values()) for (const s of L) s.w /= Math.sqrt(L.length);
    // the decoded frames are rebuilt when needed (memory)
    r.PP = r.PF = r._tl = null;
  }
  // every other network snapshot is enough (neighbouring frames are nearly the same)
  const keep = Number(process.env.NN_KEEP || 0.5);
  if (keep < 1) {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    D.nn = D.nn.filter(() => rnd() < keep);
    for (const s of D.nn) s.w /= keep;
  }
  return D;
}

// L2-regularised logistic regression (Newton), optional tanh hidden layer (Adam)
export function fitLogistic(S, { l2 = 1, hidden = 0, iters = 25 } = {}) {
  const d = S[0].x.length;
  const mu = new Float64Array(d),
    sd = new Float64Array(d);
  let W = 0;
  for (const s of S) {
    W += s.w;
    for (let i = 0; i < d; i++) mu[i] += s.w * s.x[i];
  }
  for (let i = 0; i < d; i++) mu[i] /= W;
  for (const s of S) for (let i = 0; i < d; i++) sd[i] += s.w * (s.x[i] - mu[i]) ** 2;
  for (let i = 0; i < d; i++) sd[i] = Math.sqrt(sd[i] / W) || 1;
  const X = S.map((s) => {
    const z = new Float32Array(d + 1);
    for (let i = 0; i < d; i++) z[i] = (s.x[i] - mu[i]) / sd[i];
    z[d] = 1;
    return z;
  });
  const n = d + 1;
  let w = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    const g = new Float64Array(n);
    const H = Array.from({ length: n }, () => new Float64Array(n));
    for (let j = 0; j < S.length; j++) {
      const x = X[j];
      let z = 0;
      for (let i = 0; i < n; i++) z += w[i] * x[i];
      const p = 1 / (1 + Math.exp(-z));
      const sw = S[j].w;
      const r = sw * (p - S[j].y);
      const h = sw * p * (1 - p);
      for (let a = 0; a < n; a++) {
        g[a] += r * x[a];
        const ha = h * x[a];
        for (let b = a; b < n; b++) H[a][b] += ha * x[b];
      }
    }
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < a; b++) H[a][b] = H[b][a];
      if (a < d) {
        g[a] += l2 * w[a];
        H[a][a] += l2;
      }
      H[a][a] += 1e-9;
    }
    const step = solve(H, g);
    let mx = 0;
    for (let i = 0; i < n; i++) {
      w[i] -= step[i];
      mx = Math.max(mx, Math.abs(step[i]));
    }
    if (mx < 1e-6) break;
  }
  const M = { w: Array.from(w.slice(0, d)), b: w[d], mu: Array.from(mu), sd: Array.from(sd) };
  if (hidden > 0) return fitMLP(S, X, M, hidden, l2);
  return M;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// small tanh MLP on the standardised features, full-batch Adam, started from the linear model
function fitMLP(S, X, lin, H, l2) {
  const d = lin.w.length;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.2;
  const W1 = Array.from({ length: H }, () => Float64Array.from({ length: d }, rnd));
  const b1 = new Float64Array(H);
  const w2 = Float64Array.from({ length: H }, rnd);
  let b2 = lin.b;
  const wl = Float64Array.from(lin.w); // linear skip connection
  const params = [...W1, b1, w2, wl];
  const m = params.map((p) => new Float64Array(p.length)),
    v = params.map((p) => new Float64Array(p.length));
  let mb = 0,
    vb = 0;
  const lr = 0.01,
    B1 = 0.9,
    B2 = 0.999;
  let Wsum = 0;
  for (const s of S) Wsum += s.w;
  const h = new Float64Array(H);
  for (let it = 1; it <= 400; it++) {
    const g = params.map((p) => new Float64Array(p.length));
    let gb = 0;
    for (let j = 0; j < S.length; j++) {
      const x = X[j];
      let z = b2;
      for (let i = 0; i < d; i++) z += wl[i] * x[i];
      for (let k = 0; k < H; k++) {
        let a = b1[k];
        const Wk = W1[k];
        for (let i = 0; i < d; i++) a += Wk[i] * x[i];
        h[k] = Math.tanh(a);
        z += w2[k] * h[k];
      }
      const p = 1 / (1 + Math.exp(-z));
      const r = (S[j].w * (p - S[j].y)) / Wsum;
      gb += r;
      for (let i = 0; i < d; i++) g[H + 2][i] += r * x[i];
      for (let k = 0; k < H; k++) {
        g[H + 1][k] += r * h[k];
        const da = r * w2[k] * (1 - h[k] * h[k]);
        g[H][k] += da;
        const gk = g[k];
        for (let i = 0; i < d; i++) gk[i] += da * x[i];
      }
    }
    const reg = l2 / Wsum;
    params.forEach((p, q) => {
      for (let i = 0; i < p.length; i++) {
        const gi = g[q][i] + (q !== H ? reg * p[i] : 0);
        m[q][i] = B1 * m[q][i] + (1 - B1) * gi;
        v[q][i] = B2 * v[q][i] + (1 - B2) * gi * gi;
        p[i] -= (lr * (m[q][i] / (1 - B1 ** it))) / (Math.sqrt(v[q][i] / (1 - B2 ** it)) + 1e-8);
      }
    });
    mb = B1 * mb + (1 - B1) * gb;
    vb = B2 * vb + (1 - B2) * gb * gb;
    b2 -= (lr * (mb / (1 - B1 ** it))) / (Math.sqrt(vb / (1 - B2 ** it)) + 1e-8);
  }
  const r3 = (a) => Array.from(a, (x) => Math.round(x * 1e4) / 1e4);
  return { ...lin, w: r3(wl), b: 0, W1: W1.map(r3), b1: r3(b1), w2: r3(w2), b2: Math.round(b2 * 1e4) / 1e4 };
}

export function logloss(M, S) {
  const A = new FreeArbiter(() => {}, null);
  let L = 0,
    W = 0;
  for (const s of S) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, A._eval(M, Array.from(s.x))));
    L -= s.w * (s.y ? Math.log(p) : Math.log(1 - p));
    W += s.w;
  }
  return L / W;
}

// ---- main -----------------------------------------------------------------------------------------
function loadModel(a) {
  if (!a || a === 'current') return 'current';
  if (a === 'legacy' || a === 'dsp') return a;
  return JSON.parse(fs.readFileSync(a, 'utf8'));
}

const FIT_SETS = ['sal', 'inst', 'valmix', 'noise']; // training pianos only - never 'heldout'

// what the thresholds are chosen for (fitting sets only)
const BETA = Number(process.env.BETA || 0.7); // precision weighs more than recall (free play: a false note is a wrong note)
const Fb = (x) => ((1 + BETA * BETA) * x.P * x.R) / Math.max(1e-9, BETA * BETA * x.P + x.R);
function objective(E, ref) {
  const s = E.sal['all|all'],
    b = E.inst['all|all'],
    v = E.valmix['all|all'];
  const fp = E.noise['noise|realistic'].fpm + E.noise['noise|pause'].fpm + E.valmix['noise|all'].fpm * 0.25;
  const fpRef = ref ? ref.fp : fp;
  // ... and no kind of noise worse: the student pausing while the room goes on (TV, talk)
  const pause = E.noise['noise|pause'].fpm;
  const pauseRef = ref ? ref.pause : pause;
  // octave completeness on the octave materials: no worse than the fixed rules, on either set
  const os = E.sal['all|octs'].oct,
    ob = E.inst['all|octs'].oct;
  const oct = (os + ob) / 2;
  const octPen = ref ? Math.max(0, ref.os - os) + Math.max(0, ref.ob - ob) : 0;
  const lat = (s.up[1] + b.up[1]) / 2,
    lo = (s.lo[0] + b.lo[0]) / 2;
  const F = (0.5 * Fb(s) + Fb(b)) / 1.5;
  const J = F + 0.5 * v.F + 0.2 * oct - 2 * octPen - 0.01 * Math.max(0, fp - fpRef) - 0.03 * Math.max(0, pause - pauseRef) - 0.0005 * Math.max(0, lat - 120) - 0.0003 * Math.max(0, lo - 100);
  return { J, fp, pause, oct, os, ob, salF: s.F, salR: s.R, salP: s.P, instR: b.R, instP: b.P, instF: b.F, valF: v.F, lat: [(s.up[0] + b.up[0]) / 2, lat], lo: [lo] };
}

function evalAll(data, model) {
  const E = {};
  for (const k of FIT_SETS) E[k] = evaluate(data[k], model);
  return E;
}

const fmtO = (o) => `J ${o.J.toFixed(4)} sal R ${f1(o.salR)} P ${f1(o.salP)} inst R ${f1(o.instR)} P ${f1(o.instP)} val F ${f1(o.valF)} oct ${f1(o.os)}/${f1(o.ob)} noise ${o.fp.toFixed(1)}/min (pause ${o.pause.toFixed(1)}) lat ${Math.round(o.lat[0])}/${Math.round(o.lat[1])} lo ${Math.round(o.lo[0])}`;

// evaluation pool: every worker holds the fitting sets and scores models sent to it
function pool(n) {
  const file = fileURLToPath(import.meta.url);
  const ws = Array.from({ length: n }, () => new Worker(file, { workerData: { evalWorker: true } }));
  const free = [...ws];
  const waiting = [];
  const run = (model) =>
    new Promise((res) => {
      const go = (w) => {
        w.once('message', (E) => {
          res(E);
          const nx = waiting.shift();
          if (nx) nx(w);
          else free.push(w);
        });
        w.postMessage(model);
      };
      const w = free.pop();
      if (w) go(w);
      else waiting.push(go);
    });
  return { run, close: () => ws.forEach((w) => w.terminate()) };
}

if (!isMainThread && workerData && workerData.evalWorker) {
  const data = {};
  for (const k of FIT_SETS) data[k] = load(k);
  parentPort.on('message', (model) => parentPort.postMessage(evalAll(data, model)));
}

// thresholds: coordinate search on the objective
async function searchThr(P, model, ref) {
  let best = objective(await P.run(model), ref);
  console.log(`  start: ${fmtO(best)}`);
  const grid = { dsp: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], nn: [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.96, 0.98], nnOct: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] };
  for (let round = 0; round < 2; round++)
    for (const kind of ['dsp', 'nn', 'nnOct'].filter((k) => !(process.env.FIXED || '').split(',').includes(k)))
      for (let r = 0; r < (kind === 'nnOct' ? 1 : 3); r++) {
        const set1 = (v) => (kind === 'nnOct' ? v : model.thr[kind].map((x, i) => (i === r ? v : x)));
        const cur = kind === 'nnOct' ? model.thr.nnOct : model.thr[kind][r];
        const ms = grid[kind].filter((v) => v !== cur).map((v) => ({ ...model, thr: { ...model.thr, [kind]: set1(v) } }));
        const os = (await Promise.all(ms.map((m) => P.run(m)))).map((E) => objective(E, ref));
        os.forEach((o, i) => {
          if (o.J > best.J) {
            best = o;
            model = ms[i];
            console.log(`  thr ${kind}[${r}] = ${JSON.stringify(model.thr[kind])}: ${fmtO(o)}`);
          }
        });
      }
  return { best, model };
}

// only the thresholds, for a given model (e.g. after changing a fixed rule such as octRule)
async function thrOnly(file, out) {
  const P = pool(Number(process.env.THREADS || 3));
  const ref = objective(await P.run('legacy'));
  console.log('legacy   ', fmtO(ref));
  const { best, model } = await searchThr(P, JSON.parse(fs.readFileSync(file, 'utf8')), ref);
  console.log(`chosen: thr ${JSON.stringify(model.thr)} ${fmtO(best)}`);
  fs.writeFileSync(out, JSON.stringify({ ...model, feats: FEATS }));
  console.log('wrote', out);
  P.close();
}

// refit only the octave-partner model (e.g. with a longer deadline for octave partners), then the
// thresholds
async function refitOct(file, out) {
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  base.deadlineOct = Number(process.env.DEADLINE_OCT || 0.4);
  delete base.octRule;
  let DO;
  {
    const all = FIT_SETS.flatMap((k) => load(k));
    // as the first pass of fit(): every DSP note reported, no network note, so every candidate is
    // watched to its deadline
    const D = collect(all, { deadlineOct: base.deadlineOct }, { sal: 0.5, inst: 1, valmix: 1, noise: 3 });
    DO = D.nn.filter((s) => s.partner);
    D.nn = D.dsp = null;
  }
  base.nnOct = fitLogistic(DO, { l2: 1, hidden: Number(process.env.HIDDEN || 8) });
  console.log(`${DO.length} octave-partner snapshots (${DO.filter((s) => s.y).length} true), logloss ${logloss(base.nnOct, DO).toFixed(4)}`);
  DO = null;
  fs.writeFileSync(out + '.pre', JSON.stringify(base));
  const P = pool(Number(process.env.THREADS || 3));
  const ref = objective(await P.run('legacy'));
  const { best, model } = await searchThr(P, base, ref);
  console.log(`chosen: thr ${JSON.stringify(model.thr)} ${fmtO(best)}`);
  fs.writeFileSync(out, JSON.stringify({ ...model, feats: FEATS }));
  P.close();
}

async function fit(write) {
  const P = pool(Number(process.env.THREADS || 3));
  const data = {};
  for (const k of FIT_SETS) data[k] = load(k);
  const all = FIT_SETS.flatMap((k) => data[k]);
  const ref = objective(evalAll(data, 'legacy'));
  console.log('legacy   ', fmtO(ref));
  console.log('dsp alone', fmtO(objective(evalAll(data, 'dsp'), ref)));
  const setW = { sal: 0.5, inst: 1, valmix: 1, noise: 3 };
  const H = Number(process.env.HIDDEN || 0);
  let model = null; // first pass: every DSP note reported, no network note
  let bestAll = null,
    bestModel = null;
  for (let pass = 0; pass < Number(process.env.PASSES || 2); pass++) {
    const D = collect(all, model, setW);
    const md = fitLogistic(D.dsp, { l2: 1, hidden: H });
    const mn = fitLogistic(D.nn, { l2: 1, hidden: H });
    const DO = D.nn.filter((s) => s.partner);
    const mo = fitLogistic(DO, { l2: 1, hidden: H });
    console.log(`pass ${pass}: ${D.dsp.length} DSP decisions (${D.dsp.filter((s) => s.y).length} true), ${D.nn.length} network snapshots (${D.nn.filter((s) => s.y).length} true), ${DO.length} octave partners (${DO.filter((s) => s.y).length} true); logloss dsp ${logloss(md, D.dsp).toFixed(4)} nn ${logloss(mn, D.nn).toFixed(4)} oct ${logloss(mo, DO).toFixed(4)} (general model ${logloss(mn, DO).toFixed(4)})`);
    const prevThr = model && model.thr;
    model = { dsp: md, nn: mn, nnOct: mo, thr: prevThr || { dsp: [0.3, 0.3, 0.3], nn: [0.9, 0.9, 0.9], nnOct: 0.7 }, deadline: [0.3, 0.25, 0.25] };
    const r0 = await searchThr(P, model, ref);
    let best = r0.best;
    model = r0.model;
    if (!bestAll || best.J > bestAll.J) (bestAll = best), (bestModel = model);
    fs.writeFileSync((process.env.MODEL_OUT || path.join(ARB, 'model.json')) + `.pass${pass}`, JSON.stringify({ ...model, feats: FEATS }));
    console.log(`pass ${pass} best: thr ${JSON.stringify(model.thr)} ${fmtO(best)}`);
  }
  model = bestModel;
  console.log(`chosen: thr ${JSON.stringify(model.thr)} ${fmtO(bestAll)}`);
  model.feats = FEATS;
  const out = process.env.MODEL_OUT || path.join(ARB, 'model.json');
  fs.writeFileSync(out, JSON.stringify(model));
  console.log('wrote', out);
  if (write) writeModule(model);
  P.close();
}

function writeModule(model) {
  const r = (x) => (Array.isArray(x) ? x.map(r) : typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, r(v)])) : x);
  const src = `// Fitted by tools/nn/arbiter_fit.mjs on recordings of the TRAINING pianos (the benchmark's
// material generator at other seeds on Salamander, MuseScore, FluidR3, GeneralUser, Iowa and the
// synth; the network's validation mixtures; noise clips with other seeds). The benchmark's
// held-out pianos were not used to fit it; thr.nnOct (octave partners) was set by hand, see
// docs/listening-model.md "Free-play arbiter". Regenerate, do not edit by hand.
export const ARBITER_MODEL = ${JSON.stringify(r(model))};
`;
  fs.writeFileSync(path.join(here, '../../js/audio/nn/arbiter-model.js'), src);
  console.log('wrote js/audio/nn/arbiter-model.js');
}

async function main() {
  const [cmd, set, m] = process.argv.slice(2);
  if (cmd === 'fit') return fit(process.argv.includes('--write'));
  if (cmd === 'thr') return thrOnly(set, m);
  if (cmd === 'refit-oct') return refitOct(set, m);
  if (cmd === 'write') return writeModule(JSON.parse(fs.readFileSync(set, 'utf8')));
  if (cmd === 'eval' || cmd === 'diag') {
    const recs = set.split(',').flatMap(load);
    let model = loadModel(m);
    if (model === 'current') model = (await import('../../js/audio/nn/arbiter-model.js')).ARBITER_MODEL;
    if (cmd === 'diag') diag(recs, model);
    console.log(show(evaluate(recs, model)));
  }
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) main();
