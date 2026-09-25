import test from 'node:test';
import assert from 'node:assert/strict';
import { Coach } from '../js/coach.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

function place(canPlayUpTo) {
  const c = new Coach(mem());
  let act = c.startPlacement();
  for (let i = 0; i < 20; i++) {
    const r = c.placementResult({ score: act.level <= canPlayUpTo ? 90 : 30 });
    if (r.done) return { level: r.level, tests: r.tests.length };
    act = r.next;
  }
  throw new Error('placement did not finish');
}

test('placement finds the highest playable level', () => {
  for (const skill of [0, 1, 2, 5, 9, 13, 21, 30, 39, 40]) {
    const { level, tests } = place(skill);
    assert.equal(level, Math.max(1, skill), `skill ${skill}`);
    assert.ok(tests <= 14, `tests ${tests}`);
  }
});

test('mastery leads to level up, repeated failure to a retry in wait mode', () => {
  const c = new Coach(mem());
  c.s.placed = true;
  c.s.level = 5;
  c.markIntroSeen(5);
  const piece = { seed: 1, bpm: 70 };
  const act = { kind: 'sight', level: 5 };
  c.record(act, piece, { score: 40, mode: 'tempo', hits: 1 }, 30);
  assert.deepEqual(c.nextActivity().mode, 'wait');
  c.record({ ...act }, piece, { score: 95, mode: 'wait', hits: 5 }, 30);
  assert.equal(c.nextActivity().mode, 'tempo');
  let up = false;
  for (let i = 0; i < 6 && !up; i++) up = c.record(act, piece, { score: 96, mode: 'tempo', hits: 8 }, 30).levelUp;
  assert.ok(up);
  assert.equal(c.level, 6);
  assert.equal(c.nextActivity().kind, 'intro');
});
