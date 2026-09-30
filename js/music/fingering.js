// Scale fingering for every key, both hands: which finger plays each note going up and going
// down, and where the thumb tucks under or a finger crosses over it.
//
// Fingerings depend on where the black keys fall, so they are keyed by the pitch class of the
// tonic (F♯ and G♭ are the same keys on the piano, so they share fingers). Each table entry is
// the ONE-octave ascending fingering, eight notes from the tonic to the tonic. Descending is the
// same list read backwards. Harmonic minor raises the 7th but uses the same fingers.
//
// Sources: the standard fingerings in ABRSM-style scale charts (for example pianoscales.org).
// tests/fingering.test.js checks every entry against the physical rules in `validStep`.
import { Key } from './theory.js';

const RW = [1, 2, 3, 1, 2, 3, 4, 5]; // right hand, the "white-key" pattern (C, G, D, A, E, B; A, E, B, D, G, C minor)
const LW = [5, 4, 3, 2, 1, 3, 2, 1]; // left hand, the same

// Tonic pitch class (0 = C ... 11 = B) -> one-octave ascending fingers.
export const MAJOR = {
  R: { 0: RW, 1: [2, 3, 1, 2, 3, 4, 1, 2], 2: RW, 3: [3, 1, 2, 3, 4, 1, 2, 3], 4: RW, 5: [1, 2, 3, 4, 1, 2, 3, 4], 6: [2, 3, 4, 1, 2, 3, 1, 2], 7: RW, 8: [3, 4, 1, 2, 3, 1, 2, 3], 9: RW, 10: [4, 1, 2, 3, 1, 2, 3, 4], 11: RW },
  L: { 0: LW, 1: [3, 2, 1, 4, 3, 2, 1, 3], 2: LW, 3: [3, 2, 1, 4, 3, 2, 1, 3], 4: LW, 5: LW, 6: [4, 3, 2, 1, 3, 2, 1, 4], 7: LW, 8: [3, 2, 1, 4, 3, 2, 1, 3], 9: LW, 10: [3, 2, 1, 4, 3, 2, 1, 3], 11: [4, 3, 2, 1, 4, 3, 2, 1] },
};
export const MINOR = {
  R: { 0: RW, 1: [3, 4, 1, 2, 3, 1, 2, 3], 2: RW, 3: [3, 1, 2, 3, 4, 1, 2, 3], 4: RW, 5: [1, 2, 3, 4, 1, 2, 3, 4], 6: [2, 3, 1, 2, 3, 1, 2, 3], 7: RW, 8: [3, 4, 1, 2, 3, 1, 2, 3], 9: RW, 10: [2, 1, 2, 3, 1, 2, 3, 4], 11: RW },
  L: { 0: LW, 1: [3, 2, 1, 4, 3, 2, 1, 3], 2: LW, 3: [2, 1, 4, 3, 2, 1, 3, 2], 4: LW, 5: LW, 6: [4, 3, 2, 1, 3, 2, 1, 4], 7: LW, 8: [3, 2, 1, 3, 2, 1, 4, 3], 9: LW, 10: [2, 1, 3, 2, 1, 4, 3, 2], 11: [4, 3, 2, 1, 4, 3, 2, 1] },
};

const isBlackPc = (pc) => [1, 3, 6, 8, 10].includes(((pc % 12) + 12) % 12);

// May finger `b` follow finger `a` on the next higher note of a scale? Fingers step outward one
// at a time; to keep going the thumb tucks under (right hand going up) or a finger crosses
// over the thumb (left hand going up).
export function validStep(hand, a, b) {
  if (hand === 'R') return b === a + 1 || (b === 1 && a >= 2 && a <= 4);
  return b === a - 1 || (a === 1 && (b === 3 || b === 4));
}

// Ascending fingers for `octaves` octaves (8 notes for 1, 15 for 2, ...), or null when the key
// has no table entry or the pattern cannot repeat in the next octave.
export function scaleFingers(key, hand, octaves = 1) {
  const table = key.mode === 'minor' ? MINOR : MAJOR;
  const one = table[hand] && table[hand][key.tonicPc];
  if (!one) return null;
  if (octaves <= 1) return [...one];
  // After the first octave the tonic takes the finger that keeps the pattern going: its own
  // starting finger or the finger that ended the first octave, whichever fits on both sides.
  const head = one.slice(0, 7);
  const mid = [one[0], one[7]].find((m) => validStep(hand, one[6], m) && validStep(hand, m, one[1]));
  if (mid == null) return null;
  const cycle = [mid, ...one.slice(1, 7)];
  const out = [...head];
  for (let o = 1; o < octaves; o++) out.push(...cycle);
  out.push(one[7]);
  return out;
}

// The moments in a run of fingers where the hand has to move: [{ at, finger, to, kind }].
//   at      index of the note the moved finger lands on
//   finger  the finger that stays put (the thumb tucks under it / the finger crosses over it)
//   to      the finger that plays the note at `at`
//   kind    'under' (the thumb passes under) or 'over' (a finger crosses over the thumb)
// `fingers` lists the fingers in playing order; `dir` is 'up' or 'down' (the notes' direction).
export function crossings(fingers, hand, dir) {
  // Moving away from the thumb is the normal step: right hand up (1 2 3...) or left hand down,
  // fingers count up; right hand down or left hand up, they count down. Anything else is the
  // thumb tucking under or a finger crossing over it.
  const step = (hand === 'R') === (dir === 'up') ? 1 : -1;
  const out = [];
  for (let i = 0; i + 1 < fingers.length; i++) {
    const a = fingers[i];
    const b = fingers[i + 1];
    if (b === a + step) continue;
    const thumbLands = b === 1;
    out.push({ at: i + 1, finger: thumbLands ? a : 1, to: b, kind: thumbLands ? 'under' : 'over' });
  }
  return out;
}

// Does this ascending fingering obey the physical rules? Returns a list of problems (empty = fine).
// `midis` are the notes played, to check the thumb and pinky never land on a black key.
export function checkFingering(midis, fingers, hand) {
  const bad = [];
  if (midis.length !== fingers.length) return [`length ${fingers.length} for ${midis.length} notes`];
  for (let i = 0; i < fingers.length; i++) {
    if (!(fingers[i] >= 1 && fingers[i] <= 5)) bad.push(`note ${i}: finger ${fingers[i]}`);
    if ((fingers[i] === 1 || fingers[i] === 5) && isBlackPc(midis[i])) bad.push(`note ${i}: finger ${fingers[i]} on a black key`);
    if (i > 0 && !validStep(hand, fingers[i - 1], fingers[i])) bad.push(`note ${i}: ${fingers[i - 1]} -> ${fingers[i]}`);
  }
  // A run of neighbouring fingers must fit under one hand: at most five notes.
  let run = 1;
  for (let i = 1; i < fingers.length; i++) {
    run = Math.abs(fingers[i] - fingers[i - 1]) === 1 ? run + 1 : 1;
    if (run > 5) bad.push(`note ${i}: run longer than five fingers`);
  }
  return bad;
}

export function keyOf(spec) {
  return spec instanceof Key ? spec : new Key(spec.f ?? spec.fifths ?? 0, spec.m ?? spec.mode ?? 'major');
}
