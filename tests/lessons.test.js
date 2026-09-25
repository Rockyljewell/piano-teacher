// Invariants of the generated lessons: what a student at each level can be asked to play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, generateRhythm, CELLS } from '../js/music/generator.js';
import { LEVELS, levelInfo } from '../js/music/curriculum.js';
import { diatonic } from '../js/music/theory.js';

const SEEDS = 40;
const posRange = (lo) => [lo, lo + 7]; // C and G five-finger positions span a fifth (7 semitones)
// Five-finger positions of levels 1-8 (lowest key under RH thumb / LH pinky).
const POS = Object.fromEntries(LEVELS.filter((l) => l.pos).map((l) => [l.n, l.pos]));

test('levels 1-8 have five-finger positions for every hand they use', () => {
  for (let n = 1; n <= 8; n++) {
    const lv = levelInfo(n);
    assert.ok(lv.pos, `level ${n} has pos`);
    if (lv.hands !== 'L') assert.ok(lv.pos.R != null, `level ${n} right hand`);
    if (lv.hands !== 'R') assert.ok(lv.pos.L != null, `level ${n} left hand`);
  }
});

test('levels 1-8 stay inside their five-finger positions (sight-reading, warm-ups, note reading)', () => {
  for (let n = 1; n <= 8; n++) {
    for (const kind of ['sight', 'fivefinger', 'notes']) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const p = generate(n, { seed, kind });
        const ext = new Set((p.prep.extensions || []).map((x) => x.midi));
        for (const note of p.notes) {
          const [lo, hi] = posRange(POS[n][note.hand]);
          const ok = (note.midi >= lo && note.midi <= hi) || ext.has(note.midi);
          assert.ok(ok, `L${n} ${kind} s${seed}: ${note.hand} ${note.midi} outside ${lo}-${hi}`);
        }
        assert.equal(p.prep.outOfPosition, false, `L${n} ${kind} s${seed}`);
      }
    }
  }
});

test('beginner finger numbers match the hand position', () => {
  for (let n = 1; n <= 8; n++) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const p = generate(n, { seed });
      const key = p.key;
      for (const e of p.events) {
        if (e.rest) continue;
        assert.ok(e.fingers && e.fingers.length === e.midis.length, `L${n} s${seed}: fingers on every note`);
        e.midis.forEach((m, i) => {
          const d = diatonic(key.spell(m)) - diatonic(key.spell(POS[n][e.hand]));
          const want = d === -1 && e.hand === 'L' ? 5 : e.hand === 'R' ? d + 1 : 5 - d;
          assert.equal(e.fingers[i], want, `L${n} s${seed}: ${m} in ${e.hand}`);
        });
      }
    }
  }
});

test('the only note outside a beginner position is the pinky reaching to F sharp in G position', () => {
  let seen = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const p = generate(8, { seed });
    assert.ok(p.notes.some((n) => n.midi % 12 === 6), `level 8 s${seed} plays an F sharp`);
    for (const x of p.prep.extensions) {
      assert.equal(x.midi, 42);
      assert.equal(x.finger, 5);
      seen++;
    }
  }
  assert.ok(seen > 0);
});

test('rhythm drills: any key, suggested inside the level hand position', () => {
  for (let n = 1; n <= 40; n++) {
    const lv = levelInfo(n);
    for (let seed = 1; seed <= 12; seed++) {
      const p = generateRhythm(n, { seed });
      assert.equal(p.anyKey, true);
      assert.equal(p.rhythmOnly, true);
      const s = p.suggestKey;
      assert.ok(s && Number.isInteger(s.midi) && s.name && s.text && s.say && [1, 5].includes(s.finger), `L${n} suggestKey`);
      assert.ok(/any key/i.test(s.text) && /any key/i.test(s.say));
      assert.ok(p.notes.every((x) => x.midi === s.midi), 'the falling notes sit on the suggested key');
      assert.ok(s.midi >= p.range[0] && s.midi <= p.range[1], 'suggested key is on the keyboard');
      if (lv.pos) {
        const lo = lv.pos[s.hand];
        assert.equal(s.midi, lo, `L${n}: ${s.hand === 'R' ? 'thumb' : 'pinky'} on the position's first key`);
        assert.equal(s.finger, s.hand === 'R' ? 1 : 5);
      }
      if (lv.hands === 'L') assert.equal(s.hand, 'L');
      assert.ok(!/C5/.test(s.name) || n > 8, 'no random C5 for beginners');
    }
  }
  assert.equal(generateRhythm(3, { seed: 1 }).suggestKey.midi, 48); // LH C position: C3
  assert.equal(generateRhythm(1, { seed: 1 }).suggestKey.midi, 60); // middle C
  assert.equal(generateRhythm(8, { seed: 1 }).suggestKey.midi, 67); // G position: G4
});

