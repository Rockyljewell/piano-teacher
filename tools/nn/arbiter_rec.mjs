// Record what the hybrid listener's two engines hear in free play, for fitting its free-play
// arbiter offline (tools/nn/arbiter_fit.mjs): the DSP transcriber's notes, the network's notes
// (with the hybrid's decoder settings) and the network's per-frame probabilities for every key.
//
//   node tools/nn/arbiter_rec.mjs <set> [THREADS=3]
//
// Sets (TRAINING pianos only - the benchmark's held-out pianos are never read here, unless the
// set is `heldout`, which exists to diagnose, never to fit):
//   sal      the benchmark's material generator with other seeds (1, 2), rendered on the
//            Salamander grand, conditions stand and stand+talk
//   valmix   the network's validation mixtures (tools/nn/dump_val.py: Salamander, MuseScore,
//            FluidR3, GeneralUser, Iowa, synth; validation music, rooms and noise)
//   heldout  the QUICK benchmark (upright, ydp; stand, stand+talk) - diagnosis only
//
// Output: tools/nn/.data/arb/<set>/<job>.json (notes, events) + <job>.bin (frames: u16 onset p,
// u8 sounding p per key).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '.data', 'arb');
const SR = 48000;
const CHUNK = 256;

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

async function audioOf(job) {
  if (job.set === 'noise') {
    // noise-eval.js's noise-only and pause clips, with other seeds (that file measures seed 1 / 3)
    const ne = await import('../../tests/noise-eval.js');
    const { roomTone, mixInto } = await import('../../tests/noise-sim.js');
    const { loadCorpus } = await import('../../tests/corpus-piano.js');
    if (job.kind === 'noise') {
      const pre = 1.0;
      const x = ne.makeNoise(job.noise, job.sec, { sr: SR, seed: job.seed, level: job.level });
      if (!x) return null;
      const audio = roomTone(pre + job.sec, { sr: SR, seed: 99 + job.seed });
      for (let i = 0; i < audio.length; i++) audio[i] *= 0.0015 * 0.3;
      mixInto(audio, x, 1, Math.round(pre * SR));
      return { audio, notes: [], fpFrom: pre - 0.05 };
    }
    const P = ne.pieces(job.pieceSeed);
    const notes = P.beginner.filter((n) => n.t < 10);
    const pre = 11;
    const audio = ne.renderPiece(loadCorpus() ? 'sampled' : 'synth', notes, { sr: SR, seed: 7 + job.seed, length: pre + job.sec });
    const x = ne.makeNoise(job.noise, job.sec, { sr: SR, seed: job.seed, level: job.level });
    if (!x) return null;
    mixInto(audio, x, 1, Math.round(pre * SR));
    return { audio, notes: notes.map((n) => ({ midi: n.midi, t: n.t, g: -1 })), fpFrom: pre };
  }
  if (job.set === 'inst') {
    // the training instruments (tools/nn/arbiter_dry.py, 16 kHz dry) in the benchmark's conditions
    const { applyCondition } = await import('../../tests/bench-listen.js');
    const { activeRms } = await import('../../tests/noise-sim.js');
    const b = fs.readFileSync(path.join(OUT, 'dry', `${job.inst}-${job.mat}.f32`));
    const dry = up3(new Float32Array(b.buffer, b.byteOffset, b.length / 4));
    const g = 0.0415 / (activeRms(dry, SR) || 1);
    for (let i = 0; i < dry.length; i++) dry[i] *= g;
    const audio = applyCondition(dry, job.cond, 1 + 100 * job.seed + job.k);
    return { audio, notes: job.notes };
  }
  if (job.set === 'valmix') {
    const b = fs.readFileSync(path.join(here, '.data', 'valmix', job.file));
    return { audio: up3(new Float32Array(b.buffer, b.byteOffset, b.length / 4)), notes: job.notes };
  }
  const { materials } = await import('../../tests/bench-material.js');
  const { render } = await import('../../tests/bench-sampler.js');
  const { applyCondition } = await import('../../tests/bench-listen.js');
  const mat = materials({ quick: job.quick, seed: job.seed }).find((m) => m.name === job.mat && (m.part || 0) === job.part);
  const dry = render(job.inst, mat.notes, { sr: SR, seed: 7 + job.seed, pedal: mat.pedal, length: mat.length });
  const audio = applyCondition(dry, job.cond, 1 + job.part + 100 * job.seed);
  return { audio, notes: mat.notes.map((n) => ({ midi: n.midi, t: n.t, g: n.g })) };
}

