import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, timingProfile, timingLabel, musicalOffset } from '../js/game/engine.js';
import { generate } from '../js/music/generator.js';

function run(piece, play, opts = {}) {
  let now = 0;
  const events = [];
  const s = new Session(piece, { clock: () => now, onEvent: (e) => events.push(e), ...opts });
  s.start();
  const spb = 60 / piece.bpm;
  const t0 = s.countIn * spb;
  const plays = play(piece, t0, spb).sort((a, b) => a.t - b.t);
  let i = 0;
  for (now = 0; !s.finished && now < t0 + piece.totalBeats * spb + 3; now += 0.01) {
    while (i < plays.length && plays[i].t <= now) {
      const p = plays[i++];
      s.noteOn(p.midi, p.t, p.opts || {});
    }
    s.update();
  }
  return { s, r: s.result(), events };
}

const exact = (errMs = 0) => (piece, t0, spb) => piece.notes.map((n) => ({ midi: n.midi, t: t0 + n.beat * spb + errMs / 1000 }));

test('perfect playing scores 100 with timing on the beat', () => {
  const piece = generate(10, { seed: 3 });
  const { r } = run(piece, exact(0));
  assert.equal(r.score, 100);
  assert.equal(r.hits, r.total);
  assert.equal(r.early + r.late, 0);
});

test('consistently late playing is reported in milliseconds and musically', () => {
  const piece = generate(20, { seed: 4 });
  const { r, events } = run(piece, exact(120));
  const hits = events.filter((e) => e.type === 'hit');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.timing === 'late' && h.errMs >= 115 && h.errMs <= 125), 'per-note late ms');
  assert.ok(Math.abs(r.medianErrMs - 120) <= 5);
  assert.match(r.timingSummary, /120 ms late/);
  assert.ok(r.late === r.hits);
  assert.equal(r.suggestedLatencyMs, 120);
  assert.equal(r.histogram.bins.reduce((a, b) => a + b, 0), r.hits);
});

test('beginner windows are generous: 300 ms late still counts at level 1 but not at level 30', () => {
  const beg = generate(1, { seed: 5 });
  assert.equal(run(beg, exact(300)).r.hits, beg.notes.length);
  const adv = generate(30, { seed: 5, bpm: 60 });
  const r = run(adv, exact(300)).r;
  assert.ok(r.hits / r.total < 0.25, `advanced hits ${r.hits}/${r.total}`); // only repeated pitches can still match
  assert.ok(timingProfile(1).ok > timingProfile(30).ok);
});

test('early notes are labelled early', () => {
  assert.equal(timingLabel('good', -150), 'Early · 150 ms');
  assert.equal(timingLabel('great', 70), 'Great · 70 ms late');
  assert.equal(timingLabel('perfect', 10), 'Perfect');
  assert.equal(musicalOffset(125, 120), 'about a sixteenth note');
});

test('low-confidence and ghost notes are not counted as wrong', () => {
  const piece = generate(10, { seed: 6 });
  const play = (p, t0, spb) => {
    const out = exact(0)(p, t0, spb);
    for (const n of p.notes) {
      out.push({ midi: n.midi + 12, t: t0 + n.beat * spb + 0.05 }); // octave partial ghost
      out.push({ midi: 40, t: t0 + n.beat * spb + 0.2, opts: { confidence: 0.3 } }); // unsure room noise
      out.push({ midi: 105, t: t0 + n.beat * spb + 0.25, opts: { confidence: 0.9 } }); // far out of range
    }
    return out;
  };
  const { r } = run(piece, play);
  assert.equal(r.extras, 0);
  assert.equal(r.score, 100);
  assert.ok(r.ignored > 0);
});

test('confident wrong notes are penalised, less so for beginners', () => {
  const wrongs = (p, t0, spb) => [...exact(0)(p, t0, spb), ...p.notes.slice(0, 3).map((n, i) => ({ midi: n.midi + 1 + (i % 2), t: t0 + (n.beat + 0.5) * spb, opts: { confidence: 0.95 } }))];
  const beg = run(generate(2, { seed: 7 }), wrongs).r;
  const adv = run(generate(25, { seed: 7 }), wrongs).r;
  assert.ok(beg.extras >= 2 && adv.extras >= 2);
  assert.ok(beg.score < 100 && adv.score < 100);
});

test('per-hand stats cover both hands', () => {
  const piece = generate(14, { seed: 8 });
  const { r } = run(piece, (p, t0, spb) => exact(0)(p, t0, spb).filter((x, i) => p.notes[i].hand === 'R'));
  assert.equal(r.perHand.R.acc, 1);
  assert.equal(r.perHand.L.acc, 0);
});

