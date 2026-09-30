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
function sim(piece, { play = (n) => n.midi, mode = 'tempo', barLoop = true, choose = 'continue', errMs = 0, level, onFrame } = {}) {
  let now = 0;
  const events = [];
  let pendingChoice = false;
  const s = new Session(piece, {
    mode, barLoop, level: level ?? piece.level, clock: () => now,
    onEvent: (e) => {
      events.push({ ...e, at: now, beatNow: s.beat, clearBefore: s.clearBefore });
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
      const m = play(n, ctx); // (a midi, null to leave the note out, or a list of keys pressed together)
      for (const k of Array.isArray(m) ? m : m == null ? [] : [m]) queue.push({ midi: k, t: now + (s.playMode === 'wait' ? 0.05 : 0) });
    }
    while (queue.length && queue[0].t <= now) {
      const q = queue.shift();
      s.noteOn(q.midi, q.t);
    }
    s.update();
    if (onFrame) onFrame(s, now);
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

// The lead-in before a bar played again: jumping back is not instant. The playhead goes back about
// LOOP_RULES.leadIn seconds (at least a bar) with the notes before the bar cleared away, quiet at
// first, then a full bar counted in, then "go" on the bar line.
function countInAfter(events, loop, bar, piece, spb) {
  const i = events.indexOf(loop);
  const after = events.slice(i + 1);
  const go = after.find((e) => e.type === 'beat' && e.go);
  const beats = after.slice(0, after.indexOf(go) + 1).filter((e) => e.type === 'beat');
  const rest = beats.filter((e) => e.rest);
  const lead = beats.filter((e) => e.lead);
  const from = (bar - 1) * piece.beatsPer;
  assert.ok(go, 'a "go" after the loop');
  assert.equal(go.beat, from, 'go on the bar line');
  const total = Math.max(piece.beatsPer, Math.round(LOOP_RULES.leadIn / spb));
  assert.equal(rest.length, total - piece.beatsPer, 'quiet beats first');
  if (rest.length) assert.ok(beats.indexOf(rest.at(-1)) < beats.indexOf(lead[0]), 'the quiet beats come first');
  assert.deepEqual(lead.map((e) => e.lead), Array.from({ length: piece.beatsPer }, (_, k) => piece.beatsPer - k), 'a full bar counted down');
  // time from the jump back to "go": about LOOP_RULES.leadIn (whole beats), at least a bar
  const secs = go.at - loop.at;
  assert.ok(secs >= Math.max(piece.beatsPer * spb, LOOP_RULES.leadIn - spb / 2) - 0.05, `${secs.toFixed(2)} s from the jump back to go`);
  assert.ok(secs <= Math.max(piece.beatsPer * spb, LOOP_RULES.leadIn + spb / 2) + 0.3, `${secs.toFixed(2)} s from the jump back to go`);
  // the notes before the bar are cleared away (not drawn) while it comes closer
  assert.equal(loop.clearBefore, from);
  return { go, rest, lead };
}

test('tempo: a bar played again starts after a ~4 s lead-in, cleared of old notes, ending with a one-bar count-in', () => {
  const piece = piece4();
  const { s, events } = sim(piece, { play: (n, c) => (inBar(c.s, n, 2) && c.attempt(2) <= 1 ? null : n.midi) });
  const loop = events.find((e) => e.type === 'loop');
  countInAfter(events, loop, 2, piece, s.spb);
});

test('tempo: notes played during the lead-in are ignored', () => {
  const piece = piece4();
  let now = 0;
  const events = [];
  const s = new Session(piece, { mode: 'tempo', barLoop: true, level: piece.level, clock: () => now, onEvent: (e) => events.push({ ...e, at: now }) });
  s.start();
  // miss bar 1 entirely: it is played again
  for (; now < 60 && !events.some((e) => e.type === 'loop'); now += 0.01) s.update();
  assert.ok(s.lead, 'counting in');
  const first = piece.notes.filter((n) => n.beat === 0);
  for (; s.beat < s.lead.to - 0.6; now += 0.01) {
    s.update();
    for (const n of first) assert.equal(s.noteOn(n.midi, now), null, `ignored at beat ${s.beat.toFixed(2)}`);
  }
});

test('wait mode: after a restart the app counts the student in before waiting for the notes', () => {
  const piece = piece4();
  const target = piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) === 1).sort((a, b) => a.beat - b.beat)[1];
  let wrongs = 0;
  const pressed = [];
  const { s, events } = sim(piece, {
    mode: 'wait',
    play: (n, c) => {
      pressed.push({ beat: c.s.beat, lead: c.s.lead });
      if (n.id === target.id && wrongs < 3) {
        wrongs++;
        return n.midi + 2;
      }
      return n.midi;
    },
  });
  const loop = events.find((e) => e.type === 'loop');
  assert.equal(loop.mode, 'wait');
  countInAfter(events, loop, 2, piece, s.spb);
  // nothing is asked for (the listener gets no hints, the student is not waited on) until then
  assert.ok(pressed.every((p) => !p.lead || p.beat >= p.lead.to - 0.5));
  assert.ok(s.finished);
});

test('tempo: "learn it" counts the student in before the bar in wait mode', () => {
  const piece = piece4();
  const { s, events } = sim(piece, {
    choose: 'learn',
    play: (n, c) => (inBar(c.s, n, 2) && c.s.playMode === 'tempo' ? null : n.midi),
  });
  const loop = events.find((e) => e.type === 'loop' && e.learning);
  assert.ok(loop, 'learning the bar');
  countInAfter(events, loop, 2, piece, s.spb);
});

// ---- false strikes ---------------------------------------------------------------------------
// The listener sometimes reports a key that was not struck (a release thump, a ghost partial). A bar
// the student played right must not be sent back for that.

test('tempo: a bar played right is not repeated for a couple of false strikes', () => {
  const piece = piece4();
  const bar2 = piece.notes.filter((n) => Math.floor(n.beat / piece.beatsPer) === 1);
  const strays = Math.ceil(bar2.length / 2); // (as many as the old rule needed to fail the bar)
  assert.ok(strays >= 1 && strays < bar2.length, 'a bar with several notes');
  const extra = new Set(bar2.slice(0, strays).map((n) => n.id));
  const { r, events } = sim(piece, { play: (n) => (extra.has(n.id) ? [n.midi, n.midi + 1] : n.midi) });
  assert.equal(events.filter((e) => e.type === 'loop').length, 0, 'no loop');
  assert.equal(r.hits, r.total);
  assert.ok(r.extras >= strays, 'the strays still count as wrong keys');
});

test('tempo: a bar with as many stray keys as notes is still repeated', () => {
  const piece = piece4();
  const { events } = sim(piece, { play: (n, c) => (inBar(c.s, n, 2) && c.attempt(2) <= 1 ? [n.midi, n.midi + 1] : n.midi) });
  const loops = events.filter((e) => e.type === 'loop');
  assert.equal(loops.length, 1);
  assert.equal(loops[0].bar, 2);
});

test('tempo: strays and misses together still fail the bar (a wrong key replacing a note)', () => {
  const piece = piece4();
  const { events } = sim(piece, { play: (n, c) => (inBar(c.s, n, 2) && c.attempt(2) <= 1 ? n.midi + 1 : n.midi) });
  const loops = events.filter((e) => e.type === 'loop');
  assert.equal(loops.length, 1);
  assert.equal(loops[0].bar, 2);
});

// The retry is announced while the bar is still being played: riskBar says the bar already fails.
test('tempo: riskBar names the bar that is going to be played again, before it ends', () => {
  const piece = piece4();
  const risk = [];
  const { s, events } = sim(piece, {
    play: (n, c) => (inBar(c.s, n, 2) && c.attempt(2) <= 1 ? null : n.midi),
    onFrame: (s) => {
      const r = s.riskBar;
      if (r) risk.push({ ...r, beat: s.beat, looped: s.rewinds });
    },
  });
  assert.ok(risk.length, 'the bar is flagged');
  assert.ok(risk.every((r) => r.bar === 2 && r.attempt === 1 && r.from === piece.beatsPer && r.to === 2 * piece.beatsPer));
  const first = risk[0];
  const loop = events.find((e) => e.type === 'loop');
  assert.ok(first.beat < 2 * piece.beatsPer, `flagged at beat ${first.beat.toFixed(2)}, before the bar ends`);
  assert.ok(first.beat < loop.beatNow + 4 * piece.beatsPer && first.looped === 0, 'flagged before the jump back');
  assert.equal(s.riskBar, null, 'nothing flagged at the end');
});

test('tempo: riskBar stays null for a bar played well, and when help is offered instead of a repeat', () => {
  const piece = piece4();
  let flagged = 0;
  sim(piece, { onFrame: (s) => { if (s.riskBar) flagged++; } });
  assert.equal(flagged, 0, 'a clean run flags nothing');
  // the third failed try of a bar ends in the offer (slower / learn it), not in a repeat
  const seen = [];
  sim(piece, {
    choose: 'continue',
    play: (n, c) => (inBar(c.s, n, 2) ? null : n.midi),
    onFrame: (s) => { const r = s.riskBar; if (r) seen.push(r.attempt); },
  });
  assert.ok(seen.includes(1) && seen.includes(2), `tries 1 and 2 are flagged (${[...new Set(seen)]})`);
  assert.ok(!seen.includes(LOOP_RULES.offerAfter), 'the try that ends in the offer is not announced as a repeat');
});

// A detection the engine ignores as a ghost is marked, so the play screen can leave that key dark.
test('noteOn marks ignored ghost detections (a partial, a low-confidence double), not real strikes', () => {
  const piece = piece4();
  let now = 0;
  const s = new Session(piece, { mode: 'tempo', level: piece.level, clock: () => now });
  s.start();
  for (; s.beat < 0.05; now += 0.01) s.update();
  const first = piece.notes.filter((n) => n.beat === 0)[0];
  assert.equal(s.noteOn(first.midi, now, { confidence: 0.95 }).type, 'hit');
  assert.equal(s.lastIgnore, null, 'a hit is not ignored');
  assert.equal(s.noteOn(first.midi + 12, now + 0.05, { confidence: 0.3 }), null);
  assert.equal(s.lastIgnore, 'ghost', 'the octave double of a hit key');
  assert.equal(s.noteOn(first.midi + 2, now + 0.5, { confidence: 0.4 }), null);
  assert.equal(s.lastIgnore, 'ghost', 'low confidence');
  assert.equal(s.noteOn(first.midi + 2, now + 0.6, { confidence: 0.9 }).type, 'wrong');
  assert.equal(s.lastIgnore, null, 'a confident wrong key is a wrong key, not a ghost');
});
