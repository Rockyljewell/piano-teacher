# Maestro · "Concert" direction

**An evening at the concert hall.** Maestro should feel like a calm, premium product for grown-ups (Flowkey, Apple Music, MasterClass) that is still warm and encouraging for someone who has never touched a piano. The room is a dark, warm stage. One spotlight picks out the thing that matters right now. The music is printed on cream paper. Gold leaf marks success and the next step. Everything else stays quiet so the piano can be heard.

| Mockup | File |
| --- | --- |
| Home: learning path, Continue, streak, XP and daily goal, entry points | `home.png` / `home.html` |
| Placement 1: "Have you played piano before?" (4 options) | `placement-1-experience.png` / `.html` |
| Placement 2: test header "Test 3 of ~7" with a harder/easier cue | `placement-2-test.png` / `.html` |
| Placement 3: "You're starting at Level 12" reveal | `placement-3-reveal.png` / `.html` |
| Play: HUD, sheet music on paper, falling notes, keyboard, timing chips, early/late meter | `play.png` / `play.html` |
| Results: stars, accuracy, stat tiles, timing histogram, coach, Next / Retry | `results.png` / `results.html` |
| Song library: category filters, level-fit sections, Import MIDI | `songs.png` / `songs.html` |
| Brand sheet: mark, wordmark, app icon, palette, type, components | `brand.png` / `brand.html` (1180×1640) |
| Gallery of all of the above | `index.html` |
| Tokens as CSS custom properties | `tokens.css` |
| Brand assets (SVG) | `assets/maestro-mark.svg`, `assets/maestro-wordmark.svg`, `assets/maestro-app-icon.svg`, `assets/maestro-lockup-dark.svg` |
| Generator (mockups + PNGs) | `build/build.mjs`, `build/outline.py`, `build/wordmark-outlines.json` |

