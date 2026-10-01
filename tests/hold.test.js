// Held notes: a struck chord stays "on" while its keys are down (the free-play display lights a
// key from note-on to note-off) and ends soon after they come up. The classic engine used to
// release the upper note of a held chord about a second after the attack, because cancelling the
// root's overtones took the fifth's shared partials away from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPiano, rng } from './synth-piano.js';
import { Transcriber } from '../js/audio/transcriber.js';

const SR = 48000;

// Run the classic engine over `audio`: every note-on and note-off it reports (audio-clock seconds).
function listen(audio) {
  const ons = [];
  const offs = [];
  const tr = new Transcriber(SR, { onNoteOn: (m, t) => ons.push({ m, t }), onNoteOff: (m, t) => offs.push({ m, t }) });
  tr.startCalibration();
  let calibrated = false;
  for (let i = 0; i + 256 <= audio.length; i += 256) {
    if (!calibrated && i / SR > 0.4) {
      tr.finishCalibration();
      calibrated = true;
    }
    tr.push(audio.subarray(i, i + 256), i);
  }
  return { ons, offs };
}

// Chords struck 6 s apart and held for `hold` seconds.
function chordNotes(shapes, hold, seed) {
  const r = rng(seed);
  const notes = [];
  let t = 1.2;
  shapes.forEach((shape, g) => {
    const root = 40 + Math.floor(r() * 24);
    for (const x of shape) notes.push({ midi: root + x, t: t + r() * 0.015, dur: hold, vel: 0.55 + r() * 0.2, g });
    t += hold + 3;
  });
  return { notes, length: t + 1 };
}

// For every note the listener heard at its attack: was it released before the key came up?
function holdReport(notes, { ons, offs }) {
  const r = { heard: 0, early: 0, stuck: 0, late: 0, chords: 0, whole: 0 };
  const groups = new Map();
  for (const n of notes) (groups.get(n.g) || groups.set(n.g, []).get(n.g)).push(n);
  for (const grp of groups.values()) {
    let all = true;
    for (const n of grp) {
      const on = ons.find((e) => e.m === n.midi && Math.abs(e.t - n.t) <= 0.08);
      if (!on) {
        all = false;
        continue;
      }
      r.heard++;
      const keyUp = n.t + n.dur;
      const off = offs.find((e) => e.m === n.midi && e.t >= on.t);
      const offT = off ? off.t : Infinity;
      if (offT < keyUp - 0.25) {
        r.early++;
        all = false;
      } else if (offT > keyUp + 3) r.stuck++;
      else if (offT > keyUp + 1) r.late++;
    }
    if (all && grp.every((n) => ons.some((e) => e.m === n.midi && Math.abs(e.t - n.t) <= 0.08))) r.whole++;
    r.chords++;
  }
  return r;
}

test('the notes of a held triad stay on until the keys come up', () => {
  const shapes = [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7]];
  const { notes, length } = chordNotes(shapes, 3, 21);
  const rep = holdReport(notes, listen(renderPiano(notes, { sr: SR, length })));
  assert.ok(rep.heard >= 24, `heard ${rep.heard}/${notes.length} at the attack`);
  assert.ok(rep.early / rep.heard <= 0.1, `${rep.early} of ${rep.heard} heard notes were released while the key was still down`);
  assert.equal(rep.stuck, 0, 'no note stays on long after its key came up');
  assert.ok(rep.late / rep.heard <= 0.1, `${rep.late} notes were released more than a second late`);
});

test('four-note chords too, and a fifth or third above the root is not the one to go', () => {
  const shapes = [[0, 4, 7, 12], [0, 4, 7, 10], [0, 3, 7, 10], [0, 4, 7, 11], [0, 5, 7, 12], [0, 3, 7, 12]];
  const { notes, length } = chordNotes(shapes, 3, 33);
  const rep = holdReport(notes, listen(renderPiano(notes, { sr: SR, length })));
  assert.ok(rep.heard >= 14, `heard ${rep.heard}/${notes.length}`);
  assert.ok(rep.early / rep.heard <= 0.15, `${rep.early} of ${rep.heard} heard notes were released early`);
  assert.equal(rep.stuck, 0);
});

test('a key that comes up is released soon after (nothing sticks), for a single note and inside a chord', () => {
  // the top note of a triad lets go after one second, the other two are held for three
  const r = rng(4);
  const notes = [];
  let t = 1.2;
  for (let g = 0; g < 6; g++) {
    const root = 41 + Math.floor(r() * 20);
    notes.push({ midi: root, t, dur: 3, vel: 0.6, g }, { midi: root + 4, t: t + 0.008, dur: 3, vel: 0.6, g }, { midi: root + 7, t: t + 0.004, dur: 1, vel: 0.6, g });
    t += 6;
  }
  const { ons, offs } = listen(renderPiano(notes, { sr: SR, length: t + 1 }));
  let checked = 0;
  for (const n of notes.filter((n) => n.dur === 1)) {
    const on = ons.find((e) => e.m === n.midi && Math.abs(e.t - n.t) <= 0.08);
    if (!on) continue;
    const off = offs.find((e) => e.m === n.midi && e.t >= on.t);
    assert.ok(off, `note ${n.midi} at ${n.t.toFixed(1)} s was never released`);
    assert.ok(off.t <= n.t + n.dur + 1.0, `note ${n.midi} released ${(off.t - n.t - n.dur).toFixed(2)} s after its key came up`);
    checked++;
  }
  assert.ok(checked >= 4, `${checked} released notes checked`);
});
