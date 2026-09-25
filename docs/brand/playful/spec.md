# Maestro · direction “Playful”

A warm, bouncy piano coach with a friend inside. Warm cream paper, one confident violet, chunky 3D buttons that press down, and **Pip**: a round penguin in concert tails whose body is a note head and whose tuft is the stem and flag of an eighth note. Pip speaks every coach line (Web Speech API) and the same words appear in Pip’s speech bubble.

The direction borrows the proven mechanics of Duolingo / Duolingo Music, Finch and Simply Piano (a path of 3D coins, mascot speech bubbles, coloured reward tiles, notes coloured by pitch), and adapts them to a landscape iPad that sits on a music stand about 60 cm from the player’s eyes.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Gallery of every mockup, links to this spec and the sound page. |
| `home.html` / `.png` | Home: learning path (stage 2 of 5, level 12 current), Continue hero, streak, XP, daily goal ring, 5-stage journey, navigation rail. |
| `placement-question.html` / `.png` | Placement 1: “Have you played piano before?” with four answers. |
| `placement-test.html` / `.png` | Placement 2: test header “Test 3 of ~7”, harder/easier cue, listening state. |
| `placement-reveal.html` / `.png` | Placement 3: “You’re starting at Level 12”. |
| `play.html` / `.png` | Play: HUD, sheet music on a paper card, timing chips, early/late meter, falling notes, keyboard. |
| `results.html` / `.png` | Results: stars, accuracy, stat tiles, timing histogram, coach message, Retry / Next. |
| `songs.html` / `.png` | Song library: category filters, Pip’s pick, song cards with level chips, Import MIDI. |
| `brand-board.html` / `.png` | Wordmark, app icon, Pip’s 7 poses, colour, type, components. |
| `sounds.html` | Interactive sound-design reference. Every sound is synthesised with Web Audio (copyable recipes). |
| `tokens.css` | All design tokens as CSS custom properties. |
| `src/` | Generators: `mascot.mjs` (Pip, all poses), `icons.mjs`, `lib.mjs` (wordmark, keyboard, falling notes, staff, meter, confetti), `pages/*.mjs`. `node src/build.mjs` rebuilds the HTML; `NODE_USE_ENV_PROXY=1 node src/render.mjs` re-renders the PNGs (1180 × 820, deviceScaleFactor 1, reduced motion so the frames are still). |

Every mockup HTML is self-contained (inline CSS and SVG). Only the fonts come from the Google Fonts CDN; see “Type” for self-hosting.

---

## 1. Research: patterns taken from shipped apps (Mobbin)

