// A chord whose top note is struck much softer than the others (a weak finger: 8-14 dB down) is
// heard whole. The classic engine cancels every note it finds together with the partials it
// shares with the others, which took most of a quiet fifth or third away before it was judged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPiano, rng } from './synth-piano.js';
import { Transcriber } from '../js/audio/transcriber.js';

const SR = 48000;

function listen(audio, tuning = {}) {
  const ons = [];
  const tr = new Transcriber(SR, { ...tuning, onNoteOn: (m, t, v, info) => ons.push({ m, t, info }), onNoteOff() {} });
  tr.startCalibration();
  let calibrated = false;
  for (let i = 0; i + 256 <= audio.length; i += 256) {
    if (!calibrated && i / SR > 0.4) {
      tr.finishCalibration();
      calibrated = true;
    }
    tr.push(audio.subarray(i, i + 256), i);
  }
  return ons;
}

// Chords struck 2.4 s apart, held 0.8 s; the top note at `top` x the others' velocity.
function chords(shapes, top, seed) {
  const r = rng(seed);
  const notes = [];
  let t = 1.2;
  shapes.forEach((shape, g) => {
    const root = 55 + Math.floor(r() * 10); // G3 .. E4
    shape.forEach((x, i) => notes.push({ midi: root + x, t: t + r() * 0.012, dur: 0.8, vel: (0.62 + r() * 0.1) * (i === shape.length - 1 ? top : 1), g, top: i === shape.length - 1 }));
    t += 2.4;
  });
  return { notes, length: t + 1 };
}

function report(notes, ons) {
  const heard = (n) => ons.some((e) => e.m === n.midi && Math.abs(e.t - n.t) <= 0.08);
  const tops = notes.filter((n) => n.top);
  const groups = new Map();
  for (const n of notes) (groups.get(n.g) || groups.set(n.g, []).get(n.g)).push(n);
  return {
    top: tops.filter(heard).length / tops.length,
    rest: notes.filter((n) => !n.top && heard(n)).length / notes.filter((n) => !n.top).length,
    whole: [...groups.values()].filter((g) => g.every(heard)).length / groups.size,
    extras: ons.filter((e) => !notes.some((n) => n.midi === e.m && Math.abs(e.t - n.t) <= 0.08)).length,
  };
}

test('the soft top note of a triad is heard (8-12 dB below the others)', () => {
  const shapes = [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7]];
  const { notes, length } = chords(shapes, 0.36, 5);
  const rep = report(notes, listen(renderPiano(notes, { sr: SR, length })));
  assert.ok(rep.rest >= 0.95, `the louder notes ${rep.rest}`);
  assert.ok(rep.top >= 0.75, `soft top notes heard ${rep.top}`);
  assert.ok(rep.extras <= 2, `${rep.extras} notes that were not played`);
});

test('a lesson names its notes: nothing is added to what is asked for', () => {
  // the second chance is for free play, where nothing says what should be played
  const { notes, length } = chords([[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]], 0.36, 8);
  const audio = renderPiano(notes, { sr: SR, length });
  const ons = [];
  const tr = new Transcriber(SR, { onNoteOn: (m, t, v, info) => ons.push({ m, t, info }), onNoteOff() {} });
  tr.startCalibration();
  let calibrated = false;
  for (let i = 0; i + 256 <= audio.length; i += 256) {
    const t = i / SR;
    if (!calibrated && t > 0.4) {
      tr.finishCalibration();
      calibrated = true;
    }
    tr.setExpected(notes.filter((n) => n.t > t - 0.25 && n.t < t + 0.35).map((n) => n.midi), [48, 84]);
    tr.push(audio.subarray(i, i + 256), i);
  }
  assert.equal(ons.filter((e) => e.info.rescued).length, 0, 'no note taken back in a lesson');
});
