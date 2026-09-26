// Listening benchmark: how fast and how completely the listener hears a real piano.
//
//   node tests/bench-fetch.js       once: download the held-out pianos (tests/.cache/, ~70 MB)
//   node tests/bench-listen.js      full run (all CPU cores, ~15-25 min)
//   QUICK=1 node tests/bench-listen.js   held-out pianos, stand / stand+talk, shorter material
//
// Environment:
//   QUICK=1          quick mode (iteration)                 OUT=docs/x   report path (no ext.)
//   TRANSCRIBER=path another transcriber.js to measure     CHUNK=256    samples per push()
//   BASELINE=file    earlier JSON report: adds a "before" column and the regression checks
//   ONLY=regex       only jobs whose "instrument|condition|material" matches
//   NOISE=0 / BROWSER=0  skip the noise-only table / the in-browser pipeline latency
//   URL=http://localhost:8090/  where the app is served (for the in-browser measurement)
//   THREADS=n        worker threads (default: all cores)    DETAILS=1    write misses/extras
//
// Instruments: salamander (in-sample: the confidence model was fitted on it), upright and ydp
// (held out). Conditions: close (dry), stand (iPad on the music stand: 80 Hz high-pass, iPad mic
// EQ, 0.5 s room reverb, room tone), stand+talk (plus a conversation at a realistic level).
// Modes: lesson (score-informed: setExpected with the notes due within -0.25..+0.35 s and the
// piece range, as the practice screen does) and free (no hints).
//
// Metrics per instrument x condition x material x mode: note recall / precision / F1 (onset
// within 80 ms), chord completeness (every note of a chord found), octave completeness, mean
// absolute onset error, report latency (sample position of the callback minus the true onset:
// what the student waits for, analysis + chunking, before the worker hop) by register, speed.
// Plus false notes per minute on noise alone (the noise-eval.js table) and, in headless
// Chromium, the whole in-browser pipeline latency (tests/bench-pipeline.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { materials, groupsOf } from './bench-material.js';
import { render, hasInstrument, INSTRUMENTS, HELD_OUT, PIANO_REF_RMS } from './bench-sampler.js';
import { reverb, roomTone, Biquad, gainDb, activeRms, speech as simSpeech, mixInto } from './noise-sim.js';
import { corpusNoise } from './corpus-piano.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TR_PATH = process.env.TRANSCRIBER ? path.resolve(process.env.TRANSCRIBER) : path.join(here, '../js/audio/transcriber.js');
const SR = 48000;
export const CONDITIONS = ['close', 'stand', 'stand+talk'];
export const MODES = ['lesson', 'free'];
const ROOM_DB = -40; // room tone re. the mezzo-forte piano (RMS)
const TALK_DB = -20; // conversation across the room (noise-sim LEVELS.speech.realistic)

// ---- recording conditions -------------------------------------------------------------------------
class Peak extends Biquad {
  peak(f, q, db, sr) {
    const A = Math.pow(10, db / 40),
      w = (2 * Math.PI * f) / sr,
      al = Math.sin(w) / (2 * q),
      c = Math.cos(w);
    return this._set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }
}

