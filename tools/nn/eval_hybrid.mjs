// Choose the hybrid's gate on validation mixtures of the TRAINING pianos (never the benchmark's
// held-out pianos): run the network and the DSP transcriber once on every mixture (upsampled to
// 48 kHz, as the app hears it), record both event streams, then replay the gate rules offline.
//
//   node tools/nn/eval_hybrid.mjs <weights.bin>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transcriber as NN, setWeights } from '../../js/audio/nn/nn-transcriber.js';
import { Transcriber as DSP } from '../../js/audio/transcriber.js';
import { parseWeights } from '../../js/audio/nn/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VAL = path.join(here, '.data', 'valmix');
const SR = 48000;
setWeights(parseWeights(fs.readFileSync(process.argv[2])));
let index = JSON.parse(fs.readFileSync(path.join(VAL, 'index.json'), 'utf8'));
if (process.env.VAL_LIMIT) index = [...index.slice(0, Number(process.env.VAL_LIMIT)), ...index.filter((m) => m.meta.kind === 'noise-only').slice(0, 4)];

// x3 windowed-sinc interpolation 16 -> 48 kHz
function up3(x) {
  const H = 24,
    y = new Float32Array(x.length * 3);
  const k = [];
  for (let ph = 0; ph < 3; ph++) {
    const taps = [];
    for (let j = -H; j <= H; j++) {
      const d = j - ph / 3;
      const s = d === 0 ? 1 : Math.sin(Math.PI * d * 0.95) / (Math.PI * d) / 0.95;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / (H + 1));
      taps.push(s * w);
    }
    k.push(taps);
  }
  for (let i = 0; i < x.length; i++)
    for (let ph = 0; ph < 3; ph++) {
      let s = 0;
      const t = k[ph];
      for (let j = -H; j <= H; j++) {
        const q = i + j;
        if (q >= 0 && q < x.length) s += t[j + H] * x[q];
      }
      y[3 * i + ph] = s;
    }
  return y;
}

function run(Cls, x, notes, lesson, opts = {}) {
  const ev = [];
  let tr;
  tr = new Cls(SR, { ...opts, onNoteOn: (midi, t, vel, info = {}) => ev.push({ midi, t, at: tr.pos / SR, p: info.p ?? info.confidence, conf: info.confidence ?? 1, exp: !!info.expected, restrike: !!info.restrike }) });
  tr.startCalibration();
  const lo = Math.min(...notes.map((n) => n.midi), 60),
    hi = Math.max(...notes.map((n) => n.midi), 60);
  let key = '';
  for (let i = 0; i + 512 <= x.length; i += 512) {
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
    tr.push(x.subarray(i, i + 512), i);
  }
  return ev.filter((e) => e.t >= 0.45);
}

// the hybrid's rules (js/audio/nn/hybrid-transcriber.js) replayed on recorded streams
function hybrid(nnEv, dspEv, { mode, trustP, rescueConf = 0.7, wait }) {
  const out = [];
  for (const e of nnEv) {
    if (mode === 'none' || e.exp || e.p >= trustP) {
      out.push(e);
      continue;
    }
    const d = dspEv.find((x) => x.midi === e.midi && Math.abs(x.t - e.t) <= 0.08 && x.at <= e.at + wait);
    if (d) out.push({ ...e, at: Math.max(e.at, d.at) });
  }
  if (rescueConf < 1)
    for (const d of dspEv) {
      if (d.restrike || d.conf < rescueConf) continue;
      if (out.some((e) => e.midi === d.midi && Math.abs(e.t - d.t) <= 0.08)) continue;
      out.push(d);
    }
  return out;
}

function score(notes, ev, acc) {
  const pairs = [];
  notes.forEach((n, i) => ev.forEach((e, j) => e.midi === n.midi && Math.abs(e.t - n.t) <= 0.08 && pairs.push([Math.abs(e.t - n.t), i, j])));
  pairs.sort((a, b) => a[0] - b[0]);
  const nh = new Int32Array(notes.length).fill(-1),
    eu = new Int32Array(ev.length).fill(-1);
  for (const [, i, j] of pairs) if (nh[i] < 0 && eu[j] < 0) (nh[i] = j), (eu[j] = i);
  acc.n += notes.length;
  acc.ev += ev.length;
  notes.forEach((n, i) => {
    if (nh[i] >= 0) {
      acc.hit++;
      acc.lat.push(ev[nh[i]].at - n.t);
    }
  });
}

const t0 = Date.now();
const rec = [];
for (const m of index) {
  const b = fs.readFileSync(path.join(VAL, m.file));
  const x = up3(new Float32Array(b.buffer, b.byteOffset, b.length / 4));
  const notes = m.notes.filter((n) => n.t >= 0.45 && n.t < x.length / SR - 0.1);
  const r = { noise: m.meta.kind === 'noise-only', sec: x.length / SR, notes };
  for (const lesson of [false, true]) {
    r[lesson ? 'nnL' : 'nnF'] = run(NN, x, m.notes, lesson);
    r[lesson ? 'dspL' : 'dspF'] = run(DSP, x, m.notes, lesson);
  }
  rec.push(r);
}
console.log(`${rec.length} mixtures recorded in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const configs = [
  { name: 'nn', mode: 'none', rescueConf: 1.1 },
  { name: 'dsp', dspOnly: true },
  ...[0.9, 0.95, 0.97, 0.99, 1.01].map((trustP) => ({ name: `emit trust ${trustP}`, mode: 'emit', trustP, wait: 0.35 })),
  { name: 'emit trust 0.97 no rescue', mode: 'emit', trustP: 0.97, wait: 0.35, rescueConf: 1.1 },
];
for (const lesson of [false, true]) {
  for (const c of configs) {
    const acc = { n: 0, hit: 0, ev: 0, lat: [] };
    let fp = 0,
      sec = 0;
    for (const r of rec) {
      const nn = r[lesson ? 'nnL' : 'nnF'],
        dsp = r[lesson ? 'dspL' : 'dspF'];
      const ev = c.dspOnly ? dsp : hybrid(nn, dsp, c);
      if (r.noise) {
        fp += ev.length;
        sec += r.sec;
      } else score(r.notes, ev, acc);
    }
    acc.lat.sort((a, b) => a - b);
    const R = acc.hit / acc.n,
      P = acc.hit / Math.max(1, acc.ev);
    console.log(`${lesson ? 'lesson' : 'free  '} ${c.name.padEnd(26)} R ${(R * 100).toFixed(1)} P ${(P * 100).toFixed(1)} F1 ${((200 * P * R) / (P + R)).toFixed(1)} lat ${(acc.lat[acc.lat.length >> 1] * 1000).toFixed(0)}/${(acc.lat[Math.floor(acc.lat.length * 0.9)] * 1000).toFixed(0)} ms noise ${((fp / sec) * 60).toFixed(1)}/min`);
  }
}
