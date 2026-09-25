// Noise-robustness evaluation for the listening engine.
//
//   node tests/noise-eval.js            full report (uses all CPU cores)
//   node tests/noise-eval.js noise      only the noise-only false-positive table
//   node tests/noise-eval.js piano      only the piano recall/precision tables
//   QUICK=1 node tests/noise-eval.js    shorter clips
//
// Part 1 - false note-ons per minute on noise-only audio, per noise type, at a realistic and a
//          loud level (levels are relative to a mezzo-forte piano, see noise-sim.js LEVELS).
//          The transcriber is calibrated on quiet room tone first (as the app does at start-up)
//          and the noise starts afterwards. "conf>=.55" counts only detections whose confidence
//          would make the practice engine treat them as a real wrong note.
// Part 2 - piano recall / precision / onset error, clean and mixed with noise at several SNRs,
//          on the sampled Salamander grand (if the corpus is cached) and the additive synth.
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
// TRANSCRIBER=/path/to/other/transcriber.js compares another version of the engine.
const { Transcriber } = await import(process.env.TRANSCRIBER ? pathToFileURL(process.env.TRANSCRIBER).href : '../js/audio/transcriber.js');
import { renderPiano, rng } from './synth-piano.js';
import { renderSampled, loadCorpus, corpusNoise } from './corpus-piano.js';
import { NOISES, LEVELS, roomTone, activeRms, peak, gainDb, mixInto } from './noise-sim.js';

const SR = 48000;

// ---------------------------------------------------------------------------------------------
// running the transcriber
// expect: optional list of true notes; the transcriber is told which notes are coming up (like
// the practice engine does with setExpected) - a score-informed run.
export function transcribe(audio, sr, opts = {}, { calibTo = 0.4, chunk = 128, expect = null } = {}) {
  const events = [];
  const tr = new Transcriber(sr, {
    ...opts,
    onNoteOn: (midi, t, vel, info) => events.push({ midi, t, vel, conf: info && info.confidence != null ? info.confidence : 1, restrike: !!(info && info.restrike) }),
  });
  if (calibTo > 0) tr.startCalibration();
  let calibrated = calibTo <= 0;
  const t0 = performance.now();
  for (let i = 0; i + chunk <= audio.length; i += chunk) {
    if (!calibrated && i / sr > calibTo) {
      tr.finishCalibration();
      calibrated = true;
    }
    if (expect && i % 2048 === 0) {
      const t = i / sr;
      tr.setExpected(expect.filter((n) => n.t > t - 0.25 && n.t < t + 0.35).map((n) => n.midi));
    }
    tr.push(audio.subarray(i, i + chunk), i);
  }
  const ms = performance.now() - t0;
  events.speed = audio.length / sr / (ms / 1000);
  events.tr = tr;
  return events;
}

