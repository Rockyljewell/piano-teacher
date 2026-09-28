// The bar loop ("repeat bars I miss"): a bar the student fails is stopped at its end and played
// again after a short count-in; after a few tries the app offers to slow it down or learn it in
// wait mode. Wait mode restarts a bar after several wrong tries at one spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, LOOP_RULES } from '../js/game/engine.js';
import { generate } from '../js/music/generator.js';

// A simulated student who plays in real time against the session's own clock, so jumps back to a
// bar line are followed exactly as the app would (it reads session.expectedNotes() every frame).
// `play(note, ctx)` returns the midi to play, or null to leave the note out. ctx.epoch counts the
// jumps back, ctx.attempt(bar) how many times that bar has started.
function sim(piece, { play = (n) => n.midi, mode = 'tempo', barLoop = true, choose = 'continue', errMs = 0, level } = {}) {
  let now = 0;
  const events = [];
  let pendingChoice = false;
  const s = new Session(piece, {
    mode, barLoop, level: level ?? piece.level, clock: () => now,
    onEvent: (e) => {
      events.push({ ...e, at: now, beatNow: s.beat });
      if (e.type === 'loop-offer') pendingChoice = true;
    },
  });
  s.start();
  const done = new Set();
  const attempts = new Map();
  const ctx = { get epoch() { return s.rewinds; }, attempt: (bar) => attempts.get(bar) || 0, s };
  let lastBar = 0;
  const queue = [];
  const expectedSeen = [];
  for (now = 0; !s.finished && now < 900; now += 0.01) {
    if (pendingChoice) {
      pendingChoice = false;
      s.chooseLoop(typeof choose === 'function' ? choose(s) : choose);
    }
    const bar = s.barOf(Math.max(0, s.beat));
    if (s.beat >= 0 && (bar !== lastBar || s.rewinds !== ctx._ep)) {
      if (s.beat - s.barStart(bar) < 0.5) attempts.set(bar, (attempts.get(bar) || 0) + 1);
      lastBar = bar;
      ctx._ep = s.rewinds;
    }
    const exp = s.expectedNotes(0.05);
    if (exp.length) expectedSeen.push({ beat: s.beat, notes: exp.map((n) => n.id) });
    for (const n of exp) {
      // (tempo: each note once per try; wait mode: one press every 0.4 s until it is found)
      const key = s.playMode === 'wait' ? `${n.id}@${Math.floor(now / 0.4)}` : `${n.id}@${s.rewinds}`;
      if (done.has(key)) continue;
      const due = (s.playMode === 'wait' && !queue.length) || (s.beat - n.beat) * s.spb >= errMs / 1000 - 0.005;
      if (!due) continue;
      done.add(key);
      const m = play(n, ctx);
      if (m != null) queue.push({ midi: m, t: now + (s.playMode === 'wait' ? 0.05 : 0) });
    }
    while (queue.length && queue[0].t <= now) {
      const q = queue.shift();
      s.noteOn(q.midi, q.t);
    }
    s.update();
  }
  return { s, r: s.result(), events, expectedSeen };
}

const piece4 = () => generate(10, { seed: 21, measures: 4, bpm: 80 });
const inBar = (s, n, bar) => s.barOf(n.beat) === bar;

test('bar loop off: a missed bar is not repeated (placement and listening tests stay as they were)', () => {
  const piece = piece4();
  const { r, events } = sim(piece, { barLoop: false, play: (n, c) => (inBar(c.s, n, 2) ? null : n.midi) });
  assert.equal(events.filter((e) => e.type === 'loop').length, 0);
  assert.deepEqual(r.loops, []);
  assert.equal(r.loopCount, 0);
  assert.ok(r.hits < r.total);
});

test('tempo: a failed bar stops at its end, rewinds with a one-bar count-in and counts once passed', () => {
  const piece = piece4();
  const bar2 = piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) === 1);
  assert.ok(bar2.length >= 2, 'bar 2 has notes');
  const { s, r, events } = sim(piece, { play: (n, c) => (inBar(c.s, n, 2) && c.attempt(2) <= 1 ? null : n.midi) });
  const loops = events.filter((e) => e.type === 'loop');
  assert.equal(loops.length, 1, 'one loop');
  assert.equal(loops[0].bar, 2);
  assert.equal(loops[0].attempt, 2);
  // The loop happens once bar 2 is over (and its notes decided), not in the middle of it.
  assert.ok(loops[0].beatNow < piece.beatsPer * 2 - piece.beatsPer + 0.01, 'rewound to the count-in before bar 2');
  // The count-in before the bar: beats counting down, then "go" on the bar line.
  const leadBeats = events.filter((e) => e.type === 'beat' && e.lead);
  assert.deepEqual(leadBeats.map((e) => e.lead), Array.from({ length: piece.beatsPer }, (_, i) => piece.beatsPer - i));
  assert.ok(events.some((e) => e.type === 'beat' && e.go && e.beat === piece.beatsPer));
  assert.ok(events.some((e) => e.type === 'bar-pass' && e.bar === 2 && e.tries === 2));
  // Everything was played correctly in the end: full marks, the loop is reported.
  assert.equal(r.hits, r.total);
  assert.equal(r.score, 100);
  assert.deepEqual(r.loops.map((l) => [l.bar, l.tries, l.passed]), [[2, 2, true]]);
  assert.equal(r.loopCount, 1);
  assert.ok(s.finished);
});

