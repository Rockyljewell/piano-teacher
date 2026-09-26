// The hybrid listener (js/audio/nn/hybrid-transcriber.js): the DSP transcriber with the learned
// transcriber filling its gaps. Same interface as the DSP transcriber; hears single notes, chords
// and the G2 + G3 octave. Detection tests are skipped when assets/models/piano-nn.bin is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transcriber } from '../js/audio/nn/hybrid-transcriber.js';
import { weightsLoaded } from '../js/audio/nn/nn-transcriber.js';
import { renderPiano } from './synth-piano.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = !(fs.existsSync(path.join(here, '../assets/models/piano-nn.bin')) && weightsLoaded()) && 'no weights (assets/models/piano-nn.bin)';

function run(audio, sr, { lesson = null } = {}) {
  const ev = [];
  let tr;
  tr = new Transcriber(sr, { onNoteOn: (midi, t, vel, info) => ev.push({ midi, t, at: tr.pos / sr, ...info }) });
  tr.startCalibration();
  for (let i = 0; i + 256 <= audio.length; i += 256) {
    if (tr.dsp.calibrating && i / sr > 0.4) tr.finishCalibration();
    if (lesson) {
      const t = i / sr;
      tr.setExpected([...new Set(lesson.filter((n) => n.t > t - 0.25 && n.t < t + 0.35).map((n) => n.midi))], [40, 80]);
    }
    tr.push(audio.subarray(i, i + 256), i);
  }
  return { ev, tr };
}

const NOTES = [
  { midi: 60, t: 0.8, dur: 0.5, vel: 0.6 },
  { midi: 64, t: 1.6, dur: 0.5, vel: 0.6 },
  { midi: 67, t: 1.6, dur: 0.5, vel: 0.6 },
  { midi: 72, t: 1.6, dur: 0.5, vel: 0.6 },
  { midi: 43, t: 2.4, dur: 0.6, vel: 0.7 },
  { midi: 55, t: 2.4, dur: 0.6, vel: 0.6 },
  { midi: 76, t: 3.2, dur: 0.4, vel: 0.5 },
];

test('interface: the listener can drive it like the DSP transcriber', () => {
  const tr = new Transcriber(48000, {});
  for (const f of ['push', 'setExpected', 'setRange', 'setStrictness', 'setNoisyRoom', 'setTuning', 'startCalibration', 'finishCalibration', 'reset']) assert.equal(typeof tr[f], 'function', f);
  tr.setStrictness(0.6);
  tr.setNoisyRoom(true);
  tr.setNoisyRoom(false);
  tr.setTuning(441);
  tr.sensitivity = 1.2;
  tr.startCalibration();
  const quiet = new Float32Array(48000 * 0.5).map(() => (Math.random() - 0.5) * 1e-3);
  for (let i = 0; i < quiet.length; i += 256) tr.push(quiet.subarray(i, i + 256), i);
  assert.equal(tr.finishCalibration(), true);
  assert.equal(typeof tr.noiseLevel, 'number');
  assert.equal(typeof tr.stats.emitted, 'number');
  tr.reset();
  tr.pos = -1;
  tr.push(new Float32Array(256), 5000);
  assert.equal(tr.pos, 5256);
});

for (const mode of ['free', 'lesson'])
  test(`hears single notes, chords and the G2 + G3 octave (${mode})`, { skip }, () => {
    const sr = 48000;
    const audio = renderPiano(NOTES, { sr, length: 4.2, seed: 3 });
    const { ev, tr } = run(audio, sr, { lesson: mode === 'lesson' ? NOTES : null });
    assert.equal(tr.engine, 'hybrid');
    for (const n of NOTES) {
      const e = ev.find((x) => x.midi === n.midi && Math.abs(x.t - n.t) < 0.08);
      assert.ok(e, `missed ${n.midi} at ${n.t}: heard ${ev.map((x) => `${x.midi}@${x.t.toFixed(2)}`).join(' ')}`);
    }
    const extra = ev.filter((e) => !NOTES.some((n) => n.midi === e.midi && Math.abs(e.t - n.t) < 0.08) && (e.confidence ?? 1) >= 0.55);
    assert.ok(extra.length <= 1, `confident extras: ${extra.map((x) => `${x.midi}@${x.t.toFixed(2)}`).join(' ')}`);
  });
