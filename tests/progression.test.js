// Lesson plans and progression: many activities per level, level-up only through the plan and a
// passed level check at tempo, slow mastery, little XP (and no mastery) for wait mode, and old
// saved progress carried over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Coach, lessonPlan, PROGRESSION, xpFor, typicalNotes, XP_MAX } from '../js/coach.js';
import { MAX_LEVEL } from '../js/music/curriculum.js';
import { getSong } from '../js/music/songs.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
};
const placed = (level) => {
  const c = new Coach(mem());
  c.setLevel(level);
  return c;
};
// Play the next activity with a given score (stars and hits as the engine would give them).
function playNext(c, score = 92, extra = {}) {
  const a = c.nextActivity();
  if (a.kind === 'intro') {
    c.markIntroSeen(a.level);
    return { a, out: null };
  }
  if (a.kind === 'keylesson') {
    c.keyLessonDone(a.key, { practice: false });
    return { a, out: null };
  }
  const stars = a.mode === 'wait' ? 0 : score >= 95 ? 3 : score >= 85 ? 2 : score >= 70 ? 1 : 0;
  const seed = 1000 + c.s.stats.pieces;
  const out = c.record(a, { seed, bpm: 70 }, { score, mode: a.mode, hits: 14, stars, loopCount: 0, ...extra }, 30);
  return { a, out, seed };
}

test('every level has a lesson plan of 12-20 steps: intro, learn, play, rhythm, warm-ups, song, review, check', () => {
  for (let L = 1; L <= MAX_LEVEL; L++) {
    const plan = lessonPlan(L);
    assert.ok(plan.length >= 12 && plan.length <= 20, `level ${L}: ${plan.length} steps`);
    const types = plan.map((s) => s.type);
    assert.equal(types[0], 'intro');
    assert.equal(types.at(-1), 'check');
    for (const t of ['learn', 'play', 'rhythm', 'warmup', 'song-learn', 'song-play', 'practice']) assert.ok(types.includes(t), `level ${L} has ${t}`);
    assert.equal(types.includes('review'), L > 1, `level ${L} review`);
    assert.ok(types.filter((t) => t === 'learn' || t === 'song-learn').length >= 3, 'several guided pieces');
    // A "play" step follows the piece it plays again.
    plan.forEach((s, i) => s.same && assert.ok(['learn', 'song-learn'].includes(plan[i - 1].type), `level ${L} step ${i}`));
  }
  assert.ok(PROGRESSION.minDone < lessonPlan(1).length);
});

test('the plan walks through its steps with the right modes', () => {
  const c = placed(6);
  const seen = [];
  const seeds = new Map();
  for (let i = 0; i < 15; i++) {
    const { a, seed } = playNext(c, 90);
    seen.push(a);
    seeds.set(a.lesson, seed);
    if (a.check) break;
  }
  assert.equal(seen[0].kind, 'intro');
  const byLesson = new Map(seen.filter((a) => a.lesson).map((a) => [a.lesson, a]));
  assert.equal(byLesson.get(3).mode, 'wait', 'lesson 3 learns a piece in wait mode');
  assert.equal(byLesson.get(4).mode, 'tempo', 'lesson 4 plays it with the beat');
  assert.equal(byLesson.get(4).seed, seeds.get(3), 'the same piece as lesson 3');
  assert.equal(byLesson.get(5).kind, 'rhythm');
  assert.equal(byLesson.get(6).level, 5, 'review of the level before');
  assert.ok(byLesson.get(6).review);
  // A song from the library that fits the level.
  const learnSong = byLesson.get(10);
  assert.equal(learnSong.kind, 'song');
  assert.equal(learnSong.mode, 'wait');
  const arr = getSong(learnSong.songId).arrangements.find((x) => x.id === learnSong.arrangementId);
  assert.ok(arr.level <= 6 && arr.level >= 1, `song arrangement level ${arr.level}`);
  assert.equal(byLesson.get(11).songId, learnSong.songId);
  assert.equal(byLesson.get(11).mode, 'tempo');
  assert.ok(learnSong.tempoScale > 0 && learnSong.tempoScale <= 1);
  assert.equal(byLesson.get(15).label, 'Level check');
  for (const a of seen.slice(1)) {
    assert.equal(a.total, 15);
    assert.ok(a.label && a.coachLine, `lesson ${a.lesson} has a label and Pip's line`);
    assert.ok(a.tip, `lesson ${a.lesson} has a concept reminder`);
  }
});

test('level-up needs the whole plan and a passed level check at tempo', () => {
  const c = placed(9); // (a level with no new key: no key lesson in the way)
  let n = 0,
    out = null;
  do {
    out = playNext(c, 97).out;
    n++;
  } while (!(out && out.levelUp) && n < 40);
  assert.ok(out.levelUp);
  assert.equal(n, 15, 'intro + 13 lessons + the check');
  assert.equal(c.level, 10);
  assert.equal(c.planStatus().lesson, 1, 'the new level starts at its beginning');
});