test('tempo: timing after a loop stays on the same clock (playhead, hints and grades agree)', () => {
  const piece = piece4();
  const { r, expectedSeen } = sim(piece, { errMs: 40, play: (n, c) => (inBar(c.s, n, 3) && c.attempt(3) <= 1 ? null : n.midi) });
  // Every note played after the loop was graded about 40 ms late (plus up to one 10 ms frame),
  // like the rest: the jump back did not shift the clock.
  assert.ok(r.errs.length === r.total);
  assert.ok(r.errs.every((e) => e.errMs >= 35 && e.errMs <= 56), r.errs.map((e) => e.errMs).join(' '));
  assert.equal(r.loops.length, 1);
  // The listener hints never ask for a note that is already decided or far from the playhead.
  for (const x of expectedSeen) {
    for (const id of x.notes) {
      const n = piece.notes.find((k) => k.id === id);
      assert.ok(n.beat >= x.beat - 0.31 && n.beat <= x.beat + 1.01, `hint ${n.beat} at playhead ${x.beat}`);
    }
  }
});

test('tempo: wrong keys in a try that is repeated do not count against the score', () => {
  const piece = piece4();
  const { r } = sim(piece, { play: (n, c) => (inBar(c.s, n, 2) && c.attempt(2) <= 1 ? n.midi + 1 : n.midi) });
  assert.equal(r.extras, 0);
  assert.ok(r.loopWrong > 0);
  assert.equal(r.score, 100);
  assert.deepEqual(r.loops.map((l) => l.bar), [2]);
});

test('tempo: a bar with one slip among its notes passes (no loop)', () => {
  const piece = generate(20, { seed: 5, measures: 4, bpm: 72 });
  const big = [1, 2, 3, 4].find((b) => piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) + 1 === b).length >= 6);
  assert.ok(big, 'a bar with six or more notes');
  let skipped = false;
  const { r, events } = sim(piece, {
    play: (n, c) => {
      if (!skipped && inBar(c.s, n, big)) {
        skipped = true;
        return null;
      }
      return n.midi;
    },
  });
  assert.equal(events.filter((e) => e.type === 'loop').length, 0);
  assert.equal(r.hits, r.total - 1);
});

test('tempo: two misses in a row fail a bar even when most notes are right', () => {
  const piece = generate(20, { seed: 5, measures: 4, bpm: 72 });
  const bar = [1, 2, 3, 4].find((b) => new Set(piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) + 1 === b).map((n) => n.beat)).size >= 6);
  const beats = [...new Set(piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) + 1 === bar).map((n) => n.beat))].sort((a, b) => a - b);
  const skip = new Set(beats.slice(1, 3));
  const { events } = sim(piece, { play: (n, c) => (inBar(c.s, n, bar) && c.attempt(bar) <= 1 && skip.has(n.beat) ? null : n.midi) });
  const l = events.find((e) => e.type === 'loop');
  assert.ok(l && l.bar === bar, 'looped');
  assert.equal(l.reason, 'run');
});

test('tempo: after three failed tries the app is offered "slower", which plays the bar at 75% and then returns to tempo', () => {
  const piece = piece4();
  const { s, r, events } = sim(piece, { choose: 'slower', play: (n, c) => (inBar(c.s, n, 2) && c.s.tempoScale === 1 && !(c.s.loops.get(2) || {}).passed ? null : n.midi) });
  const offer = events.find((e) => e.type === 'loop-offer');
  assert.ok(offer, 'offer made');
  assert.equal(offer.bar, 2);
  assert.equal(offer.tries, LOOP_RULES.offerAfter);
  assert.equal(events.filter((e) => e.type === 'loop' && !e.slowed).length, LOOP_RULES.offerAfter - 1);
  const tempos = events.filter((e) => e.type === 'tempo').map((e) => e.scale);
  assert.deepEqual(tempos, [LOOP_RULES.slowScale, 1], 'slowed, then back up to speed');
  assert.equal(s.tempoScale, 1);
  assert.ok(Math.abs(s.bpm - piece.bpm) < 1e-6);
  const l = r.loops.find((x) => x.bar === 2);
  assert.ok(l.passed && l.slowed);
  assert.equal(l.tries, LOOP_RULES.offerAfter + 1);
  assert.equal(r.hits, r.total, 'every note counted once played');
});

