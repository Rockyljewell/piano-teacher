# Listening on the first real recording (iPad, quiet acoustic piano)

`tests/fixtures/real/ipad-easy-2026-09-28.*`: the easy listening test played in wait mode on an
acoustic piano, recorded by the app on an iPad. The piano is quiet, about −51 dBFS, which is
~23 dB below the benchmark's mezzo-forte (`PIANO_REF_RMS` −27.6 dBFS). The room sits at −71 to
−84 dBFS. Regression test: `tests/real-recording.test.js`.

## What was really played

Checked on the spectra around every attack (fundamental and odd partials rising, not only
partials shared with a lower note). The student played 29 notes, not the 24 asked for:

- extras: A4 with the E4 at 23.70 s; E4 with the G4 at 25.46 s; C4 + D4 + G4 at 27.63 s (D
  instead of E); the whole C-E-G chord again at 29.30 s; A3 instead of G3 at 35.10 s; C4 with
  the C3 at 37.57 s.
- never struck: E4 at 28.71 s and C4 at 37.22 s. At both times the previous chord's keys are
  being released. Live, with the lesson's hint, the app took the damper noise as those notes.

In free play the listener is scored against these 29 notes. Against the 24 asked for, correct
extras count as errors and the two phantom notes count as misses.

## Diagnosis

| suspect | finding |
| --- | --- |
| DSP level gates (onset flux, pianoLevel, calibration) | Level-invariant. Replaying the recording at +15 and +30 dB gives the same DSP result: flux is measured against the calibrated noise floor, and the confidence features are relative to the piano's own level. The absolute −72 dBFS "silence" floors do not matter here (lowering them changed nothing). |
| calibration | The recording starts on the tail of a note. Calibrating on it (0–1 s) puts the room at −54 instead of −72 dBFS. The effect is small (hybrid: one extra, p90 ±50 ms). The test calibrates on room tone (0.4–1.4 s), as the app does before the lesson. |
| network input level | **Level-dependent.** Its features are `ln(1 + m / 3e-5)` and it was trained on pianos from −50 to −10 dBFS. This recording sits at the bottom of that range. The softer notes of a chord lose most: G4 in the chord at 27.63 s peaks at p 0.43, 0.86 at +20 dB; E4 at 21.24 s peaks at 0.80, 0.95 at +20 dB. At −25 dB the benchmark's free-play recall falls (singles 84 → 67 %) and latency rises (upright median 51 → 76 ms). |
| fast path's trust gate (`_pianoKnown`) | **Tempo-dependent.** It opens after 6 sure notes within 15 s. A pause of 1.5 s closes it, and then it has to be earned again. A beginner pauses every few notes, so in this recording the free-play fast path almost never fired. Wait mode gets its 20–40 ms latencies from that path. |
| arbiter's noise guard | Works as designed. The first note after silence waits for the DSP's long window (~290 ms) because no piano has been heard yet. This case is left as it is. |

## Changes

1. **Network input level normalisation** (`hybrid-transcriber.js` `_nnGain`,
   `nn-transcriber.js` `setInputGain`).
   - Once both engines have heard the piano (3 notes the DSP's long window was sure of that the
     network also heard, within 30 s), the network's input is raised by
     `levelRef − pianoLevel` dB. The gain is capped at 30 dB and moves at 10 dB/s.
   - `levelRef` is −28 dB, the quiet end of what the DSP's `pianoLevel` reads on the
     benchmark's normal level (−22 … −28). At normal level the gain is therefore ~0, and every
     normal-level row is unchanged.
   - Only the network's input is scaled. Levels, velocity and the DSP are untouched.
   - The "both engines" condition was added after a noise probe: without it, one DSP false note
     in speech set the piano level at −53 dB, turned the room up by 25 dB, and the network then
     reported a note.
2. **Tempo-independent fast-path gate** (`transcriber.js` `_pianoKnown`, `pianoReopen` = 30 s).
   The gate still closes on a 1.5 s pause. But if it was open within the last 30 s, the first
   sure long-window note re-opens it, so the rest of the phrase goes through the fast path
   again.

## What was tuned on what

- `levelRef` −28 and the gain cap: chosen from the benchmark's normal-level `pianoLevel`
  readings (−22 … −28), so that normal level is untouched. They were not tuned on the real
  recording, where −22 would score better (p90 172 ms instead of 288 ms).
- The "3 agreed notes in 30 s" guard: set on the noise probes (speech / TV), before the noise
  evaluation.
- `pianoReopen` 30 s: set by hand. It was checked with the noise evaluation's pause test at
  normal level and at −25 dB.
- The real recording was used only to diagnose and as the regression test.

## Results

Real recording (hybrid, 256-sample chunks, room calibrated on 0.4–1.4 s; "lead protocol" =
calibrated on 0–1 s):

| | hits / 29 played | extras | latency median / p90 |
| --- | --- | --- | --- |
| free, before | 27 | 0 (lead protocol: 1) | 105 / 288 ms |
| free, after | 27 | 1 (C3's octave, confidence 0.40) | 59 / 288 ms |
| wait mode (app hints), before = after | 26 (all 24 asked-for steps, 19/19) | 2 | 43 / 251 ms |
| DSP alone, free, before → after | 24 → 25 | 3 | 261 → 239 / 315 ms |

QUICK benchmark (`HINTS=app`, held-out pianos, stand and stand+talk, 2 × 14 materials):

- **Normal level:** every lesson row and every noise row is identical. Free play is
  equal or better: latency ≥ C3 p90 132 → 126 ms; lesson-piece hits 685 → 689 with 75 → 79
  extras.
- **−25 dB with a −80 dBFS mic floor (`GAIN_DB=-25 FLOOR_DB=-80`):**
  - Lesson rows are unchanged.
  - Free play recovers towards normal-level behaviour: latency ≥ C3 42.7/148 → 39.5/133 ms;
    upright all-notes median 76 → 56 ms.
  - Free-play targets: octave completeness 79.5 → 86.4 %, scales 87.1 → 90.5 %, singles recall
    69.9 → 74.4 %.
  - Precision falls back to its normal-level rate: extras on the lesson pieces 37 → 67, against
    75 at normal level.

`node tests/noise-eval.js noise`:

- **Normal level:** identical before and after. Speech 0.7, TV 9.3, dishes 6.7, bark 0.7 per
  minute. Pauses: TV 3, footsteps 1, dishes 2, bark 1.
- **−25 dB:** everything is 0 except dishes (loud) 1.0/min. Pauses: TV 0 → 2/min, which is
  still below the normal level's 3/min.
