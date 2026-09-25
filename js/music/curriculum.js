// The curriculum: 40 levels from first notes to virtuoso playing. Each level is a recipe the
// procedural generator turns into endless fresh exercises, plus the teaching text that
// introduces its new concept.
//
// Pitch ranges are MIDI numbers (60 = middle C). Rhythm weights refer to cells in generator.js.

const C4 = 60;

export const STAGES = [
  { name: 'Beginner', from: 1, to: 8 },
  { name: 'Elementary', from: 9, to: 16 },
  { name: 'Intermediate', from: 17, to: 26 },
  { name: 'Advanced', from: 27, to: 34 },
  { name: 'Master', from: 35, to: 40 },
];

const K = (fifths, mode = 'major') => [fifths, mode];

export const LEVELS = [
  {
    title: 'Middle C position: right hand',
    concept:
      'Find middle C: the white key just to the left of the two black keys closest to the middle of your piano. Put your right thumb (finger 1) on C, then let fingers 2, 3, 4 and 5 rest on D, E, F and G. Each note sits on a line or space of the treble staff. When a note reaches the glowing line, play it.',
    tips: ['Keep your fingers curved, as if holding a small ball.', 'Look at the music, not your hands. Your fingers already know their keys.'],
    hands: 'R', keys: [K(0)], time: ['4/4'], bpm: [56, 66], measures: 4,
    rh: { lo: C4, hi: C4 + 7, motion: { step: 8, repeat: 2, skip: 0 }, rhythm: { w: 1, h: 4, q: 4 } },
    fingers: true, rests: 0,
  },
  {
    title: 'Steps, skips and rests',
    concept:
      'Notes that move from a line to the next space (or space to line) are STEPS: play the neighbouring key. Line to line or space to space is a SKIP: jump over one key. A rest is a moment of silence: lift your hand and count.',
    tips: ['Say the finger numbers out loud as you play.', 'Rests count too. Keep your internal beat going.'],
    hands: 'R', keys: [K(0)], time: ['4/4'], bpm: [60, 72], measures: 4,
    rh: { lo: C4, hi: C4 + 7, motion: { step: 6, skip: 3, repeat: 1 }, rhythm: { h: 3, q: 5 } },
    fingers: true, rests: 0.08,
  },
  {
    title: 'Left hand C position',
    concept:
      'Your left hand reads the BASS clef. Put your left pinky (finger 5) on the C one octave below middle C, and fingers 4, 3, 2, 1 on D, E, F, G. In the left hand, the thumb is finger 1 too, but it is at the top.',
    tips: ['The bass clef\'s two dots wrap around the F line.', 'Your left hand is often weaker. Give it extra attention!'],
    hands: 'L', keys: [K(0)], time: ['4/4'], bpm: [56, 66], measures: 4,
    lh: { style: 'melody', lo: 48, hi: 55, motion: { step: 7, skip: 2, repeat: 1 }, rhythm: { w: 1, h: 4, q: 4 } },
    fingers: true, rests: 0.05,
  },
  {
    title: 'Hands take turns',
    concept:
      'Now the melody passes between your hands: the right hand plays on the treble staff and the left hand plays on the bass staff. Keep both hands resting in C position so each is ready for its turn.',
    tips: ['While one hand plays, get the other one ready over its keys.'],
    hands: 'alt', keys: [K(0)], time: ['4/4'], bpm: [60, 72], measures: 4,
    rh: { lo: C4, hi: C4 + 7, motion: { step: 6, skip: 3, repeat: 1 }, rhythm: { h: 3, q: 5 } },
    lh: { style: 'melody', lo: 48, hi: 55, motion: { step: 6, skip: 3, repeat: 1 }, rhythm: { h: 3, q: 5 } },
    fingers: true, rests: 0.05,
  },
  {
    title: 'Three-four time',
    concept:
      'A 3/4 time signature means three beats in each measure: count "1 2 3, 1 2 3", like a waltz. A dotted half note lasts all three beats.',
    tips: ['Lean slightly into beat 1 of every measure.'],
    hands: 'alt', keys: [K(0)], time: ['3/4'], bpm: [66, 80], measures: 4,
    rh: { lo: C4, hi: C4 + 7, motion: { step: 6, skip: 3, repeat: 1 }, rhythm: { dh: 2, h: 3, q: 5 } },
    lh: { style: 'melody', lo: 48, hi: 55, motion: { step: 6, skip: 3, repeat: 1 }, rhythm: { dh: 2, h: 3, q: 5 } },
    fingers: true, rests: 0.05,
  },
  {
    title: 'Hands together: long bass notes',
    concept:
      'Your first hands-together playing! The left hand holds long notes (C and G) while the right hand plays the melody. Play notes that line up vertically at exactly the same time.',
    tips: ['Practise the left hand alone once, then add the right.', 'Both hands press down together, like one hand.'],
    hands: 'both', keys: [K(0)], time: ['4/4', '3/4'], bpm: [54, 66], measures: 4,
    rh: { lo: C4, hi: C4 + 7, motion: { step: 6, skip: 3, repeat: 1 }, rhythm: { h: 3, q: 5 } },
    lh: { style: 'pedal', lo: 43, hi: 55 },
    fingers: true, rests: 0.03,
  },
  {
    title: 'Eighth notes',
    concept:
      'An eighth note is half a beat: two eighths fit in one beat. Count "1 and 2 and 3 and 4 and". Beamed eighths are played evenly, like a gentle trot.',
    tips: ['Tap the beat with your foot while counting the "ands".'],
    hands: 'both', keys: [K(0)], time: ['4/4', '3/4'], bpm: [60, 72], measures: 4,
    rh: { lo: C4, hi: C4 + 7, motion: { step: 7, skip: 3, repeat: 1 }, rhythm: { h: 2, q: 5, ee: 3 } },
    lh: { style: 'pedal', lo: 43, hi: 55 },
    fingers: true, rests: 0.04,
  },
  {
    title: 'G position and F sharp',
    concept:
      'Move both hands up to G position: right thumb on the G above middle C, left pinky on the G below it. The key signature has one sharp (♯) on the F line. That means every F is played as F♯, the black key just to the right of F.',
    tips: ['Look for the key signature at the start of each line before you play.'],
    hands: 'both', keys: [K(1)], time: ['4/4', '3/4'], bpm: [60, 72], measures: 4,
    rh: { lo: 67, hi: 74, motion: { step: 7, skip: 3, repeat: 1 }, rhythm: { h: 3, q: 5, ee: 2 } },
    lh: { style: 'pedal', lo: 43, hi: 55 },
    fingers: true, rests: 0.04,
  },
  // ---- Elementary -----------------------------------------------------------------------------
  {
    title: 'Melodies across both hands',
    concept:
      'Melodies can travel from the treble staff into the bass staff and back. Middle C is shared: it sits on a small ledger line between the staves.',
    tips: ['Stay relaxed at the handover. Don\'t rush the other hand in.'],
    hands: 'alt', keys: [K(0), K(1)], time: ['4/4', '3/4'], bpm: [66, 80], measures: 6,
    rh: { lo: 60, hi: 72, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 2, q: 5, ee: 3 } },
    lh: { style: 'melody', lo: 45, hi: 60, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 2, q: 5, ee: 3 } },
    fingers: false, rests: 0.05,
  },
  {
    title: 'Harmonic intervals',
    concept:
      'Two notes stacked on top of each other are played together as an INTERVAL. Thirds look like a snowman (line-line or space-space); fifths skip one more. Press both keys at exactly the same time.',
    tips: ['Balance the two notes: neither should be louder.'],
    hands: 'both', keys: [K(0), K(1)], time: ['4/4', '3/4'], bpm: [60, 72], measures: 4,
    rh: { lo: 60, hi: 72, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 3, q: 5, ee: 2 }, chords: 0.3, chordSize: 2 },
    lh: { style: 'roots', lo: 41, hi: 55 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'F major and B flat',
    concept:
      'The key of F major has one flat (♭) on the B line. Every B becomes B♭, the black key just left of B. In F position, the right thumb sits on F above middle C.',
    tips: ['Watch for B♭. It is the most commonly missed note in F major.'],
    hands: 'both', keys: [K(-1), K(0), K(1)], time: ['4/4', '3/4'], bpm: [66, 80], measures: 6,
    rh: { lo: 60, hi: 74, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 2, q: 5, ee: 3 }, chords: 0.1, chordSize: 2 },
    lh: { style: 'roots', lo: 41, hi: 55 },
    fingers: false, rests: 0.05,
  },
  {
    title: 'Dotted rhythms',
    concept:
      'A dot adds half the note\'s value. A dotted quarter lasts 1½ beats and is usually followed by an eighth: "long... short". Count "1 (and) 2 and".',
    tips: ['Hold the dotted note through the "and". Don\'t clip it short.'],
    hands: 'both', keys: [K(0), K(1), K(-1)], time: ['4/4', '3/4'], bpm: [66, 80], measures: 6,
    rh: { lo: 60, hi: 74, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 2, q: 4, ee: 3, dqe: 3 } },
    lh: { style: 'fifths', lo: 41, hi: 55 },
    fingers: false, rests: 0.05,
  },
  {
    title: 'Moving around the keyboard',
    concept:
      'Real music doesn\'t stay in one five-finger position. Now melodies span more than an octave and leap up to a sixth. Look ahead so your hand can shift early.',
    tips: ['Read one or two notes ahead of the line.', 'Move your whole arm, not just your fingers.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2)], time: ['4/4', '3/4'], bpm: [66, 84], measures: 6,
    rh: { lo: 57, hi: 79, motion: { step: 5, skip: 3, leap: 2 }, rhythm: { h: 2, q: 4, ee: 4, dqe: 2 } },
    lh: { style: 'roots', lo: 38, hi: 55 },
    fingers: false, rests: 0.05,
  },
  {
    title: 'Left-hand chords',
    concept:
      'A TRIAD is three notes stacked in thirds. Here the left hand plays the I, IV and V chords, the backbone of countless songs. Chords may appear inverted (re-stacked) so your hand barely moves.',
    tips: ['Shape the chord in the air before it arrives.', 'Keep the right-hand melody singing above the chords.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2)], time: ['4/4', '3/4'], bpm: [60, 76], measures: 6,
    rh: { lo: 60, hi: 77, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 2, q: 5, ee: 3, dqe: 1 } },
    lh: { style: 'block', lo: 45, hi: 59 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Minor keys',
    concept:
      'Minor keys sound darker. A minor shares C major\'s key signature (no sharps or flats) but centres on A. D minor has one flat, E minor one sharp. Listen for the change of mood.',
    tips: ['In minor, the 7th note is often raised by an accidental (e.g. G♯ in A minor).'],
    hands: 'both', keys: [K(0, 'minor'), K(-1, 'minor'), K(1, 'minor'), K(0)], time: ['4/4', '3/4'], bpm: [66, 84], measures: 6,
    rh: { lo: 57, hi: 76, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 2, q: 4, ee: 4, dqe: 2 } },
    lh: { style: 'broken', lo: 40, hi: 57 },
    fingers: false, rests: 0.05,
  },
  {
    title: 'Scales and new keys',
    concept:
      'A scale walks through all seven notes of a key. Scales need the thumb to tuck UNDER the hand (right hand going up, left hand going down) so you never run out of fingers. D major has two sharps (F♯, C♯); B♭ major has two flats (B♭, E♭).',
    tips: ['Tuck the thumb early and smoothly: no bumps!', 'Scales are the daily vitamins of piano practice.'],
    hands: 'both', keys: [K(2), K(-2), K(1), K(-1), K(0, 'minor')], time: ['4/4'], bpm: [72, 88], measures: 6,
    rh: { lo: 60, hi: 79, motion: { step: 9, skip: 2, leap: 1 }, rhythm: { q: 3, ee: 6, h: 1 } },
    lh: { style: 'block', lo: 43, hi: 59 },
    fingers: false, rests: 0.03, technique: 'scale',
  },
  // ---- Intermediate ---------------------------------------------------------------------------
  {
    title: 'Broken chords and Alberti bass',
    concept:
      'Instead of striking a chord all at once, you can spread it out: bottom, top, middle, top. That pattern is the ALBERTI BASS, a favourite of Mozart and Haydn. Keep it light and even under the melody.',
    tips: ['Let the wrist rotate gently: don\'t lift each finger high.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2)], time: ['4/4'], bpm: [60, 80], measures: 6,
    rh: { lo: 62, hi: 81, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 2, q: 5, ee: 2, dqe: 2 } },
    lh: { style: 'alberti', lo: 43, hi: 60 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Ledger lines',
    concept:
      'Notes above and below the staff use short LEDGER LINES. Count lines and spaces up from the staff, or learn landmark notes: high C (two ledger lines above treble) and low C (two below bass).',
    tips: ['Landmarks beat counting: memorise C2, C4, C6.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2)], time: ['4/4', '3/4'], bpm: [66, 84], measures: 6,
    rh: { lo: 60, hi: 88, motion: { step: 5, skip: 3, leap: 2 }, rhythm: { h: 2, q: 4, ee: 4, dqe: 2 } },
    lh: { style: 'roots', lo: 33, hi: 55 },
    fingers: false, rests: 0.05,
  },
  {
    title: 'Sixteenth notes',
    concept:
      'Sixteenth notes are a quarter of a beat: four per beat, counted "1 e and a". They have two beams. Keep them even and close to the keys.',
    tips: ['Practise slowly first; speed comes from evenness, not effort.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2)], time: ['4/4', '2/4'], bpm: [56, 72], measures: 6,
    rh: { lo: 62, hi: 81, motion: { step: 8, skip: 2, leap: 1 }, rhythm: { q: 3, ee: 3, ssss: 2, ess: 1, sse: 1 } },
    lh: { style: 'roots', lo: 40, hi: 57 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Syncopation and ties',
    concept:
      'SYNCOPATION puts the accent between the beats: "1 and... (2) and 3". A TIE joins two notes of the same pitch: play the first and hold through the second without re-striking.',
    tips: ['Keep counting the beat you are not playing on.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(0, 'minor')], time: ['4/4'], bpm: [66, 84], measures: 6,
    rh: { lo: 62, hi: 81, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { q: 3, ee: 3, syn: 3, dqe: 2, h: 1 } },
    lh: { style: 'fifths', lo: 40, hi: 57 },
    fingers: false, rests: 0.05,
  },
  {
    title: 'Keys with three sharps or flats',
    concept:
      'A major (three sharps: F♯ C♯ G♯) and E♭ major (three flats: B♭ E♭ A♭) join the family, along with their relative minors F♯ minor and C minor.',
    tips: ['Before playing, name every sharp or flat in the key signature out loud.'],
    hands: 'both', keys: [K(3), K(-3), K(3, 'minor'), K(-3, 'minor'), K(2), K(-2)], time: ['4/4', '3/4'], bpm: [66, 88], measures: 6,
    rh: { lo: 62, hi: 81, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { q: 4, ee: 4, dqe: 2, h: 1, ssss: 1 } },
    lh: { style: 'block', lo: 43, hi: 60 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Right-hand chords',
    concept:
      'Now the right hand plays chords too, with the melody on top. Voice the top note a little louder so the tune still sings.',
    tips: ['Drop into chords from the arm, keeping fingers firm.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3)], time: ['4/4', '3/4'], bpm: [60, 80], measures: 6,
    rh: { lo: 64, hi: 84, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 3, q: 5, dqe: 1 }, chords: 0.45, chordSize: 3 },
    lh: { style: 'roots', lo: 36, hi: 55 },
    fingers: false, rests: 0.03,
  },
  {
    title: 'Triplets',
    concept:
      'A TRIPLET squeezes three equal notes into the space of two: count "1-and-a 2-and-a" or "tri-po-let". It gives music a rolling, lilting feel.',
    tips: ['Say "trip-a-let" evenly while you play.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3)], time: ['4/4'], bpm: [60, 80], measures: 6,
    rh: { lo: 62, hi: 81, motion: { step: 7, skip: 2, leap: 1 }, rhythm: { q: 4, ee: 2, trip: 3, h: 1 } },
    lh: { style: 'broken', lo: 40, hi: 59 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Independent hands',
    concept:
      'Two real melodies at once: counterpoint. Each hand has its own rhythm. Practise hands separately, then combine very slowly.',
    tips: ['Listen to both voices: neither is just accompaniment.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(0, 'minor'), K(1, 'minor')], time: ['4/4', '3/4'], bpm: [60, 80], measures: 6,
    rh: { lo: 62, hi: 81, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { q: 4, ee: 4, dqe: 1, ssss: 1 } },
    lh: { style: 'counter', lo: 40, hi: 59, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { h: 3, q: 5, dqe: 1 } },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Arpeggios and two-octave scales',
    concept:
      'An ARPEGGIO plays a chord one note at a time across the keyboard. Combined with two-octave scales, arpeggios build the reach and thumb technique every advanced piece needs.',
    tips: ['Keep the wrist level and let the thumb pass smoothly.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(0, 'minor')], time: ['4/4'], bpm: [66, 88], measures: 6,
    rh: { lo: 60, hi: 88, motion: { step: 6, skip: 5, leap: 1 }, rhythm: { ee: 5, ssss: 2, q: 2 }, arpeggio: 0.5 },
    lh: { style: 'alberti', lo: 40, hi: 60 },
    fingers: false, rests: 0.02, technique: 'arpeggio',
  },
  {
    title: 'Six-eight time',
    concept:
      'In 6/8 the eighth notes are grouped in threes: two big beats per measure, each worth a dotted quarter. Count "1-2-3 4-5-6" with a lilt, like a barcarolle.',
    tips: ['Feel two big pulses, not six small ones.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(0, 'minor'), K(-1, 'minor')], time: ['6/8'], bpm: [50, 66], measures: 6,
    rh: { lo: 62, hi: 81, motion: { step: 6, skip: 3, leap: 1 }, rhythm: { eee: 4, qe: 3, dq: 3 } },
    lh: { style: 'broken', lo: 40, hi: 59 },
    fingers: false, rests: 0.03,
  },
  // ---- Advanced -------------------------------------------------------------------------------
  {
    title: 'Seventh chords',
    concept:
      'Add another third on top of a triad and you get a SEVENTH chord: major 7, dominant 7 and minor 7. They are the colour of jazz, pop and romantic harmony.',
    tips: ['Learn to hear the difference: maj7 dreamy, dom7 restless, min7 mellow.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3)], time: ['4/4'], bpm: [66, 88], measures: 8,
    rh: { lo: 62, hi: 84, motion: { step: 5, skip: 3, leap: 2 }, rhythm: { q: 4, ee: 4, syn: 2, dqe: 2 } },
    lh: { style: 'seventh', lo: 40, hi: 60 },
    fingers: false, rests: 0.05, sevenths: true,
  },
  {
    title: 'Keys with four and five accidentals',
    concept:
      'E major, B major, A♭ major, D♭ major and their minors: more black keys means new hand shapes. The long fingers (2, 3, 4) love black keys; the thumb prefers white keys.',
    tips: ['Think in hand shapes over black-key groups, not individual notes.'],
    hands: 'both', keys: [K(4), K(5), K(-4), K(-5), K(4, 'minor'), K(-4, 'minor'), K(3), K(-3)], time: ['4/4', '3/4'], bpm: [72, 92], measures: 8,
    rh: { lo: 60, hi: 86, motion: { step: 6, skip: 3, leap: 2 }, rhythm: { q: 4, ee: 4, dqe: 2, ssss: 1, syn: 1 } },
    lh: { style: 'alberti', lo: 38, hi: 60 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Chromatic notes',
    concept:
      'Accidentals outside the key (sharps, flats and naturals written next to notes) add spice: chromatic passing tones, neighbour notes and borrowed chords. An accidental lasts until the end of its measure.',
    tips: ['Circle-scan each measure for accidentals before you play it.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(0, 'minor'), K(-1, 'minor')], time: ['4/4', '3/4'], bpm: [72, 96], measures: 8,
    rh: { lo: 60, hi: 86, motion: { step: 7, skip: 2, leap: 1 }, rhythm: { q: 3, ee: 5, ssss: 2 } },
    lh: { style: 'broken', lo: 38, hi: 60 },
    fingers: false, rests: 0.04, chromatic: 0.18,
  },
  {
    title: 'Velocity',
    concept:
      'Fast, even sixteenth-note runs. The secret is a quiet hand, fingers close to the keys and a relaxed arm. Speed is built on accuracy at slower tempos.',
    tips: ['If it\'s messy, it\'s too fast. Drop the tempo 10% and rebuild.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(4), K(-4)], time: ['4/4', '2/4'], bpm: [72, 100], measures: 8,
    rh: { lo: 60, hi: 88, motion: { step: 9, skip: 2, leap: 1 }, rhythm: { ssss: 5, ess: 2, sse: 2, ee: 2, q: 1 } },
    lh: { style: 'roots', lo: 36, hi: 57 },
    fingers: false, rests: 0.02,
  },
  {
    title: 'Octaves and wide leaps',
    concept:
      'Left-hand octaves give a powerful bass; wide right-hand leaps demand you look ahead and move early. Keep the hand shape "set" for the octave and move from the arm.',
    tips: ['Octaves: firm pinky and thumb, loose wrist.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(0, 'minor'), K(2, 'minor')], time: ['4/4', '3/4'], bpm: [66, 92], measures: 8,
    rh: { lo: 60, hi: 91, motion: { step: 4, skip: 3, leap: 4 }, rhythm: { q: 4, ee: 4, dqe: 2, h: 1 } },
    lh: { style: 'octaves', lo: 29, hi: 55 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Walking bass and swing',
    concept:
      'A walking bass steps through chord tones on every beat while the right hand plays syncopated, jazzy lines over the top.',
    tips: ['Keep the bass steady as a clock; let the right hand dance around it.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(-3)], time: ['4/4'], bpm: [80, 108], measures: 8,
    rh: { lo: 62, hi: 86, motion: { step: 5, skip: 4, leap: 2 }, rhythm: { syn: 4, ee: 4, q: 2, dqe: 2 }, chromatic: 0.1 },
    lh: { style: 'walking', lo: 36, hi: 55 },
    fingers: false, rests: 0.06, sevenths: true,
  },
  {
    title: 'Every key',
    concept:
      'All the keys, up to six and seven sharps or flats. At this point reading key signatures should be automatic. Think of the key\'s scale shape and let it guide your hand.',
    tips: ['F♯ major and G♭ major sound the same: different names for the same keys.'],
    hands: 'both', keys: [K(6), K(-6), K(5), K(-5), K(7), K(-7), K(4, 'minor'), K(-5, 'minor'), K(5, 'minor')], time: ['4/4', '3/4'], bpm: [72, 100], measures: 8,
    rh: { lo: 60, hi: 88, motion: { step: 6, skip: 3, leap: 2 }, rhythm: { q: 3, ee: 4, dqe: 2, ssss: 2, trip: 1 } },
    lh: { style: 'block', lo: 38, hi: 60 },
    fingers: false, rests: 0.04,
  },
  {
    title: 'Three against two',
    concept:
      'POLYRHYTHM: one hand plays triplets while the other plays even eighths: 3 against 2. The combined rhythm sounds like "nice cup of tea". Master it slowly!',
    tips: ['Say "nice cup-of tea": both hands on "nice", RH on "cup", LH on "of", RH on "tea".'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3)], time: ['4/4'], bpm: [50, 72], measures: 6,
    rh: { lo: 62, hi: 84, motion: { step: 7, skip: 2, leap: 1 }, rhythm: { trip: 6, q: 1 } },
    lh: { style: 'counter', lo: 38, hi: 59, motion: { step: 5, skip: 4, leap: 1 }, rhythm: { ee: 6, q: 1 } },
    fingers: false, rests: 0.02,
  },
  // ---- Master ---------------------------------------------------------------------------------
  {
    title: 'Etude: running hands',
    concept:
      'Sixteenth notes in both hands. This is the world of Czerny and Bach inventions. Evenness and clarity at speed.',
    tips: ['Practise in rhythms (long-short, short-long) to even out runs.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(4), K(-4), K(0, 'minor'), K(-1, 'minor')], time: ['4/4', '2/4'], bpm: [66, 96], measures: 8,
    rh: { lo: 60, hi: 91, motion: { step: 8, skip: 3, leap: 1 }, rhythm: { ssss: 6, ess: 1, sse: 1, ee: 1 } },
    lh: { style: 'counter', lo: 33, hi: 59, motion: { step: 7, skip: 3, leap: 1 }, rhythm: { ee: 4, ssss: 3, q: 1 } },
    fingers: false, rests: 0.02,
  },
  {
    title: 'The whole keyboard',
    concept:
      'Music that uses the full range of the instrument, from the deepest bass to the sparkling top octave, with multiple ledger lines on both staves.',
    tips: ['Sit centred on middle C and lean from the hips to reach the extremes.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(4), K(-4), K(5), K(-5)], time: ['4/4', '3/4'], bpm: [72, 100], measures: 8,
    rh: { lo: 60, hi: 100, motion: { step: 5, skip: 3, leap: 3 }, rhythm: { q: 3, ee: 4, ssss: 2, dqe: 1 } },
    lh: { style: 'octaves', lo: 24, hi: 55 },
    fingers: false, rests: 0.03, chromatic: 0.08,
  },
  {
    title: 'Dense harmony',
    concept:
      'Full four-note chords in the right hand with seventh-chord voicings in the left, the texture of romantic and jazz piano.',
    tips: ['Voice the melody (top note) forward; keep inner notes soft.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(4), K(-4)], time: ['4/4', '3/4'], bpm: [60, 84], measures: 8,
    rh: { lo: 62, hi: 91, motion: { step: 5, skip: 4, leap: 2 }, rhythm: { h: 2, q: 5, ee: 2, dqe: 1 }, chords: 0.6, chordSize: 4 },
    lh: { style: 'seventh', lo: 36, hi: 60 },
    fingers: false, rests: 0.03, sevenths: true, chromatic: 0.05,
  },
  {
    title: 'Rhythmic mastery',
    concept:
      'Everything at once: sixteenths, triplets, dotted rhythms and syncopation mixed freely. Your inner pulse must be rock solid.',
    tips: ['Subdivide in your head: always know where the next beat lands.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(4), K(-4), K(0, 'minor'), K(2, 'minor'), K(-2, 'minor')], time: ['4/4', '3/4', '6/8'], bpm: [72, 100], measures: 8,
    rh: { lo: 60, hi: 91, motion: { step: 6, skip: 3, leap: 2 }, rhythm: { q: 2, ee: 3, ssss: 2, trip: 2, dqe: 2, syn: 2, des: 2, ess: 1, sse: 1, eee: 3, qe: 2, dq: 1 } },
    lh: { style: 'alberti', lo: 33, hi: 59 },
    fingers: false, rests: 0.04, chromatic: 0.08,
  },
  {
    title: 'Presto',
    concept:
      'Fast tempos across all keys. Everything you have learned, at performance speed.',
    tips: ['Relaxation is speed. Tension is the enemy of fast playing.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(4), K(-4), K(5), K(-5), K(0, 'minor'), K(1, 'minor'), K(-1, 'minor')], time: ['4/4', '3/4'], bpm: [100, 132], measures: 8,
    rh: { lo: 60, hi: 93, motion: { step: 7, skip: 3, leap: 2 }, rhythm: { ee: 4, ssss: 3, q: 2, trip: 1 } },
    lh: { style: 'alberti', lo: 31, hi: 59 },
    fingers: false, rests: 0.02, chromatic: 0.06,
  },
  {
    title: 'Master',
    concept:
      'The summit: any key, any texture, any rhythm, at virtuoso tempos. Every exercise here is a new sight-reading challenge. Keep your streak alive!',
    tips: ['A master is a beginner who never stopped practising.'],
    hands: 'both', keys: [K(0), K(1), K(-1), K(2), K(-2), K(3), K(-3), K(4), K(-4), K(5), K(-5), K(6), K(-6), K(0, 'minor'), K(1, 'minor'), K(-1, 'minor'), K(3, 'minor'), K(-3, 'minor')], time: ['4/4', '3/4', '6/8'], bpm: [100, 144], measures: 8,
    rh: { lo: 57, hi: 96, motion: { step: 6, skip: 3, leap: 3 }, rhythm: { ee: 3, ssss: 4, trip: 2, syn: 1, dqe: 1, des: 1, eee: 2, qe: 1 }, chords: 0.15, chordSize: 3 },
    lh: { style: 'counter', lo: 28, hi: 59, motion: { step: 6, skip: 3, leap: 2 }, rhythm: { ee: 4, q: 2, ssss: 2, eee: 2, qe: 1 } },
    fingers: false, rests: 0.03, chromatic: 0.1,
  },
].map((l, i) => ({ ...l, n: i + 1 }));

export function levelInfo(n) {
  const lv = LEVELS[Math.max(1, Math.min(LEVELS.length, n)) - 1];
  const stage = STAGES.find((s) => lv.n >= s.from && lv.n <= s.to);
  return { ...lv, stage: stage.name };
}

export const MAX_LEVEL = LEVELS.length;
