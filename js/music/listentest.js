// The listening test: a short, easy piece (both hands in C position, slow, played in wait mode
// so there is no time pressure) that still covers what the listener must get right: single
// notes in both hands, a repeated note, two-note chords, a three-note chord and both hands
// together. Played while the microphone is recorded, it gives a ground-truth recording of the
// student's own piano, iPad and room: exactly what the offline benchmark cannot simulate.
import { Key } from './theory.js';
import { TIME_SIGS, finish } from './generator.js';

// [beat, dur, hand, midis] - 4/4, beats from 0. Right hand C4-G4, left hand C3-G3.
const C = 60;
const BARS = [
  // 1-2: right hand up C D E F, then G held and G again (a repeated note)
  [0, 1, 'R', [C]], [1, 1, 'R', [C + 2]], [2, 1, 'R', [C + 4]], [3, 1, 'R', [C + 5]],
  [4, 2, 'R', [C + 7]], [6, 2, 'R', [C + 7]],
  // 3-4: left hand C D E F, then G held
  [8, 1, 'L', [48]], [9, 1, 'L', [50]], [10, 1, 'L', [52]], [11, 1, 'L', [53]],
  [12, 4, 'L', [55]],
  // 5: right-hand two-note chords
  [16, 2, 'R', [C, C + 4]], [18, 2, 'R', [C + 4, C + 7]],
  // 6: right-hand C major chord
  [20, 4, 'R', [C, C + 4, C + 7]],
  // 7: hands together
  [24, 2, 'L', [48]], [24, 2, 'R', [C + 4]], [26, 2, 'L', [55]], [26, 2, 'R', [C + 7]],
  // 8: both Cs together to finish
  [28, 4, 'L', [48]], [28, 4, 'R', [C]],
];

export function listeningTestPiece() {
  let id = 0;
  const events = BARS.map(([beat, dur, hand, midis]) => ({
    id: id++,
    staff: hand === 'L' ? 'bass' : 'treble',
    hand,
    beat,
    dur,
    midis: [...midis].sort((a, b) => a - b),
    rest: false,
  }));
  const p = {
    seed: 0,
    level: 2,
    kind: 'listentest',
    title: 'Listening test',
    key: new Key(0),
    ts: TIME_SIGS['4/4'],
    tsName: '4/4',
    bpm: 60,
    measures: 8,
    beatsPer: 4,
    staves: ['treble', 'bass'],
    events,
    harmony: [],
  };
  return finish(p, { level: 2 });
}