test('wait mode waits for the right notes', () => {
  const piece = generate(3, { seed: 9 });
  let now = 0;
  const s = new Session(piece, { mode: 'wait', clock: () => now });
  s.start();
  for (; now < 30; now += 0.02) s.update();
  assert.ok(!s.finished && s.beat <= piece.notes[0].beat + 1e-9);
  for (const g of s.groups) {
    for (let k = 0; k < 1000 && s.beat < g.beat - 1e-9; k++) {
      now += 0.02;
      s.update();
    }
    for (const n of g.notes) s.noteOn(n.midi, now);
    now += 0.02;
    s.update();
  }
  for (let k = 0; k < 400 && !s.finished; k++) {
    now += 0.02;
    s.update();
  }
  assert.ok(s.finished);
  assert.equal(s.result().score, 100);
});

// ---- grading by level, wait mode, chords, "what to fix" -------------------------------------
import { scoringFor, eventWeight } from '../js/game/engine.js';
import { Key } from '../js/music/theory.js';
import { finish } from '../js/music/generator.js';

// Wait mode: for each group, some wrong presses and/or a pause (beats) before the right notes.
function runWait(piece, plan = () => ({}), opts = {}) {
  let now = 0;
  const events = [];
  const s = new Session(piece, { mode: 'wait', clock: () => now, onEvent: (e) => events.push(e), ...opts });
  s.start();
  const spb = 60 / piece.bpm;
  const step = (dt) => {
    now += dt;
    s.update();
  };
  s.groups.forEach((g, gi) => {
    for (let k = 0; k < 3000 && s.beat < g.beat - 1e-9; k++) step(0.02);
    const pl = plan(gi, g) || {};
    for (let w = 0; w < (pl.wrong || 0); w++) {
      step(0.4);
      s.noteOn(g.notes[0].midi + (w % 2 ? -1 : 1), now, { confidence: 0.95 });
    }
    for (let k = 0; k < ((pl.delayBeats || 0) * spb) / 0.02; k++) step(0.02);
    for (const n of g.notes) s.noteOn(n.midi, now);
    step(0.02);
  });
  for (let k = 0; k < 600 && !s.finished; k++) step(0.02);
  return { s, r: s.result(), events };
}

test('scoring weights: timing matters more as the level rises, extra notes cost less for beginners', () => {
  assert.ok(scoringFor(1).timingWeight < scoringFor(12).timingWeight);
  assert.ok(scoringFor(12).timingWeight < scoringFor(30).timingWeight);
  assert.ok(scoringFor(2).extraScale < scoringFor(20).extraScale);
  assert.equal(eventWeight(1), 1);
  assert.equal(eventWeight(3), 1.5);
});

test('beginners are graded mostly on right notes: loose timing costs less at level 2 than level 20', () => {
  // All notes 250 ms late: "good" for a beginner, "ok" at level 20.
  const beg = run(generate(2, { seed: 11, bpm: 60 }), exact(250)).r;
  const mid = run(generate(20, { seed: 11, bpm: 60 }), exact(250)).r;
  assert.equal(beg.hits, beg.total);
  assert.ok(beg.score >= 93, `beginner ${beg.score}`);
  assert.ok(mid.score < beg.score - 10, `level 20 ${mid.score} vs beginner ${beg.score}`);
});

test('wait mode grades wrong keys and (gently) long pauses, per note', () => {
  const piece = generate(3, { seed: 9 });
  const clean = runWait(piece).r;
  assert.equal(clean.score, 100);
  assert.equal(clean.waitStats.wrongTries, 0);
  const oneWrong = runWait(piece, (gi) => (gi % 3 === 1 ? { wrong: 1 } : {}));
  assert.ok(oneWrong.r.score < 100 && oneWrong.r.score >= 88, `one wrong try every third note: ${oneWrong.r.score}`);
  assert.ok(oneWrong.r.waitStats.wrongTries >= 3);
  const wrongEv = oneWrong.events.find((e) => e.type === 'wrong');
  assert.ok(wrongEv && wrongEv.wait && wrongEv.expected.length >= 1, 'wrong event says what was expected');
  const found = oneWrong.events.find((e) => e.type === 'hit' && e.grade === 'good');
  assert.ok(found && found.label === 'Found it!', 'a note found after a wrong try is graded good');
  const twoWrong = runWait(piece, (gi) => (gi % 2 === 1 ? { wrong: 2 } : {})).r;
  assert.ok(twoWrong.score < oneWrong.r.score, `${twoWrong.score} < ${oneWrong.r.score}`);
  const slow = runWait(piece, (gi) => (gi % 3 === 1 ? { delayBeats: 6 } : {})).r;
  assert.ok(slow.score < 100 && slow.score >= 93, `pauses cost a little: ${slow.score}`);
  assert.ok(slow.waitStats.slowGroups >= 2);
  // Stricter later on.
  const adv = runWait(generate(20, { seed: 9 }), (gi) => (gi % 3 === 1 ? { wrong: 1 } : {})).r;
  assert.ok(adv.score < oneWrong.r.score, `level 20 ${adv.score} vs level 3 ${oneWrong.r.score}`);
});

