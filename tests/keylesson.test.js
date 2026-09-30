// Key lessons: which keys are new at which level, what the lesson shows (signature, hand position,
// scale fingering up and down, I-IV-V-I chords), that it matches the pieces the student then
// plays, and the guided practice flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Key, noteName } from '../js/music/theory.js';
import { LEVELS } from '../js/music/curriculum.js';
import { generate } from '../js/music/generator.js';
import { crossings, scaleFingers } from '../js/music/fingering.js';
import { Coach } from '../js/coach.js';
import { newKeysAt, keysToTeach, keyLesson, keyFlowSteps, keyReminder, signature, allKeys, twinOf, specId, keyOf, MAX_KEYS_PER_LEVEL } from '../js/music/keylesson.js';

const name = (spec) => keyOf(spec).name;
const ALL = [];
for (const mode of ['major', 'minor']) for (let f = -7; f <= 7; f++) ALL.push({ f, m: mode });

test('the first level in a key is where it is taught: C, G, F, then minors, D and B flat, ...', () => {
  assert.deepEqual(newKeysAt(1).map(name), ['C major']);
  assert.deepEqual(newKeysAt(8).map(name), ['G major']);
  assert.deepEqual(newKeysAt(11).map(name), ['F major']);
  assert.deepEqual(newKeysAt(15).map(name), ['A minor', 'D minor', 'E minor']);
  assert.deepEqual(newKeysAt(16).map(name), ['D major', 'B♭ major']);
  assert.deepEqual(newKeysAt(21).slice(0, 2).map(name), ['A major', 'E♭ major']);
  for (const n of [2, 3, 4, 5, 6, 7, 9, 10, 12, 13, 14, 17, 18, 19, 20]) assert.equal(newKeysAt(n).length, 0, `level ${n} has no new key`);
});

test('no level meets a key that no level taught before it (enharmonic twins count as taught)', () => {
  const known = new Set();
  const mark = (k) => {
    known.add(specId(k));
    if (twinOf(k)) known.add(specId(twinOf(k)));
  };
  for (const lv of LEVELS) {
    for (const k of newKeysAt(lv.n)) mark(k);
    for (const [f, m] of lv.keys) assert.ok(known.has(`${f}${m}`), `level ${lv.n} uses ${name({ f, m })} before it is introduced`);
  }
});

test('a level teaches at most two keys, the focus keys first, and never both F sharp and G flat', () => {
  for (let n = 1; n <= 40; n++) {
    const t = keysToTeach(n);
    assert.ok(t.length <= MAX_KEYS_PER_LEVEL);
    const lv = LEVELS[n - 1];
    if (lv.focusKeys && t.length) assert.ok(lv.focusKeys.some(([f, m]) => specId({ f, m }) === specId(t[0])), `level ${n} starts with a focus key`);
  }
  assert.deepEqual(keysToTeach(33).map(name), ['F♯ major', 'B♭ minor']);
});

test('key signature text', () => {
  assert.equal(signature(new Key(0)).text, 'No sharps or flats: only white keys');
  assert.equal(signature(new Key(1)).text, 'One sharp: F♯');
  assert.equal(signature(new Key(2)).text, 'Two sharps: F♯ and C♯');
  assert.equal(signature(new Key(-1)).text, 'One flat: B♭');
  assert.equal(signature(new Key(-3)).text, 'Three flats: B♭, E♭ and A♭');
  assert.equal(signature(new Key(0, 'minor')).text, signature(new Key(0)).text);
  assert.equal(keyReminder(new Key(1)), 'G major: every F is F♯.');
  assert.equal(keyReminder(new Key(-2)), 'B♭ major: every B is B♭ and every E is E♭.');
  assert.equal(keyReminder(new Key(0)), null);
});