test('rhythm drills only use the level rhythm vocabulary', () => {
  const durs = (lv) => {
    const w = lv.hands === 'L' ? lv.lh.rhythm : lv.rh.rhythm;
    const set = new Set();
    for (const k of Object.keys(w)) for (const d of CELLS[k]) set.add(+d.toFixed(3));
    // A measure's final long note (half, dotted half, whole) is always allowed.
    for (const d of [2, 3, 4]) set.add(d);
    return set;
  };
  for (let n = 1; n <= 26; n++) {
    const lv = levelInfo(n);
    const ok = durs(lv);
    for (let seed = 1; seed <= 15; seed++) {
      const p = generateRhythm(n, { seed });
      for (const e of p.events) {
        if (!e.rest) assert.ok(ok.has(+e.dur.toFixed(3)) || n >= 17, `L${n} s${seed}: duration ${e.dur}`);
        if (e.rest) {
          assert.ok(lv.rests > 0, `L${n}: no rests before they are taught`);
          if (e.beat % 1) assert.ok(n >= 12, `L${n}: no eighth rests yet`);
        }
      }
    }
  }
  // Level 2 teaches rests: every drill has one.
  for (let seed = 1; seed <= 15; seed++) assert.ok(generateRhythm(2, { seed }).events.some((e) => e.rest));
});

test('each level teaches what it says: rests, eighths, F sharp, intervals, B flat, dotted rhythms', () => {
  const has = {
    2: (p) => p.events.some((e) => e.rest && !e.measureRest),
    7: (p) => p.events.some((e) => !e.rest && e.dur === 0.5),
    8: (p) => p.notes.some((n) => n.midi % 12 === 6),
    10: (p) => p.events.filter((e) => e.hand === 'R' && e.midis.length === 2).length >= 2,
    11: (p) => p.key.fifths !== -1 || p.notes.some((n) => n.midi % 12 === 10),
    12: (p) => p.events.some((e) => !e.rest && e.dur === 1.5),
    19: (p) => p.events.some((e) => !e.rest && e.dur === 0.25),
    23: (p) => p.events.some((e) => e.tuplet === 3),
  };
  for (const [n, f] of Object.entries(has)) for (let seed = 1; seed <= SEEDS; seed++) assert.ok(f(generate(+n, { seed })), `level ${n} seed ${seed}`);
  // F major is the main key of the F major level.
  const f = Array.from({ length: 60 }, (_, i) => generate(11, { seed: i + 1 }).key.fifths).filter((x) => x === -1).length;
  assert.ok(f >= 30, `F major in ${f}/60 level-11 pieces`);
});

test('beginner melodies start on the tonic chord and end on the tonic, approached by step', () => {
  for (let n = 1; n <= 8; n++) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const p = generate(n, { seed });
      for (const h of ['R', 'L']) {
        const evs = p.events.filter((e) => e.hand === h && !e.rest).sort((a, b) => a.beat - b.beat);
        if (!evs.length || (p.staves.length === 2 && levelInfo(n).hands === 'both' && h === 'L')) continue;
        const mel = evs.map((e) => e.midis[0]);
        const last = evs[evs.length - 1];
        if (last.beat + last.dur < p.totalBeats - 1e-6) continue; // this hand does not end the piece
        assert.equal(mel.at(-1) % 12, p.key.tonicPc, `L${n} s${seed} ${h}: ends on the tonic`);
        const steps = Math.abs(diatonic(p.key.spell(mel.at(-1))) - diatonic(p.key.spell(mel.at(-2))));
        assert.ok(steps <= (n <= 4 ? 1 : 2), `L${n} s${seed} ${h}: final approach ${steps} steps`);
        // Final note starts on a strong beat.
        const b = last.beat % p.beatsPer;
        assert.ok(b === 0 || (p.beatsPer === 4 && b === 2), `L${n} s${seed}: final note on beat ${b + 1}`);
        // No run of four equal notes, no leap bigger than the level teaches.
        for (let i = 3; i < mel.length; i++) assert.ok(!(mel[i] === mel[i - 1] && mel[i] === mel[i - 2] && mel[i] === mel[i - 3]), `L${n} s${seed}: four equal notes`);
        if (n === 1) for (let i = 1; i < mel.length; i++) assert.ok(Math.abs(mel[i] - mel[i - 1]) <= 2 || i === mel.length - 1, `L1 s${seed}: steps only (${mel.join(' ')})`);
      }
      assert.ok(!p.events.some((e) => e.beat === 0 && e.rest && !e.measureRest), `L${n} s${seed}: no rest on beat 1`);
    }
  }
});