| Pattern | Seen in | How Maestro uses it |
| --- | --- | --- |
| Vertical path of chunky 3D coins, a coloured section banner on top, the current node ringed, locked nodes grey | [Duolingo path](https://mobbin.com/screens/1702e132-1990-45a8-b78e-c3c6633312d6), [START +25 XP popover](https://mobbin.com/screens/3ecf07e8-cea8-4414-b5d9-05cd21033429), [Duolingo Music unit path](https://mobbin.com/screens/90391d52-4bb2-4ad8-8552-1f1d472703f4), [level badge and review popover](https://mobbin.com/screens/02544e61-aefd-4d89-815e-ffcc83d83539) | Home path: one banner per stage (5 stages, stage colour), a coin per level with its number, gold when done with 0–3 stars below, a progress ring and pulse on the current level. |
| Three-column web layout: nav rail, path, right rail with streak and quests | [Duolingo web learn](https://mobbin.com/screens/0bb5fed7-839b-4978-8c3f-188ce57cf550), [with START tip](https://mobbin.com/screens/7baac688-9b35-4fc1-bbfd-f8bf8803a8f5), [section cards with mascot bubbles](https://mobbin.com/screens/8f54c23d-ad95-4497-9db9-07a782633f65) | Landscape iPad = web layout: 212 px rail, path column, 412 px right rail (Continue hero, daily goal, journey). |
| Character standing beside the current node | [Duolingo path characters](https://mobbin.com/screens/a7e8c760-e436-4ac3-a933-ff20b392e038), [Duolingo ABC mascot on the node](https://mobbin.com/screens/7599d3b5-26c2-466e-98a3-2687ac207c95) | Pip stands beside level 12 with a greeting bubble. |
| Onboarding: mascot top-left + speech bubble question, full-width answer cards, signal-bar icons for proficiency, disabled Continue until chosen | [Duolingo onboarding flow](https://mobbin.com/flows/b0b4f93f-5637-46ec-9d77-49ecda6b991d), [“How much do you know?” bars](https://mobbin.com/screens/ed5fd27f-19fb-48a9-ae0f-4481e5b7671a), [Finch question with mascot](https://mobbin.com/screens/440380e1-c53a-4479-bc1a-4f777185dba2) | Placement question: 4 answers with 1–4 signal bars, selected card turns violet-soft with a check. |
| Placement result told by the mascot (“let’s start at …”) | [Duolingo “start at Score 10”](https://mobbin.com/screens/24aaae49-d6dd-479e-913d-55740b8b25fc), [Alan “You nailed it”](https://mobbin.com/screens/4856e30f-0784-4976-b859-7d6309391c81) | Reveal: full-bleed violet, a gold level coin with a stage ribbon, Pip cheering, the unlocked levels shown on a 40-dot strip. |
| Notes coloured by pitch with letter names; the matching key edge takes the same colour; “Perfect!” / “Great! ×12” next to an avatar; glow and sparkles at the hit line | [Duolingo Music “Perfect!”](https://mobbin.com/screens/32ee1c70-7f9d-494b-bd0d-7871cb911650), [“Great! ×12”](https://mobbin.com/screens/907ba910-67eb-45f1-bf53-7195f3c84c6c), [“Oops”](https://mobbin.com/screens/1ccd10c2-415c-4a2d-8c09-2238a643511d), [coloured note balls](https://mobbin.com/screens/d9fff8d8-9a3f-4f94-91a5-a8ba54d6a881) | Falling notes by pitch (7 colours) with the letter on a white disc, hit burst and sparkles at the key, combo counter in the HUD, timing chips that name the grade. |
| Lesson complete: mascot, coloured stat tiles with a label band, one big button | [Duolingo lesson complete](https://mobbin.com/screens/31fdc425-1a41-4b78-b4e6-762bff0b9306), [Mimo with daily-goal bar](https://mobbin.com/screens/b5772854-5c51-4fca-b828-0df669bfa4d4), [Nibble confetti and big score](https://mobbin.com/screens/547a04b7-6c0d-4ccb-9196-0c23588d9638) | Results: three stars, big %, three banded tiles (Notes hit / On time / Avg. offset), daily-goal bar, confetti. |
| Streak: flame + number, a row of weekday circles | [Duolingo streak](https://mobbin.com/screens/739be3b0-b1a3-4d8b-a2aa-e387c07be210), [Cal AI week dots](https://mobbin.com/screens/839a4e83-1af4-427a-bf1d-31b7608214bd), [Speak streak records](https://mobbin.com/screens/c224e632-0ac2-4909-9f6f-f065eb9712af) | Daily goal card: ring + weekday flames, today dashed until the goal is met. |
| Song list for a real piano with difficulty filters; song page with high score, stars and “PLAY +20 XP” | [Duolingo Music songs](https://mobbin.com/screens/1e355853-bc73-4fe0-8b5b-96c7824216b4), [song search](https://mobbin.com/screens/f08f06c2-6e55-4c32-9949-8fe044ec8698), [Perform song](https://mobbin.com/screens/fd1798ab-8a92-4752-b815-7cfa89489814) | Song cards with generated covers, stars earned, level chips per arrangement, “Pip’s pick” banner. |
| Practice hub of coloured cards with START +XP | [Duolingo practice hub](https://mobbin.com/screens/7bb8916e-d373-43c3-9614-70afaf9abfed) | Practice screen (not mocked) uses the song-card grid with exercise types. |
| Quiz header: close, segmented progress | [Quizlet segmented progress](https://mobbin.com/screens/c6d6f72a-d039-402e-bf1f-0f17414933a8) | Placement test header; the unknown tail of the adaptive test is drawn as dashed “maybe” segments (“~7”). |
| Mascot home with chunky check buttons, soft palette | [Finch home](https://mobbin.com/screens/6e24c2f2-42f4-42da-9450-5c021b7d3678) | Tone and softness of cards; Pip’s idle life on Home. |
| Modal with mascot on top | [Duolingo web reminder dialog](https://mobbin.com/screens/1e81d33a-ecd3-4fd7-b83b-fc8615d2e9ed) | Pause sheet and confirm dialogs. |

Simply Piano, Flowkey, Yousician and Skoove are not in Mobbin’s catalogue; Duolingo Music covers the same “play on your real piano” patterns.

---

## 2. Brand

### Wordmark
- “maestro”, lowercase, Fredoka Bold (700), tracking −0.02em, violet `#6F4BF2` (white on violet).
- The **t**’s stem grows up past the ascender into the stem and flag of an eighth note: the same flag Pip wears as a tuft. Built in `lib.mjs → wordmark()` from Fredoka’s metrics (t stem x 10–27/100 em, top 67/100 em, flag tip stays above the x-height of the r).
- Minimum size 24 px. Clear space = the height of the “a”.
- Never outline it, never set it in another font, never recolour the flag separately.

### App icon
Pip’s face on a violet squircle (`pipFace({ bg: '#6F4BF2' })`), tuft visible. Alternate: cream background. Export at 180/192/512 for `icons/`.

### Pip (mascot)
| Part | Spec |
| --- | --- |
| Silhouette | Egg body (the note head) + eighth-note tuft. Must read at 28 px (avatar). |
| Colours | Body `#2E2B5F`, highlight `#433F82`, cream mask `#FFF4E0`, beak and feet `#FFA629`, cheeks `#FF8FA8` at 60%, violet bow tie `#6F4BF2` / knot `#4F30C9`. |
| Face | Big glossy eyes (two highlights). The eyes carry the emotion; the beak opens for cheering and talking. |
| Poses (in `mascot.mjs`) | `hello` (wave: Home, tips) · `listen` (flipper to ear + sound waves: mic check, placement, “your turn”) · `conduct` (baton + wink: count-in, Listen demo, play screen) · `cheer` (both flippers up, sparkles: stars, level up, streak) · `oops` (worried brows, sweat drop: mic trouble, a rough take) · `think` (flipper to cheek, “?”: questions) · `sleep` (eyes closed, “z”: streak at risk, idle) · `face` (avatar). |
| Rules | Pip never mocks, never frowns at the player, never covers notes the player is about to play, never talks while the microphone is grading. |

---

## 3. Design tokens (`tokens.css`)

### Colour
| Token | Hex | Use | Contrast |
| --- | --- | --- | --- |
| `--bg` | `#FFF7EA` | App background (warm cream) | ink 13.8:1 |
| `--bg-sunk` | `#FBEEDA` | Falling-notes bed, wells | |
| `--surface` | `#FFFFFF` | Cards | |
| `--paper` | `#FFFCF4` | Sheet-music card | staff ink `#3B3552` 11.3:1 |
| `--line` / `--edge` | `#F0E3CD` / `#E6D6BC` | Card border / 3D bottom edge of white things | |
| `--ink` | `#2A2346` | Text, Pip’s outline family | 13.8:1 on bg |
| `--ink-2` | `#5E5775` | Secondary text | 6.4:1 |
| `--ink-3` | `#736A8A` | Tertiary text, captions | 4.75:1 |
| `--brand` / `--brand-edge` | `#6F4BF2` / `#4F30C9` | Primary buttons, current level, focus | white 5.3:1 |
| `--brand-soft` / `--brand-ink` | `#EEE8FF` / `#4A2FC2` | Selected states | 7.1:1 |
| `--sun` / edge / soft / ink | `#FFC23D` / `#E09A0B` / `#FFF1C9` / `#8A5A00` | XP, stars, done levels, **Perfect** | ink on sun 9.1:1 |
| `--flame` / … | `#FF7A2F` / `#D95A12` / `#FFE6D6` / `#A8430B` | Streak | |
| `--mint` / … | `#20C07A` / `#12985C` / `#DDF7EA` / `#0E7A48` | Hit, **Great**, on time, mic OK | ink on mint 6.2:1 |
| `--coral` / … | `#FF5A6A` / `#D93A4C` / `#FFE3E6` / `#B4232F` | Missed / wrong note, destructive | |
| `--early` / … | `#2F9BFF` / `#1673D1` / `#DDEEFF` / `#1463B8` | Early (cool, always on the **left**) | |
| `--late` / … | `#FF9A2E` / `#D9760C` / `#FFE9CF` / `#A65400` | Late (warm, always on the **right**) | ink on late 6.95:1 |
| `--rh` / `--lh` | `#6F4BF2` / `#14B8A6` | Right hand violet, left hand teal (“by hand” mode, RH/LH tags) | |
| Stage 1–5 | `#20C07A`, `#6F4BF2`, `#2F9BFF`, `#FF7A2F`, `#E0436F` (+ edges) | Path banners and journey dots: Beginner, Elementary, Intermediate, Advanced, Master | |

Rules: every filled shape has an `-edge` shade used for its 3D bottom border. White text only on violet, coral-edge or darker. Text on sun, mint, late or E-yellow is ink. Early/late are **never** colour-only: they always come with a word and a side (left = early, right = late) and an arrow.

### Note colours (“by pitch” mode)
| C | D | E | F | G | A | B |
| --- | --- | --- | --- | --- | --- | --- |
| `#F2545B` / `#C73840` | `#FF9A2E` / `#D9760C` | `#FFC93D` / `#DDA10E` | `#3CC46F` / `#229A51` | `#22B8CF` / `#148FA3` | `#3E7BFA` / `#2358CC` | `#A45CF0` / `#7D38C9` |

- Default **by pitch** for Levels 1–16 (Beginner, Elementary), **by hand** from Level 17. Setting: “Note colours: By pitch / By hand / One colour”.
- The letter sits on a **white disc in ink** (14:1) at the key end of every falling note ≥ 34 px tall; white letters on these colours would fail contrast (F 2.3:1, G 2.4:1, D 2.1:1).
- Sharps and flats take their written letter’s colour (F♯ = F green, B♭ = B violet), drawn narrower on the black-key lane with a ♯/♭ on the disc.
- Keyboard: hinted keys get a white disc with a 4 px ring in the pitch colour; pressed keys fill with the pitch colour (black keys fill violet).

### Type
Fonts (all OFL-1.1, self-host from npm for the offline PWA): **`@fontsource-variable/fredoka`** (display), **`@fontsource-variable/nunito`** (UI and live numbers), **`@fontsource/noto-music`** (clefs and music symbols; subset to U+1D100–1D1FF and ♩♪♯♭♮).

| Role | Font | Size / line-height | Weight |
| --- | --- | --- | --- |
| Hero number (results %, level coin) | Fredoka | 88–104 / 0.95 | 700 |
| D1 headline | Fredoka | 52 / 1.05 | 700 |
| H1 | Fredoka | 36 / 1.12 | 600 |
| H2 | Fredoka | 28 / 1.15 | 600 |
| H3, card titles | Fredoka | 22 / 1.2 (song cards 19) | 600 |
| Buttons | Fredoka | 21 (M), 25 (L), 17 (S) | 600 |
| Coach bubble | Nunito | 21 / 1.35 (18–20 in tight spots) | 700 |
| Body | Nunito | 18 / 1.45 | 600 |
| Small | Nunito | 15 / 1.4 | 700 |
| Eyebrow | Nunito | 13, uppercase, +0.1em | 800 |
| Live numbers (score, combo, BPM, XP, pills) | Nunito | 19–30 | 900 |

Neither Fredoka nor Nunito has a `tnum` feature. Nunito’s digits are already equal width (600 units), so every number that changes while you watch uses Nunito 900. Fredoka digits are proportional: when a Fredoka number counts up (results %), wrap each digit in a fixed `0.62em` inline-block. Minimum text size anywhere: 13 px (eyebrows), 15 px on the play screen.

### Shape, depth, elevation, spacing
- Radii: `8 / 12 / 16 / 22 / 28 / pill`. Buttons 16 (L 22), cards 22, bubbles 22, HUD pieces 18, path coins are ellipses.
- 3D depth (bottom edge, not blur): chips 4 px, buttons and cards 5 px, hero buttons and path coins 7–9 px. Pressed = `translateY(depth)` + edge 0.
- Soft shadow only for floating things: `--shadow-card` (0 10 24 −14 ink/28%), `--shadow-pop` for dialogs.
- Spacing: 4-pt scale `4 8 12 16 20 24 32 40 48 64`. Screen gutters 20–24 px; add `env(safe-area-inset-*)`.
- Touch targets: 52 px minimum (HUD 58), primary actions 64–72 px, because the iPad is at arm’s length on a music stand.

### Layout (1180 × 820 landscape)
- Rail screens (Home, Songs, Practice, Progress, Settings): 212 px rail + content. Home content = path column (≈ 500) + right rail (412).
- Focus screens (placement, play, results) have no rail: a top bar with close/back and progress.
- Play: HUD 58 px at y 14 → paper card y 84–340 → falling notes y 352–640 → keyboard y 640–806.

---

## 4. Components

**Buttons** (`.btn`): Fredoka 600, 3D edge. Variants: primary (violet / white text), secondary (white / violet text / cream edge), sun (ink text, for XP claims), white-on-brand (inside violet cards), ghost (text only), destructive (`--coral-edge` fill, white text, used only for “Reset progress”). Sizes: S 44, M 56, L 68–72. States: pressed (sinks 5 px, 90 ms), disabled (`#E9E0D0`, text `#A79D8A`, no press), focus (4 px `--brand-hi` ring outside the edge). Icon buttons 52–58 square.

**Cards**: white, 2 px `--line` border, 5 px `--edge`, radius 22. Hero cards are violet with a violet edge.

**Chips**: filter chip 44 px pill, count in `--ink-3`; selected = brand-soft fill, violet border and edge. Stat pills (streak, XP, mic) 44 px, number in Nunito 900.

**Timing chips** (`.tchip`): white pill 40 px, 2.5 px border and 4 px edge in the grade colour, a 28 px disc with an icon, the grade word in Fredoka 19, detail in Nunito 800 15. Grades: **Perfect** (sun, sparkle), **Great** (mint, check), **Early · 150 ms** (early blue, left arrow), **Late · 130 ms** (late orange, right arrow), **Missed** (coral, cross). A pointer connects the chip to its note. The newest chip is centred over its note near the playhead; older chips right-align to their note, drift left with the music, fade to 80% and disappear after 1.2 s. Left-hand chips hang below the bass staff. Ms detail only appears when |offset| ≥ 40 ms; inside the window it just says Perfect/Great.

**Coach bubble**: white, 2.5 px `--line`, 5 px edge, radius 22, tail pointing at Pip, speaker icon when the line is spoken. Max 2 lines on play, 4 elsewhere. Bubble text = spoken text.

**Path node**: 84 × 76 coin (current 104 × 92 inside a 132 px ring whose violet arc shows exercises done in the level), glossy top highlight, 8–9 px edge. States: done (sun, number in ink, 0–3 stars under), current (violet, ring + pulse), locked (`#EAE1D2`, number in `#B2A58E`), stage test (locked coin with a trophy). The trail behind the nodes is a 22 px rounded path, gold up to the current node, cream after, with a dotted white centre line.

**Stage banner**: stage colour, eyebrow “Stage 2 · Levels 9–16”, stage name H2, Guide button (outlined white, opens the level concepts).

**HUD** (left → right): close · title block (level title, “Level 12 · 2 of 5”, mic level bars) · Score · Combo (flame + number + “in a row”) · flexible gap · tempo stepper (− ♩ 72 +) · Tempo/Wait segmented control · Listen · Pause. Display options (sheet music, falling notes, note names, fingers, keyboard hints, metronome), which are in the eye popover today, move into the Pause sheet so the HUD stays readable.

**Early/late meter**: a pill docked in the paper card’s top-right corner: “← Early” · a 250 px track (blue → white → orange with a mint ±40 ms window and a centre line) · “Late →” · “avg +14 ms”. The last 8 hits are ink ticks (older = lighter); the average is a violet triangle. It never overlaps the falling-notes lanes.

**Segmented progress** (placement): one pill per test; done = mint, current = violet with a soft halo, upcoming = cream, possible-but-uncertain = dashed outline (“~7”). Previous results as small mint chips (“Test 2 · 91%”). Harder/easier cue chip: sun “↑ A bit harder” or early-blue “↓ A bit easier”.

**Stat tiles** (results): coloured border and label band (Notes hit = mint, On time = sun, Avg. offset = late or early depending on the sign), white body, value in Fredoka 32 with a small unit.

**Histogram**: 13 bars of 30 ms from −180 to +180 ms, rounded 3D bars, blue left of the ±30 ms bins, mint centre, orange right, count labels inside bars ≥ 3, mint “On the beat” band behind the centre, violet average line.

**Song card**: generated cover (category colour + a simple motif; no album art exists for public-domain music), category tag, stars earned, title (2 lines max), composer · year, level chips per arrangement (violet = playable now, sun = within 4 levels, grey = later), play button or “Almost!” / “Challenge”. Filters: All + the 5 categories with counts. Header: search field + **Import MIDI** (secondary button with upload icon). “Pip’s pick” banner recommends a song that uses the current level’s concept.

**Dialogs**: scrim `rgba(42,35,70,.45)` + 4 px backdrop blur; card 440–520 px wide, radius 28, Pip peeking over the top edge (think for questions, oops for destructive), buttons stacked full width with the primary on top. Pause sheet: Resume (primary L), Restart, Skip this exercise, Display options (toggle list), Home (ghost).

**Toast**: white pill with icon, 3D edge, bottom centre above the keyboard, 2.5 s.

---

## 5. Motion

Principles: bouncy but short; nothing moves near the notes you are about to read; every celebration can be skipped with a tap; all of it turns off with `prefers-reduced-motion`.

| Token | Value | Use |
| --- | --- | --- |
| `--t-press` | 90 ms | Button sink |
| `--t-fast` | 160 ms | Chip select, toggles |
| `--t-base` | 240 ms | Screen push, bubble in |
| `--t-slow` | 420 ms | Stars, coin stamp |
| `--t-hero` | 700 ms | Reveal, level-up |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | Entrances |
| `--ease-in` | `cubic-bezier(.55,0,1,.45)` | Exits |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | Pops (≈ 8% overshoot) |

| Moment | Animation |
| --- | --- |
| Button | Sinks by its edge depth in 90 ms, rises with spring 160 ms. Tap sound on release. |
| Screen change | New screen slides 40 px + fades in 240 ms ease-out; old one fades 160 ms. Focus screens rise 24 px. |
| Pip idle | Bob ±4 px, 2.4 s ease-in-out loop; blink (eyes scaleY 1 → 0.1 → 1, 140 ms) every 3–6 s at random. |
| Pip pose change | Squash (scaleX 1.04, scaleY 0.94, 90 ms) → new pose → spring back 300 ms. Enter: from scale 0.6 and y +20 px, 380 ms spring, “pop” sound. |
| Pip talking | While `speechSynthesis` speaks, the beak toggles open/closed on each `boundary` event (fallback 9 Hz); the current word in the bubble gets a brand-soft highlight (karaoke) for early readers. |
| Speech bubble | Scales from 0.85 at the tail + fades in, 220 ms spring, 120 ms after Pip’s pose change. Text appears whole (no typewriter). |
| Current path node | Ring pulse (scale 1 → 1.35, opacity .55 → 0, 1.8 s loop). |
| Level done (back on Home) | Coin turns gold with a stamp (scale 1.25 → 1, 420 ms spring), stars pop in 120 ms apart, the gold trail flows to the next coin (600 ms), Pip hops there (500 ms arc, 6% squash on landing), next coin unlocks with a shake-free “pop”. |
| Count-in | Big Fredoka numbers 4-3-2-1 (120 px) pop on each beat (scale 0.6 → 1.1 → 1, 300 ms); Pip conducts on the beat. |
| Falling notes | Linear, driven by the audio clock. Notes fade in over the top 14% of the lane. No easing, no wobble: reading comes first. |
| Hit | Key sinks 3 px and fills with the note colour (40 ms), releases 120 ms. Burst at the key top: radial glow (sun for Perfect, mint otherwise, 260 ms) + 6–10 particles (dots and 4-point sparkles in the note colour, speed 120–260 px/s, gravity 600 px/s², life 450 ms, scale 1 → 0.4, fade). Perfect adds a ring shockwave (radius 0 → 46 px, stroke 4 → 0, 260 ms). Score float “+100” rises 30 px and fades in 600 ms. Played notes on the staff take their grade colour. |
| Timing chip | Pops from 0.6 scale above its note (200 ms spring), rises 8 px over 1.2 s, fades out at the end. Max 3 chips visible. |
| Miss / wrong note | The note turns coral, drops 6 px and fades (200 ms); the wrong key flashes coral-soft for 150 ms. No screen shake, no red flash over the music. |
| Combo milestone (10, 25, 50) | HUD flame grows 1.3× and settles (spring 420 ms); the combo number flips; a silent “10 in a row!” bubble from Pip for 1.5 s. |
| Early/late meter | New tick slides into place (160 ms); average triangle glides (240 ms ease-out). |
| Results | 0 ms background fades in · 150 ms title drops in (420 ms spring) · 350 / 610 / 870 ms stars pop (scale 0.3 → 1.12 → 1, rotate −15° → 0, one chime each; an empty star just fades in) · 600 ms accuracy counts 0 → 92 over 900 ms (ease-out cubic) with ticks · 1200 ms tiles rise 16 px, 80 ms apart · 1500 ms histogram bars grow from the baseline, centre first, 30 ms stagger, 500 ms each · 1900 ms Pip pops in and speaks · 2100 ms confetti if ≥ 2 stars. Buttons are live from 600 ms; a tap anywhere skips to the end state. |
| Confetti | 80–120 pieces from two cannons at the bottom corners: rounded rects 10 × 18, dots r 5.5, squiggles, 4-point sparkles; brand, sun, mint, coral, early and late colours. Launch speed 700–1100 px/s at 60–80° inward, gravity 1400 px/s², air drag 0.9/s, spin 180–720°/s, sideways flutter ±12 px at 2–4 Hz, life 2.8 s with a 400 ms fade. Never over the buttons’ hit area (draw below them). |
| Placement reveal | Coin drops in from −40 px with a spring (700 ms) and flips once (rotateY 360°), ribbon unfurls (scaleX 0 → 1, 300 ms), headline rises, the 40-dot strip fills dots 1–11 left to right (25 ms stagger) and the 12th pops gold; confetti + drum roll + chord. |
| Streak +1 | Flame grows from 0.4 to 1.2 to 1 while the number rolls up; today’s weekday circle fills with a flame. |
| Reduced motion | No bob, pulse, confetti, particles, flips or rolling numbers. Keep instant state changes, a 120 ms cross-fade for screens, and the colour change of hit keys/notes (that is information, not decoration). |

Performance: draw notes, particles and the hit glow on the existing canvas (`js/render/stage.js`); cap particles at 120; animate only `transform` and `opacity` in the DOM; pause Pip’s idle loop while a take is being graded if the frame budget drops below 60 fps.

---

## 6. Sound

Try every recipe in `sounds.html`. All sounds are synthesised with Web Audio (no files to license), in C major so sequences never clash, at a UI master level of about −18 dBFS peak. A “Sounds” switch in Settings mutes them; the metronome and the piano samples (Listen) have their own controls.

| Moment | Sound |
| --- | --- |
| Tap (any button) | Soft wooden tick: sine 1.76 kHz, 40 ms |
| Select (answer card, chip, toggle on) | Marimba G5, 120 ms |
| Continue / next step | Marimba B5 → E6 |
| Back / close | Marimba E6 → B5, quieter |
| Pip pops in | Sine sweep 300 → 900 Hz, 80 ms |
| Gentle oops (mic not found, nothing heard) | Two soft marimba notes, a minor third down. **Never** for wrong notes. |
| Stars (results) | One celesta chime per star as it lands: C6, E6, G6, 260 ms apart |
| XP count-up | 2.5 kHz ticks every 35 ms, a celesta ding at the end |
| Level complete | Marimba arpeggio C5-E5-G5-C6 + a C major celesta bloom |
| Streak +1 | Band-passed noise whoosh 400 Hz → 3 kHz + tiny crackles + chime |
| Placement reveal / stage unlocked | 600 ms drum roll (low band-passed noise) + a big major chord |

**During play the microphone is listening**, so:
- While a take is graded, **no tonal sound below 10 kHz**. The only in-take cues are high-passed noise: *Perfect sparkle* (11–15 kHz, 45 ms, −32 dBFS, off by default for Levels 1–4) and *combo shimmer* (three glints at 12 / 13.5 / 15 kHz every 10 in a row). A metronome set to “Always” uses a 10–16 kHz noise click (8 ms; beat 1 louder).
- The count-in (high marimba ticks, accent on 1) plays **before** grading starts; the last tick has decayed 700 ms before the downbeat.
- The pitch analyser low-passes its input at 9 kHz (a `BiquadFilterNode`, above C8 = 4186 Hz), so these cues can never register as piano notes.
- **Listen** (demo with piano samples) pauses grading while it plays.
- **Pip’s voice never speaks during a graded take.** In-play coach lines appear silently in the bubble; spoken lines wait for count-in, pauses, the end of the exercise or the results. In Wait mode Pip may speak only after 4 s without a note and grading resumes 300 ms after speech ends.

---

## 7. Voice and copy

Pip is a warm, slightly goofy music buddy. Short sentences, plain words, one tip at a time, always about the music, never about the person.

- **Do**: celebrate effort and specifics (“Your left hand was right on the beat!”), give one concrete next step, use musical words kids can repeat (“long, short”, “bounce”, “breathe”).
- **Don’t**: “wrong”, “fail”, “bad”, milliseconds in speech (chips show numbers, Pip says “a bit early”), sarcasm, guilt about streaks.
- Spoken lines ≤ 14 words; the bubble shows exactly the spoken text. Speech: rate 1.0 (0.92 for Levels 1–8), pitch 1.15, a clear local English voice, voice picker in Settings.

| Moment | Example lines |
| --- | --- |
| Welcome | “Welcome back, Sam! Today we make rhythms bounce.” · “Twelve days in a row. Your fingers remember!” |
| Level intro | “Dotted rhythms: long, short, long, short. Like skipping!” · “New hand position! Thumb on G this time.” |
| Before play | “Hands ready? I’ll count you in. One, two, three, four.” · “Wait mode: I’ll wait for every note.” |
| In play (silent bubble) | “Long, short! Keep that bounce.” · “Nice and steady!” · “10 in a row!” · “Left hand, let it ring.” |
| Wrong note | “Almost! That was a D. Look for the E.” |
| Timing tendency | “You’re rushing a little. Listen for the beat.” · “A touch behind. Get ready a bit sooner.” |
| Results ≥ 95% | “Wow, three stars! That sounded lovely.” |
| Results 80–94% | “Your dotted rhythms really bounced! One more try for three stars?” |
| Results 60–79% | “Good work! Let’s slow it to 60 and nail it.” |
| Results < 60% | “That one’s tricky! Try Wait mode, I’ll wait for you.” |
| Placement | “Have you played piano before?” · “You nailed that one, so here’s a trickier tune.” · “Let’s try an easier one.” · “You’re starting at Level 12! I unlocked Levels 1 to 11.” |
| Streak at risk (sleep) | “Pip’s getting sleepy… one quick song keeps your streak alive!” |
| Mic trouble (oops) | “I can’t hear the piano. Is the microphone allowed?” · “It’s a bit noisy. Let’s check the room again.” |

---

## 8. Accessibility and the music stand

- At 60 cm on an iPad (≈ 0.19 mm per CSS px): body 18 px, bubble 21 px, HUD numbers 27–30 px, staff space 12 px (2.3 mm, larger than a printed part), note letters 18 px on 25 px discs.
- Text contrast ≥ 4.5:1 (large display text ≥ 3:1); numbers listed in the colour table.
- Meaning never by colour alone: grades have words and icons, early/late have a side, arrow and word, notes have letters, hands have RH/LH tags.
- VoiceOver: Pip is decorative (`aria-hidden`) and the bubble text is live-announced only outside a take; stars, meter and histogram carry text labels.
- Reduced motion honoured everywhere (see Motion).

---

## 9. Mapping to the current app

| Today (`index.html`) | Playful component |
| --- | --- |
| `#screen-home` `.brand`, `.hero`, `#btn-start`, `.tiles` | Rail with wordmark and nav; path column; Continue hero card (`#btn-start`), pills for streak/XP/mic |
| `#screen-map` (level list) | The Home path itself (scrolls across the 5 stage banners) |
| `#screen-setup` (mic setup) | Focus screen with Pip `listen`, 3 step coins, a chunky mint level meter |
| `#screen-intro` | Level intro sheet: stage-coloured coin, concept in Pip’s bubble, “Let’s play” primary |
| `.hud`, `#btn-mode`, `#btn-tempo-*`, `#hud-bpm`, `#btn-listen`, `#btn-pause`, `#mic-dot` | HUD as specified; mic bars in the title block |
| `#btn-view` popover | Moves into the Pause sheet |
| `#feedback-pop` | Timing chips + early/late meter on the paper card |
| `#countdown` | Count-in numbers with Pip conducting |
| `#results` | Results screen (`#res-extra` becomes “· 2 extra” in the Notes hit tile) |
| `#screen-practice`, `#screen-progress`, `#screen-settings` | Rail screens using cards, chips and segmented controls from this spec |
| `.toast`, `.rotate-hint` | Toast pill; rotate hint = Pip `think` + “Turn your iPad sideways” |
