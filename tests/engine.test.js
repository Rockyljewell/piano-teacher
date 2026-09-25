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