test('tempo: "learn it" plays the bar in wait mode, then carries on at tempo', () => {
  const piece = piece4();
  let modesInBar2 = new Set();
  const { r, events } = sim(piece, {
    choose: 'learn',
    play: (n, c) => {
      if (!inBar(c.s, n, 2)) return n.midi;
      modesInBar2.add(c.s.playMode);
      return c.s.playMode === 'wait' ? n.midi : null;
    },
  });
  assert.ok(modesInBar2.has('wait'), 'bar 2 was learned in wait mode');
  assert.ok(events.some((e) => e.type === 'bar-pass' && e.learned && e.bar === 2));
  assert.equal(r.mode, 'tempo');
  assert.equal(r.hits, r.total);
  // Learned notes count, but not as on the beat, and they stay out of the timing statistics.
  const bar2 = piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) === 1).length;
  assert.equal(r.errs.length, r.total - bar2);
  assert.ok(r.score < 100 && r.score >= 80, `score ${r.score}`);
  assert.ok(r.loops[0].learned && r.loops[0].passed);
});

test('tempo: "keep going" moves on; the bar keeps its misses and the results name it', () => {
  const piece = piece4();
  const { r, events } = sim(piece, { choose: 'continue', play: (n, c) => (inBar(c.s, n, 3) ? null : n.midi) });
  assert.ok(events.some((e) => e.type === 'bar-move-on' && e.bar === 3));
  const l = r.loops.find((x) => x.bar === 3);
  assert.ok(l.gaveUp && !l.passed);
  assert.equal(l.tries, LOOP_RULES.offerAfter);
  const bar3 = piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) === 2).length;
  assert.equal(r.hits, r.total - bar3);
});

test('tempo: a failed last bar is repeated before the piece finishes', () => {
  const piece = piece4();
  const { r, events } = sim(piece, { play: (n, c) => (inBar(c.s, n, 4) && c.attempt(4) <= 1 ? null : n.midi) });
  assert.ok(events.some((e) => e.type === 'loop' && e.bar === 4));
  assert.equal(r.hits, r.total);
  assert.equal(events.filter((e) => e.type === 'finish').length, 1);
});

test('wait mode: three wrong tries at one spot start the bar again; notes count once found', () => {
  const piece = piece4();
  const target = piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) === 1).sort((a, b) => a.beat - b.beat)[1];
  let wrongs = 0;
  const { s, r, events } = sim(piece, {
    mode: 'wait',
    play: (n) => {
      if (n.id === target.id && wrongs < 3) {
        wrongs++;
        return n.midi + 2;
      }
      return n.midi;
    },
  });
  const loops = events.filter((e) => e.type === 'loop');
  assert.equal(loops.length, 1);
  assert.equal(loops[0].mode, 'wait');
  assert.equal(loops[0].bar, 2);
  assert.deepEqual(loops[0].expected, piece.notes.filter((n) => n.beat === target.beat).map((n) => n.midi));
  assert.ok(s.finished);
  assert.equal(r.hits, r.total);
  assert.equal(r.loops[0].mode, 'wait');
  assert.ok(r.loops[0].passed);
  assert.ok(r.score < 100, 'the wrong tries still cost that note some credit');
});

test('wait mode: at most two restarts per bar', () => {
  const piece = piece4();
  const target = piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) === 1).sort((a, b) => a.beat - b.beat)[0];
  let wrongs = 0;
  const { r, events } = sim(piece, {
    mode: 'wait',
    play: (n) => {
      if (n.id === target.id && wrongs < 12) {
        wrongs++;
        return n.midi + 2;
      }
      return n.midi;
    },
  });
  assert.equal(events.filter((e) => e.type === 'loop').length, LOOP_RULES.waitRestarts);
  assert.equal(r.hits, r.total);
});

test('hold and release freeze the clock without losing the place', () => {
  const piece = piece4();
  let now = 0;
  const s = new Session(piece, { mode: 'wait', barLoop: true, clock: () => now });
  s.start();
  for (; now < 3; now += 0.01) s.update();
  const b = s.beat;
  s.hold();
  for (; now < 8; now += 0.01) s.update();
  assert.equal(s.beat, b);
  assert.deepEqual(s.expectedNotes(), []);
  s.release();
  s.update();
  assert.ok(Math.abs(s.beat - b) < 0.05);
  assert.ok(s.expectedNotes().length > 0);
});