test('the raised 7th of a minor key is spelled as a sharp or natural of the 7th note, not a flat of the next', () => {
  const at = (fifths) => {
    const k = new Key(fifths, 'minor');
    const lead = (k.scalePcs()[6] + 1) % 12;
    return noteName(60 + ((lead - 0 + 12) % 12), k).replace(/\d+$/, '');
  };
  assert.equal(at(0), 'G♯'); // A minor
  assert.equal(at(-1), 'C♯'); // D minor (not D♭)
  assert.equal(at(-2), 'F♯'); // G minor (not G♭)
  assert.equal(at(1), 'D♯'); // E minor
  assert.equal(at(3), 'E♯'); // F♯ minor
  assert.equal(at(-3), 'B'); // C minor: B natural (not C♭)
  assert.equal(at(-4), 'E'); // F minor
});

test('every key has a complete lesson: signature, position, scale up and down, four chords', () => {
  for (const spec of ALL) {
    const L = keyLesson(spec);
    const key = L.key;
    assert.ok(L.intro.text.startsWith(key.name) && L.intro.say);
    for (const h of ['R', 'L']) {
      const P = L.position[h];
      assert.equal(P.midis.length, 5);
      assert.deepEqual(P.fingers, h === 'R' ? [1, 2, 3, 4, 5] : [5, 4, 3, 2, 1]);
      assert.equal(P.midis[0] % 12, key.tonicPc, `${key.name} ${h} position starts on the tonic`);
      const S = L.scale[h];
      assert.equal(S.midis.length, 8);
      assert.equal(S.midis[0] % 12, key.tonicPc);
      assert.equal(S.midis[7] - S.midis[0], 12);
      assert.deepEqual(S.up.fingers, scaleFingers(key, h, 1));
      assert.deepEqual(S.down.fingers, [...S.up.fingers].reverse());
      assert.deepEqual(S.down.midis, [...S.up.midis].reverse());
      assert.ok(S.up.moves.length >= 1 && S.down.moves.length === S.up.moves.length, `${key.name} ${h} moves`);
      assert.ok(S.up.words.text && S.down.words.text && S.up.words.say && S.down.words.say);
      // The spoken line has no symbols the voice would stumble on.
      assert.ok(!/[♯♭𝄪]/.test(S.up.words.say + S.down.words.say + L.positionSay + L.chordSay + L.intro.say), `${key.name}: speech is plain words`);
    }
    assert.equal(L.chords.length, 4);
    assert.deepEqual(L.chords.map((c) => c.degree), [0, 3, 4, 0]);
    const tonicName = key.name.split(' ')[0];
    assert.equal(L.chords[0].name.replace(/[m°]/, ''), tonicName, `${key.name}: the first chord is the tonic`);
    for (const c of L.chords) for (const h of ['R', 'L']) {
      assert.equal(c.hands[h].midis.length, 3);
      assert.equal(c.hands[h].fingers.length, 3);
      assert.ok(c.hands[h].inversion);
    }
    assert.equal(L.chords[3].hands.L.inversion, 'root position', 'ends at home in root position');
  }
});

test('G major and A minor lessons say the right things', () => {
  const G = keyLesson({ f: 1, m: 'major' });
  assert.equal(G.name, 'G major');
  assert.deepEqual(G.scale.R.names, ['G', 'A', 'B', 'C', 'D', 'E', 'F♯', 'G']);
  assert.deepEqual(G.scale.R.up.fingers, [1, 2, 3, 1, 2, 3, 4, 5]);
  assert.deepEqual(G.scale.R.up.moves, [{ at: 3, finger: 3, to: 1, kind: 'under' }]); // the thumb tucks under 3 to play C
  assert.match(G.scale.R.up.words.text, /1 2 3, then tuck your thumb under finger 3 to play C, then 1 2 3 4 5/);
  assert.deepEqual(G.scale.R.down.moves, [{ at: 5, finger: 1, to: 3, kind: 'over' }]); // finger 3 crosses over to play B
  assert.match(G.scale.R.down.words.text, /5 4 3 2 1, then cross finger 3 over your thumb to play B, then 3 2 1/);
  assert.match(G.scale.L.up.words.text, /cross finger 3 over your thumb to play E/);
  assert.deepEqual(G.chords.map((c) => c.name), ['G', 'C', 'D', 'G']);
  assert.deepEqual(G.chords.map((c) => c.roman), ['I', 'IV', 'V', 'I']);
  assert.deepEqual(G.chords[2].hands.R.names, ['F♯', 'A', 'D']);
  const C = keyLesson({ f: 0, m: 'major' });
  assert.deepEqual(C.chords.map((c) => c.name), ['C', 'F', 'G', 'C']);
  assert.match(C.position.R.text, /thumb \(1\) on C/);
  const Am = keyLesson({ f: 0, m: 'minor' });
  assert.deepEqual(Am.chords.map((c) => c.name), ['Am', 'Dm', 'E', 'Am']); // the V chord is major in harmonic minor
  assert.deepEqual(Am.chords.map((c) => c.roman), ['i', 'iv', 'V', 'i']);
  assert.equal(Am.scale.R.names[6], 'G♯');
  assert.match(Am.scaleNote, /raised \(G♯\)/);
  const F = keyLesson({ f: -1, m: 'major' });
  assert.match(F.scale.R.up.words.text, /tuck your thumb under finger 4 to play C/);
  assert.match(keyLesson({ f: 6, m: 'major' }).intro.text, /same keys on the piano/);
});

