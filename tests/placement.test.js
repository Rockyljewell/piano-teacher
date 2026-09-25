// The adaptive placement test: its model, and fair test pieces at every level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedScore, prior, update, estimate, nextLevel, shouldStop, finalLevel, MAX_TESTS } from '../js/placement.js';
import { generate } from '../js/music/generator.js';
import { Coach } from '../js/coach.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test('expected score falls as the test gets harder than the student', () => {
  for (let L = 1; L < 40; L++) assert.ok(expectedScore(10, L) >= expectedScore(10, L + 1));
  assert.ok(expectedScore(10, 10) > 75 && expectedScore(10, 10) < 90);
  assert.ok(expectedScore(10, 20) < 30);
});

test('a good score moves the estimate up, a poor one down', () => {
  const p0 = prior('some');
  const up = estimate(update(p0, 12, 95)).level;
  const down = estimate(update(p0, 12, 30)).level;
  assert.ok(up > down, `${up} > ${down}`);
  assert.ok(nextLevel(update(p0, 12, 95), [{ level: 12, score: 95 }]) >= 14);
  assert.ok(nextLevel(update(p0, 12, 30), [{ level: 12, score: 30 }]) <= 11);
});

test('the test always stops', () => {
  let post = prior('little');
  const tests = [];
  for (let i = 0; i < MAX_TESTS; i++) {
    const L = nextLevel(post, tests);
    tests.push({ level: L, score: 75 });
    post = update(post, L, 75);
  }
  assert.ok(shouldStop(post, tests));
  assert.ok(finalLevel(post) >= 1);
});

test('placement pieces carry "get ready" info and use both hands', () => {
  const c = new Coach(mem());
  const act = c.startPlacement('new');
  const p = generate(act.level, { seed: 1, bothHands: act.bothHands, measures: act.measures, tempoFactor: act.tempoFactor });
  assert.ok(p.prep && p.prep.hands.length === 2);
  assert.ok(p.notes.some((n) => n.hand === 'L') && p.notes.some((n) => n.hand === 'R'));
});

test('placement: the both-hands version of a one-hand level takes turns, never hands together', () => {
  for (const n of [1, 2, 3]) {
    for (let seed = 1; seed <= 20; seed++) {
      const p = generate(n, { seed, bothHands: true, measures: 4, tempoFactor: 0.1 });
      const byBeat = new Map();
      for (const note of p.notes) byBeat.set(note.beat, new Set([...(byBeat.get(note.beat) || []), note.hand]));
      assert.ok([...byBeat.values()].every((s) => s.size === 1), `L${n} s${seed}: no simultaneous hands`);
      assert.ok(p.notes.some((x) => x.hand === 'L') && p.notes.some((x) => x.hand === 'R'), 'both hands play');
      for (const note of p.notes) assert.ok(note.hand === 'R' ? note.midi >= 60 && note.midi <= 67 : note.midi >= 48 && note.midi <= 55, 'C position');
    }
  }
  // Level 3 (left hand) starts with the left hand.
  const p3 = generate(3, { seed: 1, bothHands: true, measures: 4 });
  assert.equal(p3.notes[0].hand, 'L');
});