test('key signatures and ledger lines are not used before they are taught', () => {
  const introduced = { 0: 1, 1: 8, '-1': 11, 2: 16, '-2': 16, 3: 21, '-3': 21 };
  for (let n = 1; n <= 16; n++) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const p = generate(n, { seed });
      assert.ok(introduced[p.key.fifths] <= n, `L${n} s${seed}: ${p.key.name}`);
      for (const note of p.notes) {
        if (note.staff === 'treble') assert.ok(note.midi >= 60, `L${n} s${seed}: treble ${note.midi} below middle C`);
        if (note.staff === 'bass') assert.ok(note.midi >= 41 - (n === 8 ? 1 : 0) && note.midi <= 62, `L${n} s${seed}: bass ${note.midi}`);
      }
    }
  }
});

test('tempos: beginners start slow, and a level never starts faster than the one after it by much', () => {
  for (let n = 1; n <= 8; n++) assert.ok(levelInfo(n).bpm[0] <= 60, `level ${n} starts at ${levelInfo(n).bpm[0]}`);
  for (let n = 1; n < 16; n++) assert.ok(levelInfo(n).bpm[0] <= levelInfo(n + 1).bpm[0] + 8, `level ${n}`);
});

test('every level has a short spoken line', () => {
  for (const lv of LEVELS) {
    assert.ok(lv.say && lv.say.length < lv.concept.length + 1, `level ${lv.n}`);
    assert.ok(lv.say.split(/\s+/).length <= 22, `level ${lv.n}: ${lv.say}`);
    assert.ok(lv.say.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length <= 3, `level ${lv.n}: at most two or three short sentences`);
  }
});

test('elementary levels show finger numbers at the start and where the hand moves', () => {
  for (let n = 9; n <= 16; n++) {
    for (let seed = 1; seed <= 10; seed++) {
      const p = generate(n, { seed });
      const rh = p.events.filter((e) => e.hand === 'R' && !e.rest).sort((a, b) => a.beat - b.beat);
      assert.ok(rh[0].fingers && rh[0].fingers.every((f) => f >= 1 && f <= 5), `L${n} s${seed}: first right-hand note has a finger`);
      const shown = rh.filter((e) => e.fingers).length;
      assert.ok(shown < rh.length, `L${n} s${seed}: not on every note`);
    }
  }
});

test('warm-ups: five-finger patterns use the level positions; scales from level 16 are one hand, with fingering', () => {
  const ff = generate(3, { kind: 'fivefinger', seed: 2 });
  assert.ok(ff.notes.every((n) => n.hand === 'L'));
  assert.ok(ff.events.filter((e) => !e.rest).every((e) => e.fingers && e.fingers[0]));
  for (let seed = 1; seed <= 10; seed++) {
    const sc = generate(16, { kind: 'scale', seed });
    assert.equal(sc.staves.length, 1);
    assert.ok(sc.events.filter((e) => !e.rest).every((e) => e.fingers && e.fingers[0]), `${sc.title} has fingering`);
    assert.ok(sc.events.filter((e) => !e.rest).every((e) => e.dur >= 1), 'quarter notes when scales are new');
  }
  const ch = generate(14, { kind: 'chords', seed: 1 });
  assert.deepEqual(ch.staves, ['bass'], 'left-hand chords at the left-hand chord level');
  assert.ok(ch.events.filter((e) => !e.rest).every((e) => e.midis.length === 3 && e.fingers.length === 3));
  // The last chord is in root position.
  const last = ch.events.filter((e) => !e.rest).at(-1);
  assert.equal(last.midis[0] % 12, ch.key.tonicPc);
});
