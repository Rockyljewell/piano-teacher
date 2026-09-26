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

// the hybrid's rules (js/audio/nn/hybrid-transcriber.js) replayed on the recorded streams
function hybrid(nnEv, dspEv, { trustP, octP, expP = 0.5, wait = 0.06 }, lesson) {
  const all = [...nnEv.map((e) => ({ ...e, src: 'nn' })), ...dspEv.map((e) => ({ ...e, src: 'dsp' }))].sort((a, b) => a.at - b.at);
  const out = [];
  let held = [];
  const has = (m, t) => out.some((e) => e.midi === m && Math.abs(e.t - t) <= 0.08);
  const partner = (m, t) => out.some((e) => e.src === 'dsp' && Math.abs(e.t - t) <= 0.04 && (e.midi === m - 12 || e.midi === m + 12 || e.midi === m - 24));
  const check = (now) => {
    const keep = [];
    for (const h of held) {
      if (has(h.midi, h.t)) continue;
      if (partner(h.midi, h.t)) out.push({ ...h, at: Math.max(h.at, now) });
      else if (now < h.at + wait) keep.push(h);
    }
    held = keep;
  };
  for (const e of all) {
    check(e.at);
    if (e.src === 'dsp') {
      if (!e.restrike && out.some((x) => x.src === 'nn' && x.midi === e.midi && Math.abs(x.t - e.t) <= 0.08)) continue;
      out.push(e);
      check(e.at);
    } else {
      if (e.restrike || has(e.midi, e.t)) continue;
      if (lesson) {
        if (e.exp && e.p >= expP) out.push(e);
        continue;
      }
      if (e.p >= trustP) out.push(e);
      else if (e.p >= octP) held.push(e);
    }
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
    r[lesson ? 'nnLd' : 'nnFd'] = run(NN, x, m.notes, lesson); // the network alone (its own decoder)
    r[lesson ? 'nnL' : 'nnF'] = run(NN, x, m.notes, lesson, { decoder: { ghostP: 0 } }); // as inside the hybrid
    r[lesson ? 'dspL' : 'dspF'] = run(DSP, x, m.notes, lesson);
  }
  rec.push(r);
}
fs.writeFileSync(path.join(here, '.data', 'hybrid-rec.json'), JSON.stringify(rec));
console.log(`${rec.length} mixtures recorded in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const configs = [{ name: 'nn', nnOnly: true }, { name: 'dsp', dspOnly: true }];
for (const trustP of [0.9, 0.95, 0.97, 0.99, 1.01]) for (const octP of [0.5, 0.7, 0.9, 1.01]) configs.push({ name: `trust ${trustP} oct ${octP}`, trustP, octP, expP: 0.5 });
for (const expP of [0.2, 0.3, 0.5, 0.7, 0.9, 1.01]) configs.push({ name: `lesson expP ${expP}`, trustP: 0.97, octP: 0.5, expP });
for (const lesson of [false, true]) {
  for (const c of configs) {
    const acc = { n: 0, hit: 0, ev: 0, lat: [] };
    let fp = 0,
      sec = 0;
    for (const r of rec) {
      const nn = r[lesson ? 'nnL' : 'nnF'],
        dsp = r[lesson ? 'dspL' : 'dspF'];
      const ev = c.dspOnly ? dsp : c.nnOnly ? r[lesson ? 'nnLd' : 'nnFd'] : hybrid(nn, dsp, c, lesson);
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