function talk(sec, seed) {
  // real LibriVox speech when the corpus is cached, else the synthetic conversation
  let x = corpusNoise('speech', seed, sec, { sr: SR });
  if (!x) x = simSpeech(sec, { sr: SR, seed });
  const a = activeRms(x, SR) || 1;
  const g = (gainDb(TALK_DB) * PIANO_REF_RMS) / a;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export function applyCondition(dry, cond, seed = 1) {
  const sec = dry.length / SR;
  let x = dry;
  if (cond === 'stand+talk') {
    x = Float32Array.from(dry);
    mixInto(x, talk(sec, seed), 1, 0);
  }
  if (cond !== 'close') x = reverb(x, { sr: SR, rt60: 0.5, wet: 0.35, seed: 11 + seed });
  else x = Float32Array.from(x);
  const room = roomTone(sec, { sr: SR, seed: 90 + seed });
  mixInto(x, room, gainDb(ROOM_DB) * PIANO_REF_RMS, 0);
  if (cond !== 'close') {
    // iPad on the music stand: small built-in mic, 80 Hz high-pass (the OS voice path), a
    // presence bump and a top-end roll-off above ~12 kHz
    new Biquad().hp(80, 0.707, SR).apply(x);
    new Peak().peak(4000, 0.9, 3, SR).apply(x);
    new Biquad().lp(12000, 0.707, SR).apply(x);
  }
  return x;
}

// ---- running the listener -----------------------------------------------------------------------
// Any engine can be measured: TRANSCRIBER=/path/to/module.js must export a `Transcriber` class
// with the contract of js/audio/transcriber.js (as tests/noise-eval.js expects):
//   new Transcriber(sampleRate, { onNoteOn(midi, t, vel, {confidence, restrike}), onNoteOff, onOnset })
//   .push(Float32Array samples, frameIndexOfFirstSample)   .setExpected(midis, [lo, hi])
//   .startCalibration() / .finishCalibration()   (optional)  .stats (optional)
// `t` is the attack time in seconds on the frame clock. Latency is measured by the harness
// (end of the chunk being pushed when onNoteOn fires), so nothing else is required.
// Name / version for the report: module exports ENGINE = { name, version } (optional), else
// the file name and a hash of its source.
let TranscriberCls = null;
async function transcriberClass() {
  if (!TranscriberCls) TranscriberCls = (await import(pathToFileURL(TR_PATH).href)).Transcriber;
  return TranscriberCls;
}

export async function engineInfo(file = TR_PATH) {
  const mod = await import(pathToFileURL(file).href);
  const src = fs.readFileSync(file);
  const hash = (await import('node:crypto')).createHash('sha1').update(src).digest('hex').slice(0, 8);
  const E = mod.ENGINE || (mod.Transcriber && mod.Transcriber.ENGINE) || {};
  return { name: E.name || path.basename(file, '.js'), version: E.version ? `${E.version} (${hash})` : hash, path: path.relative(path.join(here, '..'), file) };
}

function listen(Transcriber, audio, mat, mode, chunk) {
  const events = [];
  let at = 0; // end of the chunk being pushed: when a callback fires, this much audio exists
  const tr = new Transcriber(SR, {
    onNoteOn: (midi, t, vel, info) => events.push({ midi, t, at: at / SR, conf: info && info.confidence != null ? info.confidence : 1, restrike: !!(info && info.restrike) }),
  });
  const canCal = typeof tr.startCalibration === 'function' && typeof tr.finishCalibration === 'function';
  if (canCal) tr.startCalibration();
  let calibrated = !canCal;
  const notes = mat.notes;
  let lo = 0; // first note that may still be due
  let key = '';
  let seg = 0;
  // CPU time of this thread (robust when other processes share the machine), else wall time
  const cpu = typeof process.threadCpuUsage === 'function' ? () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; } : () => performance.now();
  const t0 = cpu();
  for (let i = 0; i + chunk <= audio.length; i += chunk) {
    const t = i / SR;
    if (!calibrated && t > 0.4) {
      tr.finishCalibration();
      calibrated = true;
    }
    if (mode === 'lesson') {
      while (seg < mat.segs.length - 1 && t > mat.segs[seg].t1) seg++;
      while (lo < notes.length && notes[lo].tn < t - 0.6) lo++;
      const due = [];
      for (let k = lo; k < notes.length && notes[k].tn < t + 0.35; k++) if (notes[k].tn > t - 0.25 && !due.includes(notes[k].midi)) due.push(notes[k].midi);
      const range = mat.segs[seg].range;
      const k2 = due.join(',') + '|' + range.join(',');
      if (k2 !== key && typeof tr.setExpected === 'function') {
        key = k2;
        tr.setExpected(due, range);
      }
    }
    at = i + chunk;
    tr.push(audio.subarray(i, i + chunk), i);
  }
  const ms = cpu() - t0;
  const stats = {};
  for (const [k, v] of Object.entries(tr.stats || {})) if (typeof v === 'number') stats[k] = v;
  return { events, ms, stats };
}

// Match events to notes: same key, onset within `tol`, nearest first (as noise-eval score()).
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
  const evUsed = new Uint8Array(events.length);
  for (const [, i, j] of pairs) {
    if (noteHit[i] >= 0 || evUsed[j]) continue;
    noteHit[i] = j;
    evUsed[j] = 1;
  }
  return { noteHit, evUsed };
}

const reg = (m) => (m < 48 ? 'lo' : m <= 72 ? 'mid' : 'hi');

// Score a set of notes (a whole material, or the notes of one level) against the events.
function scoreCell(notes, events, noteHit, evUsed, evIdx = null) {
  const { chords, octaves } = groupsOf(notes);
  const ids = evIdx || events.map((_, j) => j);
  let hit = 0,
    err = 0;
  const lat = { lo: [], mid: [], hi: [] };
  const misses = [];
  notes.forEach((n, i) => {
    const j = noteHit[i];
    if (j < 0) {
      misses.push(`${n.midi}@${n.t.toFixed(2)}`);
      return;
    }
    hit++;
    err += Math.abs(events[j].t - n.t);
    lat[reg(n.midi)].push(Math.round((events[j].at - n.t) * 10000) / 10);
  });
  const extras = ids.filter((j) => !evUsed[j]);
  return {
    n: notes.length,
    hit,
    ev: ids.length,
    extras: extras.length,
    extrasConf: extras.filter((j) => events[j].conf >= 0.55).length,
    err,
    lat,
    chords: { n: chords.length, complete: chords.filter((ix) => ix.every((i) => noteHit[i] >= 0)).length },
    octaves: { n: octaves.length, complete: octaves.filter(([a, b]) => noteHit[a] >= 0 && noteHit[b] >= 0).length },
    misses,
    extraList: extras.map((j) => `${events[j].midi}@${events[j].t.toFixed(2)}/${events[j].conf.toFixed(2)}`),
  };
}