test('level 1 only has a right hand; later lessons show both', () => {
  assert.deepEqual(keyLesson({ f: 0, m: 'major' }, { level: 1 }).hands, ['R']);
  assert.deepEqual(keyLesson({ f: 1, m: 'major' }, { level: 8 }).hands, ['R', 'L']);
});

test('the lesson shows what the practice pieces then ask for', () => {
  for (const spec of ALL.filter((k) => Math.abs(k.f) <= 6)) {
    const key = keyOf(spec);
    const L = keyLesson(spec);
    for (const hand of ['R', 'L']) {
      const p = generate(8, { kind: 'scale', key, hand, harmonic: true, seed: 1 });
      const notes = p.events.filter((e) => e.hand === hand && !e.rest);
      assert.deepEqual(notes.slice(0, 8).map((e) => e.midis[0]), L.scale[hand].midis, `${key.name} ${hand} scale notes`);
      assert.deepEqual(notes.slice(0, 8).map((e) => e.fingers[0]), L.scale[hand].up.fingers, `${key.name} ${hand} scale fingers`);
      // The down run retraces it.
      assert.deepEqual(notes.slice(7).map((e) => e.midis[0]), L.scale[hand].down.midis);
      assert.equal(p.events.filter((e) => e.cross).length, L.scale[hand].up.moves.length + L.scale[hand].down.moves.length);
    }
    const c = generate(8, { kind: 'chords', key, prog: [0, 3, 4, 0], seed: 1 });
    const left = c.events.filter((e) => !e.rest);
    assert.deepEqual(left.map((e) => e.midis), L.chords.map((x) => x.hands.L.midis), `${key.name} chords`);
    assert.deepEqual(left.map((e) => e.fingers), L.chords.map((x) => x.hands.L.fingers));
  }
});

