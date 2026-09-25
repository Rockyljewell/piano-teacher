// Music theory helpers: note spelling, keys, scales, chords, staff positions.

export const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC = [0, 2, 4, 5, 7, 9, 11];
export const PC_NAMES_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const PC_NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export function midiToFreq(m, a4 = 440) {
  return a4 * Math.pow(2, (m - 69) / 12);
}

export function isBlack(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

// Keys by number of fifths (-7 .. 7).
export const MAJOR_KEYS = {
  '-7': 'C♭', '-6': 'G♭', '-5': 'D♭', '-4': 'A♭', '-3': 'E♭', '-2': 'B♭', '-1': 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F♯', 7: 'C♯',
};
export const MINOR_KEYS = {
  '-7': 'A♭', '-6': 'E♭', '-5': 'B♭', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D',
  0: 'A', 1: 'E', 2: 'B', 3: 'F♯', 4: 'C♯', 5: 'G♯', 6: 'D♯', 7: 'A♯',
};

// Order in which sharps/flats are added in a key signature (as step indices).
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

export class Key {
  constructor(fifths = 0, mode = 'major') {
    this.fifths = fifths;
    this.mode = mode;
    // Alteration of each diatonic step in this key signature.
    this.alter = [0, 0, 0, 0, 0, 0, 0];
    if (fifths > 0) for (let i = 0; i < fifths; i++) this.alter[SHARP_ORDER[i]] = 1;
    if (fifths < 0) for (let i = 0; i < -fifths; i++) this.alter[FLAT_ORDER[i]] = -1;
    // Tonic step: major tonic is fifths*4 steps from C (a fifth = 4 steps).
    const majorTonicStep = (((fifths * 4) % 7) + 7) % 7;
    this.tonicStep = mode === 'major' ? majorTonicStep : (majorTonicStep + 5) % 7;
    this.tonicPc = (STEP_PC[this.tonicStep] + this.alter[this.tonicStep] + 12) % 12;
  }

  get name() {
    return `${(this.mode === 'major' ? MAJOR_KEYS : MINOR_KEYS)[this.fifths]} ${this.mode}`;
  }

  // Pitch classes of the scale degrees 1..7 (index 0..6). Minor uses natural minor.
  scalePcs() {
    const pcs = [];
    for (let i = 0; i < 7; i++) {
      const step = (this.tonicStep + i) % 7;
      pcs.push((STEP_PC[step] + this.alter[step] + 12) % 12);
    }
    return pcs;
  }

  // Degree (0-based) -> midi in the octave starting at `baseMidi`'s tonic at or below it.
  degreeToMidi(degree, octaveTonicMidi) {
    const pcs = this.scalePcs();
    const oct = Math.floor(degree / 7);
    const d = ((degree % 7) + 7) % 7;
    let semis = (pcs[d] - this.tonicPc + 12) % 12;
    return octaveTonicMidi + oct * 12 + semis;
  }

  // Tonic midi in the octave containing/above `near`.
  tonicNear(near) {
    let m = near - (((near - this.tonicPc) % 12) + 12) % 12;
    return m;
  }

  inKey(midi) {
    return this.scalePcs().includes(((midi % 12) + 12) % 12);
  }

  // Spell a midi note in this key: {step (0-6), octave, alter}.
  spell(midi, preferFlat) {
    const pc = ((midi % 12) + 12) % 12;
    // Diatonic spelling first.
    for (let step = 0; step < 7; step++) {
      const alt = this.alter[step];
      if ((STEP_PC[step] + alt + 12) % 12 === pc) {
        const octave = Math.floor((midi - alt) / 12) - 1;
        return { step, alter: alt, octave };
      }
    }
    // Chromatic: raise the lower step (sharp keys) or lower the upper step (flat keys).
    const flat = preferFlat ?? this.fifths < 0;
    for (let step = 0; step < 7; step++) {
      const natural = STEP_PC[step];
      const alt = flat ? -1 : 1;
      if ((natural + alt + 12) % 12 === pc) {
        const octave = Math.floor((midi - alt) / 12) - 1;
        return { step, alter: alt, octave };
      }
    }
    // Fallback (e.g. natural sign needed): use a natural step.
    for (let step = 0; step < 7; step++)
      if (STEP_PC[step] === pc) return { step, alter: 0, octave: Math.floor(midi / 12) - 1 };
    return { step: 0, alter: 0, octave: 4 };
  }
}

// Diatonic staff position: C0 = 0, each step +1. Middle C (C4) = 28.
export function diatonic(sp) {
  return sp.octave * 7 + sp.step;
}

export function noteName(midi, key) {
  const sp = (key || new Key(0)).spell(midi);
  const acc = sp.alter === 1 ? '♯' : sp.alter === -1 ? '♭' : sp.alter === 2 ? '𝄪' : sp.alter === -2 ? '𝄫' : '';
  return `${STEP_NAMES[sp.step]}${acc}${sp.octave}`;
}

export function pcName(midi, key) {
  return noteName(midi, key).replace(/-?\d+$/, '');
}

// Midi number of a diatonic staff position (see diatonic()) in a key, e.g. 28 -> C4 (60).
export function diatonicToMidi(d, key) {
  const step = ((d % 7) + 7) % 7;
  const octave = Math.floor(d / 7);
  return (octave + 1) * 12 + STEP_PC[step] + ((key && key.alter[step]) || 0);
}

const ORD = ['', '', 'second ', 'third ', 'fourth '];
// Where a note sits relative to middle C, for beginners: "middle C", "the G above middle C",
// "the second C below middle C". Null when it is more than four octaves away.
export function middleCRelative(midi, key) {
  if (midi === 60) return 'middle C';
  const letter = pcName(midi, key);
  // How many notes with this name lie between middle C and this note (inclusive)?
  const n = midi > 60 ? Math.ceil((midi - 60) / 12) : Math.ceil((60 - midi) / 12);
  if (n > 4) return null;
  return `the ${ORD[n]}${letter} ${midi > 60 ? 'above' : 'below'} middle C`;
}

// Spoken letter name: "F sharp", "B flat" (text-to-speech reads ♯/♭ unreliably).
export function spokenPc(midi, key) {
  return pcName(midi, key).replace('♯', ' sharp').replace('♭', ' flat').replace('𝄪', ' double sharp').replace('𝄫', ' double flat');
}

// A name a student can find on screen: "C3 (the C below middle C)" for beginners, "F♯4" later.
export function findableName(midi, key, level = 99) {
  const n = noteName(midi, key);
  if (midi === 60) return `middle C (${n})`;
  if (level > 8) return n;
  const rel = middleCRelative(midi, key);
  return rel ? `${n} (${rel})` : n;
}

// A name for speech: "middle C", "the C below middle C", or later "F sharp".
export function spokenName(midi, key, level = 99) {
  if (midi === 60) return 'middle C';
  if (level <= 8) {
    const rel = middleCRelative(midi, key);
    if (rel) return rel.replace(/♯/g, ' sharp').replace(/♭/g, ' flat');
  }
  return spokenPc(midi, key);
}

// Chord qualities as semitone stacks.
export const CHORDS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  hdim7: [0, 3, 6, 10],
};