const matCache = new Map();
function getMaterial(name, part, quick) {
  const k = String(quick);
  if (!matCache.has(k)) matCache.set(k, materials({ quick }));
  return matCache.get(k).find((m) => m.name === name && (m.part || 0) === (part || 0));
}

const dryCache = new Map();
async function runJob(job) {
  const Transcriber = await transcriberClass();
  const mat = getMaterial(job.mat, job.part, job.quick);
  const dk = `${job.inst}|${job.mat}|${job.part || 0}`;
  let dry = dryCache.get(dk);
  if (!dry) {
    dryCache.clear();
    dry = render(job.inst, mat.notes, { sr: SR, seed: 7, pedal: mat.pedal, length: mat.length });
    dryCache.set(dk, dry);
  }
  const audio = applyCondition(dry, job.cond, 1 + (job.part || 0));
  const out = { sec: audio.length / SR, cells: {} };
  for (const mode of MODES) {
    const { events, ms, stats } = listen(Transcriber, audio, mat, mode, job.chunk);
    const { noteHit, evUsed } = match(mat.notes, events);
    const cells = { [mat.name]: scoreCell(mat.notes, events, noteHit, evUsed) };
    if (mat.family === 'lesson') {
      // per level (events attributed to the piece they fall in)
      const levels = [...new Set(mat.notes.map((n) => n.level))];
      for (const L of levels) {
        const idx = mat.notes.map((n, i) => (n.level === L ? i : -1)).filter((i) => i >= 0);
        const segs = mat.segs.filter((s) => s.level === L);
        const evIdx = events.map((e, j) => j).filter((j) => segs.some((s) => events[j].t >= s.t0 && events[j].t < s.t1));
        const sub = scoreCell(
          idx.map((i) => mat.notes[i]),
          events,
          Int32Array.from(idx.map((i) => noteHit[i])),
          evUsed,
          evIdx,
        );
        cells[`lesson-L${String(L).padStart(2, '0')}`] = sub;
      }
    }
    out.cells[mode] = cells;
    out[`ms_${mode}`] = ms;
    out[`stats_${mode}`] = stats;
  }
  return out;
}

async function runParallel(jobs, threads) {
  const results = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const file = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(threads, jobs.length) }, async () => {
      const w = new Worker(file, { workerData: { benchWorker: true }, env: process.env });
      w.setMaxListeners(0);
      try {
        while (next < jobs.length) {
          const i = next++;
          results[i] = await new Promise((res, rej) => {
            w.once('message', res);
            w.once('error', rej);
            w.postMessage(jobs[i]);
          });
          done++;
          if (process.stderr.isTTY || process.env.PROGRESS) process.stderr.write(`\r${done}/${jobs.length} jobs, ${((Date.now() - t0) / 1000).toFixed(0)} s   `);
        }
      } finally {
        await w.terminate();
      }
    }),
  );
  if (process.stderr.isTTY || process.env.PROGRESS) process.stderr.write('\n');
  return results;
}

if (!isMainThread && workerData && workerData.benchWorker) {
  parentPort.on('message', async (job) => {
    try {
      parentPort.postMessage(await runJob(job));
    } catch (e) {
      parentPort.postMessage({ error: String(e && e.stack) });
    }
  });
}

// ---- aggregation ----------------------------------------------------------------------------------
function emptyAgg() {
  return { n: 0, hit: 0, ev: 0, extras: 0, extrasConf: 0, err: 0, lat: { lo: [], mid: [], hi: [] }, chords: { n: 0, complete: 0 }, octaves: { n: 0, complete: 0 }, misses: [], extraList: [] };
}
function addAgg(a, c) {
  a.n += c.n;
  a.hit += c.hit;
  a.ev += c.ev;
  a.extras += c.extras;
  a.extrasConf += c.extrasConf;
  a.err += c.err;
  for (const r of ['lo', 'mid', 'hi']) for (const v of c.lat[r]) a.lat[r].push(v);
  a.chords.n += c.chords.n;
  a.chords.complete += c.chords.complete;
  a.octaves.n += c.octaves.n;
  a.octaves.complete += c.octaves.complete;
  if (c.misses) a.misses.push(...c.misses);
  if (c.extraList) a.extraList.push(...c.extraList);
  return a;
}
function pctl(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}
function summarize(a) {
  const recall = a.n ? a.hit / a.n : null;
  const precision = a.hit + a.extras ? a.hit / (a.hit + a.extras) : null;
  const f1 = recall != null && precision != null && recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : null;
  const L = (arr) => ({ n: arr.length, med: pctl(arr, 0.5), p90: pctl(arr, 0.9) });
  const up = [...a.lat.mid, ...a.lat.hi];
  return {
    n: a.n,
    hit: a.hit,
    extras: a.extras,
    extrasConf: a.extrasConf,
    recall,
    precision,
    f1,
    absErrMs: a.hit ? (a.err / a.hit) * 1000 : null,
    chordComplete: a.chords.n ? a.chords.complete / a.chords.n : null,
    chords: a.chords.n,
    octaveComplete: a.octaves.n ? a.octaves.complete / a.octaves.n : null,
    octaves: a.octaves.n,
    latency: { lo: L(a.lat.lo), mid: L(a.lat.mid), hi: L(a.lat.hi), geC3: L(up), all: L([...a.lat.lo, ...up]) },
  };
}

