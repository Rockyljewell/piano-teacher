# The learned listener

A small causal neural network that hears the piano through the iPad microphone: every 10 ms it
says, for each of the 88 keys, "struck in the last 40 ms", "sounding", and when exactly the
attack was. It runs in the listener Web Worker in plain JavaScript (`js/audio/nn/`), as a drop-in
replacement for the DSP transcriber (`js/audio/transcriber.js`). Training code: `tools/nn/`
([README](../tools/nn/README.md) has the exact commands to reproduce it).

RESULTS_PLACEHOLDER

## How it hears

```
mic (44.1 / 48 kHz) --windowed-sinc resampler--> 16 kHz
  every 10 ms (160 samples), windows ENDING at the newest sample (causal):
    |STFT| 2048 (128 ms, resolves low notes) + |STFT| 512 (32 ms, sharp attacks)
    -> 296 log-frequency bins, 3 per semitone (MIDI 20 .. 118 1/3, 26 Hz .. 7.5 kHz)
    -> ln(1 + |X| / 3e-5), fixed per-window normalisation
  network (below) -> per key: onset p, sounding p, attack age (0..3 frames ago)
  decoder -> onNoteOn(midi, attack time, vel, {confidence, restrike}), onNoteOff, onOnset
```

**Network** (`tools/nn/model.py`, mirrored by `js/audio/nn/model.js`). Weights are shared across
keys (the log-frequency axis makes pitch a translation), with a learned per-key bias so the bass
and treble can differ.

1. *Harmonic stack* (as in Basic Pitch): for the 3 bins around every key (264 positions) the
   spectrum at h = 1/3, 1/2, 1, 3/2, 2, 5/2, 3, 4, 5, 6, 7, 8 times its frequency, for the long
   window, the short window and the short window's rise over the last 30 ms (36 channels). The
   sub-harmonics (1/2, 3/2, 5/2, 1/3) show whether a lower note already explains the energy: that
   is what separates "C4" from "C3 + C4".
2. 1x1 convolution to 16 channels; a causal 3 frames x 3 bins depthwise convolution (residual).
3. The 3 positions of each key -> 24 channels per key (+ per-key bias).
4. Six residual blocks at the 88 keys: causal temporal depthwise convolutions (dilation 1, 2, 4,
   8) and two cross-key blocks that look at the keys an octave, a twelfth, two octaves and a
   semitone or two away, plus a global context vector (mean and max over keys).
5. Heads: onset, sounding, attack age.

No look-ahead layer at all: the model is strictly causal. Its "look-ahead" is the onset target,
which is 1 for the 4 frames after an attack, so the network may say "struck" as soon as it is
sure, at most 40 ms after the attack; easy notes fire after 10-20 ms.

