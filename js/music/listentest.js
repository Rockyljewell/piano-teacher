// The listening test: a short fixed piece that exercises everything the listener must get right
// (single notes in both hands, triads, four-note chords, both-hands chords, octaves, an octave
// melody, fast repeated notes, a fast run, low bass, high treble and a big final chord). Played in
// tempo mode while the microphone is recorded, it gives a ground-truth recording of the
// student's own piano, iPad and room: exactly what the offline benchmark cannot simulate.
import { Key } from './theory.js';
import { TIME_SIGS, finish } from './generator.js';

// [beat, dur, hand, midis, fingers?] — 4/4, beats from 0.
const C = 60;
const BARS = [
  // 1-2: right hand up the C scale, left hand answers down
  [0, 1, 'R', [C]], [1, 1, 'R', [C + 2]], [2, 1, 'R', [C + 4]], [3, 1, 'R', [C + 5]],
  [4, 1, 'L', [55]], [5, 1, 'L', [53]], [6, 1, 'L', [52]], [7, 1, 'L', [48]],
  // 3: right-hand triads (root position, then first inversion)
  [8, 2, 'R', [C, C + 4, C + 7]], [10, 2, 'R', [C + 4, C + 7, C + 12]],
  // 4: a four-note chord, then an octave
  [12, 2, 'R', [C, C + 4, C + 7, C + 12]], [14, 2, 'R', [C, C + 12]],
  // 5: both hands together
  [16, 2, 'L', [48, 55]], [16, 2, 'R', [C + 4, C + 7, C + 12]],
  [18, 2, 'L', [41, 48]], [18, 2, 'R', [C + 5, C + 9, C + 12]],
  // 6: melody doubled in octaves
  [20, 1, 'R', [C + 7, C + 19]], [21, 1, 'R', [C + 5, C + 17]], [22, 1, 'R', [C + 4, C + 16]], [23, 1, 'R', [C + 2, C + 14]],
  // 7: fast repeated notes (eighths)
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [24 + i * 0.5, 0.5, 'R', [C + 7]]),
  // 8: a fast run down (eighths) and back to C
  ...[12, 11, 9, 7, 5, 4, 2, 0].map((d, i) => [28 + i * 0.5, 0.5, 'R', [C + d]]),
  // 9: low bass and high treble
  [32, 2, 'L', [36]], [34, 2, 'R', [C + 24]],
  // 10: left-hand chord under a right-hand melody
  [36, 4, 'L', [43, 47, 50]], [36, 1, 'R', [C + 11]], [37, 1, 'R', [C + 14]], [38, 1, 'R', [C + 17]], [39, 1, 'R', [C + 19]],
  // 11: a soft chord and a single note after it (quiet playing)
  [40, 2, 'R', [C + 2, C + 5, C + 9]], [42, 2, 'R', [C + 7]],
  // 12: big final chord, both hands
  [44, 4, 'L', [36, 43, 48]], [44, 4, 'R', [C + 4, C + 7, C + 12, C + 16]],
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
    level: 6,
    kind: 'listentest',
    title: 'Listening test',
    key: new Key(0),
    ts: TIME_SIGS['4/4'],
    tsName: '4/4',
    bpm: 72,
    measures: 12,
    beatsPer: 4,
    staves: ['treble', 'bass'],
    events,
    harmony: [],
  };
  return finish(p, { level: 6 });
}
