import test from 'node:test';
import assert from 'node:assert/strict';
import { Coach } from '../js/coach.js';
import { expectedScore } from '../js/placement.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

// Simulated student: true skill s, scores follow the model with noise (seeded).
function simulate(skill, experience, seed, noise = 14) {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
  const c = new Coach(mem());
  let act = c.startPlacement(experience);
  const levels = [];
  for (let i = 0; i < 20; i++) {
    assert.ok(act.bothHands, 'placement tests use both hands');
    levels.push(act.level);
    const score = Math.max(0, Math.min(100, Math.round(expectedScore(skill, act.level) + gauss() * noise)));
    const r = c.placementResult({ score, noteAcc: score / 100, timing: 0.8 });
    if (r.done) return { level: r.level, tests: r.tests, levels };
    if (score >= 80) assert.ok(r.next.level > act.level || act.level === 40, 'harder after a good score');
    if (score < 55) assert.ok(r.next.level < act.level || act.level === 1, 'easier after a poor score');
    act = r.next;
  }
  throw new Error('placement did not finish');
}

test('adaptive placement lands near the true skill in several both-hands tests', () => {
  const exps = ['new', 'little', 'some', 'lots'];
  let close = 0,
    total = 0;
  for (const skill of [1, 3, 6, 10, 15, 20, 28, 36]) {
    for (let k = 0; k < 12; k++) {
      const exp = exps[k % 4];
      const { level, tests } = simulate(skill, exp, 1000 * skill + k + 7);
      assert.ok(tests.length <= 9);
      if (skill > 2) assert.ok(tests.length >= 5, `several tests (${tests.length})`);
      total++;
      if (Math.abs(level - skill) <= 3) close++;
    }
  }
  assert.ok(close / total >= 0.8, `within 3 levels in ${close}/${total} runs`);
});

test('a total beginner is placed at level 1 quickly', () => {
  const { level, tests } = simulate(0, 'new', 42, 8);
  assert.equal(level, 1);
  assert.ok(tests.length <= 6);
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

test('setLevel places the student directly and clears a running placement', () => {
  const c = new Coach(mem());
  c.startPlacement('some');
  c.setLevel(1);
  assert.equal(c.s.level, 1);
  assert.equal(c.s.placed, true);
  assert.equal(c.s.placement, null);
  c.setLevel(99);
  assert.equal(c.s.level, 40);
});