async function runJob(job) {
  const { Transcriber: NN, getWeights } = await import('../../js/audio/nn/nn-transcriber.js');
  const { Transcriber: DSP } = await import('../../js/audio/transcriber.js');
  const A = await audioOf(job);
  if (!A) return { id: job.id, skipped: true };
  const { audio, notes } = A;
  let at = 0;
  const dspEv = [],
    nnEv = [],
    onsets = [];
  const dsp = new DSP(SR, {
    onNoteOn: (midi, t, vel, info = {}) => dspEv.push({ midi, t, at, conf: info.confidence ?? 1, restrike: !!info.restrike, path: info.path || 'long' }),
    onOnset: (t, s) => onsets.push({ t, s, at }),
  });
  const nn = new NN(SR, {
    weights: getWeights(),
    decoder: { ghostP: 0, thrReg: null, thr: 0.3, confirm: 1 },
    onNoteOn: (midi, t, vel, info = {}) => nnEv.push({ midi, t, at, p: info.p ?? 0, restrike: !!info.restrike }),
  });
  dsp.startCalibration();
  nn.startCalibration();
  let cal = false;
  const frames = [];
  const ft = [];
  let lastFrame = -1;
  for (let i = 0; i + CHUNK <= audio.length; i += CHUNK) {
    if (!cal && i / SR > 0.4) {
      nn.finishCalibration();
      dsp.finishCalibration();
      cal = true;
    }
    at = (i + CHUNK) / SR;
    const x = audio.subarray(i, i + CHUNK);
    dsp.push(x, i);
    nn.push(x, i);
    if (nn.frame !== lastFrame && nn.frame >= nn.dec.warm) {
      lastFrame = nn.frame;
      const b = new Uint8Array(88 * 3);
      for (let k = 0; k < 88; k++) {
        const q = Math.round(nn.lastP[k] * 65535);
        b[2 * k] = q & 255;
        b[2 * k + 1] = q >> 8;
        b[176 + k] = Math.round(nn.lastPf[k] * 255);
      }
      frames.push(b);
      ft.push(at);
    }
  }
  const name = job.id;
  const dir = path.join(OUT, job.set);
  const bin = Buffer.concat(frames.map((b) => Buffer.from(b.buffer)));
  fs.writeFileSync(path.join(dir, name + '.bin'), bin);
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ job, sec: audio.length / SR, fpFrom: A.fpFrom ?? null, notes, dsp: dspEv, nn: nnEv, onsets, ft }));
  return { id: name, dsp: dspEv.length, nn: nnEv.length, frames: frames.length };
}

if (!isMainThread && workerData && workerData.arbWorker) {
  parentPort.on('message', async (job) => {
    try {
      parentPort.postMessage(await runJob(job));
    } catch (e) {
      parentPort.postMessage({ error: String(e && e.stack) });
    }
  });
}