All mockups are 1180×820 (iPad Air/Pro 11" landscape in CSS px) and self-contained HTML. The only external resource is Google Fonts, which will be self-hosted later. The notation is engraved with the Bravura outlines the app already ships (`js/render/glyphs.js`). The song covers are drawn from the real melodies in `js/music/songs.js`. To regenerate everything: `node docs/brand/concert/build/build.mjs` (add `--html` to skip the PNGs, or list page names to render only those pages).

---

## 1. Principles

1. **One spotlight per screen.** Each screen has exactly one gold, glowing call to action (Continue, Begin Level 12, Next exercise). Everything else is ivory on ebony.
2. **Music lives on paper.** Sheet music is always ink on a cream paper card (`--paper`), never light-on-dark. It reads like a real score on the music stand, and the eye learns where to look.
3. **The piano is the soundtrack.** During play the UI makes no sound in the piano's range (see §7). Feedback is visual: light, not noise.
4. **Concert words in headings, plain words on buttons.** "Bravo!", "Your programme", "I. Beginner" set the tone. Buttons always say exactly what they do: *Continue*, *Retry*, *Next exercise*, *Import MIDI*.
5. **Readable from the music stand.** At about 60 cm, nothing needed during play is smaller than 16 px bold. Live numbers are at least 22 px, and feedback chips use colour, an arrow and a word.

## 2. Brand

### The mark: "the Fermata"
A fermata (𝄐) is the conductor's sign for *hold this moment*. Drawn as an arch of light over a single point, it doubles as a spotlight over a performer or a note on stage. It is original geometry: a 25-unit outer arc with an elliptical inner arc (22.2 × 19.6). That makes the stroke thick at the crown and tapered at the feet, over a 4.9-unit dot.

```svg
<svg viewBox="4 12 56 40"><path d="M7 44A25 25 0 0 1 57 44H54.2A22.2 19.6 0 0 0 9.8 44Z"/><circle cx="32" cy="39.6" r="4.9"/></svg>
```

* **Gold (default):** metallic gradient `#F7E6B4 → #D9AE5C → #A87A2C` (160°). Flat gold `#D9AE5C` below 24 px.
* **Mono:** ink `#1D1A16` on paper, ivory `#F5EEDF` on stage, gold ink `#1E1606` on gold.
* **App icon:** ebony rounded square (`#241D16 → #0C0A08`) with a warm radial pool under the dot and a faint floor line. See `assets/maestro-app-icon.svg`. It reads at 40 px.
* **Live uses:** the fermata *is* the coach's avatar. Its dot breathes while the coach speaks (scale 1 → 1.12, 1.6 s, `--ease-in-out`) and while the mic is listening on setup screens.

### The wordmark
"Maestro" set in Fraunces 600 at optical size 144, outlined to SVG paths (`assets/maestro-wordmark.svg`, from `build/outline.py`). The final **o** is gold and sits under its own fermata arc, so the word ends on a held note. The r–o pair is opened by 90 units so the arc clears the r.

* The **primary lockup is the wordmark alone.** Do not put the mark beside it, because that shows two fermatas. Use the mark alone where space is square: app icon, favicon, coach avatar, loading.
* Clear space: the height of the "o" on all sides. Minimum size: 18 px tall (arc on), 14 px (use `arc: false`).
* On velvet or photography, use the wordmark without the arc (all ivory).
* Don'ts: don't recolour the arc separately from the o, don't stretch it, don't set "Maestro" in live text as a substitute.

## 3. Design tokens

All tokens are in `tokens.css`, ready to paste over `:root` in `css/style.css`.

### Colour

| Token | Hex | Role |
| --- | --- | --- |
| `--stage-950` | `#0A0807` | Deepest background (bottom of page gradient) |
| `--stage-900` | `#0F0C0A` | Page background, app `theme-color` |
| `--stage-850` | `#15110E` | Lane background under falling notes |
| `--stage-800` | `#1B1612` | Card surface |
| `--stage-750` | `#221C17` | Raised card / hero top |
| `--stage-700` | `#2C251E` | Pressed, track fills |
| `--stage-600` | `#3A3128` | Strong borders, empty week dots |
| `--ivory-50` | `#FCF8EF` | Highest-emphasis text |
| `--ivory-100` | `#F5EEDF` | Primary text |
| `--ivory-200` | `#E8DFCC` | Secondary emphasis |
| `--ivory-300` | `#D4C9B4` | Body copy on dark |
| `--ivory-400` | `#B3A892` | Muted text, captions (7.6:1 on stage-800) |
| `--ivory-500` | `#8F8574` | Labels, captions (4.9:1 on stage-800) |
| `--ivory-600` | `#6B6356` | Hairlines, empty step rings |
| `--paper` | `#FBF6EA` | Sheet-music card, song-card specimen, keyboard ivories |
| `--ink` | `#1D1A16` | Notation ink |
| `--ink-soft` | `#5B5346` | Counting, captions on paper |
| `--gold-100` | `#FBF0D2` | Text on gold-tinted surfaces |
| `--gold-200` | `#F3DDA5` | Champagne: links, "Great", highlighted numbers |
| `--gold-300` | `#E9C77F` | Eyebrows, icons, "Perfect" fill |
| `--gold-400` | `#D9AE5C` | Brand gold (flat) |
| `--gold-500` | `#C4953E` | Playhead, gradient foot |
| `--gold-600` | `#A07629` | Bronze: gold on paper (played-perfect notes) |
| `--gold-ink` | `#1E1606` | Text/icons on gold (11:1 on gold-300, 9:1 at the gradient's middle) |
| `--velvet-500` | `#8E2A3B` | Curtain accent: corner glows, Master stage |
| `--velvet-700` | `#4B1520` | Velvet surfaces |
| `--rh-400` / `--rh-500` | `#7DB0FF` / `#4F8FEA` | Right hand (falling notes, hint strip) |
| `--lh-400` / `--lh-500` | `#F6A07A` / `#E27B52` | Left hand |
| `--perfect` | `#E9C77F` | Timing tier ≤ ±35 ms |
| `--great` | `#F3DDA5` | Timing tier ≤ ±80 ms |
| `--offbeat` | `#F2A65A` | Early / Late (> ±80 ms), both directions |
| `--miss` | `#E8707E` | Missed note |
| `--wrong` | `#F0525F` | Wrong key heard |
| `--listening` | `#8FD1A6` | Mic live indicator, "easier" cue |
| `--paper-perfect` / `--paper-offbeat` / `--paper-miss` | `#A07629` / `#B85F1A` / `#B8384A` | The same tiers printed on paper |

Gradients: `--gold-grad` (buttons, chips: `#F4DC9F → #DDB263 → #C4953E`, 180°) and `--gold-metal` (mark, stars: 160°). The page background is `.stage-bg`: a warm top spotlight (`rgba(240,200,130,.15)` ellipse 760×460 at 50% −8%), two velvet corner glows at 12–16% and a 5% film grain (SVG turbulence, overlay blend).

Timing colours follow **tiers, not direction** (as osu!-style hit-error meters do). Direction is always carried by the word ("Early", "Late"), an arrow (‹ ›) and position on the meter. This keeps hand colours (blue and coral) and timing colours from clashing.

**Stage theme for `js/render/stage.js`** (`stage.setTheme({...})`):

```js
{ paper: '#FBF6EA', ink: '#1D1A16', inkSoft: 'rgba(29,26,22,0.35)', rh: '#7DB0FF', lh: '#F6A07A',
  hit: '#E9C77F', near: '#F2A65A', miss: '#E8707E', wrong: '#F0525F', playhead: '#C4953E',
  bg: '#0F0C0A', lane: '#15110E', laneLine: 'rgba(245,238,223,0.05)' }
```
Staff note results on paper use `--paper-perfect`, `--paper-offbeat` and `--paper-miss`, not the dark-UI tier colours.

### Typography
Both families are OFL, variable, and on npm: **`@fontsource-variable/fraunces`** and **`@fontsource-variable/manrope`** (static cuts: `@fontsource/fraunces`, `@fontsource/manrope`). Self-host the `latin` + `latin-ext` subsets (the library has Frère, Für, Gymnopédie). Fallbacks: `'Iowan Old Style', Palatino, Georgia, serif` / `-apple-system, 'SF Pro Text', system-ui, sans-serif`.

* **Fraunces** (display serif): headings, big numerals, the coach's italic asides. Keep `font-optical-sizing: auto` so large sizes get the high-contrast concert-programme cut. Roman weight 560, italic 420. Axes `SOFT 0` and `WONK 0` (the defaults).
* **Manrope** (UI sans): everything interactive and every live number, with `font-variant-numeric: tabular-nums` for scores, tempo and ms.

| Style | Font | Size / line | Weight | Use |
| --- | --- | --- | --- | --- |
| Numeral XL | Fraunces | 132 / 0.9 | 560 | Placement level reveal |
| Numeral L | Fraunces | 88 / 0.9 | 560 | Results accuracy % |
| Display L | Fraunces | 50 / 1.04 | 560 | Onboarding question, screen titles |
| Display M | Fraunces | 46–47 / 1.04 | 560 | Hero lesson title, "Songs" |
| Display italic | Fraunces italic | 50 / 1 | 460 | "Bravo!", combo pops (30) |
| Heading | Fraunces | 26 / 1 | 560 | Card and section titles |
| Title | Fraunces | 20–25 / 1.15 | 560 | Song card and option card titles, HUD title (22) |
| Body L | Manrope | 18–19 / 1.5 | 500 | Ledes, coach message (17.5) |
| Body | Manrope | 15–16 / 1.45 | 550–600 | Descriptions, list rows |
| Label | Manrope | 12 / 1, +0.16em, caps | 700 | Eyebrows, stat labels |
| Button | Manrope | 17 (primary XL 20) | 700 | All buttons |
| HUD number | Manrope | 25–26 / 1, tabular | 800 | Score, streak, stat tiles |
| Chip | Manrope | 16 / 1 | 800 | Timing chips (play) |
| Caption | Manrope | 13 / 1.3 | 600–650 | Meta, sub-labels |

### Radii, spacing, elevation

* Radii: `--r-xs 8`, `--r-sm 12` (icon tiles), `--r-md 16`, `--r-lg 22` (cards), `--r-xl 28` (hero, option cards, overlays), `--r-pill 999` (buttons, chips, segmented controls). Paper cards use 18. Falling-note bars use 9, and keys have 6 px bottom radius.
* Spacing: 4-pt grid (`--s-1` 4 through `--s-18` 72). Screen gutters are 28 px (home, songs) and 16 px (play canvas). Card padding is 18–24 px, and the gap between cards is 18 px.
* Elevation: `--e-1` (cards: 1 px inner top highlight plus a soft 24 px drop), `--e-2` (hero and overlays: 64 px drop), `--e-paper` (paper: white inner edge plus a deep drop so it floats on the stage), `--glow-gold` (primary CTA only).
* Hit targets: at least 44×44. Primary CTAs are 60–64 px tall, and the Continue button carries a 40 px dark "play dot".

### Layout (1180×820)
* **Home:** top bar 76 px. Grid of `1fr 348px` with an 18 px gap. The hero is 380 px tall, and the programme card fills the rest.
* **Play:** HUD 80 px, then a 3 px piece-progress line. Paper card 206 px (grand staff, 10 px staff space). Falling-note lane about 344 px (78 px per beat). Keyboard 154 px (C3–C6 = 22 white keys at 52 px). The playhead is fixed at x = 300 on the paper, and the hit line is the top edge of the keyboard.
* Other iPads: scale the play canvas vertically. Keep the keyboard at 150–170 px and the paper card at 24–26% of the height, and give the lane whatever remains.

## 4. Components

**Top bar.** Wordmark (30 px) · segmented tab rail (Learn, Songs, Practice, Free play, Progress; icons at 18 px, the active tab gets a raised ivory pill with a gold icon) · streak chip (flame + days) · XP chip · settings button. Settings stays an icon because it is rarely used.

**Buttons.** *Gold* (`--gold-grad`, gold-ink text, `--glow-gold`): at most one per screen. *XL gold* (64 px, with a play dot) is for Continue and Begin. *Ghost* (4% ivory fill, 14% ivory hairline) is for secondary actions (Hear it first, Retry). *Outline gold* is for tools (Import MIDI). *Quiet* is plain text (Skip). Pressed state: scale .97, 90 ms.

**Chips and filters.** 38 px pills with a count in 60% opacity. The selected chip is gold. The "Fits Level 12" toggle is a gold-outlined pill with a switch.

**Hero (Continue).** Eyebrow (stage · level) → Fraunces title → one-sentence concept → lesson steps (done, now, next; stepper pattern from MasterClass) → XL Continue plus "Hear it first" → mastery bar. On the right is a tilted **paper specimen** of the level's concept, engraved from the curriculum (dotted rhythms here, with counting under it) and lit by a soft spotlight beam.

**Today card.** A 92 px gold progress ring (XP today / goal) · "12-day streak" in Fraunces with a flame · the concrete remainder ("20 XP to go · about 5 minutes") · a week row (done = gold disc with check, today = dashed gold ring, future = empty). Week-dot pattern from Uxcel and Brilliant.

**Quick picks.** Three rows (song at your level, practice drill, free play), each with a 40 px gold-tinted icon tile and a chevron.

**The programme (learning path).** The 40 levels are drawn as a melody on a treble staff. Each stage ("movement", numbered I–V in Fraunces italic) is a rising scale, and barlines separate the stages. A final double bar and a fermata over Level 40 close it.
* Completed: gold filled notehead + stem + gold level number.
* Current: a notehead at 1.55× with a radial glow and a spotlight beam from above, a "YOU ARE HERE" flag and a gold pill number.
* Ahead: hollow (half-note) heads at 34% ivory. They stay tappable, because levels are never locked.
* Under each movement: name, `done/total`, and a 4 px progress bar.
* Tap a note to open a level sheet. Swiping the band scrolls it horizontally on smaller screens.

**Placement option card.** A 2×2 layout from Brilliant, shown here as 4 across: a paper **specimen** of what that experience looks like (a middle-C keyboard, a five-note melody, a grand staff, a dense two-hand passage), a Fraunces title, one line in the player's own voice, and "First test ≈ Level N". Selected state: gold hairline, 18% gold halo, gold check badge. Continue stays disabled (35% opacity) until a card is selected.

**Placement test header.** Eyebrow "PLACEMENT" + "Test 3 of ~7". Segmented progress: done segments gold, the current one partly filled with a halo, the rest empty, and the final segment **dashed** to show the total is an estimate ("~"). Per-test chips: "✓ Test 2 · Level 8". The **cue pill** has three states:
* ▲ gold: "A little harder · You aced test 2"
* ✓ ivory: "Same level again"
* ▼ sage (`--listening`): "A little easier · Let's steady the ground". Easier is never red, because stepping down is not failing.

The countdown overlay shows the upcoming test's hands, tempo and length.

**Level reveal.** A cone spotlight over a medallion. Inside it: "You're starting at", *Level* (Fraunces italic) and the numeral (132 px, gold gradient text). Around it runs a **circular caption** (textPath fitted with `textLength` so it closes exactly): "STAGE II · ELEMENTARY · LEVEL 12 · DOTTED RHYTHMS · PLACED BY EAR". Side panels show "How we found it" (a step chart of test levels with passes and stumbles, and the final level as a gold line) and "You can already" (ticks) plus "First lesson". CTAs: *Begin Level 12* (gold) and *Start from Level 1 instead* (ghost). The copy guarantees that lower levels stay open.

**HUD (play).** Exit · title (Fraunces 22) + green listening dot + "Level 12 · Exercise 2 of 3" · Score · Streak (×n) · **early/late meter** · Tempo|Wait segmented · tempo stepper (− ♩ 84 +) · Listen · Pause. Below it, a gold piece-progress line with bar ticks.

**Early | late meter.** 236×26 px. The track runs from −200 to +200 ms. Zones: ±35 ms solid gold, ±80 ms champagne, ±150 ms amber tint. The last 10 hits show as 3 px ticks coloured by tier, fading with age (35%→100%), and a small ivory ▼ marks the running average ("avg +18 ms"). Labels: "‹ EARLY" on the left, "LATE ›" on the right.

**Sheet card (paper).** A grand staff with an engraved brace, clefs and time signature. The playhead is a gold 2.5 px line with a small ▼ cap and a 52 px soft gold band. Played notes are re-inked by result (bronze for Perfect/Great, burnt orange for Early/Late, rose for Missed). The note under the playhead gets a gold glow. Notes fade out over the last 70 px before the clef, and measure numbers are Fraunces italic.

**Falling notes.** Bars have 9 px radius with a horizontal gradient in the hand colour, a 1 px inner highlight and the letter name at the bottom (15 px, 800). Bars slide *out from under the paper card*, so the music falls off the page. The bar being played brightens (a lighter gradient, an ivory 1.6 px edge and a 5 px gold outer glow). Octave guides sit at every C (7%) and F (3.5%).

**Keyboard.** Ivory keys (`#FBF6EA` with a slight gradient) and ebony keys with a lip highlight. States:
* **hit:** gold key, a light beam rising 230 px up the lane (42% → 0), a pool of light on the hit line and sparks
* **hint:** an 8 px hand-coloured bar at the bottom of the key for the next note of each hand
* **wrong:** the key gets a `--wrong` inner fill at 55% and a short shake (see §6)

C keys are labelled (C3, C4…).

**Timing chips.** 34 px pills, 16 px 800 text, with a tail pointing at the key. They appear just above the hit line, centred on the key.
* `Perfect`: solid gold
* `Great · 70 ms late`: dark fill, champagne outline and text
* `‹ Early · 150 ms` / `Late · 120 ms ›`: dark fill, amber outline and text
* `Missed`: rose

New chips on the same key stack upward and older chips drift up and fade. Keep at most 3 on screen at once.

**Combo pop.** At 10, 25, 50 and 100 in a row, a Fraunces italic line ("14 in a row", "Keep that pulse") appears in an empty part of the lane. Never place it over the notes.

**Results.**
* **Stars** (3, metallic gold; the middle one is larger and raised).
* **Accuracy ring** (250 px, gold arc = accuracy, circular caption with the exercise name).
* "Bravo!" (the headline depends on score, see §8) and a sub-line.
* **Coach card** (fermata avatar, "MAESTRO" + replay-voice icon, a message of 17.5 px).
* **2×2 stat tiles:**

  | Tile | Main | Detail |
  | --- | --- | --- |
  | Notes hit | 47/50 | most missed note |
  | On time | 88% | within ±80 ms |
  | Average offset | +18 ms | "slightly late" in amber |
  | Best streak | 21 | notes in a row |

* **Timing histogram:** 25 ms bins from −150 to +150. Bars are coloured by tier, the ±35 ms band is shaded, the average is marked with an ivory line and pill, the axis reads "◂ Early / On the beat / Late ▸", and a one-line diagnosis sits underneath.
* **Mastery strip:** the old mastery in dim gold and the new gain in glowing gold, "62% → 74%", plus XP and "Goal met" badges.
* Actions at the bottom right: *Retry* (ghost) and *Next exercise* (gold).

**Song card.**
* **Cover:** a 124 px duotone cover by category. It shows a "melody constellation": the song's first 26 right-hand notes as a piano roll, with the left hand as a dashed bass line underneath. It is generated from `songs.js`, so every cover is unique and true to the tune.
* **Title and composer:** Fraunces 20 title, composer in Manrope 13.5.
* **Level pill:** "Lv 12" with 5 stage pips.
* **Arrangement:** the name of the version that fits best.
* **Footer:** stars earned or "Not played yet", and the number of versions.
* **Tag:** "Level 12" (gold) or "Stretch" (outlined).

Category duotones:

| Category | Duotone |
| --- | --- |
| Kids & folk | Sage `#2F3B2A` / `#CFE3BF` |
| Holiday | Crimson `#40171D` / `#F4C9BE` |
| Hymns & ballads | Indigo `#23284A` / `#D2D1F4` |
| Classical | Bronze `#3A2A17` / `#F1D7A0` |
| Ragtime & blues | Teal `#13383B` / `#B9E6DE` |

The library groups songs into **Right at your level** (±2 levels) and **Stretch goals**. *Import MIDI* is an outline-gold tool button next to search.

## 5. Readability and beginner friendliness
* Play-critical sizes: HUD title 22, numbers 25, chips 16/800, falling-note letters 15/800, key labels 12/700. The paper staff uses a 10 px staff space on an 11" screen, the same size as a printed method book seen at 60 cm.
* Always pair colour with a word or an arrow (Early ‹, Late ›, ✓, ✕). Hand colours (blue and coral) are safe for protanopia and deuteranopia.
* Contrast (WCAG): ivory-100 on stage-800 is 15.5:1, ivory-400 is 7.6:1, ivory-500 is 4.9:1, gold-300 on stage-900 is 12:1, and gold-ink on the gold gradient is at least 9:1. Letters on falling bars are 6.4:1 (right hand) and 7:1 (left hand). The paper result inks are 3.8–5.3:1; they colour noteheads (large graphics), never small text.
* Beginner levels (1–8) switch on note letters in noteheads, finger numbers (right hand blue-ink `#1F4F9A`, left hand bronze `#9A4222` on paper) and, optionally, per-pitch colours (§9).

## 6. Motion

| Token | Value | Use |
| --- | --- | --- |
| `--t-press` | 90 ms | Button press (scale .97) |
| `--t-quick` | 160 ms | Chip select, toggles, hover-in |
| `--t-base` | 240 ms | Card enter, tab change |
| `--t-gentle` | 420 ms | Overlays, panels, the "curtain" |
| `--t-stage` | 700 ms | Spotlight fades, level cards |
| `--t-reveal` | 1200 ms | Level reveal, results sequence |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | Default for anything arriving |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | Breathing loops, the curtain |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | Chips, stars, badges (one small overshoot, never bouncy) |

**Screen transitions: "the curtain".** The outgoing screen dims to 60% and scales to .985 (240 ms). The incoming screen fades up from 12 px below (320 ms, `--ease-out`). Going *into* play, the page vignette closes to an iris around the paper card (420 ms). The HUD and keyboard then slide in from their edges (240 ms, staggered 60 ms).

**Hit feedback (per note, canvas).**
1. The key fills gold in 60 ms and decays to ivory over 380 ms.
2. A **light beam** (key width, 230 px) rises from the key at 42% and decays over 450 ms.
3. On Perfect only, a **ring** (ellipse on the hit line) expands from 0.6 to 1.25× the key width and fades over 420 ms.
4. **Sparks:** 10–14 gold motes (1.2–3.4 px) per hit rise 14–78 px with slight drift and a life of 600–900 ms, with additive blending. Cap: 120 motes.
5. The **chip** springs in (scale .8 → 1, 180 ms `--ease-spring`), holds 500 ms, then drifts up 24 px and fades by 1100 ms.
6. The played notehead on the paper is re-inked to its result colour over 160 ms.

**Misses and wrong notes.** A missed bar desaturates to 35% and slips under the keyboard. The key gets a rose outline pulse (200 ms), and there are no sparks. A wrong key gives a 3 px horizontal key shake (2 cycles, 160 ms) and a rose inner fill that fades in 300 ms. The wrong note is drawn on the paper in `--paper-miss` for 1 beat. Nothing flashes full-screen.

**Combo milestones.** The page spotlight swells 15% brighter for 600 ms and the italic combo line fades up (240 ms), then fades out after 1.4 s. There is no confetti mid-play.

**Countdown.** The ring drains from full to empty on each beat, and the numeral cross-fades with a 6 px upward move (160 ms).

**Results sequence** (total ≈ 2.4 s; tap skips it):
1. Spotlight up (0–400 ms).
2. Stars drop in at 250 ms intervals: scale 1.4 → 1 with the spring, a 120 ms glint sweep and a small gold-leaf burst per star.
3. The accuracy ring sweeps and the number counts up (900 ms, `--ease-out`).
4. "Bravo!" fades in italic.
5. Tiles stagger in at 60 ms intervals.
6. Histogram bars grow from the baseline in bin order, 40 ms apart.
7. The mastery bar fills its new segment last.

A gentle **gold-leaf fall** (40–50 flakes, 2–6 px, rotating, 2.5 s) plays only for 3 stars.

**Placement reveal.** The spotlight fades in (700 ms), the medallion rim draws (600 ms), and the circular caption rotates 12° into place while fading (1200 ms). The numeral counts from the first test level to the final level with a 60 ms tick per step, then settles with a spring. The side panels arrive last (240 ms, staggered).

**Idle loops.** The "you are here" note on the programme breathes (glow 70%↔100%, 2.4 s). The coach fermata dot breathes while speaking. There are no other loops.

**Reduced motion** (`prefers-reduced-motion`): no sparks, beams or leaf, cross-fades only (160 ms), and the count-ups jump straight to their values.

## 7. Sound design

The microphone is the product, so sound follows one hard rule. **While the mic is grading, any sound must have (almost) no energy below 10 kHz, or stay below −45 dBFS.** The transcriber analyses pitch up to 9.5 kHz and onsets up to 8 kHz (`js/audio/transcriber.js`), so content high-passed at ≥ 10.5 kHz is invisible to it. Everything else holds the mic via `AudioEngine.playSfx()` (it gates capture for the sound's duration) and is only used outside grading.

**Palette:** "celesta and felt". Soft sine/triangle bells in C major with a short, dark room (0.6 s). Nothing buzzes and nothing is sampled except the piano itself. Master UI level is −18 dBFS peak, 6 dB under the piano demo.

Mapping to the sound names in `js/audio/sfx.js`:

| Name | Where | Concert tuning |
| --- | --- | --- |
| `tap` | Buttons, cards (outside play) | Felt tick: 1.76 kHz sine, 25 ms, plus a 3 ms noise click. −28 dBFS |
| `toggle` | Switches, Tempo/Wait | Two felt ticks a fifth apart (up = on, down = off), 60 ms apart |
| `whoosh` | Screen change (curtain) | Pink noise, low-passed 2→6 kHz sweep, 300 ms, −30 dBFS. Reverse for back |
| `success` | Correct quiz answer, option chosen | Harp pluck G5 → D6 (90 ms apart), 700 ms decay |
| `bloop` / `error` | Not possible, wrong quiz answer | Wooden knock at 220 Hz, 60 ms, −26 dBFS. Never a buzzer |
| `countdown` / `countdown-go` | Count-in *before* the mic grades | Woodblock at 1.2 kHz, with "go" at 1.6 kHz and an accent. While the mic is live, use `count` instead |
| `harder` / `easier` | Placement cue pill (between tests) | Rising fourth C6→F6 celesta / falling third E6→C6, soft |
| `star1`–`star3` | Results stars | Celesta E6, G6, C7 (sine + 2×partial at 30%, 900 ms decay), synced to each star landing |
| `streak` | Streak or daily goal met (results) | Two-bell chord C6+E6 with a 1.2 s bloom |
| `levelup` / `complete` | Level up, lesson complete, **placement reveal** | Piano-sampled arpeggio C5–E5–G5–C6–E6 over 600 ms, with a quiet string pad swell under it (low-pass 1.2 kHz, 1.5 s, −30 dBFS). The reveal adds one tick per level as the numeral counts |
| `hit` (mic-safe) | Correct note in play | **Off by default.** An optional 12 kHz glint, 15 ms, −38 dBFS |
| `perfect` (mic-safe) | Perfect in play | **Off by default.** An "air shimmer": noise band-passed at 13 kHz (Q 3), 1 ms attack, 40 ms decay, −34 dBFS, high-passed at 10.5 kHz |
| `combo` (mic-safe) | Milestones 10, 25, 50, 100 | A glint pair at 11.5 kHz and 13 kHz, rising with the milestone level. −32 dBFS |
| `miss` / `wrong` (mic-safe) | Missed or wrong note in play | Silent by default: the visuals carry it. Optional airy falling swish from 14 to 11 kHz, −40 dBFS |
| `count` (mic-safe) | Metronome while grading | Hi-hat tick: noise high-passed at 11 kHz (as the current `tick()`), 18 ms, downbeat +4 dB, −28 dBFS |

Defaults: in-play sounds off except the metronome when the user enables it. A *Settings → Sound → "Sparkle on perfect notes"* toggle turns on `perfect`/`combo` for players who like it. Everything else is on and respects the iPad's silent switch where the platform allows.

**Voice (Web Speech API).** The coach never speaks while Tempo mode is grading (speech sits at 100 Hz–4 kHz, right on top of the piano). It speaks:
* before the count-in, with a 400 ms gap before the first click
* on results
* on the placement reveal
* in Wait mode only while the engine is *waiting* (the mic is held by `attachVoice`, with a 400 ms tail)

Voice choice: prefer an en-GB or en-US "enhanced" or "premium" local voice (Daniel, Serena or Samantha on iOS). Rate 0.95, pitch 1.0, volume 0.9. The on-screen text always mirrors what is spoken, and speech can be switched off.

## 8. Voice and copy

**Personality:** a warm conductor. Calm, specific and generous. Uses musical words, but explains them the first time. Short sentences. It praises the *music* ("lovely control of the dotted notes"), not the person's worth. It never says "wrong" or "failed", and never uses exclamation marks outside the results headline.

**Vocabulary**

| We say | Instead of |
| --- | --- |
| Your programme | Course, map |
| Movement I–V (Beginner…Master) | Unit, world |
| Stretch goal | Locked, too hard |
| Too hard, for now | Failed |
| Retry | Try again? / Replay |
| Bravo! / Beautiful. / Lovely. | Awesome!!! / Amazing job! |
| Hear it first / Listen | Demo |

**Results headlines by score:**

| Score | Headline |
| --- | --- |
| ≥ 95 | "Standing ovation." |
| ≥ 85 | "Bravo!" |
| ≥ 70 | "Lovely work." |
| ≥ 50 | "Getting there." |
| < 50 | "A first read." |

**Example coach lines**

* Setup: "Put me on the music stand and play middle C. I'm listening."
* Placement start: "Seven short pieces, getting harder. Play what you can; I'll find where you shine."
* Placement cue up: "You aced that one. The next is a little harder."
* Placement cue down: "Let's steady the ground with something a touch easier."
* Placement reveal: "You read both clefs with confidence. We'll begin at Level 12: dotted rhythms."
* Lesson intro: "A dot adds half again to a note. Long, short. Long, short. Let's hear it first."
* Before play: "Shoulders down, wrists level. When you're ready."
* Wait mode (while waiting): "Take your time. Find the E, right hand, third finger."
* Results, rushing: "You're a little ahead of the beat. Let the dotted notes breathe."
* Results, dragging: "You're arriving slightly late. Look one note ahead."
* Results, timing on: "Right on the beat. That's a pianist's pulse."
* Results, wrong notes: "Close. The piece wants F natural there, not F sharp."
* Results, many extra notes: "I heard a few extra notes. Take a breath and aim for each key."
* Retry suggestion: "Let's learn it in Wait mode first. No clock, just the notes."
* Level up: "Level 13: moving around the keyboard. Your hands are ready."
* Streak: "Twelve days in a row. That's how pianists are made."
* Daily goal: "That's today's practice done. Anything more is encore."

Rewrites for `js/coach.js` tips:

| Current | Rewrite |
| --- | --- |
| "Outstanding! Clean notes and steady rhythm." | "Standing ovation. Clean notes, steady pulse." |
| "Great playing!" | "Bravo. That was musical." |
| "Keep going. Accuracy first, speed later." | "Getting there. Notes first, speed later." |
| "That one was tough…" | "That one's a stretch. Let's learn it step by step in Wait mode." |

## 9. Note colours

**Hands (default at every level):** right hand `--rh-400` `#7DB0FF`, left hand `--lh-400` `#F6A07A`. Falling bars use a gradient from 400 to 500. Labels are drawn in the dark tone of the same hue (`#0E2A57` or `#4A1C09`), not white, so the letter reads on the bar at 15 px.

**Per-pitch (optional, beginner levels 1–8 and the "Note colours" setting).** Seven jewel tones at similar lightness, so no single note shouts:

| C | D | E | F | G | A | B |
| --- | --- | --- | --- | --- | --- | --- |
| `#EE7C7C` | `#F2A65A` | `#E9CF6A` | `#93D29F` | `#5CC6BE` | `#7DAEF5` | `#B596F0` |

A sharp or flat takes the colour of its letter (F♯ = F, B♭ = B) at 75% lightness, with a 45° hatch (2 px at 30% black) so it reads as "the black key of that letter". When pitch colours are on, the hand is shown by the bar's left edge (a 3 px blue or coral stripe) instead of the fill. On paper, per-pitch colour tints only the notehead, never the stem.

## 10. Mobbin references

Mobbin has no Flowkey, Simply Piano, Yousician or Skoove entries. Duolingo's Music course was the closest shipped piano learner, and the other patterns come from premium learning and music apps.

* **Duolingo · Music "Practice on your real piano" song list** (star filters, unit tags): https://mobbin.com/screens/1e355853-bc73-4fe0-8b5b-96c7824216b4 → level-fit sections and stars on the song cards.
* **Duolingo · Completing a song lesson** (note blocks with letters on a staff, keys with hand-colour edges, "Perfect!" at the playhead): https://mobbin.com/flows/a74bbb0c-c024-4536-9d7f-242851830c7c and https://mobbin.com/screens/1ccd10c2-415c-4a2d-8c09-2238a643511d → letter labels in falling notes, hint strips on keys, feedback at the hit line.
* **Duolingo · Completing a lesson to find level** (placement → "you should start with Section 2"): https://mobbin.com/flows/1acaf182-952f-47de-941d-250795337fb9 and https://mobbin.com/screens/24aaae49-d6dd-479e-913d-55740b8b25fc → a reveal that explains *why*, with one Continue.
* **Duolingo · Music path** (section header + nodes): https://mobbin.com/flows/93f3e3ec-a6f7-44c4-9319-81930368110a → the path as the home screen's backbone.
* **Duolingo · Lesson complete tiles** (labelled stat tiles): https://mobbin.com/screens/31fdc425-1a41-4b78-b4e6-762bff0b9306 → the 2×2 results tiles.
* **Brilliant · "What's your programming comfort level?"** (2×2 cards, each with a code specimen): https://mobbin.com/screens/575d5e50-529c-4e4b-86aa-3af687c6e924 → notation specimens on the experience cards.
* **Strava · "Where are you in your fitness journey?"** (title + one-line self-description): https://mobbin.com/screens/9abe1e4c-91ff-46bd-8304-247f8ff09446 → first-person option copy.
* **Mimo · Onboarding** (experience question, progress bar): https://mobbin.com/flows/a59b2d63-1c67-4f4c-9fac-e9565ee90657
* **Cleo AI · score reveal** (huge number in a warm glow): https://mobbin.com/screens/8c905f3c-e573-42b4-a31e-faf44c7606f2 → the Level 12 medallion in a spotlight.
* **CapWords · "75%" with circular "Congratulations" text**: https://mobbin.com/screens/63df033a-449e-4475-9406-c6b444af74c5 → circular captions on the reveal and the accuracy ring.
* **Brilliant · Lesson complete** (object on a lit pedestal, light beam): https://mobbin.com/screens/3c3cb198-8f28-4ed3-84e0-d9607f4da700 → the spotlight cone on results.
* **MasterClass · Home** (dark cinematic, one hero): https://mobbin.com/screens/f9ba0317-2f4f-4c85-9be0-3c0ed2f7c9a3 · **MasterClass · session stepper** (numbered steps with checks): https://mobbin.com/screens/330ee713-cd27-4070-b3e5-5331b79bf847 → the hero's warm-up, sight-reading and rhythm steps.
* **Apple Music · Browse by genre** (duotone category tiles): https://mobbin.com/screens/548b402d-4166-4705-9b59-988223bedbbf → category duotones on song covers.
* **Uxcel (web) · streak week dots**: https://mobbin.com/screens/1cc395af-aa0b-4148-89b9-7872d82a88a9 and **Brilliant (web) · streak card + Recommended/Start**: https://mobbin.com/screens/feb81e8d-d2f4-495e-b324-8a98c1a26129 → the Today card.
* **Babbel (web) · serif lesson titles on coloured cards**: https://mobbin.com/screens/d29cda65-34e4-456d-967f-fac1cc16a541 → a serif display face for learning content.
* **Unity Learn (web) · dark "Learning Pathways"**: https://mobbin.com/screens/50b17bad-5868-4664-9dd9-4ef22f6bc8fe → named movements with a badge each.
* **Google Photos · music picker with mood chips**: https://mobbin.com/screens/1619d2fe-4759-43b4-8e5d-d7f1debf9c64 → filter chips above a list.

## 11. Implementation notes
* **Fonts:** `npm i @fontsource-variable/fraunces @fontsource-variable/manrope`. Copy the `latin` and `latin-ext` woff2 files into `assets/fonts/`, declare `@font-face` with `font-display: swap`, and add them to the service-worker precache. Both are SIL OFL 1.1, so ship the licence text next to the files, as the app already does for Bravura.
* **CSS:** replace `:root` in `css/style.css` with `tokens.css`. Map `--bg → --stage-900`, `--card → --stage-800`, `--text → --ivory-100`, `--muted → --ivory-400`, `--accent → --gold-400`, `--good → --perfect`, `--warn → --offbeat`, `--bad → --miss`, `--rh/--lh → --rh-400/--lh-400`. Add `.stage-bg` as the body background.
* **Canvas:** call `stage.setTheme(...)` with the values in §3. Beams, rings and sparks already exist as `burst`, `rings` and `chips` in `stage.js`. Retint them gold and add the beam as a vertical gradient `fillRect` per active key. The paper card is a rounded rect with a radial fill; draw the lane *before* the paper so bars appear from under it.
* **Icons:** the mockups use an original 24 px, 1.8-stroke line set (in `build/build.mjs`, `ICON`). It replaces the emoji tiles on the current home screen.
* **Manifest and icon:** `theme-color` `#0F0C0A`, `background_color` `#0F0C0A`. Export `assets/maestro-app-icon.svg` to 180, 192 and 512 PNG.