**Decoder** (`js/audio/nn/nn-transcriber.js`): a key fires the first time its onset
probability crosses its threshold; thresholds are per register, lower for the notes the lesson
expects (`setExpected`), higher for unexpected notes more than 5 semitones outside the piece
(`setRange`) and in strict / noisy-room mode (`setStrictness`, `setNoisyRoom`). The time is
back-dated to the attack: the network's age head picks the 10 ms frame, then the 2 ms block with
the steepest high-band energy jump within +-20 ms. `confidence` is the probability at firing
mapped through an isotonic calibration measured on validation mixtures, so "confidence >= 0.55"
(the practice engine's bar for counting a wrong note) means ">= 55% of such notes were real".
Note-off when "sounding" stays below 0.25 for 30 ms. The piano's tuning is tracked from the
partials of confident notes and the log-frequency bins follow it (the network itself was trained
for +-30 cents). `noiseLevel`, `pianoLevel`, `stats`, calibration and `reset` behave as in the DSP
transcriber.

## Training data

Only sources whose licence lets us ship weights trained on them. Nothing below is committed; the
fetch script downloads it (`tools/nn/fetch_data.py`).

| source | what | licence (checked at the source) |
| --- | --- | --- |
| Salamander Grand Piano V3 (Alexander Holm), SF2 build from FreePats | Yamaha C5, 16 velocity layers, every minor third | CC BY 3.0 - <https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html> (attribution: see Credits) |
| MuseScore_General.sf2 v0.2, "Grand Piano" | AKAI "Splendid Grand" (Steinway D), 6 layers, looped | MIT; the piano samples are public domain ("confirmed via AKAI rep.") - <https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md>, `MuseScore_General_Sample_Sources.csv` |
| FluidR3_GM.sf2 (Frank Wen), Debian's pristine upstream tarball | "Yamaha Grand Piano", 9 layers, looped | MIT (COPYING in the tarball) - <https://deb.debian.org/debian/pool/main/f/fluid-soundfont/> |
| GeneralUser GS v2.0.3 (S. Christian Collins) | "Grand Piano", 8 layers, looped | GeneralUser GS License v2.0: "use ... without restriction ... in your software projects" - <https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt> |
| University of Iowa MIS, piano | Steinway B, pp / mf / ff, every key, real room noise | "freely available ... may be downloaded and used for any projects, without restrictions" - <https://theremin.music.uiowa.edu/MIS.html>, <https://theremin.music.uiowa.edu/MISpiano.html> |
| additive synth (`tests/synth-piano.js`, widened in `tools/nn/synth.py`) | a family of virtual pianos: string stiffness from concert grand to small upright, 1-3 detuned strings per key, own tilt / decay / hammer noise | this project |
| LibriVox "20 Short Science Fiction Stories", chapters 1, 4, 5, 6, 8, 9 | background speech | public domain - <https://librivox.org/> (the benchmark uses chapters 2, 3, 7: not trained on) |
| Great 78 Project: five 1920/21 records (Sunnyside Sal, Learn to Smile, Sleepy Head, Swanee River Moon, Playthings) | background radio | public domain in the US - <https://archive.org/details/georgeblood> (the benchmark's two records are not trained on) |
| `tests/noise-sim.js` (speech, TV, claps, taps, footsteps, dishes, hum, bark, typing, room tone) | simulated room noise, seeds >= 1000 (the benchmark uses seeds < 100) | this project |

**Not used:** MAESTRO, MAPS, SMD or any other non-commercial / unclear data, and the benchmark's
held-out pianos (Upright Piano KW, YDP grand). A cross-correlation check found no training sample
that is a copy of a held-out sample (best match 0.75 for keys up to G3, where waveforms are
distinctive; a copy scores ~1).

**Music played** (`tools/nn/content.py`, `tools/nn/dump_content.mjs`): the app's own
`generate(level, {seed, kind})` for all 40 levels and every warm-up kind (sight, scale, arpeggio,
chords, five-finger, note reading), `generateRhythm`, and all 76 song arrangements (seeds >=
100000; the benchmark's pieces use small seeds) - 1356 pieces, 53k notes - played at 0.75-1.35x
tempo with human timing, chord spread and dynamics, sometimes pedalled; plus synthetic material
aimed at what is hard: block chords (dyads to 6 notes, octaves, octave + fifth, clusters, random),
both-hands chords, repeated chords, scales, arpeggios, chromatic runs, trills, repeated notes, broken
octaves, Alberti bass (5-18 notes/s), pedalled broken chords with a melody on top, random note soup
over the whole keyboard, extremes (A0-B1, C6-C8), and silence.

**Rendering** (`tools/nn/synth.py`): the region by key and velocity, pitch shifted from the nearest
sample (Catmull-Rom, anti-aliased), SoundFont loops and volume envelopes, velocity curve, darker
when soft for single-layer instruments, dampers (slower in the bass, none above F6), sustain pedal
with sympathetic resonance of undamped strings (unlabelled) and pedal thumps, per-key tuning
scatter (3 cents), stretch tuning, global detune +-30 cents.

**Rooms and microphones**: 80% of clips through synthetic rooms (rt60 0.15-1.2 s, early reflections,
treble dying faster, direct-to-reverberant ratio -3..12 dB). At training time every batch is a new
mixture: piano level +-20 dB around -30 dBFS, room tone -75..-38 dB, 1-2 noises from the table
above at SNR 3-42 dB (continuous) or -26..+3 dB re the piano's peak (impulsive), sometimes only for
part of the clip; metronome ticks (as leaked through the mic, labelled "no note"); iPad-mic EQ
(60-150 Hz high-pass, 1-4 random peaks +-8 dB, tilt, top-end roll-off); occasional clipping.

**Scale:** 30 h of rendered clips (9000 x 12 s) + 8 h more of the synthetic piano family (for
stiffer, upright-like strings); 1.7 h of validation clips (same instruments, other music, rooms and
noise seeds). Each training step sees 16 x 4.5 s.

## Integration plan

INTEGRATION_PLACEHOLDER

## Credits

Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0. MuseScore_General.sf2 by S. Christian
Collins (FluidR3 by Frank Wen, FluidR3Mono by Michael Cowgill), MIT. FluidR3_GM by Frank Wen, MIT.
GeneralUser GS by S. Christian Collins. University of Iowa Electronic Music Studios, Musical
Instrument Samples (Lawrence Fritts). LibriVox volunteers. The Great 78 Project / Internet Archive.