test('a failed level check: learn that piece, try it again, then a fresh check', () => {
  const c = placed(4);
  while (!c.nextActivity().check) playNext(c, 88);
  assert.equal(c.level, 4);
  const { out } = playNext(c, 72); // below the pass mark
  assert.equal(out.levelUp, false);
  assert.equal(out.check.passed, false);
  assert.equal(out.check.need, PROGRESSION.checkPass);
  const r1 = c.nextActivity();
  assert.ok(r1.retry && r1.mode === 'wait');
  playNext(c, 90);
  const r2 = c.nextActivity();
  assert.ok(r2.retry && r2.mode === 'tempo');
  playNext(c, 90);
  const again = c.nextActivity();
  assert.ok(again.check && !again.retry && again.seed == null, 'a fresh check piece');
  // A check that needed several bars played again doesn't pass yet.
  const loopy = playNext(c, 95, { loopCount: 3 }).out;
  assert.equal(loopy.levelUp, false);
  assert.ok(loopy.check.tooManyLoops);
  playNext(c, 90);
  playNext(c, 90);
  const pass = playNext(c, 85).out;
  assert.ok(pass.levelUp);
  assert.equal(c.level, 5);
});

test('the check is only reached after enough completed lessons: skipping adds extra practice', () => {
  const c = placed(10);
  playNext(c); // intro
  const skipped = [];
  while (!c.nextActivity().check && !c.nextActivity().extra) {
    const a = c.nextActivity();
    if (skipped.length < 4) {
      c.skip(a, { seed: 5 });
      skipped.push(a.lesson);
    } else playNext(c, 90);
  }
  const x = c.nextActivity();
  assert.ok(x.extra, 'extra practice before the check');
  assert.equal(x.mode, 'tempo');
  let extras = 0;
  while (c.nextActivity().extra) {
    playNext(c, 90);
    extras++;
  }
  assert.equal(extras, 4 - (lessonPlan(10).length - 1 - PROGRESSION.minDone));
  assert.ok(c.nextActivity().check);
  // The check itself can't be skipped.
  c.skip(c.nextActivity(), { seed: 1 });
  assert.ok(c.nextActivity().check);
});

test('mastery grows slowly, only at tempo: wait mode gives next to nothing', () => {
  const c = placed(12);
  playNext(c);
  const act = { kind: 'sight', level: 12, mode: 'tempo', plan: { level: 12, step: 99 } };
  const w = c.record({ ...act, mode: 'wait' }, { seed: 1, bpm: 70 }, { score: 100, mode: 'wait', hits: 20, stars: 3 }, 30);
  assert.ok(w.gain <= 1, `wait gain ${w.gain}`);
  const t = c.record(act, { seed: 2, bpm: 70 }, { score: 100, mode: 'tempo', hits: 20, stars: 3 }, 30);
  assert.ok(t.gain > w.gain && t.gain <= 10, `tempo gain ${t.gain}`);
  // Three perfect tempo pieces are no longer a level (they used to be).
  for (let i = 0; i < 3; i++) c.record(act, { seed: 3 + i, bpm: 70 }, { score: 100, mode: 'tempo', hits: 20, stars: 3 }, 30);
  assert.equal(c.level, 12);
  assert.ok(c.mastery(12) < 60, `mastery ${c.mastery(12)}`);
  // A piece that needed several loops counts for less.
  const loopy = c.record(act, { seed: 9, bpm: 70 }, { score: 100, mode: 'tempo', hits: 20, stars: 3, loopCount: 3 }, 30);
  assert.ok(loopy.gain < t.gain);
});

