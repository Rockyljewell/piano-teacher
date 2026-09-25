# Maestro · "Arcade" direction

> **Your piano, your arcade. It listens. You level up.**

The Arcade direction gives Maestro the energy of a rhythm game (Yousician, Guitar Hero, Beat Saber, Rocksmith, the game moments in Duolingo Music) without losing what matters on a music stand: **calm, readable sheet music** and a **welcoming tone for adult beginners**.

Five principles:

1. **Stage lights, not casino lights.** The UI sits on a deep "arcade night" indigo. Colour and glow are kept for things that *happen*: a hit, a combo, a new best. At rest the screen is quiet.
2. **Paper stays paper.** Notation is always dark ink on a cream card. The arcade effects live around the music, never on top of it.
3. **One bright button.** Every screen has exactly one Volt (lime) action. It is the only lime element on screen.
4. **Timing you can feel.** Every note gets a chip (PERFECT / GREAT · 70 ms late / EARLY · 150 ms). Cool colours mean early and warm colours mean late, the same everywhere: chips, meter, histogram and paper.
5. **Readable at 60 cm.** Anything you read while playing is at least 20 px, numbers at least 26 px, and targets at least 52 px.

---

## 1. Deliverables

| File | What it is |
|---|---|
| `home.html` / [`home.png`](home.png) | Home: continue hero, stage path (levels 9–16), 40-level "journey" equaliser, daily goal + streak, Songs / Practice / Free play / Progress, song pick |
| `placement-1-experience.html` / [`.png`](placement-1-experience.png) | "Have you played piano before?" with 4 options |
| `placement-2-test.html` / [`.png`](placement-2-test.png) | Placement test: "Test 3 of ~7", harder/easier cue, "zeroing in" estimate, count-in |
| `placement-3-reveal.html` / [`.png`](placement-3-reveal.png) | "You're starting at Level 12" reveal |
| `play.html` / [`play.png`](play.png) | Play screen: HUD, paper score, timing rail (early/late meter), falling notes, timing chips, keyboard |
| `results.html` / [`results.png`](results.png) | Results: stars, accuracy gauge, stat tiles, timing histogram, coach message, Next / Retry |
| `songs.html` / [`songs.png`](songs.png) | Song library: category filters, piano-roll covers, level ranges, Import MIDI |
| `brand-sheet.html` / [`brand-sheet.png`](brand-sheet.png) | Wordmark, app mark, Mo mascot, palette, type, components, pitch colours |
| `tokens.css` | Drop-in design tokens (CSS custom properties) |
| `svg/maestro-wordmark.svg`, `svg/maestro-wordmark-mono.svg` | Wordmark as outlined paths (no font dependency) |
| `svg/maestro-lockup.svg` | Mark + wordmark lockup |
| `svg/maestro-mark.svg` | App mark (squircle, transparent corners) |
| `svg/maestro-app-icon-1024.png`, `svg/maestro-app-icon-180.png` | Full-bleed square icons for the manifest and `apple-touch-icon` (the OS applies the mask) |
| `svg/mo-hello.svg`, `svg/mo-listening.svg`, `svg/mo-encore.svg` | Mascot poses |

Every mockup is a self-contained HTML file with inline CSS, an inline SVG sprite, and Bravura glyphs copied from `js/render/glyphs.js`. Each is authored at **1180 × 820** (iPad Air / iPad 10th gen, landscape). Only the fonts load from Google Fonts. The PNGs were rendered with Playwright at 1180 × 820, deviceScaleFactor 1.

---

## 2. Research (Mobbin)

Yousician, Simply Piano, Flowkey and Skoove are **not indexed on Mobbin**: searches for them returned other apps. **Duolingo Music** is the closest music-learning product Mobbin has, so it carries most of the music-specific references. The general rhythm-game conventions (combo multiplier, hit line, judgement text) come from the genre itself (Guitar Hero, Beat Saber, Rocksmith).

