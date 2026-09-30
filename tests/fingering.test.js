// Scale fingering for every key: physically playable, standard where it is well known, and
// the thumb-under / cross-over points found in the right places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Key } from '../js/music/theory.js';
import { scaleFingers, crossings, checkFingering, validStep, MAJOR, MINOR } from '../js/music/fingering.js';

// The notes of a scale from the tonic near middle C (harmonic minor raises the 7th).
function notes(key, octaves) {
  const t = key.tonicNear(60);
  const up = [];
  for (let d = 0; d <= 7 * octaves; d++) up.push(key.degreeToMidi(d, t));
  if (key.mode !== 'minor') return up;
  const seventh = key.scalePcs()[6];
  return up.map((m) => (((m % 12) + 12) % 12 === seventh ? m + 1 : m));
}
const KEYS = [];
for (const mode of ['major', 'minor']) for (let f = -7; f <= 7; f++) KEYS.push(new Key(f, mode));

test('every key has a one-octave fingering for each hand that obeys the physical rules', () => {
  for (const key of KEYS) {
    for (const hand of ['R', 'L']) {
      const f = scaleFingers(key, hand, 1);
      assert.ok(f && f.length === 8, `${key.name} ${hand}`);
      assert.deepEqual(checkFingering(notes(key, 1), f, hand), [], `${key.name} ${hand}: ${f.join(' ')}`);
    }
  }
});

test('the tables cover all twelve tonics for major and minor, both hands', () => {
  for (const t of [MAJOR, MINOR]) for (const hand of ['R', 'L']) assert.deepEqual(Object.keys(t[hand]).map(Number).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('well-known fingerings', () => {
  const f = (fifths, mode, hand) => scaleFingers(new Key(fifths, mode), hand, 1).join(' ');
  assert.equal(f(0, 'major', 'R'), '1 2 3 1 2 3 4 5'); // C
  assert.equal(f(0, 'major', 'L'), '5 4 3 2 1 3 2 1');
  assert.equal(f(1, 'major', 'R'), '1 2 3 1 2 3 4 5'); // G
  assert.equal(f(1, 'major', 'L'), '5 4 3 2 1 3 2 1');
  assert.equal(f(-1, 'major', 'R'), '1 2 3 4 1 2 3 4'); // F: thumb after the fourth finger
  assert.equal(f(-1, 'major', 'L'), '5 4 3 2 1 3 2 1');
  assert.equal(f(-2, 'major', 'R'), '4 1 2 3 1 2 3 4'); // B flat
  assert.equal(f(-2, 'major', 'L'), '3 2 1 4 3 2 1 3');
  assert.equal(f(6, 'major', 'R'), '2 3 4 1 2 3 1 2'); // F sharp
  assert.equal(f(6, 'major', 'L'), '4 3 2 1 3 2 1 4');
  assert.equal(f(5, 'major', 'L'), '4 3 2 1 4 3 2 1'); // B
  assert.equal(f(0, 'minor', 'R'), '1 2 3 1 2 3 4 5'); // A minor
  assert.equal(f(-5, 'minor', 'R'), '2 1 2 3 1 2 3 4'); // B flat minor
  assert.equal(f(-5, 'minor', 'L'), '2 1 3 2 1 4 3 2');
  // Enharmonic keys share fingers: they are the same keys on the piano.
  for (const hand of ['R', 'L']) {
    assert.equal(f(6, 'major', hand), f(-6, 'major', hand));
    assert.equal(f(7, 'major', hand), f(-5, 'major', hand));
    assert.equal(f(-7, 'major', hand), f(5, 'major', hand));
  }
});

test('the thumb never lands on a black key, in any key, either hand, going up or down', () => {
  for (const key of KEYS) {
    for (const hand of ['R', 'L']) {
      const up = notes(key, 1);
      const f = scaleFingers(key, hand, 1);
      up.forEach((m, i) => f[i] === 1 && assert.ok(![1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12), `${key.name} ${hand}: thumb on ${m}`));
    }
  }
});

test('two-octave fingering repeats the pattern and stays valid (or is withheld)', () => {
  let given = 0;
  for (const key of KEYS) {
    for (const hand of ['R', 'L']) {
      const f = scaleFingers(key, hand, 2);
      if (!f) continue;
      given++;
      assert.equal(f.length, 15);
      assert.deepEqual(checkFingering(notes(key, 2), f, hand), [], `${key.name} ${hand} x2: ${f.join(' ')}`);
    }
  }
  assert.ok(given >= KEYS.length * 2 - 4, `${given} two-octave fingerings`);
  // C major: the classic two-octave fingerings.
  assert.equal(scaleFingers(new Key(0), 'R', 2).join(' '), '1 2 3 1 2 3 4 1 2 3 1 2 3 4 5');
  assert.equal(scaleFingers(new Key(0), 'L', 2).join(' '), '5 4 3 2 1 3 2 1 4 3 2 1 3 2 1');
});

test('crossings: right hand up tucks the thumb under, left hand up crosses over it', () => {
  const C = new Key(0);
  const rUp = scaleFingers(C, 'R', 1);
  assert.deepEqual(crossings(rUp, 'R', 'up'), [{ at: 3, finger: 3, to: 1, kind: 'under' }]); // after 1 2 3 the thumb tucks under 3
  const lUp = scaleFingers(C, 'L', 1);
  assert.deepEqual(crossings(lUp, 'L', 'up'), [{ at: 5, finger: 1, to: 3, kind: 'over' }]); // after 5 4 3 2 1 finger 3 crosses over
  // Coming back down it is the other way round.
  const rDown = [...rUp].reverse();
  assert.deepEqual(crossings(rDown, 'R', 'down'), [{ at: 5, finger: 1, to: 3, kind: 'over' }]);
  const lDown = [...lUp].reverse();
  assert.deepEqual(crossings(lDown, 'L', 'down'), [{ at: 3, finger: 3, to: 1, kind: 'under' }]);
  // F major, right hand: the thumb tucks under the fourth finger, both times.
  const F = scaleFingers(new Key(-1), 'R', 1);
  assert.deepEqual(crossings(F, 'R', 'up').map((c) => [c.finger, c.kind]), [[4, 'under']]);
  // B flat minor, right hand, starts with the thumb tucking under the second finger.
  const Bbm = scaleFingers(new Key(-5, 'minor'), 'R', 1);
  assert.deepEqual(crossings(Bbm, 'R', 'up')[0], { at: 1, finger: 2, to: 1, kind: 'under' });
  // Two hands going up in C: exactly one move each per octave, never more than two moves per octave.
  for (const key of KEYS) for (const hand of ['R', 'L']) {
    const n = crossings(scaleFingers(key, hand, 1), hand, 'up').length;
    assert.ok(n >= 1 && n <= 2, `${key.name} ${hand}: ${n} moves`);
  }
});

test('validStep: the rules of the hand', () => {
  assert.ok(validStep('R', 3, 1) && validStep('R', 4, 1) && validStep('R', 1, 2));
  assert.ok(!validStep('R', 5, 1) && !validStep('R', 1, 3) && !validStep('R', 3, 3));
  assert.ok(validStep('L', 1, 3) && validStep('L', 1, 4) && validStep('L', 5, 4));
  assert.ok(!validStep('L', 1, 5) && !validStep('L', 2, 5));
});
