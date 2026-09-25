# Maestro: piano coach

A web app for iPad that listens to you play a real piano, grades you in real time, finds your level with a placement test, and then teaches you step by step from your very first note to master level.

**Use it:** https://rockyljewell.github.io/piano-teacher/ (after GitHub Pages is enabled, see [Deploying](#deploying)).

1. Open the link in Safari on your iPad. Optionally tap *Share → Add to Home Screen* for a full-screen app.
2. Put the iPad on the piano's music stand in landscape and tap **Start**.
3. Allow the microphone, stay quiet for two seconds, then play middle C.
4. The **placement test** starts. Short pieces scroll by and get harder until Maestro finds the highest level you can follow. After that, lessons continue hands-free: each exercise is graded, and the next one starts automatically.

## What it does

- **Hears every note.** It does polyphonic transcription of the microphone signal across all 88 keys (A0 to C8), including chords, both hands, repeated notes and notes held with the pedal. It also detects attacks within a few milliseconds for rhythm grading, and adapts to the piano's tuning (old pianos are often flat).
- **Grades you.** Each note is marked Perfect, Great, Good, Early/Late or Missed. Wrong notes show up on the staff in red. At the end you get a score, stars, timing statistics (average offset, early or late tendency) and coaching tips such as "you tend to rush" or "most missed: F♯4".
- **Moving-line display, like a typing game.** A scrolling grand staff moves past a fixed playhead. Falling notes line up with a keyboard overlay that highlights the keys to play, and shows the keys it hears in green (right) or red (wrong). Note names and finger numbers are on at beginner levels.
- **Procedurally generated music.** Every exercise is new. Harmony comes first as a cadential chord progression. Then a melody is built that lands on chord tones on strong beats, and a left-hand part is added in the level's style: long bass notes, roots, fifths, block chords with voice leading, broken chords, Alberti bass, walking bass, octaves, seventh chords or an independent counter-melody.
- **Lessons and rhythm.** Each lesson cycles through a warm-up (note reading, scales, arpeggios or chord progressions), sight-reading and rhythm drills. In rhythm drills any key counts, so only timing is graded.
- **Tempo mode and wait mode.** Tempo mode keeps moving and grades timing. Wait mode stops until you play the right notes. If you struggle at tempo, the coach has you learn the same piece in wait mode, then retries it at tempo.
- **Adaptive progression.** Each level has a mastery meter, and the tempo adapts to how comfortable you are. You level up at 100% mastery and drop back a level after repeated failures. Progress, streaks and history are saved on the device.
- **Other input options.** A Web MIDI keyboard works where the browser supports it (not iPad Safari). The on-screen keys are touchable, and a computer keyboard works too (A W S E D F T G… = C4 upward).

## The curriculum (40 levels)

| Stage | Levels | Topics |
| --- | --- | --- |
| Beginner | 1–8 | Middle C position (RH, LH), steps and skips, rests, hands taking turns, 3/4, first hands-together, eighth notes, G position and F♯ |
| Elementary | 9–16 | Melodies across hands, harmonic intervals, F major, dotted rhythms, shifting positions, LH triads (I–IV–V), minor keys, scales and new keys |
| Intermediate | 17–26 | Alberti bass, ledger lines, sixteenths, syncopation and ties, 3♯/3♭ keys, RH chords, triplets, independent hands, arpeggios and two-octave scales, 6/8 |
| Advanced | 27–34 | Seventh chords, 4–5 accidentals, chromaticism, velocity, octaves and leaps, walking bass, every key, 3-against-2 polyrhythm |
| Master | 35–40 | Running-hands etudes, full keyboard range, dense harmony, mixed rhythms, presto, the master level |

Each level starts with a short lesson card that explains its new concept.

## How the listening works

`js/audio/transcriber.js` runs on the audio clock:

1. **Onsets:** spectral flux on 1024-sample frames (5 ms hop), normalised by the room noise measured during setup, with adaptive peak picking.
2. **Pitch:** an 8192-sample Hann window every ~21 ms goes through noise subtraction and spectral whitening. It then computes a harmonic salience for all 88 keys, modelling piano-string inharmonicity. Notes are found iteratively: take the strongest note, then cancel its partials using spectral smoothness (after Klapuri, 2006). This finds every note in a chord.
3. **Tracking:** new notes need a hammer attack and are back-dated to it. Re-struck notes are found with a short-window energy check, plus ghost pruning (bass semitone neighbours, weak octave-up partials). During lessons, the notes the score expects get a small detection prior.

On synthesized piano audio (`npm run eval`), recall is about 95–100% for single notes, triads, fast scales, repeated notes and noisy rooms, with onset timing errors of about 2–3 ms.

## Development

No build step: it's plain ES modules.

```sh
npm start          # serves on http://localhost:8080
npm test           # generator, coach and listening-engine tests (node:test)
npm run eval       # detailed transcription accuracy report
node e2e/smoke.mjs out/     # end-to-end run in headless Chromium with a fake microphone (needs Playwright)
node e2e/gallery.mjs out/   # screenshots of exercises from across the curriculum
```

The microphone needs a secure context: `localhost` works on the computer, but an iPad needs HTTPS (GitHub Pages provides it).

## Deploying

`.github/workflows/pages.yml` runs the tests on every push and PR, and deploys to GitHub Pages from `main`. To enable it once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Credits

Music notation glyphs are extracted from the [Bravura](https://github.com/steinbergmedia/bravura) font (SMuFL), © Steinberg Media Technologies GmbH, licensed under the SIL Open Font License 1.1.
