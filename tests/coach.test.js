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

// ---- automatic microphone-delay correction, results that teach, warm-ups --------------------
import { Session } from '../js/game/engine.js';
import { generate } from '../js/music/generator.js';
import { AUTO_LATENCY, warmupKinds } from '../js/coach.js';

// Play a piece through a real Session. The device hears every note `deviceMs` late; the
// player's own timing is `playerMs(i)` (ms, + = late); `keep(n, i)` decides which notes are played.
function playThrough(coach, piece, { deviceMs = 0, playerMs = () => 0, keep = () => true, level } = {}) {
  let now = 0;
  const s = new Session(piece, { clock: () => now, latency: coach.settings.latencyMs / 1000, level: level ?? piece.level });
  s.start();
  const spb = 60 / piece.bpm;
  const t0 = s.countIn * spb;
  const plays = piece.notes.map((n, i) => (keep(n, i) ? { midi: n.midi, t: t0 + n.beat * spb + (playerMs(i, n) + deviceMs) / 1000 } : null)).filter(Boolean).sort((a, b) => a.t - b.t);
  let i = 0;
  for (now = 0; !s.finished && now < t0 + piece.totalBeats * spb + 3; now += 0.01) {
    while (i < plays.length && plays[i].t <= now) s.noteOn(plays[i].midi, plays[i++].t);
    s.update();
  }
  return s.result();
}
const jitter = (sd) => (i) => Math.round(Math.sin(i * 12.9898) * 43758.5453 % 1 * sd * 1.7); // deterministic, roughly +-sd

function placedCoach(level = 10) {
  const c = new Coach(mem());
  c.setLevel(level);
  c.markIntroSeen(level);
  return c;
}

test('auto latency: a steady 120 ms device delay is learned in small steps, without overshoot or oscillation', () => {
  const c = placedCoach(10);
  const history = [c.settings.latencyMs];
  for (let k = 0; k < 12; k++) {
    const piece = generate(10, { seed: 100 + k, tempoFactor: 0.5 });
    const r = playThrough(c, piece, { deviceMs: 120, playerMs: jitter(20) });
    const out = c.record({ kind: 'sight', level: 10 }, piece, r, 30);
    if (out.latency) assert.ok(Math.abs(out.latency.to - out.latency.from) <= AUTO_LATENCY.maxStep, 'bounded step');
    history.push(c.settings.latencyMs);
  }
  for (let k = 1; k < history.length; k++) assert.ok(history[k] >= history[k - 1], `monotone: ${history.join(' ')}`);
  assert.ok(Math.max(...history) <= 135, `no overshoot: ${history.join(' ')}`);
  assert.ok(Math.abs(history[history.length - 1] - 120) <= 15, `converged near 120: ${history.join(' ')}`);
  assert.equal(history[1], 0, 'one piece is not enough evidence');
  // Once corrected, the player's timing reads as on the beat.
  const piece = generate(10, { seed: 999 });
  const r = playThrough(c, piece, { deviceMs: 120, playerMs: jitter(20) });
  assert.ok(Math.abs(r.medianErrMs) <= 20, `residual ${r.medianErrMs} ms`);
});

test('auto latency: noisy per-piece estimates settle without ping-pong', () => {
  const c = placedCoach(10);
  const hist = [0];
  const offsets = [100, 140, 110, 150, 95, 130, 120, 145, 105, 125, 115, 135];
  offsets.forEach((dev, k) => {
    const piece = generate(10, { seed: 300 + k });
    const r = playThrough(c, piece, { deviceMs: dev, playerMs: jitter(15) });
    c.record({ kind: 'sight', level: 10 }, piece, r, 30);
    hist.push(c.settings.latencyMs);
  });
  const moves = hist.slice(1).map((v, i) => Math.sign(v - hist[i])).filter(Boolean);
  const flips = moves.slice(1).filter((m, i) => m !== moves[i]).length;
  assert.ok(flips <= 1, `direction changes: ${hist.join(' ')}`);
  assert.ok(hist.at(-1) >= 95 && hist.at(-1) <= 145, `ends in range: ${hist.join(' ')}`);
});