// ---- report ---------------------------------------------------------------------------------------
const fmtP = (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%');
const fmtMs = (v) => (v == null ? '–' : Math.round(v) + '');

export const TARGETS = [
  { id: 'latLessonUp', label: 'Latency, lesson, notes ≥ C3: median / p90', unit: 'ms', get: (A) => A('lesson', 'all').latency.geC3, test: (v) => v.med <= 40 && v.p90 <= 70, show: (v) => `${fmtMs(v.med)} / ${fmtMs(v.p90)} ms`, want: '≤ 40 / ≤ 70 ms' },
  { id: 'latLessonLo', label: 'Latency, lesson, notes < C3: median', get: (A) => A('lesson', 'all').latency.lo, test: (v) => v.med <= 70, show: (v) => `${fmtMs(v.med)} ms (p90 ${fmtMs(v.p90)})`, want: '≤ 70 ms' },
  { id: 'latFreeUp', label: 'Latency, free play, notes ≥ C3: median / p90', get: (A) => A('free', 'all').latency.geC3, test: (v) => v.med <= 60 && v.p90 <= 120, show: (v) => `${fmtMs(v.med)} / ${fmtMs(v.p90)} ms`, want: '≤ 60 / ≤ 120 ms' },
  { id: 'chordLesson', label: 'Lesson: chord completeness (dyads, triads, 4-note, both hands)', get: (A) => A('lesson', ['dyads', 'triads', 'tetrads', 'bothhands']).chordComplete, test: (v) => v >= 0.95, show: fmtP, want: '≥ 95%' },
  { id: 'octLesson', label: 'Lesson: octave completeness', get: (A) => A('lesson', ['octaves', 'octmelody']).octaveComplete, test: (v) => v >= 0.9, show: fmtP, want: '≥ 90%' },
  { id: 'f1Lesson', label: 'Lesson: note F1 on the lesson pieces, levels 1–20', get: (A) => A('lesson', 'lesson≤20').f1, test: (v) => v >= 0.97, show: fmtP, want: '≥ 97%' },
  { id: 'triadFree', label: 'Free play: triad recall / precision', get: (A) => A('free', ['triads']), test: (v) => v.recall >= 0.9 && v.precision >= 0.9, show: (v) => `${fmtP(v.recall)} / ${fmtP(v.precision)}`, want: '≥ 90% / ≥ 90%' },
  { id: 'octFree', label: 'Free play: octave completeness', get: (A) => A('free', ['octaves', 'octmelody']).octaveComplete, test: (v) => v >= 0.8, show: fmtP, want: '≥ 80%' },
  { id: 'scalesFree', label: 'Free play: fast 16th scales, recall', get: (A) => A('free', ['scales16']).recall, test: (v) => v >= 0.85, show: fmtP, want: '≥ 85%' },
  // market comparison (docs/listening-market.md): what reviews report for the leading apps
  { id: 'singlesFree', label: 'Market: single notes, free play, recall / precision', get: (A) => A('free', ['singles']), test: (v) => v.recall >= 0.98 && v.precision >= 0.98, show: (v) => `${fmtP(v.recall)} / ${fmtP(v.precision)}`, want: '≥ 98% / ≥ 98%' },
  { id: 'fastLesson', label: 'Market: fast passages (scales, repeated notes, trills, arpeggios), lesson, recall', get: (A) => A('lesson', ['scales16', 'repeated8', 'trills', 'arpeggios']).recall, test: (v) => v >= 0.9, show: fmtP, want: '≥ 90%' },
];

function buildAccessor(agg, insts, cond, fams) {
  return (mode, what) => {
    const a = emptyAgg();
    for (const inst of insts) {
      const cells = agg[`${inst}|${cond}|${mode}`];
      if (!cells) continue;
      for (const [mat, c] of Object.entries(cells)) {
        let take;
        if (what === 'all') take = !mat.startsWith('lesson-');
        else if (what === 'lesson≤20') take = /^lesson-L(\d+)$/.test(mat) && Number(mat.slice(8)) <= 20;
        else take = what.includes(mat);
        if (take) addAgg(a, c);
      }
    }
    return summarize(a);
  };
}

function mdTable(head, rows) {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

async function main() {
  const quick = !!process.env.QUICK;
  const chunk = Number(process.env.CHUNK || 256); // what the capture worklet sends (was 512 before)
  const threads = Number(process.env.THREADS || Math.max(1, os.cpus().length));
  const outBase = process.env.OUT || path.join(here, '../docs/listening-bench');
  const t0 = Date.now();
  const insts = INSTRUMENTS.filter((i) => hasInstrument(i) && (!quick || HELD_OUT.includes(i)));
  if (!insts.length) {
    console.log('no pianos cached: run node tests/corpus-fetch.js and node tests/bench-fetch.js');
    process.exit(0);
  }
  const heldOut = insts.filter((i) => HELD_OUT.includes(i));
  const conds = quick ? ['stand', 'stand+talk'] : CONDITIONS;
  const mats = materials({ quick });
  let jobs = [];
  for (const inst of insts) for (const cond of conds) for (const m of mats) jobs.push({ inst, cond, mat: m.name, part: m.part || 0, quick, chunk });
  if (process.env.ONLY) {
    const re = new RegExp(process.env.ONLY);
    jobs = jobs.filter((j) => re.test(`${j.inst}|${j.cond}|${j.mat}`));
  }
  // longest first (lessons) for better load balance
  const lenOf = (j) => mats.find((m) => m.name === j.mat && (m.part || 0) === j.part).length;
  jobs.sort((a, b) => lenOf(b) - lenOf(a));
  console.log(`listening benchmark: ${insts.join(', ')} x ${conds.join(', ')} x ${mats.length} materials x ${MODES.join('/')}; ${jobs.length} jobs on ${threads} threads; chunk ${chunk}${quick ? '; QUICK' : ''}`);
  const engine = await engineInfo();
  console.log(`engine: ${engine.name} ${engine.version} (${engine.path})`);
  const res = await runParallel(jobs, threads);

  // aggregate: agg["inst|cond|mode"][material] = raw counters
  const agg = {};
  const speeds = [];
  let cpuMs = 0,
    audioSec = 0;
  const statsSum = {};
  jobs.forEach((j, i) => {
    const r = res[i];
    if (r.error) {
      console.log(`! ${j.inst}|${j.cond}|${j.mat}: ${r.error}`);
      return;
    }
    for (const mode of MODES) {
      const k = `${j.inst}|${j.cond}|${mode}`;
      agg[k] ||= {};
      for (const [mat, c] of Object.entries(r.cells[mode])) addAgg((agg[k][mat] ||= emptyAgg()), c);
      speeds.push(r.sec / (r[`ms_${mode}`] / 1000));
      cpuMs += r[`ms_${mode}`];
      audioSec += r.sec;
      for (const [s, v] of Object.entries(r[`stats_${mode}`] || {})) statsSum[s] = (statsSum[s] || 0) + v;
    }
  });
  speeds.sort((a, b) => a - b);
  const speed = { median: pctl(speeds, 0.5), min: speeds[0], overall: audioSec / (cpuMs / 1000) };

  // summaries
  const cells = {};
  for (const [k, mats2] of Object.entries(agg)) for (const [mat, a] of Object.entries(mats2)) cells[`${k}|${mat}`] = summarize(a);
  const targets = {};
  for (const cond of conds) {
    const A = buildAccessor(agg, heldOut.length ? heldOut : insts, cond);
    for (const T of TARGETS) {
      let v = null;
      try {
        v = T.get(A);
      } catch {
        v = null;
      }
      const ok = v != null && (typeof v !== 'object' || v.med != null || v.recall != null) ? !!T.test(v) : null;
      (targets[T.id] ||= {})[cond] = { value: v, pass: ok };
    }
  }
  const byInst = {};
  for (const inst of insts)
    for (const cond of conds) {
      const A = buildAccessor(agg, [inst], cond);
      byInst[`${inst}|${cond}`] = {};
      for (const mode of MODES) byInst[`${inst}|${cond}`][mode] = { all: A(mode, 'all'), lesson: A(mode, ['lesson']), chords: A(mode, ['dyads', 'triads', 'tetrads', 'bothhands', 'repchords']), octaves: A(mode, ['octaves', 'octmelody']), fast: A(mode, ['scales16', 'repeated8', 'trills', 'arpeggios']), singles: A(mode, ['singles']), pedal: A(mode, ['pedal']) };
    }

  // noise-only false notes
  let noise = null;
  if (process.env.NOISE !== '0') {
    const ne = await import('./noise-eval.js');
    const types = quick ? ['speech', 'tv', 'claps', 'typing'] : [...ne.NOISE_TYPES, ...(hasInstrument('salamander') ? ['real-speech', 'real-radio'] : [])];
    const levels = quick ? ['realistic'] : ['realistic', 'loud'];
    const njobs = [];
    for (const n of types) for (const level of levels) njobs.push({ kind: 'noise', noise: n, level, sec: quick ? 30 : 60, seed: 1, opts: {} });
    const nres = await ne.runParallel(njobs, threads);
    noise = {};
    njobs.forEach((j, i) => {
      const r = nres[i];
      if (r.skipped || r.error) return;
      (noise[j.noise] ||= {})[j.level] = { fpm: r.fpm, fpmConf: r.fpmConf, notes: r.notes };
    });
  }

  // in-browser pipeline latency
  let browser = null;
  if (process.env.BROWSER !== '0') {
    try {
      const { measurePipeline } = await import('./bench-pipeline.js');
      browser = await measurePipeline({ url: process.env.URL || 'http://localhost:8090/' });
    } catch (e) {
      browser = { skipped: String((e && e.message) || e) };
    }
  }

  const baseline = process.env.BASELINE && fs.existsSync(process.env.BASELINE) ? JSON.parse(fs.readFileSync(process.env.BASELINE, 'utf8')) : null;
  if (baseline) fillTargets(baseline);
  const report = {
    date: new Date().toISOString(),
    engine: engine.path,
    engineName: engine.name,
    engineVersion: engine.version,
    quick,
    chunk,
    instruments: insts,
    heldOut,
    conditions: conds,
    wallSec: Math.round((Date.now() - t0) / 1000),
    speed,
    stats: statsSum,
    targets,
    byInst,
    cells,
    noise,
    browser,
  };
  const md = markdown(report, baseline);
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  fs.writeFileSync(outBase + '.md', md);
  fs.writeFileSync(outBase + '.json', JSON.stringify(report, null, 1));
  if (process.env.DETAILS) {
    const det = {};
    for (const [k, mats2] of Object.entries(agg)) for (const [mat, a] of Object.entries(mats2)) det[`${k}|${mat}`] = { misses: a.misses, extras: a.extraList };
    fs.writeFileSync(outBase + '.details.json', JSON.stringify(det, null, 1));
  }
  console.log(md.split('\n## ')[0]);
  console.log(`\nwrote ${path.relative(process.cwd(), outBase)}.md / .json (${report.wallSec} s)`);
}

function markdown(R, B) {
  const L = [];
  const heldName = R.heldOut.length ? R.heldOut.join(' + ') : R.instruments.join(' + ');
  L.push(`# Listening benchmark${R.quick ? ' (QUICK)' : ''}`);
  L.push('');
  const eng = (X) => (X.engineName ? `${X.engineName} ${X.engineVersion}` : X.engine);
  L.push(`${R.date.slice(0, 16).replace('T', ' ')} UTC · engine **${eng(R)}** (\`${R.engine}\`) · ${R.chunk}-sample chunks · ${R.instruments.join(', ')} × ${R.conditions.join(', ')} · ${R.wallSec} s wall. Generated by \`node tests/bench-listen.js\`.`);
  L.push('');
  L.push(`Targets are measured on the held-out pianos (${heldName}) in the \`stand\` condition (iPad on the music stand); \`stand+talk\` adds a conversation across the room.${B ? ' "Before" is ' + eng(B) + ' from ' + B.date.slice(0, 10) + '.' : ''}`);
  L.push('');
  const conds = R.conditions.filter((c) => c !== 'close');
  const head = ['Target', 'Wanted', ...conds.map((c) => `\`${c}\``), ...(B ? ['before (`stand`)'] : []), 'Pass'];
  const rows = [];
  for (const T of TARGETS) {
    const t = R.targets[T.id];
    if (!t) continue;
    const val = (c) => (t[c] && t[c].value != null ? T.show(t[c].value) : '–');
    const b = B && B.targets[T.id] && B.targets[T.id].stand && B.targets[T.id].stand.value != null ? T.show(B.targets[T.id].stand.value) : '–';
    const pass = t.stand ? t.stand.pass : t[conds[0]] && t[conds[0]].pass;
    rows.push([T.label, T.want, ...conds.map(val), ...(B ? [b] : []), pass == null ? '–' : pass ? '**pass**' : 'FAIL']);
  }
  // no-regression checks
  if (R.noise) {
    const fp = (N, lvl) => Object.values(N).reduce((a, v) => a + (v[lvl] ? v[lvl].fpm : 0), 0);
    const now = fp(R.noise, 'realistic');
    const before = B && B.noise ? fp(B.noise, 'realistic') : null;
    const sp = R.noise.speech && R.noise.speech.realistic ? R.noise.speech.realistic.fpm : null;
    const ok = before == null ? null : now <= before * 1.2 + 0.5 && (sp == null || sp <= 1);
    rows.push(['No regression: noise-only false notes/min (sum of all noise types, realistic)', '≤ before + 20%, speech ≈ 0', `${now.toFixed(1)} (speech ${sp == null ? '–' : sp.toFixed(1)})`, ...conds.slice(1).map(() => ''), ...(B ? [before == null ? '–' : before.toFixed(1)] : []), ok == null ? '–' : ok ? '**pass**' : 'FAIL']);
  }
  for (const [id, label, mats] of [
    ['singles', 'No regression: singles recall (free)', ['singles']],
    ['repeated', 'No regression: repeated notes recall (free)', ['repeated8']],
  ]) {
    const get = (X) => {
      if (!X) return null;
      let hit = 0,
        n = 0;
      for (const inst of X.heldOut.length ? X.heldOut : X.instruments)
        for (const m of mats) {
          const c = X.cells[`${inst}|stand|free|${m}`];
          if (c) {
            hit += c.hit;
            n += c.n;
          }
        }
      return n ? hit / n : null;
    };
    const now = get(R),
      before = get(B);
    rows.push([label, '≥ before', fmtP(now), ...conds.slice(1).map(() => ''), ...(B ? [fmtP(before)] : []), before == null || now == null ? '–' : now >= before - 0.005 ? '**pass**' : 'FAIL']);
    void id;
  }
  rows.push(['Speed (one core, × real time, median job)', '≥ 4×', `${R.speed.median.toFixed(1)}× (min ${R.speed.min.toFixed(1)}×)`, ...conds.slice(1).map(() => ''), ...(B ? [`${B.speed.median.toFixed(1)}×`] : []), R.speed.median >= 4 ? '**pass**' : 'FAIL']);
  L.push(mdTable(head, rows));
  L.push('');

  // latency detail
  L.push('## Report latency');
  L.push('');
  L.push('Attack → callback, in ms (median / p90), by register, all materials pooled. This is analysis plus chunking; the in-browser pipeline adds the worker hops (see the end).');
  L.push('');
  {
    const rows2 = [];
    for (const key of Object.keys(R.byInst)) {
      const [inst, cond] = key.split('|');
      for (const mode of ['lesson', 'free']) {
        const l = R.byInst[key][mode].all.latency;
        rows2.push([inst, cond, mode, ...['lo', 'mid', 'hi'].map((r) => (l[r].n ? `${fmtMs(l[r].med)} / ${fmtMs(l[r].p90)}` : '–'))]);
      }
    }
    L.push(mdTable(['piano', 'condition', 'mode', '< C3', 'C3–C5', '> C5'], rows2));
  }
  L.push('');

  // per material, held-out, stand
  const matNames = [...new Set(Object.keys(R.cells).map((k) => k.split('|')[3]))].filter((m) => !m.startsWith('lesson-'));
  for (const cond of R.conditions) {
    L.push(`## Materials — held-out pianos, \`${cond}\``);
    L.push('');
    const rows3 = [];
    for (const mat of matNames)
      for (const mode of ['lesson', 'free']) {
        const a = emptyAgg();
        let any = false;
        for (const inst of R.heldOut.length ? R.heldOut : R.instruments) {
          const c = R._raw && R._raw[`${inst}|${cond}|${mode}|${mat}`];
          void c;
          const s = R.cells[`${inst}|${cond}|${mode}|${mat}`];
          if (s) {
            any = true;
            a.n += s.n;
            a.hit += s.hit;
            a.extras += s.extras;
            a.extrasConf += s.extrasConf;
            a.err += (s.absErrMs || 0) * s.hit;
            a.chords.n += s.chords;
            a.chords.complete += (s.chordComplete || 0) * s.chords;
            a.octaves.n += s.octaves;
            a.octaves.complete += (s.octaveComplete || 0) * s.octaves;
          }
        }
        if (!any) continue;
        const s = summarize(a);
        rows3.push([mat, mode, fmtP(s.recall), fmtP(s.precision), fmtP(s.f1), s.chords ? fmtP(s.chordComplete) : '', s.octaves ? fmtP(s.octaveComplete) : '', a.hit ? (a.err / a.hit).toFixed(1) : '–', `${a.extras} (${a.extrasConf})`]);
      }
    L.push(mdTable(['material', 'mode', 'recall', 'precision', 'F1', 'chords complete', 'octaves complete', 'onset err ms', 'extras (conf ≥ .55)'], rows3));
    L.push('');
  }

  // by instrument
  L.push('## By piano and condition (F1; chord / octave completeness)');
  L.push('');
  {
    const rows4 = [];
    for (const [key, v] of Object.entries(R.byInst)) {
      const [inst, cond] = key.split('|');
      for (const mode of ['lesson', 'free']) {
        const x = v[mode];
        rows4.push([inst + (R.heldOut.includes(inst) ? '' : ' (in-sample)'), cond, mode, fmtP(x.all.f1), fmtP(x.singles.f1), fmtP(x.lesson.f1), `${fmtP(x.chords.f1)} · ${fmtP(x.chords.chordComplete)}`, `${fmtP(x.octaves.f1)} · ${fmtP(x.octaves.octaveComplete)}`, fmtP(x.fast.f1), fmtP(x.pedal.f1)]);
      }
    }
    L.push(mdTable(['piano', 'condition', 'mode', 'all', 'singles', 'lesson pieces', 'chords (F1 · complete)', 'octaves (F1 · complete)', 'fast', 'pedal'], rows4));
  }
  L.push('');

  // lesson by level
  L.push('## Lesson pieces by level — held-out pianos, `stand`, lesson mode (F1)');
  L.push('');
  {
    const levels = [...new Set(Object.keys(R.cells).filter((k) => k.includes('|lesson-L')).map((k) => k.split('|')[3]))].sort();
    const rows5 = [];
    for (const lv of levels) {
      const r = [lv.replace('lesson-L', 'level ').replace(/ 0/, ' ')];
      for (const mode of ['lesson', 'free']) {
        let hit = 0,
          n = 0,
          ex = 0;
        for (const inst of R.heldOut.length ? R.heldOut : R.instruments) {
          const s = R.cells[`${inst}|stand|${mode}|${lv}`];
          if (s) {
            hit += s.hit;
            n += s.n;
            ex += s.extras;
          }
        }
        const rc = n ? hit / n : 0,
          pr = hit + ex ? hit / (hit + ex) : 0;
        r.push(n ? `${fmtP((2 * rc * pr) / (rc + pr || 1))} (${fmtP(rc)} / ${fmtP(pr)})` : '–');
      }
      rows5.push(r);
    }
    L.push(mdTable(['piece', 'lesson mode: F1 (recall / precision)', 'free: F1 (recall / precision)'], rows5));
  }
  L.push('');

  if (R.noise) {
    L.push('## Noise alone: false notes per minute (all / confidence ≥ 0.55)');
    L.push('');
    const rows6 = Object.entries(R.noise).map(([n, v]) => {
      const b = B && B.noise && B.noise[n];
      const f = (x) => (x ? `${x.fpm.toFixed(1)} (${x.fpmConf.toFixed(1)})` : '–');
      return [n, f(v.realistic), f(v.loud), ...(B ? [f(b && b.realistic), f(b && b.loud)] : [])];
    });
    L.push(mdTable(['noise', 'realistic', 'loud', ...(B ? ['before: realistic', 'before: loud'] : [])], rows6));
    L.push('');
  }

  L.push('## Speed');
  L.push('');
  L.push(`One core (thread CPU time): median job ${R.speed.median.toFixed(1)}× real time (slowest ${R.speed.min.toFixed(1)}×, overall ${R.speed.overall.toFixed(1)}×). Listener stats over all runs: ${Object.entries(R.stats).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  L.push('');

  L.push('## In-browser pipeline latency (headless Chromium, fake microphone)');
  L.push('');
  if (!R.browser || R.browser.skipped) L.push(`Skipped${R.browser ? ': ' + R.browser.skipped : ''}.`);
  else {
    const b = R.browser;
    L.push(b.note || '');
    L.push('');
    const rows7 = [];
    for (const [k, v] of Object.entries(b.results || {})) rows7.push([k, `${v.found}/${v.n}`, fmtMs(v.med), fmtMs(v.p90), fmtMs(v.offlineMed), fmtMs(v.offlineP90)]);
    L.push(mdTable(['mode', 'notes heard', 'attack → main thread, median ms', 'p90 ms', 'offline (same audio, same engine) median', 'p90'], rows7));
    if (B && B.browser && B.browser.results) {
      L.push('');
      L.push('Before: ' + Object.entries(B.browser.results).map(([k, v]) => `${k} median ${fmtMs(v.med)} ms / p90 ${fmtMs(v.p90)} ms`).join('; ') + '.');
    }
  }
  L.push('');
  return L.join('\n');
}

// node tests/bench-listen.js --report docs/x.json   rebuilds docs/x.md from its JSON (BASELINE
// applies as usual).
// Count-based targets can be recomputed from the stored per-cell summaries (latency percentiles
// cannot: they need the raw latencies of the run).
function cellAccessor(R, insts, cond) {
  return (mode, what) => {
    const a = emptyAgg();
    for (const inst of insts)
      for (const [k, c] of Object.entries(R.cells)) {
        const [i2, c2, m2, mat] = k.split('|');
        if (i2 !== inst || c2 !== cond || m2 !== mode) continue;
        const take = what === 'all' ? !mat.startsWith('lesson-') : what === 'lesson≤20' ? /^lesson-L(\d+)$/.test(mat) && Number(mat.slice(8)) <= 20 : what.includes(mat);
        if (!take) continue;
        a.n += c.n;
        a.hit += c.hit;
        a.extras += c.extras;
        a.chords.n += c.chords;
        a.chords.complete += Math.round((c.chordComplete || 0) * c.chords);
        a.octaves.n += c.octaves;
        a.octaves.complete += Math.round((c.octaveComplete || 0) * c.octaves);
      }
    return summarize(a);
  };
}

function fillTargets(R) {
  for (const cond of R.conditions) {
    const A = cellAccessor(R, R.heldOut.length ? R.heldOut : R.instruments, cond);
    for (const T of TARGETS) {
      if (T.id.startsWith('lat') || (R.targets[T.id] && R.targets[T.id][cond])) continue;
      const v = T.get(A);
      const ok = v != null && (typeof v !== 'object' || v.recall != null) ? !!T.test(v) : null;
      (R.targets[T.id] ||= {})[cond] = { value: v, pass: ok };
    }
  }
}

function reportOnly(file) {
  const R = JSON.parse(fs.readFileSync(file, 'utf8'));
  fillTargets(R);
  fs.writeFileSync(file, JSON.stringify(R, null, 1));
  const B = process.env.BASELINE && fs.existsSync(process.env.BASELINE) ? JSON.parse(fs.readFileSync(process.env.BASELINE, 'utf8')) : null;
  if (B) fillTargets(B);
  fs.writeFileSync(file.replace(/\.json$/, '.md'), markdown(R, B));
  console.log(`wrote ${file.replace(/\.json$/, '.md')}`);
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--report') reportOnly(process.argv[3]);
  else main();
}