| Pattern copied | Reference | How Maestro uses it |
|---|---|---|
| Section header + 3D "coin" nodes on a winding path, with a callout on the current node | [Duolingo path](https://mobbin.com/screens/3ecf07e8-cea8-4414-b5d9-05cd21033429), [Duolingo Music path](https://mobbin.com/screens/81df0dd4-c52b-436a-9885-e1343c2c552f) | Stage path card with coins, stars under cleared levels, a "YOU" flag and pulse ring on the current level |
| Path with locked nodes and a bottom Start card | [Brilliant](https://mobbin.com/screens/ec3fe703-fe07-489e-92a5-45eb5b3d4720), [Mimo](https://mobbin.com/screens/f83964b8-5a63-4abf-bc32-726991f82a82) | Lock glyph on dimmed coins. The CTA sits in a hero card instead, because landscape has room |
| Judgement text + glow burst at the hit point, combo count next to it | [Duolingo Music "Perfect!"](https://mobbin.com/screens/32ee1c70-7f9d-494b-bd0d-7871cb911650), ["Great! ×12"](https://mobbin.com/screens/907ba910-67eb-45f1-bf53-7195f3c84c6c), ["Oops"](https://mobbin.com/screens/1ccd10c2-415c-4a2d-8c09-2238a643511d) | Timing chips on the hit line, gold burst + sparks, ×4 multiplier ring in the HUD |
| "Play E to start" (the music waits for the first note) | [Duolingo Music](https://mobbin.com/screens/c2d8e4de-97f6-4d73-b088-609eb1d82301), [key highlight](https://mobbin.com/screens/ac438966-0f8e-4be4-9ad6-1e9d2ec55c65) | Hint dots on the next keys; the count-in card on the placement test |
| Arc gauge with stars on it + 3 stat tiles | [Duolingo Music "Song complete!"](https://mobbin.com/screens/c5bc0107-ffbb-4322-b95a-0108ef5b585f) | Results accuracy gauge + stat tiles |
| Stat tiles with a coloured header band | [Duolingo Lesson complete](https://mobbin.com/screens/31fdc425-1a41-4b78-b4e6-762bff0b9306) | Notes hit / On time / Avg offset / Best streak tiles |
| XP + daily-goal bar on completion | [Mimo](https://mobbin.com/screens/b5772854-5c51-4fca-b828-0df669bfa4d4), [Brilliant](https://mobbin.com/screens/3c3cb198-8f28-4ed3-84e0-d9607f4da700) | "+45 XP" pill, daily goal ring on Home |
| Confetti + big score number | [Nibble](https://mobbin.com/screens/547a04b7-6c0d-4ccb-9196-0c23588d9638) | Results and level reveal |
| Level badge reveal on a light burst | [Liven "Level up"](https://mobbin.com/screens/85f59a4b-98e0-462e-aa63-2e6fcac06911), [Numo new level](https://mobbin.com/screens/471775a4-fb1c-42ac-9e6c-72cf8acece92), [Runna badge](https://mobbin.com/screens/0e8a24e7-31ae-4657-bc16-6ace3abc70ea) | Shield badge "LEVEL 12 · ELEMENTARY" on rays |
| Mascot speech bubble asks the question; answers show signal bars 1–4 | [Duolingo onboarding flow](https://mobbin.com/flows/ac9d2f58-868d-4fd3-a79c-9655ce6b1522) | Mo asks "Have you played piano before?"; options show 1–4 equaliser bars |
| Test lesson → "you should start with Section 2!" | [Duolingo find-my-level flow](https://mobbin.com/flows/1acaf182-952f-47de-941d-250795337fb9) | Placement test → Level 12 reveal |
| Experience level + level picker | [Mimo onboarding](https://mobbin.com/flows/a59b2d63-1c67-4f4c-9fac-e9565ee90657), [Speak "Select your level"](https://mobbin.com/flows/63a9fe3e-eed7-4f85-9b55-98fbb2f6f20f) | "Tests begin near Level N" footer on each option: honest about what happens next |
| Song list with difficulty filters, "Practice on your real piano" | [Duolingo Music songs](https://mobbin.com/screens/1e355853-bc73-4fe0-8b5b-96c7824216b4), [song search](https://mobbin.com/screens/3dc9ead7-cbb6-430a-9b0d-3c84b23ff256) | Category chips with counts, "Near Level 12" toggle, level-range badge |
| Filter chips (genre, tempo) | [Epidemic Sound](https://mobbin.com/screens/9d32d58b-75bf-43c1-b7b1-c9ecb9c2727e) | Category chips with coloured dots |
| Streak with a week row | [Numo](https://mobbin.com/screens/a3ac24c6-bba2-4c93-ac2e-86c4f6462ec3), [Yazio](https://mobbin.com/screens/84b1eadf-f94e-43a7-84e6-838d039aeaa1), [Duolingo streak](https://mobbin.com/screens/739be3b0-b1a3-4d8b-a2aa-e387c07be210), [LinkedIn Wend](https://mobbin.com/screens/ac97796a-bc39-417a-a3ec-b92d96040c1d) | Flame + count + M–S dots, today ringed |
| Dark game dashboard: neon gradient hero, lime CTA | [Higgsfield (web)](https://mobbin.com/screens/f0f1c0dc-fe89-4199-8a10-26f572d4a9ae), [Discord Quests (web)](https://mobbin.com/screens/d0f477e9-496c-4993-b7a4-d3baa5b81126) | Arcade-night surfaces, Volt CTA on indigo |

**Original ideas added on top:**
- the **journey equaliser**: all 40 levels as EQ bars that grow taller as the music gets harder
- **piano-roll song covers**: each cover draws the song's opening melody as neon bars
- the **timing rail** between the score and the falling notes
- **grade-coloured noteheads** on the paper after you play them
- the **"zeroing in"** estimate during placement

---

## 3. Brand

### Wordmark
"MAESTRO" set in **Unbounded Black** and converted to outlines (`svg/maestro-wordmark.svg`). The final **O is a whole note**: an oval outline with a counter tilted −34°. The pun reads as an O first and as a note second.
- The primary version is filled with the neon gradient (#8C6BFF → #FF3FA4 → #FFA24A). On dark backgrounds it gets a 3D extrude: the mono wordmark in #2B1C8C, offset (+3, +6) px at 72 px height.
- The mono version uses `--paper-ink` #1B1733 on paper/light, or #FFFFFF on photos.
- Minimum height is 16 px. Clear space is the height of the O on every side.
- Don't: skew it, outline it, put the gradient on a light background, or add the stem back (a stem turns the O into a "d").

### App mark
Mo's note-head on a stage-light squircle (indigo #3A2A9E → #120E3A with a pink glow), standing on the neon **hit line**: "the moment a note lands". The mark works down to 24 px. For the home-screen / PWA icon use the full-bleed PNGs, because iOS applies its own mask.

### Mascot: Mo
Mo is an eighth note with a lot of rhythm. The body is a tilted note-head in a pink-to-orange gradient, the stem is white and the flag is Volt lime, which makes it read like a quiff.

| Pose | Symbol / file | Use |
|---|---|---|
| Hello (waving) | `#mo` / `mo-hello.svg` | Home hero, tips, coach bubble, empty states |
| Listening (headphones) | `#mo-listen` / `mo-listening.svg` | Mic setup, placement tests, "Listen" mode, "I can't hear you" |
| Encore! (arms up, happy eyes) | `#mo-cheer` / `mo-encore.svg` | Results ≥ 1 star, level reveal, streaks, new best |

- **Personality:** a friendly stage-hand who has seen every concert. Cheerful, never sarcastic, never disappointed.
- **Rules:** Mo **never appears during play** (no distraction and no face over the music). Mo is at most 220 px tall and is never cropped by the screen edge. Mo does not cry or frown: a poor result gets the Hello pose with an encouraging line.

---

## 4. Design tokens

All tokens live in [`tokens.css`](tokens.css). Contrast ratios are computed with the WCAG formula.

### 4.1 Colour: surfaces & text

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--ink-0` | `#07061A` | keyboard well, toggles' track, overlays | |
| `--bg` | `#0E0C2A` | app background ("arcade night") | |
| `--bg-2` | `#131036` | play-field background | |
| `--surface-1` | `#1A1744` | cards | |
| `--surface-2` | `#231F58` | raised cards, secondary buttons, inputs | |
| `--surface-3` | `#2E2972` | selected segment, hover | |
| `--stroke` / `--stroke-2` | `rgba(177,166,255,.14 / .28)` | hairlines / control outlines | |
| `--text` | `#F5F3FF` | primary text | 17.3:1 on bg |
| `--text-2` | `#C4BFEA` | secondary text | 10.9:1 on bg · 9.6:1 on surface-1 |
| `--text-3` | `#938DCB` | labels, captions | 6.3:1 on bg · 5.5:1 on surface-1 |

Page background: `--bg` plus two soft radial "stage lights": violet `rgba(123,92,255,.34)` at the top-left and pink `rgba(255,63,164,.20)` at the bottom-right.

### 4.2 Colour: brand

| Token | Hex | Use |
|---|---|---|
| `--volt` | `#C8FF3D` | **the** primary action. Always with `--ink` #0E0C2A text (16.1:1) |
| `--volt-edge` | `#5B9A0C` | 3D lip under Volt buttons |
| `--grad-volt` | `#E2FF7A → #C8FF3D → #A9F02B` (vertical) | Volt button fill |
| `--grad-neon` | `#7B5CFF → #FF3FA4 → #FF9A3D` (100°) | wordmark, hit line, progress bars, "New best", playhead band |
| `--violet` `--pink` `--orange` | `#7B5CFF` `#FF3FA4` `#FF9A3D` | gradient stops, accents |
| `--gold` / `--grad-gold` | `#FFD23F` / `#FFE98A → #FFD23F → #F5A623` | stars, Perfect |
| `--mint` `--sky` `--coral` | `#3DF5B0` `#4CC3FF` `#FF5A6E` | semantic support |

### 4.3 Colour: timing semantics ("cool = early, warm = late")

| Grade (engine) | Chip label | Dark UI | On paper (played notehead) |
|---|---|---|---|
| `perfect` | ★ PERFECT | `--perfect` #FFD23F (gold gradient + glow) | `--paper-perfect` #9A6A00 (4.5:1) |
| `great` | GREAT · 70 ms late | `--great` #3DF5B0 | `--paper-great` #0A8559 (4.4:1) |
| `good`/`ok`, early | ◀ EARLY · 150 ms | `--early` #A493FF | `--paper-early` #5B45D6 (6.1:1) |
| `good`/`ok`, late | LATE · 120 ms ▶ | `--late` #FF9A3D | `--paper-late` #BF5510 (4.4:1) |
| miss | MISSED (outline chip) | `--miss` #FF5A6E (6.3:1 on bg) | `--paper-miss` #C42A45 (5.3:1) |

All chip text is `--ink` on the fill (7.4–13.5:1). **Colour is never the only cue:** each grade also has a word, an arrow for direction (◀ early, late ▶) or a star.

### 4.4 Colour: hands, stages, paper

| Token | Hex | Use |
|---|---|---|
| `--rh` | `#35D6FF` | right-hand falling notes, key glow, notehead halo (10.6:1 on field) |
| `--lh` | `#FF5FB7` | left-hand falling notes, key glow (6.6:1 on field) |
| `--st-1` … `--st-5` | `#3DF5B0` `#4CC3FF` `#A493FF` `#FF5FB7` `#FFD23F` | Beginner 1–8 · Elementary 9–16 · Intermediate 17–26 · Advanced 27–34 · Master 35–40 |
| `--paper` | `#FFF8EA` | sheet-music card (subtle vertical gradient `#FFFBF2 → #FFF8EA → #FBF1DC`) |
| `--paper-ink` | `#1B1733` | notation (16.3:1) |
| `--paper-line` | `#6A6384` | staff lines (5.3:1) |
| `--paper-muted` | `#7E7896` | bar numbers, fingering (4.0:1, ≥ 12 px bold) |

Song category colours (chips and covers): Kids & folk #1FD696 → #0A7A5C · Holiday #FF5A6E → #B3244A · Hymns & ballads #A493FF → #5B3FD9 · Classical #4CC3FF → #2A4FD9 · Ragtime & blues #FF9A3D → #D9406A.

### 4.5 Pitch colours (beginner mode)

These are used when `settings.noteColors` resolves true (`'auto'` = levels 1–8). The 12-step neon wheel replaces `NOTE_COLORS` in `js/render/stage.js` index-for-index. The note name or finger number stays printed inside every bar.

| C | C♯ | D | D♯ | E | F | F♯ | G | G♯ | A | A♯ | B |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `#FF4D5E` | `#FF6E3D` | `#FF9A3D` | `#FFC23D` | `#FFE14D` | `#B6F03D` | `#3DE88A` | `#3DF5C8` | `#3DD2FF` | `#4C8DFF` | `#7B6CFF` | `#B45CFF` |

In beginner mode left-hand bars keep the pitch colour and get a 2 px `--lh` outline (the renderer already marks LH notes when colours are on).

### 4.6 Type

| Role | Font (npm, licence) | Weight | Size / line | Notes |
|---|---|---|---|---|
| Display XL (level reveal) | **Unbounded** (`@fontsource-variable/unbounded`, OFL-1.1) | 900 | 150/0.9 | letter-spacing −0.04em |
| Display L (accuracy, hero level) | Unbounded | 900 | 64–86/0.9–1 | −0.02 to −0.03em |
| Display M (screen titles) | Unbounded | 800–900 | 34–44/1.05 | |
| Headline S (card titles) | Unbounded | 800 | 18–20/1 | |
| HUD numbers | Unbounded | 800 | 26–28/1 | `font-variant-numeric: tabular-nums` (Unbounded has `tnum`) |
| CTA label | Unbounded | 800 | 20–24/1 | UPPERCASE, +0.04em |
| Title | **Lexend** (`@fontsource-variable/lexend`, OFL-1.1) | 700 | 20–28/1.15 | |
| Body L (anything read while playing, coach) | Lexend | 500 | 19–20/1.4 | **minimum while playing** |
| Body (menus) | Lexend | 400–500 | 16–18/1.4 | |
| Label | Lexend | 700 | 12–13/16 | UPPERCASE, +0.14em, `--text-3` |

Why these two: Unbounded's wide, rounded geometry gives arcade scoreboards their punch and has tabular figures. Lexend was designed to improve reading fluency, which suits adult beginners reading from a stand. Lexend has **no `tnum`**, so every number that changes live (score, ms, BPM, combo) is set in Unbounded.

**Readability at ~60 cm:** 1 CSS px ≈ 0.19 mm on an 11″ iPad (2360 px at 264 ppi across 1180 CSS px). Lexend at 20 px gives a ~2.7 mm cap height, about 15 arc-minutes at 60 cm, which is comfortable (≈ 3× the legibility threshold). Hence: play-time text ≥ 20 px, chips ≥ 15 px bold, HUD numbers ≥ 26 px. The staff space is **12 px (≈ 2.3 mm, slightly larger than printed music)**, or 14 px when only one staff is shown.

### 4.7 Radii, spacing, elevation

| Radii | px | Use |
|---|---|---|
| `--r-xs` | 8 | tags, level pill |
| `--r-s` | 12 | chips on the hit line, small buttons |
| `--r-m` | 18 | buttons, inputs |
| `--r-l` | 24 | cards |
| `--r-xl` | 32 | sheets, reveal cards |
| `--r-pill` | 999 | pills, filter chips |

**Spacing:** 4-pt scale `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Screen gutters are 24 px (menus) and 16 px (play). The gap between cards is 16 px.

| Elevation | Value |
|---|---|
| `--sh-card` | `inset 0 1px 0 rgba(255,255,255,.06), 0 18px 40px -12px rgba(3,2,18,.7)` + `inset 0 0 0 1px var(--stroke)` |
| `--sh-lip` (3D secondary buttons, coins) | `0 6px 0 #0A0822` (pressed: `0 2px 0`, translateY 4px) |
| Volt button | `0 6px 0 #5B9A0C, 0 18px 40px -10px rgba(200,255,61,.55), inset 0 2px 0 rgba(255,255,255,.65)` |
| Glows | pink `0 0 28px rgba(255,63,164,.55)` · gold `0 0 26px rgba(255,210,63,.6)` · hand bars `drop-shadow(0 0 10px <hand> @55%)` |

---

## 5. Components

Sizes are at 1180 × 820. Touch targets are ≥ 52 px (≥ 44 px only for secondary chips).

**Buttons**
- **Volt CTA:** 56 px tall (XL: 64–72 px), radius 18–22, Unbounded 800 UPPERCASE, icon 24–26 px. One per screen.
- **Secondary:** `--surface-2` with a 1.5 px `--stroke-2` inset and the `--sh-lip` lip.
- **Ghost:** text only, `--text-2`.
- **Icon button:** 52 × 52, radius 16, 4 px lip.
- **Pressed state:** the lip collapses (translateY 4 px, shadow 6 → 2 px) over 90 ms. There is no scale on press, because it feels mushy on glass.

**Chips & toggles**
- **Filter chip:** 44 px tall, pill. The selected chip is inverted (`--text` fill, `--ink` text). A count sits in a 13 px/60% suffix, and a category dot is 10 px.
- **Segmented toggle (Tempo | Wait):** `--ink-0` track with 4 px padding. Segments are 40–44 px, with a metronome / hourglass icon and a label. The active segment is `--surface-3` with a lip.
- **Switch:** 54 × 32 Volt track with a white knob.

**Level coin (path node):** 58–64 px circle. Stage-colour fill with a top-left specular highlight and a 6 px darker lip.
- **Current:** 74 px white coin with a 6 px stage-colour halo, a pulse ring, and a "YOU" flag.
- **Locked:** `--surface-2` with a lock glyph.
- **Stage finale:** trophy glyph.
- Stars (15 px) sit under cleared coins. The title below each coin is 12.5 px, at most 2 lines.

**Stage path card:** header ("STAGE 2" label + "Elementary" Unbounded 20 + "3 of 8 cleared" bar + "All 40 levels ›"). Coins sit on a zig-zag bezier. The cleared part of the line is a solid stage-colour glow; the rest is dotted (`2 11` dash).

**Journey equaliser:** 40 bars in 5 stage groups, 16 px apart. Bar height = `16 + 60·(n−1)/39` px. Cleared bars are filled with the stage colour plus a glow. The current bar is white with a halo and a number flag. Locked bars are outline-only at 16% fill. Stage names sit under each group. The same component is reused, smaller, in the placement "zeroing in" meter and the reveal.

**Daily goal ring:** 104 px. The track is 12 px at 14% lavender; the fill uses the Volt gradient, has a round cap and glows. The ring shows the XP in Unbounded 30 with "of 50 XP" underneath.
**Streak:** a 38 px flame (#FF7A3D → #FFE98A core) and Unbounded count. The week row has 30 px dots: done dots are orange-filled with a check, today is ringed.

**Entry tile:** 40 px icon squircle in its own gradient, title Lexend 17 700, subtitle 13.5 px on 2 lines. Songs are pink, Practice sky, Free play mint, Progress gold.

**Song card:** 256 px tall.
- **Cover (128 px):** the category gradient, a soft highlight circle, 5 faint "staff" lines, and the **opening melody drawn as 12 px neon bars**. Bar x = duration and bar y = pitch.
- **Cover overlays:** a category tag (dark glass) top-left, a level-range pill top-right in the stage colour of the main arrangement ("LV 1–12"), best stars in a dark pill bottom-right, and a gold "▲ STRETCH GOAL" tag when the easiest arrangement is more than 4 levels above the player.
- **Body:** title Lexend 18 700, composer 14 px `--text-3`, and arrangement pills ("RH 1", "Both 12"). Pills are filled in the stage colour once they have 3 stars.
- **Import MIDI:** a header button plus a dashed Volt card in the grid ("Import a MIDI file").

**HUD (play):** 60 px tall.
- **Left:** level coin (46) + title (Lexend 20 700) + subtitle.
- **Centre scoreboard:** an `--ink-0` capsule holding SCORE (Unbounded 27 tnum) | the multiplier ring (48 px, Volt arc = progress to the next tier, "×4" inside) + flame + "23 IN A ROW".
- **Right:** tempo stepper (− ♩ 96 +, 52 px), Tempo | Wait toggle, Listen (speaker), Pause (52 px).
- Nothing in the HUD animates except score, combo and ring.

**Paper score card:** radius 20, cream gradient, soft drop shadow.
- **Playhead:** a 3 px `--pink` line with top and bottom notches, over a 52 px pink band (22% at the centre).
- **Current notes:** a 15 px halo in the hand colour plus a 2.4 px ring.
- **Played noteheads:** recoloured in their `--paper-*` grade colour, so the page becomes a timing trail.
- **Details:** fingering in `--paper-muted` 12 px bold; bar numbers 13 px.

**Status strip** (40 px, between paper and field):
- **Left:** "Listening" mic pill with a 5-bar live level.
- **Centre:** the **timing rail** (early/late meter).
- **Right:** "Bar 3 of 16" + progress.

**Timing rail:** a 330 × 12 px track with a gradient: early violet → transparent → gold perfect zone (the middle 12%, outlined) → transparent → late orange. The last 8 hits are white ticks whose opacity fades with age. The latest hit is a 16 px white diamond with a gold halo. The track spans ±150 ms and the perfect zone follows the level's timing profile (±45 ms shown).

**Falling notes:**
- **Lanes:** aligned to keys; black-key lanes are darker. There is a brighter guide at every C, beat lines at 8% and bar lines at 22%.
- **Bars:** 70% of the key width (50% on black keys), radius 10, hand-colour gradient with a white top highlight and a glow. A finger number sits in a 22 px dark circle at the bottom.
- **Hit line:** a 3 px neon gradient with a 10 px 28% glow.

**Timing chip:** 36–40 px tall, radius 12, Lexend 800 15–17 px UPPERCASE grade plus 600-weight detail ("· 70 ms late"). It is anchored to the lane, with its bottom 12 px above the hit line.

**Keyboard:** white keys have a #FFFFFF → #F1EEF8 → #D9D3EA gradient and 8 px bottom radius. Black keys are #2C2766 → #110E33 with a key-front highlight. The well is `--ink-0`.
- **Pressed:** fills with the hand colour gradient plus a 14 px glow.
- **Next-note hint:** a 14 px hand-colour dot near the key front.
- **Labels:** C labels (C3, C4…) 13 px.

**Results:**
- **Gauge:** 300 px, a 270° arc, a 20 px stroke using the neon gradient + glow. It shows "96%" in Unbounded 86 over the label "ACCURACY", with a "NEW BEST · +14" tag.
- **Stars:** 82 / 100 / 82 px, gold with a 6 px dark-gold lip and a glow.
- **Stat tiles:** 3 px coloured frame + header band (11.5 px UPPERCASE ink) + inner value in Unbounded 27 with a 13.5 px caption.
- **Histogram:** 21 bins of 15 ms (−150…+150). Each bar takes the colour of its grade zone and carries a count label. The perfect zone is a dashed box, and a white "avg +18 ms" pill sits under the axis.
- **Coach card:** Mo Encore pose with the spoken line in Lexend 19 500.
- **Hands-free:** a 36 px Volt countdown ring ("Next in 5 s") next to Retry and Next.

**Placement:**
- **Experience cards:** 4 across, 300 px tall. Each has an equaliser icon with 1–4 bars lit, a title (Lexend 25 700) and a detail (Lexend 18). The footer says "Tests begin near **Level N**" (1 / 4 / 12 / 25, the prior means in `placement.js`). The selected card gets a 3 px Volt ring, glow, a lift of −6 px and a check badge.
- **Test pips:** 58 × 34. Done pips show the tested level + ▲/▼. The current pip is white with a glow. Likely tests are striped. Possible extra tests are dashed at 45% opacity, which is how "~7" is communicated.
- **Cue card:** a violet (easier ▼) or mint (harder ▲) arrow tile plus "A bit easier / Level 14 was a stretch (48%)".
- **"Zeroing in" meter:** a mini equaliser of all 40 levels. The credible band (10th–90th percentile, from `estimate()`) is lit sky blue, tested levels carry dots (passed mint, too hard violet), and the current test is white.
- **Reveal badge:** a 300 px shield in the stage-colour gradient with a white rim, a 12 px dark lip and a glow. It holds "LEVEL" and "12" in Unbounded 150, plus a stage ribbon.

---

## 6. Layout (play screen)

| Region | y (px) | Rule on other iPads |
|---|---|---|
| HUD | 12–72 | fixed 60 px |
| Paper card | 84–308 | ~27% of height, min 200 px; two staves at 12 px staff space |
| Status strip | 316–356 | fixed 40 px, overlaps the field top (notes emerge from under it) |
| Falling field | 356–634 | flex; ≥ 4 beats of look-ahead at the current tempo |
| Hit line | 634 | |
| Keyboard | 640–806 | ~20% of height, min 150 px; 20 white keys (F2–D5 here); range follows the piece |

Respect the safe-area insets. The same proportions hold on 1024 × 768, 1133 × 744 (mini) and 1366 × 1024 (12.9″), because only the field flexes.

---

## 7. Motion

**Principles:** reward = overshoot, information = ease-out, exits = fast.
- Only `transform` and `opacity` are animated in the DOM. The field and particles run on the existing canvas, driven by the AudioContext clock.
- Live particles are capped at 120.
- `prefers-reduced-motion` turns off particles, shakes, ray rotation and count-ups, and keeps ≤ 150 ms fades.

| Token | Value | Use |
|---|---|---|
| `--t-tap` | 90 ms | press / lip collapse |
| `--t-fast` | 160 ms | chips in, toggles, rail ticks |
| `--t-base` | 240 ms | cards, sheets |
| `--t-slow` | 420 ms | screen transitions, gauge segments |
| `--t-reward` | 700 ms | stars, badge landings |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | default |
| `--ease-pop` | `cubic-bezier(.34,1.56,.64,1)` | rewards (≈ 10% overshoot) |
| `--ease-in` | `cubic-bezier(.55,0,1,.45)` | exits |

### Hit feedback (per note)

| Event | Visual |
|---|---|
| Any hit | The bar flashes white (0–80 ms), then is consumed downward into the hit line. The key glows in the hand colour (60 ms in, 220 ms release). A radial burst ellipse (rx 60–70) scales 0.6 → 1.2 and fades over 280 ms. |
| **Perfect** | Gold burst plus **14 sparks**: 4-point stars, white/#FFE98A, 4–9 px, initial speed 180–320 px/s in a ±60° upward cone, gravity 900 px/s², life 420–600 ms, fading over the last 40%. Plus a 3 px #FFF6C8 outline on the bar. |
| **Great** | Mint burst, 8 sparks. |
| Early / Late | Violet or orange burst, 4 sparks, no outline. |
| Miss | No burst. The bar slides past the hit line, desaturates to 35% with a coral outline and fades over 300 ms. The paper notehead turns `--paper-miss`. No red flash and no shake. |
| Wrong extra note | A 120 ms coral key tint on the keyboard only. |

**Timing chip lifecycle** (≈ 1 s):
1. Pops in (scale 0.6 → 1.08 → 1, 220 ms, ease-pop).
2. Holds for 350 ms.
3. Rises 28 px and fades over 450 ms.

Rules:
- At most 3 chips are visible. The newest is on top; older chips scale to 0.9 and drop to 50% opacity.
- If an upcoming note in the same or next lane is within 1 beat of the hit line, the chip is anchored at the lane's edge and extends away from it, like the "GREAT · 70 ms late" chip in the mockup, so it never covers a note you still have to play.

**Rail:** a new tick travels from the centre to its offset in 160 ms (ease-out). The diamond eases in 300 ms. Ticks fade out after 8 newer hits.

**Combo:** the multiplier tier goes up every 10 in a row (×2, ×3, ×4 max).
- **Each hit:** the streak number rolls like an odometer (180 ms), and the ring fill tweens over 200 ms.
- **Tier-up:** the badge scales 1 → 1.35 → 1 (360 ms, ease-pop), a shockwave ring grows 0 → 60 px and fades over 400 ms, the hit line brightens for 600 ms, and a volt edge vignette shows for 500 ms.
- **Milestones (25 / 50 / 100 in a row):** a centred "50 IN A ROW!" banner in Unbounded 40 appears for 900 ms between the paper and the field.
- **Combo break:** the badge desaturates and shakes ±4 px (3 cycles, 240 ms), and the ring drains over 300 ms. No sound.

**Score:** rolls to its new value over 400 ms (ease-out, tabular figures).

**Wait mode:** when the music stops for you, the next bars breathe (opacity 0.7 ↔ 1, 900 ms) and the hint dots pulse. The rail hides, since there is no timing in Wait mode.

**Ambient:** Mo floats ±6 px on a 3.2 s cycle. The current-level ring pulses (1.6 s, scale 1 → 1.55, fading out). A diagonal shine sweeps the Volt CTA every 6 s (700 ms). Stage-light radials drift 20 px over 20 s.

**Screen transitions:** push is 280 ms (24 px + fade). Sheets and overlays take 320 ms from the bottom. The count-in ring drains once per beat.

**Results choreography** (0 = overlay shown):

| Time | Event |
|---|---|
| 0 ms | Background dims, rays start a slow rotation (60 s per turn) |
| 150 ms | "Encore!" drops in (scale 1.2 → 1, 300 ms) |
| 400 / 650 / 900 ms | Stars drop in (380 ms ease-pop each) with sparkles and one piano note each |
| 1.1 s | Confetti burst (60 pieces, 2.5 s fall; only at ≥ 2 stars) |
| 0.3 s | Gauge sweeps 0 → 96% over 1100 ms (ease-out-expo) while the number counts up |
| 1.6 s | "NEW BEST" stamps in (scale 1.4 → 1, 200 ms) |
| 1.2 s | Stat tiles rise in, staggered 70 ms |
| 1.5 s | Histogram bars grow from the baseline over 500 ms, staggered 20 ms |
| 2.0 s | Coach card slides in and the voice line starts |

**Placement reveal:**

| Time | Event |
|---|---|
| 0–900 ms | The badge silhouette spins on Y (2 turns) while its number flickers 1 → 12 |
| 900 ms | Lands at scale 1.15 → 1 with a flash, confetti and the sonic logo |
| 1.2 s | The equaliser fills levels 1–11 over 600 ms (15 ms stagger), then level 12 lights up |

**Placement test:** the harder/easier cue slides in from the right over 240 ms. The arrow bounces once (up for harder, down for easier).

---

## 8. Sound design

### The hard rule
The microphone is judging the player. `js/audio/transcriber.js` analyses partials up to **9.5 kHz** (`maxBin`), and its onset/energy envelope uses 120 Hz – 6 kHz. The existing metronome tick already lives above 9 kHz. So:

- **While the listener is judging (count-in and play), every sound is band-limited to ≥ 10.5 kHz, or it doesn't play.**
  - Generate with sine oscillators at ≥ 11 kHz, or with noise through **two cascaded high-pass biquads at 10.5 kHz** (Q 0.707, 24 dB/oct).
  - Use a **raised-cosine attack of ≥ 3 ms**. A hard attack sprays energy into the analysed band and can trigger false onsets.
  - Peak level ≤ −24 dBFS (gain ≈ 0.06), 6–12 dB under the piano.
- **The coach voice is never used while judging.** Speech (100 Hz – 8 kHz) sits right in the pitch band. Speak before the count-in or after the last note, and gate matching while `speechSynthesis.speaking`.
- Many adults over ~50 cannot hear above 10–12 kHz, and some speakers roll off. **In-play sounds are optional garnish, never information:** every cue is visual first. Setting: *Sparkle sounds* (on by default, own volume).
- Outside judging (menus, results, reveal), full-range sound is allowed, because matching is paused. The sonic identity is built from the app's **own piano samples** (`assets/piano/*.mp3`), so the brand literally sounds like a piano.

### In-play "sparkle band" (≥ 10.5 kHz)

| Event | Recipe | Level |
|---|---|---|
| Hit (great / ok) | 1 sine, 12.5 kHz, 3 ms attack, 45 ms exp decay | −30 dBFS |
| **Perfect** | 3 sines at 11.2 / 13.3 / 15.1 kHz, staggered 0 / 18 / 36 ms, 60 ms decay each, ±80 Hz random detune | −27 dBFS |
| Combo tier-up | noise → HPF 10.5 kHz ×2, 180 ms swell + a 12.5 → 15.5 kHz sine chirp | −26 dBFS |
| 25 / 50 / 100 in a row | 4-note "arpeggio" of 11.2, 12.6, 14.1, 15.8 kHz, 40 ms apart | −26 dBFS |
| Count-in / metronome | existing hi-hat tick (> 9 kHz). Accent beat 1: +3 dB and HPF 11 kHz instead of 9 kHz | as now |
| Miss, combo break, wrong note | **silence**. No negative sounds while playing | – |

```js
// Sparkle: one band-limited "tick" the transcriber (<= 9.5 kHz) cannot hear as a note.
function sparkle(ctx, out, f = 12500, t = ctx.currentTime, peak = 0.03, decay = 0.045) {
  const o = ctx.createOscillator(), g = ctx.createGain(), hp = ctx.createBiquadFilter();
  o.frequency.value = f;
  hp.type = 'highpass'; hp.frequency.value = 10500;             // cascade two for 24 dB/oct
  const rc = Float32Array.from({ length: 16 }, (_, i) => peak * 0.5 * (1 - Math.cos((Math.PI * i) / 15)));
  g.gain.value = 0;                                              // intrinsic value, not an automation event
  g.gain.setValueCurveAtTime(rc, t, 0.004);                      // 4 ms raised-cosine attack: no broadband click
  g.gain.setTargetAtTime(0, t + 0.0045, decay / 3);              // exponential decay
  o.connect(hp).connect(g).connect(out);
  o.start(t); o.stop(t + decay * 3);
}
```

*Verified in Chromium's `OfflineAudioContext` at 48 kHz: the snippet peaks at −28.5 dBFS, and the energy at ≤ 9.5 kHz (the transcriber's band) is **−71.5 dB** relative to the total.*

### Outside judging (full range, piano-sample based)

| Moment | Sound |
|---|---|
| UI tap | Felt "tock": piano C6 at velocity 0.12, 80 ms, low-passed at 3 kHz, −30 dBFS. No sound on scroll. |
| Toggle on / off | E6 → A6 (on) / A6 → E6 (off), 40 ms apart, very soft |
| Results stars | C5, E5, G5 on each star drop; 3 stars add a rolled C4-E4-G4-C5 chord plus sparkle |
| Accuracy count-up | Sparkle ticks thinning out as the number settles |
| **Sonic logo "Encore"** | G4 → C5 → E5 (60 ms grace spacing) resolving to a G5 + C6 dyad with a 15 kHz sparkle tail, ~1.2 s. Used for the level reveal, new best and level cleared. |
| Placement reveal | A white-key glissando C4 → C6 (15 notes, 45 ms each) during the badge spin, landing on the sonic logo |
| Streak extended | Fmaj7 arpeggio (F4-A4-C5-E5), warm and slow (90 ms) |
| Errors / mic problems | No sound. Visual plus the coach voice |

Master chain: gentle compressor (already in `Synth`), and UI sounds ≤ −18 dBFS. Gate every sound on `settings.sounds`. Don't rely on the hardware mute switch: with an active microphone session, iOS may play Web Audio regardless.

---

## 9. Voice & copy

**Tone:** an upbeat stage coach who is also a patient teacher.
- **Specific:** "a touch late on the dotted notes", not "bad timing".
- **Musical:** "about a sixteenth early".
- **Brief.**
- **Generous:** effort is celebrated and mistakes are framed as the next step.
- Never "wrong", "fail", "error" or "bad". Say "missed", "slipped by", "a stretch", "tricky".

**Vocabulary:** Encore! · Perfect · Great · Early · Late · Missed · In a row · Stretch goal · Zeroing in · Your journey · Hands-free.

**Chips:** use the engine's `timingLabel()` output unchanged, with the grade word in UPPERCASE, e.g. `PERFECT`, `GREAT · 70 ms late`, `◀ EARLY · 150 ms`, `LATE · 120 ms ▶`, `MISSED`.

**Spoken lines (Web Speech):**
- ≤ 12 words, one line per event, at most one line per 8 s.
- Rate 1.0–1.05, pitch 1.0–1.1, warm system voice.
- Never during judging (see §8).

| Situation | Example coach lines |
|---|---|
| Level intro | "Level 12: dotted rhythms. Count one-and-a, two." · "Both hands this time. Nice and steady." |
| Wait mode | "Take your time. I'll wait for you." |
| ≥ 90% | "Encore! That was right on the beat." · "Three stars. Your timing is really settling in." |
| 75–89% | "Nice work! Just a touch late on the dotted notes." |
| < 75% | "Good effort. Let's slow it down and go again." · "Tricky one! Try Wait mode, and I'll pause for you." |
| Rushing (avg < −40 ms) | "You're rushing a little. Let the metronome lead." |
| Dragging (avg > +40 ms) | "A touch behind the beat. Aim for the start of each click." |
| Hands out of sync | "Your left hand jumped early. Let it land with the right." |
| Missed cluster | "Bar 3 slipped by. Let's loop it slowly." |
| New best | "New best! Fourteen points better than last time." |
| Streak | "Twelve days in a row. That's how pianists are made." |
| Daily goal | "Daily goal done! Anything more is a bonus." |
| Placement start | "Let's find your level. Play what you can. No pressure." |
| After a hard test | "That one was a stretch. Here's a slightly easier one." |
| After a strong test | "Nailed it. Let's try something harder." |
| Reveal | "You're starting at Level 12. Dotted rhythms, here we come!" |
| Mic can't hear | "I can't hear the piano. Could you move me a little closer?" |
| Welcome back | "Welcome back! Let's warm up with Level 11." |

**Screen copy examples:**
- **Home hint:** "One more star and the dots will feel easy!"
- **Placement:** "No pressure: tests that feel hard are how I find your level."
- **Journey:** "Each bar is a level. They grow as the music does."
- **Import:** "Bring any piece from Mutopia, IMSLP or your own files."

---

## 10. Implementation notes

**Fonts:** `npm i @fontsource-variable/unbounded @fontsource-variable/lexend` (both OFL-1.1). Self-host the latin subsets, preload Unbounded 800 and Lexend 500, and use `font-display: swap`. The wordmark is outlined, so it never waits for fonts.

**Tokens:** drop in `tokens.css`. Existing variables in `css/style.css` map as follows:

| Existing | New |
|---|---|
| `--bg` | `--bg` |
| `--bg2` | `--bg-2` |
| `--card` | `--surface-1` |
| `--card2` | `--surface-2` |
| `--line` | `--stroke` |
| `--text` | `--text` |
| `--muted` | `--text-2` (labels: `--text-3`) |
| `--accent` | `--volt` for primary actions; `--sky` for info |
| `--good` | `--great` |
| `--warn` | `--late` |
| `--bad` | `--miss` |
| `--rh` | `--rh` |
| `--lh` | `--lh` |
| `--radius` | `--r-l` |

**Canvas (`js/render/stage.js` `COLORS`):**

| Key | New value |
|---|---|
| `paper` | `#FFF8EA` |
| `ink` | `#1B1733` |
| `rh` | `#35D6FF` |
| `lh` | `#FF5FB7` |
| `hit` | `#0A8559` (paper) / `#3DF5B0` (field) |
| `near` | `#9A6A00` (paper) / `#FFD23F` (field) |
| `miss` / `wrong` | `#C42A45` (paper) / `#FF5A6E` (field) |
| `playhead` | `#FF3FA4` |
| `bg` | `#131036` |
| `lane` | `#07061A` @ 35% for black-key lanes |
| `laneLine` | `rgba(177,166,255,.07)` (C lines .28) |

`NOTE_COLORS` is replaced by the table in §4.5.

**Icons:** the sprite in any mockup (`<symbol id="i-…">`) is an original 24-px set (play, pause, x, back, chevron, gear, flame, bolt, star, lock, note, target, wave, chart, speaker, metronome, hourglass, upload, search, check, plus, minus, crown, trophy, retry, home, up, down, clock, mic, keys, map, sparkle, hands). It uses `currentColor` and replaces the current emoji tiles.

**Accessibility:**
- All text meets WCAG AA and all non-text graphics meet 3:1 (see the ratios above).
- Direction is conveyed by words and arrows, not only colour.
- Focus rings: 3 px `--volt` + 2 px `--ink` offset.
- VoiceOver labels on icon buttons.
- The HUD live region announces only milestones, not every hit.