test('scale pieces mark the notes that follow a thumb tuck or a cross-over', () => {
  const p = generate(16, { kind: 'scale', key: new Key(0), hand: 'R', seed: 3 });
  const evs = p.events.filter((e) => !e.rest);
  assert.equal(evs.length, 15);
  const at = evs.map((e, i) => (e.cross ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(at, [3, 12]);
  assert.deepEqual(evs[3].cross, { at: 3, finger: 3, to: 1, kind: 'under' });
  assert.deepEqual(evs[12].cross, { at: 5, finger: 1, to: 3, kind: 'over' });
  // A chosen hand is honoured at every level; 'both' plays both.
  assert.deepEqual(generate(3, { kind: 'scale', key: new Key(1), hand: 'L', seed: 1 }).staves, ['bass']);
  assert.deepEqual(generate(3, { kind: 'scale', key: new Key(1), hand: 'both', seed: 1 }).staves, ['treble', 'bass']);
  // Two-octave scales (from level 25) carry fingers now: three thumb tucks up, three crossings down.
  const two = generate(26, { kind: 'scale', key: new Key(1), hand: 'R', seed: 1 });
  const fs = two.events.filter((e) => !e.rest);
  assert.equal(fs.length, 29);
  assert.ok(fs.every((e) => e.fingers && e.fingers[0] >= 1));
  assert.equal(fs.filter((e) => e.cross).length, 6);
  // Minor keys raise the 7th when asked, at any level.
  const am = generate(3, { kind: 'scale', key: new Key(0, 'minor'), hand: 'R', harmonic: true, seed: 1 });
  assert.ok(am.notes.some((n) => n.midi % 12 === 8));
});

test('the practice flow: a five-finger position at first, then scale (each hand) and chords', () => {
  const early = keyFlowSteps(1, { f: 0, m: 'major' });
  assert.deepEqual(early.map((s) => s.kind), ['fivefinger']);
  const g = keyFlowSteps(8, { f: 1, m: 'major' });
  assert.deepEqual(g.map((s) => [s.kind, s.hand]), [['scale', 'R'], ['scale', 'L'], ['chords', undefined]]);
  for (const s of g) {
    assert.deepEqual(s.key, { f: 1, m: 'major' });
    assert.ok(s.label && s.coachLine && s.tip);
  }
  assert.deepEqual(g[2].prog, [0, 3, 4, 0]);
  assert.match(g[0].label, /G major scale: right hand/);
  assert.match(g[2].label, /I IV V I/);
});

test('the Keys section lists every key once around the circle of fifths', () => {
  const ks = allKeys();
  assert.equal(ks.length, 12);
  assert.deepEqual(ks[0].major, { f: 0, m: 'major' });
  assert.equal(ks.map((k) => name(k.major)).join(' '), 'C major G major D major A major E major B major F♯ major D♭ major A♭ major E♭ major B♭ major F major');
  assert.equal(ks.map((k) => name(k.minor)).join(' '), 'A minor E minor B minor F♯ minor C♯ minor G♯ minor D♯ minor B♭ minor F minor C minor G minor D minor');
  assert.ok(crossings);
});

// ---- the coach: when a key lesson is due and what follows it ------------------------------------
const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
};
const placed = (level, storage = mem()) => {
  const c = new Coach(storage);
  c.setLevel(level);
  c.setSetting('voice', false);
  return c;
};
const playFlow = (c, score = 90) => {
  const a = c.nextActivity();
  assert.ok(a.keyFlow, `a practice step, got ${a.kind}`);
  const out = c.record(a, { seed: 1, bpm: 60 }, { score, mode: a.mode, hits: 8, stars: 1, loopCount: 0 }, 20);
  return { a, out };
};

test('level 8 (G major): intro, then the key lesson, then scale right, scale left, chords, then the plan', () => {
  const c = placed(8);
  assert.equal(c.nextActivity().kind, 'intro');
  c.markIntroSeen(8);
  const due = c.nextActivity();
  assert.equal(due.kind, 'keylesson');
  assert.deepEqual(due.key, { f: 1, m: 'major' });
  assert.match(due.label, /Meet G major/);
  assert.equal(c.nextActivity().kind, 'keylesson', 'it stays due until the student has had it');
  assert.equal(c.planStatus().lesson, 2, 'the lesson card is not a plan step');
  c.keyLessonDone(due.key);
  assert.ok(c.keyTaught(due.key));
  const done = c.mastery(8);
  const a1 = playFlow(c).a;
  assert.deepEqual([a1.kind, a1.hand, a1.mode, a1.keyFlow.i, a1.keyFlow.n], ['scale', 'R', 'wait', 0, 3]);
  assert.deepEqual(a1.key, { f: 1, m: 'major' });
  assert.ok(a1.label && a1.coachLine && a1.tip);
  const a2 = playFlow(c).a;
  assert.deepEqual([a2.kind, a2.hand, a2.keyFlow.i], ['scale', 'L', 1]);
  const a3 = playFlow(c).a;
  assert.deepEqual([a3.kind, a3.keyFlow.i, a3.prog], ['chords', 2, [0, 3, 4, 0]]);
  assert.equal(c.mastery(8), done, 'learning a key is not a level exercise: no mastery');
  assert.equal(c.planStatus().lesson, 2, 'and it does not move the plan');
  const next = c.nextActivity();
  assert.ok(!next.keyFlow && next.kind !== 'keylesson');
  assert.equal(next.kind, 'fivefinger', 'the plan carries on with its first warm-up');
  assert.deepEqual(next.key, { f: 1, m: 'major' }, 'in the new key');
});

test('the key lesson is had once: after that, never again (and it is remembered)', () => {
  const storage = mem();
  const c = placed(8, storage);
  c.markIntroSeen(8);
  c.keyLessonDone({ f: 1, m: 'major' }, { practice: false });
  assert.equal(c.s.keyFlow, null, 'skipping the practice');
  assert.notEqual(c.nextActivity().kind, 'keylesson');
  const again = new Coach(storage);
  assert.ok(again.keyTaught({ f: 1, m: 'major' }));
  assert.notEqual(again.nextActivity().kind, 'keylesson');
  // Down a level and up again: not taught twice.
  again.s.level = 7;
  again.s.level = 8;
  assert.equal(again.pendingKey(8), null);
});

test('leaving in the middle of the practice: the next step is where you left off', () => {
  const storage = mem();
  const c = placed(8, storage);
  c.markIntroSeen(8);
  c.keyLessonDone({ f: 1, m: 'major' });
  playFlow(c);
  const back = new Coach(storage);
  const a = back.nextActivity();
  assert.deepEqual([a.kind, a.hand, a.keyFlow.i], ['scale', 'L', 1]);
  // Skipping a practice step moves on to the next.
  back.skip(a, null);
  assert.equal(back.nextActivity().kind, 'chords');
  back.skip(back.nextActivity(), null);
  assert.ok(!back.nextActivity().keyFlow);
});

test('a student part-way through a level is not interrupted by a key lesson', () => {
  const c = placed(8);
  c.markIntroSeen(8);
  c._plan(8).step = 5;
  assert.notEqual(c.nextActivity().kind, 'keylesson');
});

test('levels without a new key have no key lesson; levels with one do, once each', () => {
  const levels = [];
  for (let n = 1; n <= 40; n++) {
    const c = placed(n);
    c.markIntroSeen(n);
    if (c.nextActivity().kind === 'keylesson') levels.push(n);
  }
  assert.deepEqual(levels, [1, 8, 11, 15, 16, 21, 28, 31, 33, 38]);
});

test('level 1 (C major): the practice is the five-finger position', () => {
  const c = placed(1);
  c.markIntroSeen(1);
  const due = c.nextActivity();
  assert.equal(due.kind, 'keylesson');
  assert.deepEqual(due.key, { f: 0, m: 'major' });
  c.keyLessonDone(due.key);
  const a = c.nextActivity();
  assert.deepEqual([a.kind, a.keyFlow.n, a.mode], ['fivefinger', 1, 'wait']);
  playFlow(c);
  assert.ok(!c.nextActivity().keyFlow);
});

test('a level with two new keys teaches both, one after the other (level 16: D, then B flat)', () => {
  const c = placed(16);
  c.markIntroSeen(16);
  const first = c.nextActivity();
  assert.equal(first.label, 'Meet D major');
  c.keyLessonDone(first.key);
  for (let i = 0; i < 3; i++) playFlow(c);
  const second = c.nextActivity();
  assert.equal(second.kind, 'keylesson');
  assert.equal(second.label, 'Meet B♭ major');
  c.keyLessonDone(second.key);
  for (let i = 0; i < 3; i++) playFlow(c);
  assert.equal(c.pendingKey(16), null);
  assert.ok(!c.nextActivity().keyFlow);
});

test('the warm-ups of a key level use its new keys', () => {
  const c = placed(16);
  c.markIntroSeen(16);
  for (const k of keysToTeach(16)) c.keyLessonDone(k, { practice: false });
  const seen = [];
  for (let i = 0; i < 9; i++) {
    const a = c.nextActivity();
    if (a.plan && ['scale', 'chords', 'fivefinger', 'notes'].includes(a.kind)) seen.push(name(a.key));
    c.record(a, { seed: 40 + i, bpm: 70 }, { score: 92, mode: a.mode, hits: 12, stars: 2, loopCount: 0 }, 30);
  }
  assert.deepEqual(seen, ['D major', 'B♭ major']);
});

test('practising from the Keys section: any key, the full scale and chords, no plan or mastery', () => {
  const c = placed(3);
  c.markIntroSeen(3);
  const before = JSON.stringify([c.s.plan, c.s.mastery]);
  c.keyLessonDone({ f: -2, m: 'major' }, { level: 3, free: true });
  const steps = [];
  while (c.s.keyFlow) steps.push(playFlow(c).a);
  assert.deepEqual(steps.map((a) => a.kind), ['scale', 'scale', 'chords']);
  assert.ok(steps.every((a) => a.free && a.level === 3 && a.mode === 'wait'));
  assert.equal(JSON.stringify([c.s.plan, c.s.mastery]), before);
});

test('a practice flow left over from another level is dropped', () => {
  const c = placed(8);
  c.markIntroSeen(8);
  c.keyLessonDone({ f: 1, m: 'major' });
  c.s.level = 9;
  c.markIntroSeen(9);
  assert.ok(!c.nextActivity().keyFlow);
  assert.equal(c.s.keyFlow, null);
});

test('saved progress from before key lessons loads (old saves have no keysTaught)', () => {
  const storage = mem();
  const old = new Coach(storage);
  old.setLevel(9);
  delete old.s.keysTaught;
  delete old.s.keyFlow;
  old.save();
  const c = new Coach(storage);
  assert.deepEqual(c.s.keysTaught, {});
  assert.ok(c.nextActivity());
});

test('the get-ready text of a scale says where the thumb moves', () => {
  const text = (level, opts) => generate(level, { kind: 'scale', seed: 1, ...opts }).prep.text;
  const g = text(8, { key: new Key(1), hand: 'R' });
  assert.match(g, /Going up, tuck the thumb under finger 3 to play C\./);
  assert.match(g, /Coming down, cross finger 3 over the thumb to play B\./);
  assert.match(g, /dashed ring/);
  assert.doesNotMatch(g, /read ahead/);
  assert.match(text(8, { key: new Key(1), hand: 'L' }), /Going up, cross finger 3 over the thumb to play E\. Coming down, tuck the thumb under finger 3 to play D\./);
  assert.match(text(8, { key: new Key(-1), hand: 'R' }), /tuck the thumb under finger 4 to play C/);
  // Both hands: one sentence each.
  const both = text(22, { key: new Key(2), hand: 'both' });
  assert.match(both, /Right hand: going up, tuck the thumb under finger 3 to play G\./);
  assert.match(both, /Left hand: going up, cross finger 3 over the thumb to play B\./);
  // Two octaves: the notes the thumb tucks under on, in order.
  assert.match(text(26, { key: new Key(0), hand: 'R' }), /tuck the thumb under to play F, C and F/);
  // Other pieces keep their usual line.
  assert.doesNotMatch(generate(8, { kind: 'chords', key: new Key(1), seed: 1 }).prep.text, /thumb/);
});

test('get-ready text reminds of the key signature when a piece is not in C or A minor (levels up to 16)', () => {
  const g = generate(9, { kind: 'sight', key: new Key(1), seed: 2 }).prep.text;
  assert.match(g, /G major: every F is F♯\./);
  assert.doesNotMatch(generate(9, { kind: 'sight', key: new Key(0), seed: 2 }).prep.text, /every/);
  assert.match(generate(11, { kind: 'sight', key: new Key(-1), seed: 2 }).prep.text, /F major: every B is B♭\./);
  assert.doesNotMatch(generate(20, { kind: 'sight', key: new Key(1), seed: 2 }).prep.text, /every F is/, 'later levels read the signature themselves');
});
