// Regression test on the first REAL recording: the project owner's iPad on the music stand of an
// acoustic piano at home, the easy listening test (tests/fixtures/real/ipad-easy-2026-09-28.*).
// The recording is quiet (piano about -51 dBFS, room -71 to -84 dBFS): ~23 dB below the
// benchmark's mezzo-forte, which is what this test guards.
//
// Two replays of the hybrid listener (js/audio/nn/hybrid-transcriber.js), calibrated on the room
// tone before the first note (as the app does at start-up) and fed 256-sample chunks:
//   - wait mode, with the app's hints: the notes of the current step not heard yet are expected
//     (setExpected), the step moves on once all were heard. Live, on the iPad, the app heard all
//     24 notes; so must the replay.
//   - free play: no hints. Scored against the notes that were really PLAYED, which are not quite
//     the 24 the test asked for (checked on the spectra, see PLAYED below): the student added
//     notes (A4 with the E4 at 23.70 s, E4 with the G4 at 25.46 s, D4 in the C-E-G chord at
//     27.63 s, the chord again at 29.30 s, A3 instead of G3 at 35.10 s, C4 with the C3 at
//     37.57 s), and two notes the app accepted live were never struck (E4 at 28.71 s and C4 at
//     37.22 s: the keys of the previous chord being released, heard with the lesson's hint).
// Skipped when the network's weights (assets/models/piano-nn.bin) are missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transcriber } from '../js/audio/nn/hybrid-transcriber.js';
import { weightsLoaded } from '../js/audio/nn/nn-transcriber.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(here, 'fixtures/real/ipad-easy-2026-09-28');
const skip = (!(fs.existsSync(path.join(here, '../assets/models/piano-nn.bin')) && weightsLoaded()) && 'no weights (assets/models/piano-nn.bin)') || (!fs.existsSync(BASE + '.wav') && 'no recording');

function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12,
    fmt = null,
    data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4),
      sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = [o + 8, sz];
    o += 8 + sz + (sz & 1);
  }
  assert.ok(fmt && data && fmt.bits === 16, '16-bit PCM WAV');
  const n = Math.floor(data[1] / 2 / fmt.ch);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(data[0] + 2 * i * fmt.ch) / 32768;
  return { x, sr: fmt.sr };
}

// What was played (MIDI, attack s), from the spectra around every attack: a key counts when its
// fundamental and its own (odd) partials rose at the attack, not only partials it shares with a
// lower note struck with it (C3's octave and twelfth at 12.71 and 32.74 s, G4 alone at 35.10 s).
const PLAYED = [
  [60, 4.149], [62, 5.237], [64, 6.341], [65, 7.412], [67, 8.496], [67, 10.592],
  [48, 12.709], [50, 13.706], [52, 14.8], [53, 15.867], [55, 16.95],
  [60, 21.244], [64, 21.243], [64, 23.7], [69, 23.7], [64, 25.462], [67, 25.49],
  [60, 27.627], [62, 27.627], [67, 27.627], [60, 29.3], [64, 29.3], [67, 29.3],
  [48, 32.741], [64, 32.741], [67, 35.1], [57, 35.1], [48, 37.573], [60, 37.573],
];
// played or not, can't tell (A3's octave): neither a hit nor an extra
const EITHER = [[69, 35.1]];

// free play floors (raise them as the listener improves). Before the level normalisation and
// the tempo-independent fast-path gate: 27 hits, 0-1 extras, median 105 ms, p90 288 ms; after:
// 27, 1 (C3's octave at 12.71 s, confidence 0.4), 59 ms, 288 ms. Wait mode: median 43 ms.
const FREE = { hits: 27, extras: 1, med: 70, p90: 300 };

const END = 39;
const CAL = [0.4, 1.4]; // s: room tone before the first note (the recording starts on a note's tail)