test('auto latency leaves genuine timing problems alone', () => {
  // Uneven dragging (wide spread) is the player, not the device.
  const a = placedCoach(10);
  for (let k = 0; k < 5; k++) {
    const piece = generate(10, { seed: 400 + k });
    a.record({ kind: 'sight', level: 10 }, piece, playThrough(a, piece, { playerMs: (i) => 80 + ((i * 53) % 9) * 30 - 120 }), 30);
  }
  assert.equal(a.settings.latencyMs, 0, 'wide spread: no correction');
  // Inaccurate playing is no evidence.
  const b = placedCoach(10);
  for (let k = 0; k < 5; k++) {
    const piece = generate(10, { seed: 500 + k });
    b.record({ kind: 'sight', level: 10 }, piece, playThrough(b, piece, { deviceMs: 120, keep: (n, i) => i % 2 === 0 }), 30);
  }
  assert.equal(b.settings.latencyMs, 0, 'half the notes missed: no correction');
  // The hands disagree: one hand drags, so it is the player.
  const d = placedCoach(10);
  for (let k = 0; k < 5; k++) {
    const piece = generate(10, { seed: 600 + k });
    d.record({ kind: 'sight', level: 10 }, piece, playThrough(d, piece, { playerMs: (i, n) => (n.hand === 'L' ? 110 : 0) }), 30);
  }
  assert.equal(d.settings.latencyMs, 0, 'left hand late, right hand on time: no correction');
  // Switched off.
  const e = placedCoach(10);
  e.setSetting('autoLatency', false);
  for (let k = 0; k < 4; k++) {
    const piece = generate(10, { seed: 700 + k });
    e.record({ kind: 'sight', level: 10 }, piece, playThrough(e, piece, { deviceMs: 120 }), 30);
  }
  assert.equal(e.settings.latencyMs, 0);
});

test('review: one short spoken line and at most three tips that say what to fix', () => {
  const c = placedCoach(8);
  const piece = generate(8, { seed: 3, bpm: 64 });
  const r = playThrough(c, piece, { keep: (n) => !(n.hand === 'R' && Math.floor(n.beat / piece.beatsPer) === 1), playerMs: () => -80 });
  const rv = c.review(piece, r, { kind: 'sight', level: 8 }, {});
  assert.ok(rv.tips.length >= 1 && rv.tips.length <= 3);
  assert.ok(rv.tips.some((t) => /Bar 2/.test(t)), rv.tips.join(' | '));
  assert.ok(rv.speak.startsWith(`${r.score} percent.`));
  assert.ok(rv.speak.split(/\s+/).length <= 14, rv.speak);
  assert.ok(!/[♯♭]/.test(rv.speak), 'spoken line has no symbols');
  assert.equal(c.feedback(piece, r)[0], rv.headline);
});

test('warm-ups fit the level: no thumb-under scales before level 16, left-hand chords from 14', () => {
  assert.deepEqual(warmupKinds(1), ['notes', 'fivefinger']);
  assert.ok(!warmupKinds(9).includes('scale') && !warmupKinds(15).includes('scale'));
  assert.ok(warmupKinds(14).includes('chords') && !warmupKinds(13).includes('chords'));
  assert.ok(warmupKinds(16).includes('scale') && warmupKinds(25).includes('arpeggio'));
  const c = placedCoach(3);
  const w = c.nextActivity();
  assert.equal(w.kind, 'fivefinger');
  const piece = generate(3, { kind: w.kind, seed: 1 });
  assert.ok(piece.notes.every((n) => n.hand === 'L' && n.midi >= 48 && n.midi <= 55), 'level 3 warm-up is in left-hand C position');
});

test('new settings default on and survive old saved data', () => {
  const store = mem();
  store.setItem('maestro.progress.v1', JSON.stringify({ level: 4, settings: { latencyMs: 30 } }));
  const c = new Coach(store);
  assert.equal(c.settings.prep, true);
  assert.equal(c.settings.autoLatency, true);
  assert.equal(c.settings.latencyMs, 30);
});