test('wait mode: mashing several keys at once counts as one try; the right note played early is not wrong', () => {
  const key = new Key(0);
  const events = [
    { id: 9100, staff: 'treble', hand: 'R', beat: 0, dur: 1, midis: [60], rest: false },
    { id: 9101, staff: 'treble', hand: 'R', beat: 1, dur: 3, midis: [], rest: true },
    { id: 9102, staff: 'treble', hand: 'R', beat: 4, dur: 4, midis: [64], rest: false },
  ];
  const piece = finish({ seed: 1, level: 3, kind: 'sight', title: 't', key, ts: { num: 4, den: 4, beats: 4 }, tsName: '4/4', bpm: 60, measures: 2, beatsPer: 4, staves: ['treble'], events, harmony: [] });
  let now = 0;
  const s = new Session(piece, { mode: 'wait', clock: () => now });
  s.start();
  while (s.beat < 0 && now < 10) {
    now += 0.02;
    s.update();
  }
  s.noteOn(60, now);
  now += 0.1;
  s.update();
  // E4 is next but the playhead is still 4 beats away: ignored, neither wrong nor a hit.
  s.noteOn(64, now);
  assert.equal(s.extras, 0);
  assert.equal(s.status.size, 1);
  // Two wrong keys pressed together while waiting: one try.
  s.noteOn(65, now + 0.02, { confidence: 0.95 });
  s.noteOn(67, now + 0.05, { confidence: 0.95 });
  assert.equal(s.waitLog.get(1).wrong, 1);
  assert.equal(s.extras, 2);
});

test('chords get partial credit, and a skipped hand still counts for a third', () => {
  const piece = generate(14, { seed: 2 });
  const top = new Set(piece.events.filter((e) => e.hand === 'L' && e.midis.length === 3).map((e) => `${e.id}:${Math.max(...e.midis)}`));
  assert.ok(top.size >= 4);
  const partial = run(piece, (p, t0, spb) => exact(0)(p, t0, spb).filter((x, i) => !top.has(p.notes[i].id))).r;
  const noLeft = run(piece, (p, t0, spb) => exact(0)(p, t0, spb).filter((x, i) => p.notes[i].hand !== 'L')).r;
  assert.ok(partial.score >= 85 && partial.score < 95, `two of three chord notes: ${partial.score}`);
  assert.ok(noLeft.score <= 70, `no left hand at all: ${noLeft.score}`);
  assert.equal(noLeft.weakHand, 'L');
});

test('results say what to fix: worst bar, missed notes, weaker hand, rushing', () => {
  const piece = generate(12, { seed: 5, bpm: 70 });
  // Miss every right-hand note in bar 3; everything else 90 ms early.
  const { r } = run(piece, (p, t0, spb) =>
    p.notes.filter((n) => !(n.hand === 'R' && Math.floor(n.beat / p.beatsPer) === 2)).map((n) => ({ midi: n.midi, t: t0 + n.beat * spb - 0.09 })),
  );
  assert.equal(r.worstBars[0].bar, 3);
  assert.ok(r.bars.find((b) => b.bar === 3).missed >= 2);
  assert.equal(r.tendency, 'rush');
  assert.ok(r.missedByMidi.length > 0);
});

test('key-signature slips are recognised (F played for F sharp)', () => {
  const key = new Key(1);
  const events = [60, 62, 64, 66, 67, 66, 64, 62].map((m, i) => ({ id: 9000 + i, staff: 'treble', hand: 'R', beat: i, dur: 1, midis: [m], rest: false }));
  const piece = finish({ seed: 1, level: 8, kind: 'sight', title: 't', key, ts: { num: 4, den: 4, beats: 4 }, tsName: '4/4', bpm: 60, measures: 2, beatsPer: 4, staves: ['treble'], events, harmony: [] });
  const { r } = run(piece, (p, t0, spb) => p.notes.map((n) => ({ midi: n.midi === 66 ? 65 : n.midi, t: t0 + n.beat * spb, opts: { confidence: 0.95 } })));
  assert.equal(r.sigSlips[0].letter, 'F');
  assert.equal(r.sigSlips[0].name, 'F♯');
  assert.equal(r.sigSlips[0].count, 2);
});