test('XP: work done and quality; wait mode earns about a third and no star bonus', () => {
  const L = 10;
  const full = typicalNotes(L);
  const tempo = xpFor({ score: 95, mode: 'tempo', hits: full, stars: 3 }, L);
  const wait = xpFor({ score: 95, mode: 'wait', hits: full, stars: 3 }, L);
  const waitNoStars = xpFor({ score: 95, mode: 'wait', hits: full, stars: 0 }, L);
  assert.equal(wait, waitNoStars, 'no star bonus in wait mode');
  assert.ok(wait <= Math.ceil(tempo / 3), `wait ${wait} vs tempo ${tempo}`);
  assert.ok(wait >= 1);
  // A short warm-up earns less than a full piece played as well.
  const warm = xpFor({ score: 95, mode: 'tempo', hits: Math.round(full / 3), stars: 3 }, L);
  assert.ok(warm < tempo * 0.6, `warm-up ${warm} vs piece ${tempo}`);
  // Better playing earns more.
  assert.ok(xpFor({ score: 60, mode: 'tempo', hits: Math.round(full * 0.6), stars: 0 }, L) < tempo);
  assert.ok(tempo <= XP_MAX);
  // Comparable across levels: a full piece is worth about the same at level 1 and level 30.
  const a = xpFor({ score: 90, mode: 'tempo', hits: typicalNotes(1), stars: 2 }, 1);
  const b = xpFor({ score: 90, mode: 'tempo', hits: typicalNotes(30), stars: 2 }, 30);
  assert.ok(Math.abs(a - b) <= 2, `${a} vs ${b}`);
  // The daily goal takes a real session: several lesson activities, not two or three.
  const c = placed(3);
  playNext(c);
  let acts = 0;
  while (c.summary().todayXp < c.settings.dailyGoal && acts < 30) {
    const nx = c.nextActivity();
    const hits = typicalNotes(nx.level);
    const stars = nx.mode === 'wait' ? 0 : 2;
    c.record(nx, { seed: acts, bpm: 70 }, { score: 88, mode: nx.mode, hits, stars }, 30);
    acts++;
  }
  assert.ok(acts >= 4 && acts <= 9, `${acts} activities for the daily goal`);
});

test('placement places the student and starts the plan at the beginning of that level', () => {
  const c = new Coach(mem());
  let act = c.startPlacement('some');
  for (let i = 0; i < 12; i++) {
    const r = c.placementResult({ score: act.level <= 9 ? 95 : 30, noteAcc: 0.9, timing: 0.9 });
    if (r.done) break;
    act = r.next;
  }
  assert.ok(c.s.placed);
  const L = c.level;
  assert.ok(L > 1);
  const st = c.planStatus();
  assert.equal(st.lesson, 1);
  assert.equal(c.nextActivity().kind, 'intro');
  assert.equal(c.mastery(L), PROGRESSION.placementHeadStart);
});

test('old saved progress (version 1) keeps its level, XP and stars, and starts the plan partway', () => {
  const store = mem();
  const old = {
    placed: true, level: 7, mastery: { 5: 100, 6: 100, 7: 60 }, tempo: { 7: 0.3 }, counter: { 7: 11 }, fails: {}, seenIntro: { 7: true },
    retry: { level: 7, seed: 42, mode: 'wait' }, history: [{ t: 1, level: 7, kind: 'sight', mode: 'tempo', score: 80 }],
    stats: { seconds: 900, pieces: 30, notes: 500 }, streak: { last: null, days: 2 }, settings: { dailyGoal: 100 }, xp: 640,
  };
  store.setItem('maestro.progress.v1', JSON.stringify(old));
  const c = new Coach(store);
  assert.equal(c.level, 7);
  assert.equal(c.s.xp, 640);
  assert.equal(c.mastery(6), 100);
  assert.equal(c.settings.dailyGoal, 100);
  assert.equal(c.settings.repeatBars, true);
  assert.equal(c.s.version, 2);
  const st = c.planStatus();
  assert.ok(st.lesson >= 6 && st.lesson <= 11, `lesson ${st.lesson} of ${st.total}`);
  assert.ok(st.done >= st.step);
  // The pending retry carries over.
  const a = c.nextActivity();
  assert.ok(a.retry && a.seed === 42 && a.mode === 'wait');
  // Saved again in the new format, and loaded the same way.
  c.save();
  const again = new Coach(store);
  assert.equal(again.planStatus().lesson, st.lesson);
  // A student at 100% mastery who never levelled up still has to pass the check.
  const s2 = mem();
  s2.setItem('maestro.progress.v1', JSON.stringify({ ...old, mastery: { 7: 100 }, retry: null }));
  const c2 = new Coach(s2);
  assert.ok(c2.planStatus().lesson < lessonPlan(7).length, 'not straight to the next level');
  // Not yet placed / not seen the intro: the plan starts at the intro.
  const s3 = mem();
  s3.setItem('maestro.progress.v1', JSON.stringify({ placed: true, level: 3, mastery: { 3: 40 }, seenIntro: {} }));
  assert.equal(new Coach(s3).nextActivity().kind, 'intro');
});

test('results name the bars that needed practice', () => {
  const c = placed(8);
  const rv = c.review({ key: null }, { score: 88, mode: 'tempo', loops: [{ bar: 3, tries: 3, passed: true }, { bar: 5, tries: 2, passed: true }], total: 20, extras: 0 }, {}, {});
  assert.ok(rv.tips.some((t) => /Bars 3 and 5/.test(t)), rv.tips.join(' | '));
  const rv2 = c.review({ key: null }, { score: 70, mode: 'tempo', loops: [{ bar: 2, tries: 3, gaveUp: true }], total: 20, extras: 0 }, {}, {});
  assert.ok(rv2.tips.some((t) => /Bar 2 still needs work/.test(t)), rv2.tips.join(' | '));
});
