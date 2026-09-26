# Listening: Maestro vs. the leading piano apps

How well the market's leading apps hear an acoustic piano through the device microphone, next to Maestro on our listening benchmark ([listening-bench.md](listening-bench.md), [baseline](listening-bench-baseline.md)).

Approximate numbers (marked ≈) come from public reviews and vendor help pages, not from our own measurements. They describe different pianos, rooms and devices, so read them as orientation, not as a like-for-like comparison.

| | Simply Piano / Yousician / flowkey (published) | Maestro before (baseline) | Maestro after |
| --- | --- | --- | --- |
| Reaction time, attack → note on screen (median) | ≈ 47 ms | 99 ms in lessons, 297 ms in free play (in-browser, headless Chromium) · 86 ms / 148 ms offline (notes ≥ C3) | _pending_ |
| Single notes, acoustic piano, mic | ≈ 85–90% recognised | 77% recall / 81% precision in free play · 91% / 90% in lessons | _pending_ |
| Chords | weak ("the same chord played identically would sometimes register incorrectly") | 75% of chords complete in lessons · triads 83% / 80% in free play | _pending_ |
| Octaves | weak | 49% of octaves complete in lessons · 19% in free play | _pending_ |
| Fast passages | weak | 65% recall in lessons · 16th scales 46% in free play | _pending_ |

Maestro's numbers are measured on the held-out pianos (Upright KW, YDP grand) in the `stand` condition: an iPad on the music stand, with room reverb and room tone. Free play means the app gives the listener no hints; in lessons it knows which notes are due.

**Targets derived from this table** (checked in the benchmark's summary):
- Single notes in free play: ≥ 98% recall at ≥ 98% precision (held-out pianos, `stand`).
- Fast passages in lessons (16th scales, repeated notes, trills, arpeggios): ≥ 90% recall.
- Plus the latency, chord and octave targets in [listening-bench.md](listening-bench.md), which are all stricter than "weak".

## Sources

- Simply Piano blog, "3 ways to improve note recognition": https://www.hellosimply.com/blog/piano-learning-app/3-ways-improve-note-recognition-simply-piano/
- Pianist's Compass, Simply Piano review: https://pianistscompass.org/reviews/apps/simply-piano/ (qualitative only; the chord quote above is from here, and the reviewer recommends a MIDI keyboard because recognition "is very inconsistent")
- Yousician support, "Piano sound recognition issues": https://support.yousician.com/hc/en-us/articles/205909051-Piano-sound-recognition-issues
- flowkey help, "Can I use an acoustic piano with flowkey?": https://help.flowkey.com/en/articles/651003-can-i-use-an-acoustic-piano-with-flowkey (qualitative only: move the device, open the lid, tune to 440 Hz, reduce background noise)

The ≈ 47 ms reaction time and ≈ 85–90% single-note figures came with the project brief, compiled from public reviews of these apps. When this page was written, the Simply Piano blog returned HTTP 504 and the Yousician article returned HTTP 403 (a bot check), so those two figures could not be re-checked against the pages above. The two pages that could be read give no numbers.
