# Listening: Maestro vs. the leading piano apps

How well the market's leading apps hear an acoustic piano through the device microphone, next to Maestro on our listening benchmark ([listening-bench.md](listening-bench.md), [baseline](listening-bench-baseline.md)).

Approximate numbers (marked ≈) come from public reviews and vendor help pages, not from our own measurements. They describe different pianos, rooms and devices, so read them as orientation, not as a like-for-like comparison.

| | Simply Piano / Yousician / flowkey (published) | Maestro before (baseline) | Maestro now (hybrid: DSP 3.1 + learned network) |
| --- | --- | --- | --- |
| Reaction time, attack → note on screen (median) | ≈ 47 ms | 99 ms in lessons, 297 ms in free play (in-browser) · 86 ms / 148 ms offline (notes ≥ C3) | **31 ms in lessons** (in-browser, p90 43) · **22 ms in lessons / 38 ms in free play** offline (notes ≥ C3; free-play p90 132 ms) |
| Single notes, acoustic piano, mic | ≈ 85–90% recognised | 77% recall / 81% precision in free play · 91% / 90% in lessons | **86% / 83% in free play** · **93% / 95% in lessons** |
| Chords | weak ("the same chord played identically would sometimes register incorrectly") | 75% of chords complete in lessons · triads 83% / 80% in free play | **100% of chords complete in lessons** · triads 95% / 76% in free play |
| Octaves | weak | 49% of octaves complete in lessons · 19% in free play | **100% complete in lessons · 86–91% in free play** |
| Fast passages | weak | 65% recall in lessons · 16th scales 46% in free play | **96% recall in lessons** (repeated eighths 90%, trills 100%) · **16th scales 95% in free play** |
| Stuck or phantom notes from room noise | not published | 22 false notes/min summed over 11 noise types | 12–17 false notes/min (speech ≈ 0) |

Maestro's numbers are measured on the held-out pianos (Upright KW, YDP grand) in the `stand` condition: an iPad on the music stand, with room reverb and room tone. Free play means the app gives the listener no hints; in lessons it knows which notes are due (and, as in the app, drops notes it has already matched). "Now" is the QUICK benchmark of the shipped hybrid ([listening-bench-hybrid-quick.md](listening-bench-hybrid-quick.md)) with the retrained network.

**Targets derived from this table:**
- Reaction ≤ 40 ms median in lessons: **met** (22 ms offline, 31 ms in the browser).
- Chords ≥ 95% and octaves ≥ 90% complete in lessons: **met** (100% / 100%).
- Fast passages in lessons ≥ 90%: **met** (96%).
- Free-play octaves ≥ 80% and 16th scales ≥ 85%: **met** (86% / 95%).
- Single notes in free play ≥ 98% recall at ≥ 98% precision: **not met** (86% / 83%).
- Free-play triad precision ≥ 90% and latency p90 ≤ 120 ms: **not met** (76%, 132 ms).

**Where Maestro stands:** on everything a lesson grades (speed, chords, octaves, fast passages, repeated notes) it is now measured at or beyond what reviews report for the leading apps, whose weak spots are exactly chords, octaves and fast passages. Without hints (free play) single notes are at the top of the ≈ 85–90% range the competitors are credited with, but not yet at the 98% target, and chords in free play still report one extra note in four. These are lab numbers on sampled pianos; a Listening-test recording from a real iPad and piano is the check that matters next.

## Sources

- Simply Piano blog, "3 ways to improve note recognition": https://www.hellosimply.com/blog/piano-learning-app/3-ways-improve-note-recognition-simply-piano/
- Pianist's Compass, Simply Piano review: https://pianistscompass.org/reviews/apps/simply-piano/ (qualitative only; the chord quote above is from here, and the reviewer recommends a MIDI keyboard because recognition "is very inconsistent")
- Yousician support, "Piano sound recognition issues": https://support.yousician.com/hc/en-us/articles/205909051-Piano-sound-recognition-issues
- flowkey help, "Can I use an acoustic piano with flowkey?": https://help.flowkey.com/en/articles/651003-can-i-use-an-acoustic-piano-with-flowkey (qualitative only: move the device, open the lid, tune to 440 Hz, reduce background noise)

The ≈ 47 ms reaction time and ≈ 85–90% single-note figures came with the project brief, compiled from public reviews of these apps. When this page was written, the Simply Piano blog returned HTTP 504 and the Yousician article returned HTTP 403 (a bot check), so those two figures could not be re-checked against the pages above. The two pages that could be read give no numbers.