async function main() {
  const set = process.argv[2] || 'sal';
  const threads = Number(process.env.THREADS || Math.min(3, os.cpus().length));
  fs.mkdirSync(path.join(OUT, set), { recursive: true });
  let jobs = [];
  if (set === 'dump-mats') {
    // materials for arbiter_dry.py: the benchmark's generator, seed 3
    const { materials } = await import('../../tests/bench-material.js');
    const mats = materials({ quick: false, seed: 3 }).map((m) => ({ id: `${m.name}${m.part || 0}`, notes: m.notes.map((n) => ({ midi: n.midi, t: n.t, dur: n.dur, vel: n.vel, g: n.g })), pedal: m.pedal, length: m.length }));
    fs.writeFileSync(path.join(OUT, 'mats.json'), JSON.stringify(mats));
    console.log(mats.length, 'materials');
    return;
  }
  if (set === 'inst') {
    const mats = JSON.parse(fs.readFileSync(path.join(OUT, 'mats.json'), 'utf8'));
    let k = 0;
    for (const inst of ['musescore', 'fluid', 'gu', 'iowa', 'synth'])
      for (const cond of ['stand', 'stand+talk'])
        for (const m of mats) jobs.push({ set, id: `${inst}-${cond}-${m.id}-s3`, inst, cond, mat: m.id, seed: 3, k: k++, len: m.length, notes: m.notes.map((n) => ({ midi: n.midi, t: n.t, g: n.g })) });
    jobs.sort((a, b) => b.len - a.len);
  } else if (set === 'noise') {
    const types = ['speech', 'tv', 'claps', 'taps', 'footsteps', 'dishes', 'hum', 'bark', 'typing', 'real-speech', 'real-radio'];
    for (const noise of types) {
      for (const seed of [5, 6]) jobs.push({ set, id: `noise-${noise}-realistic-${seed}`, kind: 'noise', noise, level: 'realistic', seed, sec: 45, noiseOnly: true });
      jobs.push({ set, id: `noise-${noise}-loud-5`, kind: 'noise', noise, level: 'loud', seed: 5, sec: 30, noiseOnly: true });
      jobs.push({ set, id: `pause-${noise}-5`, kind: 'pause', noise, level: 'realistic', seed: 5, pieceSeed: 5, sec: 30 });
    }
  } else if (set === 'valmix') {
    const index = JSON.parse(fs.readFileSync(path.join(here, '.data', 'valmix', 'index.json'), 'utf8'));
    jobs = index.map((m, i) => ({ set, id: `v${String(i).padStart(3, '0')}`, file: m.file, notes: m.notes.map((n) => ({ midi: n.midi, t: n.t, g: -1 })), noise: m.meta.kind === 'noise-only', inst: m.meta.inst }));
  } else {
    const { materials } = await import('../../tests/bench-material.js');
    const heldout = set === 'heldout';
    const insts = heldout ? ['upright', 'ydp'] : ['salamander'];
    const seeds = heldout ? [0] : (process.env.SEEDS || '1,2').split(',').map(Number);
    for (const seed of seeds) {
      const mats = materials({ quick: heldout, seed });
      for (const inst of insts)
        for (const cond of ['stand', 'stand+talk'])
          for (const m of mats) jobs.push({ set, id: `${inst}-${cond}-${m.name}${m.part || 0}-s${seed}`, inst, cond, mat: m.name, part: m.part || 0, seed, quick: heldout, len: m.length });
    }
    jobs.sort((a, b) => b.len - a.len);
  }
  if (process.env.ONLY) jobs = jobs.filter((j) => new RegExp(process.env.ONLY).test(j.id));
  const t0 = Date.now();
  let next = 0,
    done = 0;
  const file = fileURLToPath(import.meta.url);
  await Promise.all(
    Array.from({ length: Math.min(threads, jobs.length) }, async () => {
      const w = new Worker(file, { workerData: { arbWorker: true } });
      w.setMaxListeners(0);
      try {
        while (next < jobs.length) {
          const j = jobs[next++];
          const r = await new Promise((res, rej) => {
            w.once('message', res);
            w.once('error', rej);
            w.postMessage(j);
          });
          done++;
          if (r.error) console.log(j.id, r.error);
          else if (done % 10 === 0 || done === jobs.length) console.log(`${done}/${jobs.length} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        }
      } finally {
        await w.terminate();
      }
    }),
  );
  fs.writeFileSync(path.join(OUT, set, 'index.json'), JSON.stringify(jobs.map((j) => ({ ...j, notes: undefined }))));
  console.log(`${set}: ${jobs.length} jobs in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

if (isMainThread) main();