export function score(notes, events, tol = 0.08) {
  const used = new Set();
  let hit = 0;
  const errs = [];
  const misses = [];
  const hitConf = [];
  for (const n of notes) {
    let best = -1,
      bd = 1e9;
    events.forEach((e, i) => {
      if (used.has(i) || e.midi !== n.midi) return;
      const d = Math.abs(e.t - n.t);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0 && bd <= tol) {
      used.add(best);
      hit++;
      errs.push(events[best].t - n.t);
      hitConf.push(events[best].conf ?? 1);
    } else misses.push(n);
  }
  const extras = events.filter((_, i) => !used.has(i));
  const meanErr = errs.reduce((a, b) => a + b, 0) / (errs.length || 1);
  const absErr = errs.reduce((a, b) => a + Math.abs(b), 0) / (errs.length || 1);
  return {
    recall: hit / notes.length,
    precision: hit / (hit + extras.length || 1),
    meanErr,
    absErr,
    misses,
    extras,
    hitConf,
    confidentExtras: extras.filter((e) => (e.conf ?? 1) >= 0.55).length,
  };
}

// ---------------------------------------------------------------------------------------------
// test material
export function pieces(seed = 3) {
  const r = rng(seed);
  const P = {};
  P.singles = [];
  for (let m = 21; m <= 108; m++) P.singles.push({ midi: m, t: 0.6 + (m - 21) * 0.7, dur: 0.5, vel: 0.5 + r() * 0.4 });
  P.soft = P.singles.map((n) => ({ ...n, vel: 0.25 }));
  P.triads = [];
  let t = 0.6;
  for (let i = 0; i < 40; i++) {
    const root = 48 + Math.floor(r() * 24);
    for (const iv of r() < 0.5 ? [0, 4, 7] : [0, 3, 7]) P.triads.push({ midi: root + iv, t, dur: 0.6, vel: 0.6 });
    t += 0.8;
  }
  P.twohand = [];
  t = 0.6;
  for (let i = 0; i < 40; i++) {
    P.twohand.push({ midi: 36 + Math.floor(r() * 18), t, dur: 0.7, vel: 0.6 });
    P.twohand.push({ midi: 60 + Math.floor(r() * 20), t, dur: 0.35, vel: 0.6 });
    P.twohand.push({ midi: 60 + Math.floor(r() * 20), t: t + 0.4, dur: 0.35, vel: 0.6 });
    t += 0.8;
  }
  const seq = [60, 60, 60, 62, 64, 64, 62, 60, 67, 67, 65, 65, 64, 64, 62, 62, 60, 60, 60, 60];
  P.repeated = seq.map((m, i) => ({ midi: m, t: 0.6 + i * 0.25, dur: 0.22, vel: 0.6 }));
  const sc = [0, 2, 4, 5, 7, 9, 11];
  const sn = [];
  for (let o = 0; o < 2; o++) for (const s of sc) sn.push(60 + o * 12 + s);
  sn.push(84);
  P.scale = [...sn, ...sn.slice(0, -1).reverse()].map((m, i) => ({ midi: m, t: 0.6 + i * 0.15, dur: 0.14, vel: 0.6 }));
  // pedal: broken chords under a sustained pedal, pedal changes every bar
  P.pedal = [];
  t = 0.6;
  for (let bar = 0; bar < 12; bar++) {
    const root = 43 + Math.floor(r() * 12);
    const ch = [0, 7, 12, 16, 19, 24].map((x) => root + x);
    for (let k = 0; k < 6; k++) P.pedal.push({ midi: ch[k], t: t + k * 0.25, dur: 0.2, vel: 0.45 + r() * 0.3 });
    t += 1.6;
  }
  P.pedalTimes = [];
  for (let bar = 0; bar < 12; bar++) P.pedalTimes.push([0.6 + bar * 1.6 + 0.05, 0.6 + (bar + 1) * 1.6 - 0.02]);
  // beginner two-hand piece: slow quarter notes, right hand melody + left hand bass notes and
  // occasional dyads (what the app's first levels look like)
  P.beginner = [];
  t = 0.8;
  for (let bar = 0; bar < 16; bar++) {
    const beat = 0.7;
    for (let b = 0; b < 4; b++) {
      P.beginner.push({ midi: 60 + [0, 2, 4, 5, 7, 9, 7, 5][Math.floor(r() * 8)], t: t + b * beat, dur: beat * 0.9, vel: 0.45 + r() * 0.3 });
      if (b % 2 === 0) P.beginner.push({ midi: 48 + [0, 5, 7, 4][Math.floor(r() * 4)], t: t + b * beat, dur: beat * 1.8, vel: 0.4 + r() * 0.3 });
    }
    t += 4 * 0.7;
  }
  // dynamics: a loud phrase, then a very soft one (the soft notes must not look like "room")
  P.dynamics = [];
  t = 0.6;
  for (let i = 0; i < 32; i++) {
    P.dynamics.push({ midi: 55 + Math.floor(r() * 22), t, dur: 0.35, vel: i < 16 ? 0.85 + r() * 0.1 : 0.18 + r() * 0.1 });
    t += 0.4;
  }
  P.melody = [];
  t = 0.6;
  for (let i = 0; i < 60; i++) {
    P.melody.push({ midi: 55 + Math.floor(r() * 24), t, dur: 0.28, vel: 0.4 + r() * 0.4 });
    t += 0.3;
  }
  return P;
}

export function renderPiece(engine, notes, opts = {}) {
  if (engine === 'sampled') return renderSampled(notes, opts);
  return renderPiano(notes, opts);
}

// Reference piano level: the beginner piece at mezzo-forte on the sampled grand, measured once
// (activeRms / peak of renderSampled(pieces().beginner.slice(0, 24))) and fixed so noise levels
// are the same with or without the corpus. pianoRef('synth') measures the synth instead.
export const PIANO_REF = { rms: 0.0415, peak: 0.2376 };
const refCache = {};
export function pianoRef(engine) {
  if (!engine) return PIANO_REF;
  if (refCache[engine]) return refCache[engine];
  const P = pieces();
  const x = renderPiece(engine, P.beginner.slice(0, 24), { sr: SR, noise: 0 });
  return (refCache[engine] = { rms: activeRms(x, SR), peak: peak(x) });
}

// A noise clip scaled to a level. `level` is 'realistic' | 'loud' | dB number (relative to the
// piano reference; RMS or peak based depending on the noise type).
export function makeNoise(type, sec, { sr = SR, seed = 1, level = 'realistic', engine } = {}) {
  let x;
  let ref = 'rms';
  if (type === 'real-speech' || type === 'real-radio') {
    x = corpusNoise(type === 'real-speech' ? 'speech' : 'radio', seed, sec, { sr });
    if (!x) return null;
    const a = activeRms(x, sr);
    for (let i = 0; i < x.length; i++) x[i] /= a;
  } else {
    x = NOISES[type](sec, { sr, seed });
    ref = LEVELS[type].ref;
  }
  const L = LEVELS[type.replace('real-', '').replace('radio', 'tv')] || LEVELS.speech;
  const db = typeof level === 'number' ? level : L[level];
  const pr = pianoRef(engine);
  const g = gainDb(db) * (ref === 'peak' ? pr.peak : pr.rms);
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export const NOISE_TYPES = ['speech', 'tv', 'claps', 'taps', 'footsteps', 'dishes', 'hum', 'bark', 'typing'];

// ---------------------------------------------------------------------------------------------
// jobs (run inside workers)
function runJob(job) {
  const sr = job.sr || SR;
  if (job.kind === 'noise') {
    const pre = 1.0;
    const x = makeNoise(job.noise, job.sec, { sr, seed: job.seed, level: job.level });
    if (!x) return { skipped: true };
    const total = pre + job.sec;
    const audio = roomTone(total, { sr, seed: 99 });
    const rt = 0.0015 * 0.3; // same room noise as the piano renders
    for (let i = 0; i < audio.length; i++) audio[i] *= rt;
    mixInto(audio, x, 1, Math.round(pre * sr));
    const ev = transcribe(audio, sr, job.opts, { calibTo: 0.8 });
    const fp = ev.filter((e) => e.t > pre - 0.05);
    return {
      fp: fp.length,
      fpConf: fp.filter((e) => e.conf >= 0.55).length,
      fpm: fp.length / (job.sec / 60),
      fpmConf: fp.filter((e) => e.conf >= 0.55).length / (job.sec / 60),
      notes: fp.map((e) => `${e.midi}@${e.t.toFixed(2)}${e.conf < 1 ? '/' + e.conf.toFixed(2) : ''}`),
      speed: ev.speed,
    };
  }
  if (job.kind === 'pause') {
    // The student plays for a while, then stops; the room goes on (TV, talking...). Counts
    // false notes during the pause, when the listener knows how loud the piano is.
    const P = pieces(job.pieceSeed || 3);
    const notes = P.beginner.filter((n) => n.t < 10);
    const pre = 11;
    const audio = renderPiece(job.engine || (loadCorpus() ? 'sampled' : 'synth'), notes, { sr, seed: 7, length: pre + job.sec });
    const x = makeNoise(job.noise, job.sec, { sr, seed: job.seed, level: job.level });
    if (!x) return { skipped: true };
    mixInto(audio, x, 1, Math.round(pre * sr));
    const ev = transcribe(audio, sr, job.opts);
    const fp = ev.filter((e) => e.t > pre);
    return {
      fp: fp.length,
      fpm: fp.length / (job.sec / 60),
      fpmConf: fp.filter((e) => e.conf >= 0.55).length / (job.sec / 60),
      notes: fp.map((e) => `${e.midi}@${e.t.toFixed(2)}/${e.conf.toFixed(2)}`),
      speed: ev.speed,
    };
  }
  if (job.kind === 'piano') {
    const P = pieces(job.pieceSeed || 3);
    const notes = P[job.piece];
    const ropts = { sr, seed: job.seed || 7, ...(job.render || {}) };
    if (job.piece === 'pedal') ropts.pedal = P.pedalTimes;
    let audio = renderPiece(job.engine, notes, ropts);
    if (job.noise) {
      const x = makeNoise(job.noise, audio.length / sr, { sr, seed: job.seed || 1, level: 0, engine: job.engine });
      if (!x) return { skipped: true };
      // scale noise to the requested SNR re. this piece's active RMS
      const g = activeRms(audio, sr) / activeRms(x, sr) / gainDb(job.snr);
      mixInto(audio, x, g, 0);
    }
    const ev = transcribe(audio, sr, job.opts, { expect: job.expect ? notes : null });
    const s = score(notes, ev);
    return {
      recall: s.recall,
      precision: s.precision,
      meanErr: s.meanErr,
      absErr: s.absErr,
      extras: s.extras.length,
      confidentExtras: s.confidentExtras,
      hitConfMean: s.hitConf.reduce((a, b) => a + b, 0) / (s.hitConf.length || 1),
      hitConfLow: s.hitConf.filter((c) => c < 0.55).length,
      misses: s.misses.map((n) => `${n.midi}@${n.t.toFixed(2)}`),
      extraList: s.extras.map((e) => `${e.midi}@${e.t.toFixed(2)}/${(e.conf ?? 1).toFixed(2)}`),
      speed: ev.speed,
      n: notes.length,
    };
  }
  throw new Error('unknown job ' + job.kind);
}

export async function runParallel(jobs, threads = Math.max(1, Math.min(os.cpus().length, 8))) {
  const results = new Array(jobs.length);
  let next = 0;
  const file = fileURLToPath(import.meta.url);
  await Promise.all(
    Array.from({ length: Math.min(threads, jobs.length) }, async () => {
      const w = new Worker(file, { workerData: { worker: true } });
      w.setMaxListeners(0);
      try {
        while (next < jobs.length) {
          const i = next++;
          results[i] = await new Promise((res, rej) => {
            w.once('message', res);
            w.once('error', rej);
            w.postMessage(jobs[i]);
          });
        }
      } finally {
        await w.terminate();
      }
    }),
  );
  return results;
}

if (!isMainThread && workerData && workerData.worker) {
  parentPort.on('message', (job) => {
    try {
      parentPort.postMessage(runJob(job));
    } catch (e) {
      parentPort.postMessage({ error: String(e && e.stack) });
    }
  });
}

// ---------------------------------------------------------------------------------------------
const pct = (v) => (v * 100).toFixed(1).padStart(5) + '%';

async function main() {
  const what = process.argv[2] || 'all';
  const quick = !!process.env.QUICK;
  const opts = process.env.OPTS ? JSON.parse(process.env.OPTS) : {};
  const hasC = !!loadCorpus();
  const verbose = !!process.env.VERBOSE;
  const t0 = Date.now();
  let speeds = [];

  if (what === 'all' || what === 'noise') {
    const types = [...NOISE_TYPES, ...(hasC ? ['real-speech', 'real-radio'] : [])];
    const jobs = [];
    for (const noise of types)
      for (const level of ['realistic', 'loud']) jobs.push({ kind: 'noise', noise, level, sec: quick ? 30 : level === 'realistic' ? 90 : 60, seed: 1, opts });
    const res = await runParallel(jobs);
    console.log('\nFalse note-ons per minute on noise-only audio (lower is better)');
    console.log('noise'.padEnd(13) + 'realistic   (conf>=.55)   loud    (conf>=.55)   level dB (realistic/loud)');
    for (const noise of types) {
      const r = res[jobs.findIndex((j) => j.noise === noise && j.level === 'realistic')];
      const l = res[jobs.findIndex((j) => j.noise === noise && j.level === 'loud')];
      if (r.error || l.error) {
        console.log(noise, r.error || l.error);
        continue;
      }
      if (r.skipped) continue;
      const L = LEVELS[noise.replace('real-', '').replace('radio', 'tv')];
      console.log(
        noise.padEnd(13) +
          r.fpm.toFixed(1).padStart(6) +
          `   (${r.fpmConf.toFixed(1).padStart(5)})` +
          l.fpm.toFixed(1).padStart(10) +
          `   (${l.fpmConf.toFixed(1).padStart(5)})` +
          `     ${L.realistic}/${L.loud} ${L.ref}`,
      );
      if (verbose) console.log('   ', r.notes.join(' '), '|', l.notes.join(' '));
      speeds.push(r.speed, l.speed);
    }
  }

  if (what === 'all' || what === 'noise' || what === 'pause') {
    const types = [...NOISE_TYPES, ...(hasC ? ['real-speech', 'real-radio'] : [])];
    const jobs = types.map((noise) => ({ kind: 'pause', noise, level: 'realistic', sec: quick ? 30 : 60, seed: 3, opts }));
    const res = await runParallel(jobs);
    console.log('\nFalse note-ons per minute while the student pauses (after 10 s of playing), realistic level');
    console.log(types.map((n, i) => `${n} ${res[i].skipped ? '-' : res[i].fpm.toFixed(1)}`).join('  '));
    if (verbose) types.forEach((n, i) => res[i].notes && res[i].notes.length && console.log('   ', n, res[i].notes.join(' ')));
  }

  if (what === 'all' || what === 'piano') {
    const engines = hasC ? ['sampled', 'synth'] : ['synth'];
    const clean = ['singles', 'soft', 'triads', 'twohand', 'repeated', 'scale', 'pedal', 'beginner', 'dynamics'];
    const jobs = [];
    for (const engine of engines) {
      for (const piece of clean) jobs.push({ kind: 'piano', engine, piece, opts, label: piece });
      jobs.push({ kind: 'piano', engine, piece: 'melody', render: { reverb: { rt60: 0.8, wet: 0.5 } }, opts, label: 'reverb 0.8s' });
      jobs.push({ kind: 'piano', engine, piece: 'triads', render: { tuningCents: -30, bScale: 2 }, opts, label: 'detuned -30c' });
      jobs.push({ kind: 'piano', engine, piece: 'triads', sr: 44100, opts, label: 'triads 44.1k' });
      const noisy = quick ? ['speech', 'tv', 'claps'] : ['speech', 'tv', 'claps', 'taps', 'dishes', 'hum', 'bark', ...(hasC && engine === 'sampled' ? ['real-speech', 'real-radio'] : [])];
      for (const noise of noisy) for (const snr of quick ? [10] : [20, 10, 5]) jobs.push({ kind: 'piano', engine, piece: 'beginner', noise, snr, opts, label: `beginner + ${noise} ${snr}dB` });
      // score-informed: the listener knows which notes are due (as in the practice screens)
      for (const piece of ['beginner', 'triads', 'twohand', 'singles', 'pedal']) jobs.push({ kind: 'piano', engine, piece, expect: true, opts, label: `${piece}, expected` });
      for (const noise of quick ? ['speech'] : ['speech', 'tv', 'claps', 'bark']) jobs.push({ kind: 'piano', engine, piece: 'beginner', noise, snr: 10, expect: true, opts, label: `beginner + ${noise} 10dB, exp.` });
    }
    if (process.env.ONLY) {
      const re = new RegExp(process.env.ONLY);
      for (let i = jobs.length - 1; i >= 0; i--) if (!re.test(`${jobs[i].engine}:${jobs[i].label}`)) jobs.splice(i, 1);
    }
    const res = await runParallel(jobs);
    let cur = null;
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i],
        r = res[i];
      if (r.skipped) continue;
      if (j.engine !== cur) {
        cur = j.engine;
        console.log(`\nPiano transcription - ${cur === 'sampled' ? 'Salamander grand samples' : 'additive synth piano'}`);
        console.log('scenario'.padEnd(30) + 'recall  precision  extras(conf>=.55)  onset mean/abs ms  hit conf  cpu');
      }
      if (r.error) {
        console.log(j.label, r.error);
        continue;
      }
      speeds.push(r.speed);
      console.log(
        j.label.padEnd(30) +
          pct(r.recall) +
          '   ' +
          pct(r.precision) +
          `   ${String(r.extras).padStart(4)} (${String(r.confidentExtras).padStart(3)})` +
          `        ${(r.meanErr * 1000).toFixed(1).padStart(5)} / ${(r.absErr * 1000).toFixed(1).padStart(4)}` +
          `      ${r.hitConfMean.toFixed(2)}` +
          `   x${r.speed.toFixed(1)}`,
      );
      if (verbose) {
        console.log('    misses', r.misses.join(' '));
        console.log('    extras', r.extraList.join(' '));
      }
    }
  }
  if (speeds.length) {
    speeds.sort((a, b) => a - b);
    console.log(`\ncpu: median x${speeds[speeds.length >> 1].toFixed(1)} realtime per core (min x${speeds[0].toFixed(1)}); wall ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) main();
