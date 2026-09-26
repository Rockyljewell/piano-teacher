# Maestro: piano coach

A web app for iPad that listens to you play a real piano, grades every note in real time, finds your level with a short adaptive test, and then teaches you step by step from your very first note to master level. Your coach is Pip, a penguin who talks you through it.

**Use it:** https://rockyljewell.github.io/piano-teacher/

1. Open the link in Safari on your iPad. Optionally tap *Share → Add to Home Screen* for a full-screen app that also works offline.
2. Put the iPad on the piano's music stand in landscape and tap **Start**.
3. Allow the microphone, stay quiet for two seconds while Maestro measures the room, then play middle C.
4. Say how much you've played before. The **placement test** is a series of short two-handed pieces. Each test gets harder if you did well and easier if you struggled, until Maestro has narrowed down your level (usually 5–6 tests).
5. From there lessons run hands-free: each exercise is graded, Pip tells you how it went, and the next one starts automatically.

## What it does

- **Hears your piano, not the room.** The listener tracks all 88 keys, chords and both hands, and ignores speech, TV, claps, taps on the iPad, footsteps, typing and barking (see [How the listening works](#how-the-listening-works)).
- **Tells you if you're early or late, and by how much.** Every note gets a grade and a timing chip (for example "Great · 70 ms late"). A live early/late meter shows your running average. After each piece you get a timing histogram, your median offset and spread, and tips such as "you tend to rush". A consistent offset with a tight spread is recognised as microphone delay and corrected automatically over a few pieces (you can undo it on the results screen or switch it off in Settings).
- **Beginner-friendly timing.** Timing windows depend on your level:

  | Stage | Perfect | Great | Good | OK |
  | --- | --- | --- | --- | --- |
  | Beginner (1–8) | ±110 ms | ±190 ms | ±290 ms | ±400 ms |
  | Elementary (9–16) | ±90 ms | ±160 ms | ±240 ms | ±330 ms |
  | Intermediate (17–26) | ±70 ms | ±130 ms | ±200 ms | ±280 ms |
  | Advanced (27–34) | ±55 ms | ±105 ms | ±165 ms | ±235 ms |
  | Master (35–40) | ±45 ms | ±90 ms | ±140 ms | ±200 ms |

  Beginners also start at a slower tempo, and extra notes cost less at low levels.
- **Gets you ready first.** Before each exercise (levels 1–16), song or placement test, the keyboard lights up where your hands go, with finger numbers, and Pip says it: "Left pinky on C3, the C below middle C." Rhythm drills say "any key works" and suggest a key in your current hand position. The count-in starts when you play the first note, or tap "I'm ready".
- **Grading that fits your level.** Beginners are graded mostly on playing the right notes; timing counts more as you advance. Chords earn partial credit, each hand counts, and wait mode is graded too (wrong tries and long hesitations). Results say what to fix: the weakest bar, the weaker hand, the notes missed most, and whether you rush or drag.
- **Adaptive placement.** A Bayesian estimate of your level (0–40) is updated after every test. It starts from how much you said you've played. Scores of 92%+ jump two levels up, 80%+ one level up, under 70% never goes harder, and under 55% steps down. The test stops once the estimate is narrow enough (5 to 9 tests). Every test uses both hands.
- **Moving-line display, like a typing game.** A scrolling grand staff moves past a fixed playhead. Pitch-coloured notes fall onto a keyboard overlay that lights up the keys to play. Note names and finger numbers show at beginner levels.
- **Procedurally generated music.** Every exercise is new: a chord progression first, then a melody that lands on chord tones, then a left-hand part in the level's style (long bass notes, block chords, broken chords, Alberti bass, walking bass, octaves, sevenths, counter-melody).
- **Free songs to learn.** 41 public-domain songs in 76 arrangements, from three-note tunes for level 1 to Chopin, Joplin and Satie. Each song has an easy version first. You can also import any MIDI file, and the Songs screen links to free sheet-music libraries (Mutopia, IMSLP, Musopen, CPDL, Hymnary). See [docs/SONGS.md](docs/SONGS.md).
- **A coach with a voice.** Pip speaks using the iPad's built-in text-to-speech (Web Speech API): free, offline and private, with nothing to download. Pip never talks while you're being graded, and the microphone pauses while Maestro itself makes sound, so the app never grades its own voice, piano demos or sound effects.
- **Sound.** "Hear it first" demos use a sampled grand piano. Sound effects are synthesized, and the ones that play during a piece sit in a high frequency band that the listener ignores.
- **Lessons and rhythm.** Lessons cycle through warm-ups (note reading, scales, arpeggios, chords), sight-reading and rhythm drills. Tempo mode keeps moving; wait mode stops until you play the right notes. There's a mastery meter per level, a daily XP goal and a streak.
- **Other input.** A Web MIDI keyboard works where the browser supports it (not iPad Safari). The on-screen keys are touchable, and a computer keyboard works too (A W S E D F T G… = C4 upward).

## The curriculum (40 levels)

| Stage | Levels | Topics |
| --- | --- | --- |
| Beginner | 1–8 | Middle C position (RH, LH), steps and skips, rests, hands taking turns, 3/4, first hands-together, eighth notes, G position and F♯ |
| Elementary | 9–16 | Melodies across hands, harmonic intervals, F major, dotted rhythms, shifting positions, LH triads (I–IV–V), minor keys, scales and new keys |
| Intermediate | 17–26 | Alberti bass, ledger lines, sixteenths, syncopation and ties, 3♯/3♭ keys, RH chords, triplets, independent hands, arpeggios and two-octave scales, 6/8 |
| Advanced | 27–34 | Seventh chords, 4–5 accidentals, chromaticism, velocity, octaves and leaps, walking bass, every key, 3-against-2 polyrhythm |
| Master | 35–40 | Running-hands etudes, full keyboard range, dense harmony, mixed rhythms, presto, the master level |

## How the listening works

`js/audio/transcriber.js` runs on the audio clock:

1. **Noise tracking.** The room's noise floor is measured at setup and keeps adapting, but a sounding note is never learned as noise.
2. **Attacks.** Spectral flux is measured only on energy clearly above the noise floor.
3. **Pitch.** An 8192-sample window goes through noise subtraction and whitening. Harmonic salience is computed for all 88 keys with a piano model (string inharmonicity, stretch tuning, nearly pure treble). Notes are then found by iterative cancellation (after Klapuri, 2006), so every note of a chord is found. The piano's own tuning is learned after a few notes.
4. **Is it a piano?** A small fitted model scores each candidate note: is the tone steady, does the pitch hold (voices wobble), did it strike and then only decay (voices swell, claps vanish), and how loud is it compared with the room and your recent playing? Each note gets a 0–1 confidence. Doubtful candidates are watched for up to 0.3 s. Wrong notes only count against you when the listener is confident.
5. **Lesson hints.** During lessons the listener knows which notes are due and the piece's range. Expected notes need less evidence, and stray sounds far outside the piece need more.

**False notes per minute**, measured with `npm run eval:noise` on simulated and real recordings:

| Noise | Before (v1) | Now |
| --- | --- | --- |
| Conversation | 984 | 0 |
| Real audiobook speech | 693 | 0.7 |
| Real 1920 radio music | 994 | 1.3 |
| Claps | 688 | 0 |
| Taps / knocks | 128 | 0.7 |
| Typing | 647 | 0 |
| Dog bark | 465 | 0 |
| TV music (synthetic, with singing) | 439 | 11 (4.7 confident) |

**Accuracy on a real grand piano** (Salamander samples), recall / precision:

| Case | Before (v1) | Now |
| --- | --- | --- |
| Beginner two-hand piece | 86 / 86% | 96 / 94% |
| Same piece, with lesson hints | 95 / 94% | 97 / 95% |
| Same piece, speech 10 dB below the piano | 69 / 56% | 91 / 94% |
| Triads, with lesson hints | 88 / 84% | 97 / 99% |

Onset timing error is 1.5–3 ms in a quiet room and 4–6 ms at 10 dB SNR. Notes are timestamped at the attack.

**Speed and chords** (held-out upright and grand pianos never used for tuning, iPad on the music stand; full tables in [docs/listening-bench.md](docs/listening-bench.md)):

| In a lesson | Before | Now |
| --- | --- | --- |
| Note reported after the attack, C3 and up (median / p90) | 86 / 149 ms | 22 / 40 ms |
| Same, below C3 (median) | 124 ms | 43 ms |
| Chords heard complete | 74.5% | 96.4% |
| Lesson pieces, levels 1–20 (F1) | 91.2% | 97.7% |
| Octaves heard complete | 48.9% | 85.2% |

A fast path decides each note from short windows starting at the attack (21–85 ms, depending on the register), so the ringing of earlier notes cancels out. It only trusts notes the lesson did not ask for once the piano has clearly been heard, so room noise stays as rare as before. In the browser, worker hops add about 5–15 ms.

**Reliability.** The listener runs in a Web Worker: the capture AudioWorklet sends mic samples straight to it, so transcription never competes with the animation for the main thread. A health supervisor watches the audio engine and the microphone. It covers iOS stopping or "interrupting" the AudioContext, a clock that stops advancing, and a mic track that ends, mutes or goes silent. It recovers automatically where it can. When iOS needs a tap, the lesson pauses and asks for one, instead of freezing.

**Troubleshooting.** The *Listening check* opens from the mic chip on the play screen, from Settings, or from the "I can't hear your piano" screen. It shows:
- a live input meter, with the room's noise and your piano's level
- the engine and microphone state
- the last notes heard, with confidence

It can restart the microphone, run a note test, and save a 15-second recording plus a log to share when something goes wrong.

Known limits: pop music with singing on a TV, and ringing glasses in the top two octaves, can still register now and then. Free play (no lesson hints) is slower and weaker on octaves, chords in both hands and fast pedalled passages, and the bottom octave (below C2) is often missed on upright pianos.

## Development

No build step: it's plain ES modules.

```sh
npm start              # serves on http://localhost:8080
npm test               # all unit tests (node:test), ~2 min including the noise tests
npm run eval           # transcription accuracy report on synthesized piano
npm run corpus         # download real piano / speech / radio recordings (~8 MB) into tests/.cache/
npm run eval:noise     # false notes per minute and accuracy in noise
npm run fit            # refit the listener's confidence model
node e2e/smoke.mjs out/     # full run in headless Chromium: fake mic, adaptive placement, every screen
node e2e/gallery.mjs out/   # screenshots of exercises from across the curriculum
```

The microphone needs a secure context: `localhost` works on a computer, but an iPad needs HTTPS (GitHub Pages provides it).

## Deploying

`.github/workflows/pages.yml` runs the tests on every push and PR, and deploys to GitHub Pages from `main`.

## Credits

- **Piano samples:** Salamander Grand Piano V3 by Alexander Holm, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (see `assets/piano/README.md`).
- **Notation glyphs:** extracted from the [Bravura](https://github.com/steinbergmedia/bravura) font (SMuFL), © Steinberg Media Technologies GmbH, SIL Open Font License 1.1.
- **Fonts:** [Fredoka](https://github.com/hafontia/Fredoka-One) and [Nunito](https://github.com/googlefonts/nunito), SIL Open Font License 1.1 (licences in `assets/fonts/`).
- **Music:** public-domain melodies with arrangements written for this project. Classical pieces were checked against public-domain [Mutopia Project](https://www.mutopiaproject.org/) editions. Sources are listed per song in [docs/SONGS.md](docs/SONGS.md).
- **Test recordings** (downloaded on demand, never shipped): LibriVox public-domain readings, and 1920 recordings from the Great 78 Project at the Internet Archive.
- Pip, the sound effects and the listener's confidence model are original to this project.
