# Held chords: notes that were let go while the keys were still down

Reported on a real piano: *hit three notes and hold them, and only two are picked up.*

## What was wrong

The free-play display lights a key from the listener's note-on to its note-off. The benchmarks
only scored attacks, so nothing measured what happens while a chord is held.

In the classic engine (`js/audio/transcriber.js`) a reported note was ended as soon as the
iterative note finder had failed to return it in 3 frames in a row (about 64 ms). The finder
finds the strongest note, cancels its partials, and looks again. The fifth (or third) above a
root shares overtones with it, for example G3's 3rd partial is D4's 4th, so once the root's
partials are cancelled there is too little left of the upper note, and it drops out of the
finder's list for a few frames while it is still ringing. Its raw strength, before any
cancellation, stays high the whole time: one trace had it at 70 % of the strongest note when it
was released, 2 s before the key came up.

Held for 3 s on the upright in the benchmark, the classic engine alone still had the top note of
a triad on after 1 s for only 14 % of the chords, while the lowest note stayed on for 86 %.

## Change

`_track` ends a note exactly as before, but if the note is still plainly in the raw spectrum
(`_sustained`: raw strength at least 0.75 of the detection threshold) its note-off waits in a
`lingering` list until that strength goes. The dampers collapse it within about 150 ms of the key
coming up, so a released key is still let go promptly (median lag after the key comes up about
0.3 s, no change; nothing over 0.85 s, nothing stuck).

- Only the outward note-off is delayed. The detector's own `active` set, which drives
  thresholds, re-strikes, noise rejection and lesson matching, is untouched, so note-ons are
  identical. (The first version kept the note in `active`; a loud TV and the lesson recording
  then produced false notes, `tests/noise.test.js` and `tests/real-recording.test.js` caught it.)
- Not for a note at an overtone interval above another sounding note (12, 19, 24, 28 ... semitones):
  its partials are the lower note's own, the raw spectrum cannot tell the two apart, and only the
  cancelling detection can. An octave doubling can still drop out of a held chord.
- The hybrid engine ends a note when neither engine hears it, so it gets the same fix.
  The network's own release (its "still sounding" output with hysteresis) is unchanged.

## Results

`node tests/bench-hold.js`, upright + YDP grand, `stand` condition. Notes struck as 1-4 note
chords, held 0.5-3 s. "Whole" = every note of the chord heard at the attack and still on 0.25 s
before the key came up; "early" = released more than 0.25 s before the key came up (share of the
notes heard at the attack).

| engine, level | | 2 notes | 3 notes | 4 notes |
| --- | --- | --- | --- | --- |
| classic, normal | whole chord kept, before → after | 50 → 53 % | 25 → **53 %** | 13 → **28 %** |
| | early release, before → after | 13 → 9 % | 25 → **5 %** | 28 → **8 %** |
| classic + learned, normal | whole chord kept | 88 → 88 % | 66 → **72 %** | 44 → **50 %** |
| | early release | 6 → 6 % | 6 → **2 %** | 7 → **5 %** |
| classic, quiet (−25 dB, floor −80) | whole chord kept | 50 → 56 % | 25 → **44 %** | 13 → **25 %** |
| | early release | 22 → 17 % | 32 → **20 %** | 27 → **12 %** |
| classic + learned, quiet | whole chord kept | 81 → 81 % | 53 → **56 %** | 47 → **53 %** |
| | early release | 7 → 7 % | 12 → **9 %** | 9 → **6 %** |

Single notes are unchanged. Release lag after the key comes up: median 0.27-0.36 s before and
after; the longest 0.83 s after the change (0.82 s before); no note stayed on (0 % stuck in every
row). More notes now count as "released after the key came up" because they are no longer let go
early, which is why the share released more than 0.6 s late looks higher; they end as promptly as
the rest.

Every attack metric is identical, because note-ons do not change.

## What this does not fix

The other half of "only two notes": in free play (no hints) the attack of a 3rd or 4th note is
missed too. On the same pianos the classic engine alone completes 58-72 % of triads and 50-56 % of
4-note chords at the attack, the classic + learned engine 89 % and 75 %. The sensitivity slider
does not help (at 1.5× the classic engine's triads go from 58 % to 75 % but false notes go up more than threefold,
and 4+ notes do not improve). Lessons are not affected: with the lesson's hints chords are heard
97-100 % complete (81 % for both-hands chords on the classic engine alone, 100 % on the hybrid).

## Tests

- `tests/hold.test.js` (synthetic piano, runs without the corpus): held triads and four-note
  chords keep the notes they heard until the keys come up (fails on the previous code: 5 of 26
  and 5 of 19 notes released early); a released key is still let go within a second.
- `tests/bench-hold.js` is the benchmark behind the table (`npm run bench:hold`).
