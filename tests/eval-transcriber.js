// Offline accuracy report for the transcriber on synthesized piano audio.
import { Transcriber } from '../js/audio/transcriber.js';
import { renderPiano, rng } from './synth-piano.js';

export function transcribe(audio, sr, opts = {}) {
  const events = [];
  const tr = new Transcriber(sr, { ...opts, onNoteOn: (midi, t) => events.push({ midi, t }) });
  // calibrate on the first 0.4 s (silence)
  tr.startCalibration();
  const chunk = 128;
  let calibrated = false;
  for (let i = 0; i + chunk <= audio.length; i += chunk) {
    if (!calibrated && i / sr > 0.4) { tr.finishCalibration(); calibrated = true; }
    tr.push(audio.subarray(i, i + chunk), i);
  }
  return events;
}

export function score(notes, events, tol = 0.08) {
  const used = new Set();
  let hit = 0, errs = [];
  const misses = [];
  for (const n of notes) {
    let best = -1, bd = 1e9;
    events.forEach((e, i) => {
      if (used.has(i) || e.midi !== n.midi) return;
      const d = Math.abs(e.t - n.t);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd <= tol) { used.add(best); hit++; errs.push(events[best].t - n.t); }
    else misses.push(n);
  }
  const extras = events.filter((_, i) => !used.has(i));
  const meanErr = errs.reduce((a, b) => a + b, 0) / (errs.length || 1);
  const absErr = errs.reduce((a, b) => a + Math.abs(b), 0) / (errs.length || 1);
  return { recall: hit / notes.length, precision: hit / (hit + extras.length || 1), meanErr, absErr, misses, extras };
}

function run(name, notes, sr = 48000, opts = {}) {
  const audio = renderPiano(notes, { sr, ...opts });
  const t0 = performance.now();
  const ev = transcribe(audio, sr);
  const ms = performance.now() - t0;
  const s = score(notes, ev);
  console.log(`${name.padEnd(28)} recall ${(s.recall * 100).toFixed(1).padStart(5)}%  precision ${(s.precision * 100).toFixed(1).padStart(5)}%  onset err mean ${(s.meanErr * 1000).toFixed(1)}ms abs ${(s.absErr * 1000).toFixed(1)}ms  cpu x${(audio.length / sr * 1000 / ms).toFixed(1)} realtime`);
  if (process.env.VERBOSE) {
    console.log('  misses', s.misses.map((n) => `${n.midi}@${n.t.toFixed(2)}`).join(' '));
    console.log('  extras', s.extras.map((n) => `${n.midi}@${n.t.toFixed(2)}`).join(' '));
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = rng(3);
  // 1. every key, separated
  const singles = [];
  for (let m = 21; m <= 108; m++) singles.push({ midi: m, t: 0.6 + (m - 21) * 0.7, dur: 0.5, vel: 0.5 + r() * 0.4 });
  run('single notes A0-C8', singles);
  const soft = singles.map((n) => ({ ...n, vel: 0.2 }));
  run('single notes soft', soft);
  // 2. triads in the middle register
  const chords = [];
  let t = 0.6;
  for (let i = 0; i < 40; i++) {
    const root = 48 + Math.floor(r() * 24);
    const q = r() < 0.5 ? [0, 4, 7] : [0, 3, 7];
    for (const iv of q) chords.push({ midi: root + iv, t, dur: 0.6, vel: 0.6 });
    t += 0.8;
  }
  run('triads C3-C6', chords);
  // 3. two hands: bass note + melody note
  const hands = [];
  t = 0.6;
  for (let i = 0; i < 40; i++) {
    hands.push({ midi: 36 + Math.floor(r() * 18), t, dur: 0.7, vel: 0.6 });
    hands.push({ midi: 60 + Math.floor(r() * 20), t, dur: 0.35, vel: 0.6 });
    hands.push({ midi: 60 + Math.floor(r() * 20), t: t + 0.4, dur: 0.35, vel: 0.6 });
    t += 0.8;
  }
  run('bass + melody', hands);
  // 4. melody with repeated notes, eighths at 120 bpm
  const mel = [];
  const seq = [60, 60, 60, 62, 64, 64, 62, 60, 67, 67, 65, 65, 64, 64, 62, 62, 60, 60, 60, 60];
  seq.forEach((m, i) => mel.push({ midi: m, t: 0.6 + i * 0.25, dur: 0.22, vel: 0.6 }));
  run('repeated eighths 120bpm', mel);
  // 5. fast scale: sixteenths at 100 bpm, 2 octaves up and down
  const sc = [0, 2, 4, 5, 7, 9, 11];
  const sn = [];
  for (let o = 0; o < 2; o++) for (const s of sc) sn.push(60 + o * 12 + s);
  sn.push(84);
  const scale = [...sn, ...sn.slice(0, -1).reverse()].map((m, i) => ({ midi: m, t: 0.6 + i * 0.15, dur: 0.14, vel: 0.6 }));
  run('scale 16ths 100bpm', scale);
  // 6. out of tune piano (-30 cents), larger inharmonicity
  run('detuned -30c, B x2', chords, 48000, { tuningCents: -30, bScale: 2 });
  run('44.1kHz triads', chords, 44100);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = rng(11);
  const mel = [];
  let t = 0.6;
  for (let i = 0; i < 60; i++) { mel.push({ midi: 55 + Math.floor(r() * 24), t, dur: 1.2, vel: 0.4 + r() * 0.4 }); t += 0.3; }
  run('pedal (overlapping notes)', mel);
  run('noisy room', mel.map((n) => ({ ...n, dur: 0.28 })), 48000, { noise: 0.01 });
}
