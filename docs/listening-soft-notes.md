# Soft notes of a chord: the weak finger's note was missed at the attack

Reported on a real piano: *we are having a hard time picking up more than two notes at a time;
three notes only sometimes.*

## What was wrong

A real free-play recording from the app (listening check: classic + learned engine, normal level,
iPad on the stand) showed it. The chords there are C-E-G and the like; the top note (G4) sounds
11-21 dB below the other two, as it does when the weak fingers play it, and it was missed at about
half the chord attacks. The loud notes were found every time.

Two things take a soft chord note away in the classic engine (`js/audio/transcriber.js`):

1. **The cancelling.** The note finder takes the strongest note, cancels its partials from the
   spectrum, and looks again. The fifth above a root shares partials with it (A3's 3rd, 6th and
   9th partials are E4's 2nd, 4th and 6th) and a third shares some with the others, so after the
   louder notes are cancelled there is too little left of the soft one. One trace: E4 reads 0.92
   before any cancelling (the detection threshold is 0.44), 0.33 after A3 is cancelled and 0.18
   after C4. It never comes back as a note.
2. **The confidence model.** Even when a note does come through, the model that decides whether a
   candidate is a piano note was fitted on notes found in the cancelled spectrum, which read
   about three times the threshold; a note found at its uncancelled strength (about once the
   threshold) is rated as a doubtful one (0.08 for the real G4).

At the attack itself the finder is also crowded out for 0.1-0.15 s by sub-octave "ghost"
candidates (a low note whose overtones land on the real notes' peaks), so the soft note cannot
count on being found in the first frames either.

The learned engine did not help much: it gives the soft note a probability of 0.14-0.18 against its
0.3 threshold, and the arbiter that decides which engine to believe leans on that.

## Change

`_rescue` in `_iterativeDetect` (classic engine; the hybrid uses it as its first engine). Free
play only: a lesson names the notes it wants, and its lower thresholds already find them. After
the search it takes a note back when

- it is a chord: two notes were found, the note lies above the lowest of them, between C3 and C6;
- its strength in the spectrum **before** any cancelling is at least half the threshold (0.8 in the
  first version; 0.5 was a free gain: nothing more is taken back that was not played);
- it is not an overtone (12, 19, 24, 28 ... semitones), a sub-octave or a semitone neighbour of a
  note found, nor a partial of a lower note whose fundamental is plainly there (a bass note the
  search lost: its other partials would otherwise look like notes), nor above an octave below that
  is as strong as it is (which of the two was played is the network's question);
- its fundamental is a clear peak of its own (4x the median of the bins around it) and so are two
  more of its first six partials that no note found has. A ghost candidate living off the notes'
  partials has no peak of its own and empty gaps between its partials, which is how the soft
  note and the ghosts are told apart (partial-1 prominence in the benchmark: the soft notes'
  median is 11 and their 10th percentile 4.7; the ghost candidates' 90th percentile is 2.3).

The note goes to the tracker as strong as the weakest note found (so the confidence model does
not read it as a doubtful one) and still needs an attack and the model's agreement to become a
note. At most two notes are taken back per frame, and a rescued note is never the yardstick that
prunes another (`_prune`). `onNoteOn`'s info carries `rescued` for notes that were only ever found
this way.

In the hybrid the arbiter (`js/audio/nn/arbiter.js`) has one more rule for these notes. Its fitted
model leans on the network's probability, and the network gives a soft quiet fifth or third only
0.04-0.2, so about a third of the rescued notes were dropped. A rescued note is now reported when the
DSP is sure of it (confidence 0.8) and the network does not say no (onset probability at the attack
at least 0.02). Set by hand on the benchmark's free-play material, not fitted: over two sets of
seeds, two levels and the noise clips, 19 more of the 120 rescued notes are reported, 2 of them
not played, and no noise clip adds a note.

Things that were tried and are not in:
- a stricter support test for the lowest candidates (little gain, more extras);
- looser partial tests, or no cap at C6 (a loud voice at 10 dB SNR then adds notes;
  `tests/noise.test.js` caught it);
- taking the octave above a bass note back without the octave rule made real bass notes disappear on
  the quiet tablet benchmark: once the octave above is on, it out-competes the bass note;
- the opposite: letting a candidate through when the octave below has no fundamental peak of its
  own (from C3 up). It recovers a 20 dB-soft G4 in the real recording and adds 4 points on the voiced
  chords, but a quiet bass note's fundamental is as weak as a ghost's (80 Hz high-pass, a tablet's
  speaker): the quiet both-hands benchmark loses bass notes (hybrid -3 hits) and the classic engine
  adds 6 false notes there;
- a general second chance for every DSP note the arbiter drops: as many false notes come in as true
  ones (and no single feature of the arbiter separates the true ones it still drops, 35 per
  seed, from the false ones);
- keeping a rescued note on a little more easily once the tracker is watching it (+2 points, and
  the talker test then has one false note less of margin).

## Results

`node tests/bench-voiced.js`: chords struck 2.2 s apart, with the top note 5-20 dB below the
others (the sampled upright and YDP grand, `stand` condition). "Whole" = every note of the chord
heard at its attack (within 80 ms); "extras" = notes not played, per minute.

| engine, level | | 3 notes | 4 notes |
| --- | --- | --- | --- |
| classic, normal | whole chord, before → after | 35 → **73 %** | 21 → **46 %** |
| | top note heard | 35 → **77 %** | 25 → **63 %** |
| | extras per minute | 6 → 7 | 16 → 18 |
| classic + learned, normal | whole chord | 25 → **63 %** | 27 → **60 %** |
| | top note heard | 25 → **63 %** | 29 → **65 %** |
| | extras per minute | 9 → 9 | 13 → 13 |
| classic, quiet (−25 dB, floor −80) | whole chord | 40 → **75 %** | 25 → **50 %** |
| | extras per minute | 7 → 7 | 15 → 15 |
| classic + learned, quiet | whole chord | 27 → **60 %** | 29 → **60 %** |
| | extras per minute | 8 → 8 | 8 → 8 |

(The first version of the rescue, with the network's arbiter unchanged and the strength bar at 0.8,
reached 71 / 44 % classic and 52 / 56 % with the network, normal level.)

Top notes 8-14 dB below the loudest: 39 → 79 % (classic), 25 → 61 % (with the network). Chords in
both hands (a left-hand fifth under a right-hand triad) do not change (0-15 % whole): the
bass notes' partials crowd every candidate and the rescue stays out of that register.

The existing benchmark (`tests/bench-listen.js` QUICK, chords / octaves / both hands, normal and
quiet, classic and with the network) is unchanged within noise: lessons identical, free play
+4 / +2 / +2 / 0 notes heard and +1 / +1 / +2 / 0 extras in the four configurations. The noise
tests (`tests/noise.test.js`, TV, speech, real recordings) and the held-chord tests pass; free play
on the beginner piece is as precise as before (0.958) and with a talker at 10 dB SNR a little better
(0.874 against 0.863).

The real free-play recording: the G4 of the C-E-G chord at 2.6 s is now heard (classic + learned
engine). The G4 at 9.1 s (a G-B-D chord, G4 21 dB down) is still missed: the octave rule holds it
back, see above. At 3.8 s and 5.3 s a G4 peak sits 16-20 dB down, but it is also the 3rd partial of
the C3 played there and the octave of the G3, so it may never have been struck; nothing is
reported there, and the listener cannot tell either.

## What this does not fix

- Soft notes that are an octave above the root (2 of 12 heard) and a major seventh above it
  (5 of 12, the top of C-E-G-B) are mostly still missed.
- Notes more than about 14 dB below the loudest are hit or miss.
- The upright is much worse than the grand (24 of 48 against 39 of 48 top notes in the 3- and
  4-note material): its resonant bass fills the spectrum with partials.
- Chords with notes in both hands, and anything below C3.
- In the real recording the confidence model still rates some soft notes below its bar.

## Tests

- `tests/soft-notes.test.js` (synthetic piano, runs without the corpus): the soft top notes of
  twelve triads are heard (fails on the previous code: 1 of 12), nothing is taken back in a
  lesson.
- `tests/nn-arbiter.test.js`: a rescued note the network hardly sees is reported when the DSP is
  sure of it; a doubtful one, one the network is sure was not struck, and the same note not taken
  back by the DSP are left to the fitted model.
- `tests/bench-voiced.js` is the benchmark behind the table (`npm run bench:voiced`).