function replay(x, sr, { wait = null } = {}) {
  const ev = [];
  let tr;
  let step = 0;
  let pending = wait ? new Set(wait[0].midis) : null;
  tr = new Transcriber(sr, {
    onNoteOn: (midi, t, vel, info) => {
      ev.push({ midi, t, at: tr.pos / sr, conf: info?.confidence ?? 1 });
      if (pending && pending.has(midi)) {
        pending.delete(midi);
        if (!pending.size && ++step < wait.length) pending = new Set(wait[step].midis);
      }
    },
  });
  let key = null;
  const end = Math.min(x.length, Math.round(END * sr)); // (nothing is played after the last notes)
  for (let i = 0; i + 256 <= end; i += 256) {
    const t = i / sr;
    if (wait && step >= wait.length) break;
    if (t >= CAL[0] && !tr.dsp.calibrating && key === null) {
      tr.startCalibration();
      key = '';
    }
    if (t >= CAL[1] && tr.dsp.calibrating) tr.finishCalibration();
    if (wait) {
      const due = step < wait.length ? [...pending] : [];
      const k = due.join(',');
      if (k !== key) {
        key = k;
        tr.setExpected(due, [48, 67]); // the piece's range, as the app sends it
      }
    }
    tr.push(x.subarray(i, i + 256), i);
  }
  return { ev, steps: step, tr };
}

function score(ev, notes, tol, ignore = []) {
  const used = new Set();
  const lat = [];
  const missed = [];
  for (const [m, t] of notes) {
    let best = -1;
    ev.forEach((e, j) => {
      if (!used.has(j) && e.midi === m && Math.abs(e.t - t) <= tol && (best < 0 || Math.abs(e.t - t) < Math.abs(ev[best].t - t))) best = j;
    });
    if (best < 0) missed.push(`${m}@${t}`);
    else {
      used.add(best);
      lat.push(Math.round((ev[best].at - t) * 1000));
    }
  }
  const extras = ev.filter((e, j) => !used.has(j) && e.t > 3 && !ignore.some(([m, t]) => m === e.midi && Math.abs(e.t - t) <= tol));
  lat.sort((a, b) => a - b);
  const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
  return { hits: lat.length, missed, extras: extras.map((e) => `${e.midi}@${e.t.toFixed(2)}/${e.conf.toFixed(2)}`), med: q(0.5), p90: q(0.9) };
}

let rec = null;
const load = () => (rec ||= { ...readWav(BASE + '.wav'), J: JSON.parse(fs.readFileSync(BASE + '.json', 'utf8')) });

test('real iPad recording, wait mode with the app\'s hints: all 24 notes heard', { skip }, () => {
  const { x, sr, J } = load();
  const exp = J.expected.filter((e) => e.t != null);
  assert.equal(exp.length, 24);
  // the test's steps: notes asked for together (the app times them when each was heard)
  const steps = [];
  for (const e of [...exp].sort((a, b) => a.t - b.t)) {
    const s = steps.find((g) => Math.abs(g.t - e.t) < 0.6 && !g.midis.includes(e.midi));
    if (s) s.midis.push(e.midi);
    else steps.push({ t: e.t, midis: [e.midi] });
  }
  const { ev, steps: done } = replay(x, sr, { wait: steps });
  assert.equal(done, steps.length, `wait mode stuck at step ${done} (${steps[done]?.midis} @ ${steps[done]?.t}); heard ${ev.map((e) => e.midi + '@' + e.t.toFixed(2)).join(' ')}`);
});

test('real iPad recording, free play: hears what was played, quickly', { skip }, () => {
  const { x, sr } = load();
  const { ev } = replay(x, sr);
  const s = score(ev, PLAYED, 0.1, EITHER);
  const msg = `free play: ${s.hits}/${PLAYED.length} hit, missed ${s.missed.join(' ') || '-'}, extras ${s.extras.join(' ') || '-'}, latency median ${s.med} p90 ${s.p90} ms`;
  assert.ok(s.hits >= FREE.hits, msg);
  assert.ok(s.extras.length <= FREE.extras, msg);
  assert.ok(s.med <= FREE.med, msg);
  assert.ok(s.p90 <= FREE.p90, msg);
});
