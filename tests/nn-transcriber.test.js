// The learned transcriber (js/audio/nn/nn-transcriber.js): same interface as the DSP
// Transcriber, hears notes and chords quickly, back-dates them to the attack, and falls back to
// the DSP engine when the weights are not available. The detection tests are skipped when
// assets/models/piano-nn.bin is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transcriber, weightsLoaded, setWeights, getWeights } from '../js/audio/nn/nn-transcriber.js';
import { renderPiano } from './synth-piano.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS = path.join(here, '../assets/models/piano-nn.bin');
const skip = !(fs.existsSync(WEIGHTS) && weightsLoaded()) && 'no weights (assets/models/piano-nn.bin)';

function run(audio, sr, { chunk = 512, expected = null, range = null } = {}) {
  const ev = [];
  const offs = [];
  const onsets = [];
  let tr;
  tr = new Transcriber(sr, {
    onNoteOn: (midi, t, vel, info) => ev.push({ midi, t, at: tr.pos / sr, vel, ...info }),
    onNoteOff: (midi, t) => offs.push({ midi, t }),
    onOnset: (t) => onsets.push(t),
  });
  tr.startCalibration();
  let cal = false;
  for (let i = 0; i + chunk <= audio.length; i += chunk) {
    if (!cal && i / sr > 0.4) {
      tr.finishCalibration();
      cal = true;
    }
    if (expected) tr.setExpected(expected, range);
    tr.push(audio.subarray(i, i + chunk), i);
  }
  return { ev, offs, onsets, tr };
}

test('interface: everything the listener calls exists', () => {
  const tr = new Transcriber(48000, {});
  for (const f of ['push', 'setExpected', 'setRange', 'setStrictness', 'setNoisyRoom', 'setTuning', 'startCalibration', 'finishCalibration', 'reset']) assert.equal(typeof tr[f], 'function', f);
  tr.setExpected([60, 64], [55, 70]);
  tr.setRange(48, 72);
  tr.setRange(null);
  tr.setStrictness(0.7);
  tr.setNoisyRoom(true);
  assert.ok(tr.strictness >= 0.85);
  tr.setNoisyRoom(false);
  tr.setTuning(442);
  assert.ok(Math.abs(tr.tuningCents - 1200 * Math.log2(442 / 440)) < 1e-9);
  tr.startCalibration();
  const quiet = new Float32Array(48000 * 0.5).map(() => (Math.random() - 0.5) * 1e-3);
  for (let i = 0; i < quiet.length; i += 512) tr.push(quiet.subarray(i, i + 512), i); // as the mic delivers it
  assert.equal(tr.finishCalibration(), true);
  assert.equal(typeof tr.noiseLevel, 'number');
  assert.ok(tr.pianoLevel === null || typeof tr.pianoLevel === 'number');
  assert.equal(typeof tr.stats.emitted, 'number');
  tr.reset();
  tr.pos = -1; // the listener's realign
  tr.push(new Float32Array(512), 123456);
  assert.equal(tr.pos, 123456 + 512);
  tr.push(new Float32Array(512), 123456 + 512);
  assert.equal(tr.pos, 123456 + 1024);
});

test('hears single notes and chords, back-dated to the attack, within ~40 ms', { skip }, () => {
  const sr = 48000;
  const notes = [
    { midi: 60, t: 0.8, dur: 0.5, vel: 0.6 },
    { midi: 64, t: 1.6, dur: 0.5, vel: 0.6 },
    { midi: 67, t: 1.6, dur: 0.5, vel: 0.6 },
    { midi: 72, t: 1.6, dur: 0.5, vel: 0.6 },
    { midi: 43, t: 2.4, dur: 0.6, vel: 0.7 },
    { midi: 55, t: 2.4, dur: 0.6, vel: 0.6 },
    { midi: 76, t: 3.2, dur: 0.4, vel: 0.5 },
  ];
  const audio = renderPiano(notes, { sr, length: 4.2, seed: 3 });
  const { ev, tr } = run(audio, sr);
  assert.equal(tr.engine, 'nn');
  const lat = [];
  for (const n of notes) {
    const e = ev.find((x) => x.midi === n.midi && Math.abs(x.t - n.t) < 0.08);
    assert.ok(e, `missed ${n.midi} at ${n.t}: heard ${ev.map((x) => `${x.midi}@${x.t.toFixed(2)}`).join(' ')}`);
    assert.ok(Math.abs(e.t - n.t) < 0.03, `${n.midi}: time ${e.t.toFixed(3)} vs ${n.t}`);
    assert.ok(e.confidence > 0 && e.confidence <= 1);
    lat.push(e.at - n.t);
  }
  lat.sort((a, b) => a - b);
  assert.ok(lat[lat.length >> 1] < 0.06, `median report latency ${lat[lat.length >> 1]}`);
  const extra = ev.filter((e) => !notes.some((n) => n.midi === e.midi && Math.abs(e.t - n.t) < 0.08) && e.confidence >= 0.55);
  assert.ok(extra.length <= 1, `confident extras: ${extra.map((x) => `${x.midi}@${x.t.toFixed(2)}`).join(' ')}`);
});

test('silence and room noise: no notes', { skip }, () => {
  const sr = 48000;
  const x = new Float32Array(sr * 3);
  let s = 7;
  for (let i = 0; i < x.length; i++) {
    s = (s * 16807) % 2147483647;
    x[i] = ((s / 2147483647) * 2 - 1) * 0.002;
  }
  const { ev } = run(x, sr);
  assert.equal(ev.length, 0);
});

test('falls back to the DSP transcriber until weights are available', () => {
  const saved = getWeights();
  setWeights(null);
  try {
    const tr = new Transcriber(48000, {});
    assert.equal(tr.engine, 'dsp');
    tr.setExpected([60]);
    tr.startCalibration();
    tr.push(new Float32Array(4800), 0);
    tr.finishCalibration();
    assert.equal(typeof tr.noiseLevel, 'number');
  } finally {
    if (saved) setWeights(saved);
  }
});
