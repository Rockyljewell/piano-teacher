// Every note the hybrid listener reports on is released again (the stuck-keys bug: notes only
// the learned network heard were never released, so they stayed lit on the keyboard). Skipped
// when assets/models/piano-nn.bin is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weightsLoaded } from '../js/audio/nn/nn-transcriber.js';
import { renderPiano } from './synth-piano.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = !(fs.existsSync(path.join(here, '../assets/models/piano-nn.bin')) && weightsLoaded()) && 'no weights (assets/models/piano-nn.bin)';
const { Transcriber } = await import(process.env.HYBRID_MODULE ? path.resolve(process.env.HYBRID_MODULE) : '../js/audio/nn/hybrid-transcriber.js');

// singles, chords, octaves, a fast scale and repeated notes, then 2.5 s of silence
const NOTES = [];
let t = 0.8;
for (const m of [60, 62, 64, 65, 67]) NOTES.push({ midi: m, t: (t += 0.35), dur: 0.3, vel: 0.6 });
for (const ch of [[48, 60, 64, 67], [43, 55, 71], [41, 53, 57, 60, 65]]) {
  t += 0.7;
  for (const m of ch) NOTES.push({ midi: m, t, dur: 0.6, vel: 0.6 });
}
for (let i = 0; i < 12; i++) NOTES.push({ midi: [72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 72, 74][i], t: (t += i ? 0.11 : 0.8), dur: 0.1, vel: 0.55 });
for (let i = 0; i < 6; i++) NOTES.push({ midi: 67, t: (t += i ? 0.2 : 0.6), dur: 0.15, vel: 0.6 });
const LEN = t + 3;

function run(lesson) {
  const sr = 48000;
  const audio = renderPiano(NOTES, { sr, length: LEN, seed: 5 });
  const held = new Set();
  let ons = 0;
  let badOffs = 0;
  let tr;
  tr = new Transcriber(sr, {
    onNoteOn: (midi) => {
      held.add(midi);
      ons++;
    },
    onNoteOff: (midi) => {
      if (!held.delete(midi)) badOffs++;
    },
  });
  tr.startCalibration();
  for (let i = 0; i + 256 <= audio.length; i += 256) {
    if (tr.dsp.calibrating && i / sr > 0.4) tr.finishCalibration();
    if (lesson) {
      const tt = i / sr;
      tr.setExpected([...new Set(NOTES.filter((n) => n.t > tt - 0.25 && n.t < tt + 0.35).map((n) => n.midi))], [36, 84]);
    }
    tr.push(audio.subarray(i, i + 256), i);
  }
  return { held, ons, badOffs, tr };
}

for (const lesson of [false, true]) {
  test(`every reported note is released after the piano stops (${lesson ? 'lesson' : 'free'})`, { skip }, () => {
    const { held, ons, badOffs } = run(lesson);
    assert.ok(ons >= 20, `only ${ons} notes heard`);
    assert.deepEqual([...held], [], `still lit ${[...held].join(' ')} after ${ons} notes`);
    assert.equal(badOffs, 0, 'note-off without a note-on');
  });
}

test('reset releases every note still lit (a new microphone, a realign)', { skip }, () => {
  const sr = 48000;
  const audio = renderPiano([{ midi: 48, t: 0.8, dur: 3, vel: 0.7 }, { midi: 64, t: 0.8, dur: 3, vel: 0.6 }], { sr, length: 1.6, seed: 2 });
  const held = new Set();
  const tr = new Transcriber(sr, { onNoteOn: (m) => held.add(m), onNoteOff: (m) => held.delete(m) });
  tr.startCalibration();
  for (let i = 0; i + 256 <= audio.length; i += 256) {
    if (tr.dsp.calibrating && i / sr > 0.4) tr.finishCalibration();
    tr.push(audio.subarray(i, i + 256), i);
  }
  assert.ok(held.size > 0, 'the chord is heard');
  tr.reset();
  assert.deepEqual([...held], []);
});