// Diatonic triad (or 7th) on a scale degree, as midi notes, root position, root >= low.
export function diatonicChord(key, degree, rootMidiNear, size = 3) {
  const tonic = key.tonicNear(rootMidiNear);
  const notes = [];
  for (let i = 0; i < size; i++) notes.push(key.degreeToMidi(degree + 2 * i, tonic));
  // Move so the root is close to rootMidiNear.
  while (notes[0] < rootMidiNear - 6) for (let i = 0; i < notes.length; i++) notes[i] += 12;
  while (notes[0] > rootMidiNear + 6) for (let i = 0; i < notes.length; i++) notes[i] -= 12;
  return notes;
}

export function invert(notes, inversion) {
  const n = [...notes];
  for (let i = 0; i < inversion; i++) n.push(n.shift() + 12);
  return n;
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export function romanFor(key, degree) {
  const pcs = key.scalePcs();
  const third = (pcs[(degree + 2) % 7] - pcs[degree] + 12) % 12;
  const fifth = (pcs[(degree + 4) % 7] - pcs[degree] + 12) % 12;
  let r = ROMAN[degree];
  if (third === 3) r = r.toLowerCase();
  if (fifth === 6) r += '°';
  return r;
}

// Name the chord formed by a set of midi notes (e.g. "C", "Am7", "G/B"), or null.
const CHORD_NAMES = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['°', [0, 3, 6]], ['+', [0, 4, 8]],
  ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['ø7', [0, 3, 6, 10]], ['°7', [0, 3, 6, 9]],
  ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]],
  ['7', [0, 4, 10]], ['maj7', [0, 4, 11]], ['m7', [0, 3, 10]], ['5', [0, 7]],
];
export function chordName(midis, key) {
  if (!midis || midis.length < 2) return null;
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))];
  if (pcs.length < 2) return null;
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  const flat = key ? key.fifths < 0 : false;
  const names = flat ? PC_NAMES_FLAT : PC_NAMES_SHARP;
  for (const [suffix, iv] of CHORD_NAMES) {
    if (iv.length !== pcs.length) continue;
    for (const root of pcs) {
      const set = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b);
      if (set.every((x, i) => x === iv[i])) {
        return `${names[root]}${suffix}${root !== bass ? '/' + names[bass] : ''}`;
      }
    }
  }
  return null;
}
