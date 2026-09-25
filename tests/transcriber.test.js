// Regression test for the listening engine on synthesized piano audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPiano, rng } from './synth-piano.js';
import { transcribe, score } from './eval-transcriber.js';

const sr = 48000;

test('single notes across the keyboard', () => {
  const notes = [];
  const r = rng(5);
  for (let m = 21; m <= 108; m += 3) notes.push({ midi: m, t: 0.6 + notes.length * 0.7, dur: 0.5, vel: 0.4 + r() * 0.5 });
  const s = score(notes, transcribe(renderPiano(notes, { sr }), sr));
  assert.ok(s.recall >= 0.95, `recall ${s.recall}`);
  assert.ok(s.precision >= 0.85, `precision ${s.precision}`);
  assert.ok(s.absErr < 0.02, `onset error ${s.absErr}`);
});

test('chords (every note of a triad)', () => {
  const notes = [];
  const r = rng(9);
  let t = 0.6;
  for (let i = 0; i < 16; i++) {
    const root = 48 + Math.floor(r() * 24);
    for (const iv of r() < 0.5 ? [0, 4, 7] : [0, 3, 7]) notes.push({ midi: root + iv, t, dur: 0.6, vel: 0.6 });
    t += 0.8;
  }
  const s = score(notes, transcribe(renderPiano(notes, { sr }), sr));
  assert.ok(s.recall >= 0.9, `recall ${s.recall}`);
  assert.ok(s.precision >= 0.8, `precision ${s.precision}`);
});

test('repeated notes are each detected', () => {
  const seq = [60, 60, 60, 62, 64, 64, 62, 60, 67, 67, 65, 65];
  const notes = seq.map((m, i) => ({ midi: m, t: 0.6 + i * 0.25, dur: 0.22, vel: 0.6 }));
  const s = score(notes, transcribe(renderPiano(notes, { sr }), sr));
  assert.ok(s.recall >= 0.9, `recall ${s.recall}`);
  assert.ok(s.precision >= 0.9, `precision ${s.precision}`);
});

test('works at 44.1 kHz and on a flat piano', () => {
  const notes = [60, 64, 67, 72, 71, 69, 65, 62].map((m, i) => ({ midi: m, t: 0.6 + i * 0.4, dur: 0.35, vel: 0.6 }));
  for (const opts of [{ sr: 44100 }, { sr, tuningCents: -25 }]) {
    const s = score(notes, transcribe(renderPiano(notes, { ...opts, sr: opts.sr }), opts.sr));
    assert.ok(s.recall >= 0.85, `recall ${s.recall} ${JSON.stringify(opts)}`);
  }
});
