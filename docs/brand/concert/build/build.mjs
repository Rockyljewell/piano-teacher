// Concert direction: generates the static mockups (self-contained HTML) and renders PNGs.
//   node docs/brand/concert/build/build.mjs            # write HTML + PNG
//   node docs/brand/concert/build/build.mjs --html     # HTML only
// Notation is engraved with the Bravura outlines the app already ships (js/render/glyphs.js),
// and song covers are drawn from the real melodies in js/music/songs.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPHS } from '../../../../js/render/glyphs.js';
import { SONGS, songPiece } from '../../../../js/music/songs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const W = 1180;
const H = 820;

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------
export const TOKENS_CSS = `:root {
  /* Stage: warm ebony backgrounds (never pure black) */
  --stage-950: #0A0807;
  --stage-900: #0F0C0A;
  --stage-850: #15110E;
  --stage-800: #1B1612;
  --stage-750: #221C17;
  --stage-700: #2C251E;
  --stage-600: #3A3128;

  /* Ivory: text and the paper the music is printed on */
  --ivory-50: #FCF8EF;
  --ivory-100: #F5EEDF;
  --ivory-200: #E8DFCC;
  --ivory-300: #D4C9B4;
  --ivory-400: #B3A892;
  --ivory-500: #8F8574;
  --ivory-600: #6B6356;
  --paper: #FBF6EA;
  --paper-edge: #EFE6D2;
  --ink: #1D1A16;
  --ink-soft: #5B5346;

  /* Gold leaf: brand accent, primary actions, "Perfect" */
  --gold-100: #FBF0D2;
  --gold-200: #F3DDA5;
  --gold-300: #E9C77F;
  --gold-400: #D9AE5C;
  --gold-500: #C4953E;
  --gold-600: #A07629;
  --gold-700: #6E511C;
  --gold-ink: #1E1606;
  --gold-grad: linear-gradient(180deg, #F4DC9F 0%, #DDB263 52%, #C4953E 100%);
  --gold-metal: linear-gradient(160deg, #F6E3AE 0%, #D9AE5C 55%, #A87A2C 100%);

  /* Velvet: the curtain. Used sparingly for depth and the Master stage */
  --velvet-400: #B4485A;
  --velvet-500: #8E2A3B;
  --velvet-700: #4B1520;
  --velvet-900: #240A10;

  /* Hands */
  --rh-300: #AFCDFF;
  --rh-400: #7DB0FF;
  --rh-500: #4F8FEA;
  --rh-700: #1F4F9A;
  --lh-300: #FFC7AA;
  --lh-400: #F6A07A;
  --lh-500: #E27B52;
  --lh-700: #9A4222;

  /* Feedback (timing tiers, not directions) */
  --perfect: #E9C77F;
  --great: #F3DDA5;
  --good: #D4C9B4;
  --offbeat: #F2A65A;   /* Early / Late */
  --miss: #E8707E;
  --wrong: #F0525F;
  --listening: #8FD1A6;
  /* The same tiers printed on paper */
  --paper-perfect: #A07629;
  --paper-offbeat: #B85F1A;
  --paper-miss: #B8384A;

  /* Lines */
  --line: rgba(245, 238, 223, 0.08);
  --line-2: rgba(245, 238, 223, 0.14);
  --line-gold: rgba(217, 174, 92, 0.45);

  /* Type */
  --font-display: 'Fraunces', 'Iowan Old Style', Palatino, Georgia, serif;
  --font-ui: 'Manrope', -apple-system, 'SF Pro Text', system-ui, sans-serif;

  /* Radii */
  --r-xs: 8px;
  --r-sm: 12px;
  --r-md: 16px;
  --r-lg: 22px;
  --r-xl: 28px;
  --r-pill: 999px;

  /* Spacing (4 pt grid) */
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 20px;
  --s-6: 24px;
  --s-8: 32px;
  --s-10: 40px;
  --s-14: 56px;
  --s-18: 72px;

  /* Elevation */
  --e-1: inset 0 1px 0 rgba(255, 244, 220, 0.05), 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.28);
  --e-2: inset 0 1px 0 rgba(255, 244, 220, 0.06), 0 24px 64px rgba(0, 0, 0, 0.5);
  --e-paper: 0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 18px 40px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.35);
  --glow-gold: 0 10px 34px rgba(217, 174, 92, 0.34), inset 0 1px 0 rgba(255, 248, 225, 0.7);

  /* Motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --t-press: 90ms;
  --t-quick: 160ms;
  --t-base: 240ms;
  --t-gentle: 420ms;
  --t-stage: 700ms;
  --t-reveal: 1200ms;
}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..600&family=Manrope:wght@400..800&display=swap" rel="stylesheet">`;

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1  0 0 0 0 .95  0 0 0 0 .85  0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")`;

const BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: var(--stage-900); color: var(--ivory-100);
  font-family: var(--font-ui); -webkit-font-smoothing: antialiased; font-feature-settings: 'tnum' 0; }
button { font: inherit; color: inherit; border: 0; background: none; }
.screen { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; }
.stage-bg { position: absolute; inset: 0; z-index: 0;
  background:
    radial-gradient(760px 460px at 50% -8%, rgba(240, 200, 130, 0.15), rgba(240, 200, 130, 0.04) 55%, transparent 75%),
    radial-gradient(520px 380px at -6% 104%, rgba(142, 42, 59, 0.16), transparent 70%),
    radial-gradient(520px 380px at 106% 104%, rgba(142, 42, 59, 0.12), transparent 70%),
    linear-gradient(180deg, #16120E 0%, #0E0B09 60%, #0B0907 100%); }
.stage-bg::after { content: ''; position: absolute; inset: 0; background-image: ${GRAIN}; opacity: 0.05; mix-blend-mode: overlay; }
.layer { position: absolute; inset: 0; z-index: 1; }

/* ---- type ---- */
.display { font-family: var(--font-display); font-weight: 560; letter-spacing: -0.012em; line-height: 1.04; }
.display.i, .ital { font-family: var(--font-display); font-style: italic; font-weight: 420; }
.eyebrow { font: 700 12px/1 var(--font-ui); letter-spacing: 0.16em; text-transform: uppercase; color: var(--gold-300); }
.eyebrow.muted { color: var(--ivory-500); }
.muted { color: var(--ivory-400); }
.num { font-variant-numeric: tabular-nums lining-nums; }

/* ---- surfaces ---- */
.card { background: linear-gradient(180deg, rgba(34, 28, 23, 0.92), rgba(24, 20, 16, 0.92)); border: 1px solid var(--line);
  border-radius: var(--r-lg); box-shadow: var(--e-1); }
.card.flat { background: rgba(27, 22, 18, 0.7); }
.paper { background: radial-gradient(120% 140% at 30% 0%, #FFFCF4 0%, var(--paper) 45%, #F3EBD8 100%); color: var(--ink);
  border-radius: 18px; box-shadow: var(--e-paper); }

/* ---- buttons ---- */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 52px; padding: 0 24px;
  border-radius: var(--r-pill); font: 700 17px/1 var(--font-ui); letter-spacing: 0.01em; white-space: nowrap; }
.btn .ic { flex: none; }
.btn-gold { background: var(--gold-grad); color: var(--gold-ink); box-shadow: var(--glow-gold); }
.btn-gold.xl { height: 64px; padding: 0 34px 0 14px; font-size: 20px; gap: 14px; }
.btn-gold .play-dot { width: 40px; height: 40px; border-radius: 50%; background: var(--gold-ink); color: var(--gold-300);
  display: grid; place-items: center; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
.btn-ghost { border: 1px solid var(--line-2); color: var(--ivory-100); background: rgba(245, 238, 223, 0.04); }
.btn-outline-gold { border: 1px solid var(--line-gold); color: var(--gold-200); background: rgba(217, 174, 92, 0.07); }
.btn-quiet { color: var(--ivory-300); padding: 0 12px; }
.icon-btn { width: 44px; height: 44px; border-radius: 50%; display: inline-grid; place-items: center; color: var(--ivory-200);
  background: rgba(245, 238, 223, 0.05); border: 1px solid var(--line); }
.chip { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 16px; border-radius: var(--r-pill);
  font: 650 14px/1 var(--font-ui); color: var(--ivory-300); border: 1px solid var(--line); background: rgba(245, 238, 223, 0.03); white-space: nowrap; }
.chip.on { color: var(--gold-ink); background: var(--gold-grad); border-color: transparent; box-shadow: 0 6px 18px rgba(217,174,92,.25); }
.chip .count { font-weight: 600; opacity: 0.6; }
.stat-chip { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 11px; border-radius: var(--r-pill);
  background: rgba(245, 238, 223, 0.05); border: 1px solid var(--line); font: 700 15px/1 var(--font-ui); color: var(--ivory-100); }
.stat-chip .ic { color: var(--gold-300); }
.stat-chip small { font-weight: 600; color: var(--ivory-500); font-size: 13px; }

/* ---- top bar ---- */
.topbar { position: absolute; left: 0; right: 0; top: 0; height: 76px; padding: 0 28px; display: flex; align-items: center; gap: 24px; z-index: 5; }
.lockup { display: flex; align-items: center; gap: 12px; }
.tabs { display: flex; gap: 2px; margin-left: 20px; padding: 5px; border-radius: var(--r-pill); background: rgba(245,238,223,.035); border: 1px solid var(--line); }
.tabs a { display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 15px; white-space: nowrap; border-radius: var(--r-pill); font: 650 15px/1 var(--font-ui); color: var(--ivory-400); }
.tabs a.on { color: var(--ivory-50); background: rgba(245,238,223,.09); box-shadow: inset 0 1px 0 rgba(255,244,220,.08); }
.tabs a .ic { opacity: .85; }
.tabs a.on .ic { color: var(--gold-300); opacity: 1; }
.top-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.avatar { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font: 600 16px/1 var(--font-display);
  color: var(--gold-200); background: radial-gradient(circle at 30% 25%, #3a2f22, #1c1712); border: 1px solid var(--line-gold); }

/* ---- timing chips ---- */
.tchip { position: absolute; transform: translate(-50%, -100%); display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px;
  border-radius: var(--r-pill); font: 800 16px/1 var(--font-ui); white-space: nowrap; letter-spacing: 0.005em; }
.tchip::after { content: ''; position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px; transform: translateX(-50%) rotate(45deg); background: inherit; border-right: inherit; border-bottom: inherit; border-radius: 0 0 3px 0; }
.tchip.perfect { background: var(--gold-grad); color: var(--gold-ink); box-shadow: 0 8px 22px rgba(217,174,92,.45); }
.tchip.great { background: #2A2319; color: var(--great); border: 1.5px solid rgba(243,221,165,.7); }
.tchip.off { background: #2B1E13; color: var(--offbeat); border: 1.5px solid rgba(242,166,90,.75); }
.tchip.miss { background: #2A1518; color: var(--miss); border: 1.5px solid rgba(232,112,126,.7); }
.tchip b { font-weight: 600; opacity: .85; }
`;

// ---------------------------------------------------------------------------------------------
// Icons (24 px grid, 1.8 stroke, round joins). Original drawings.
// ---------------------------------------------------------------------------------------------
const ICON = {
  note: '<path d="M9 18V5.8l11-2.6v12.3"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="17.4" cy="15.5" r="2.6"/>',
  metronome: '<path d="M9.3 3.5h5.4L19 20.5H5z"/><path d="M12 16.2l5.6-9.4"/><path d="M7.4 16.2h9.2"/>',
  keys: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M8.2 19.5v-5.5M12 19.5v-5.5M15.8 19.5v-5.5"/><path d="M7 4.5v9.5h2.4V4.5M14.6 4.5v9.5H17V4.5" fill="currentColor" stroke-width="1.2"/>',
  chart: '<path d="M4 20h16"/><path d="M6 15.5l4-4.5 3.5 3L19 7.5"/><path d="M15 7.5h4v4"/>',
  sliders: '<path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20"/><circle cx="15" cy="7" r="2.3"/><circle cx="9" cy="17" r="2.3"/>',
  flame: '<path d="M12 3c.7 3.1 5 5.2 5 10.1a5 5 0 0 1-10 0c0-2.3 1.1-3.7 2.3-4.8.1 1.8.9 2.9 2 3.2-.4-3.2-.2-5.4.7-8.5z"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  speaker: '<path d="M4 9.5v5h3.4l4.6 4V5.5l-4.6 4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  play: '<path d="M8.5 5.8v12.4a.6.6 0 0 0 .9.5l9.7-6.2a.6.6 0 0 0 0-1L9.4 5.3a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  arrowR: '<path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5"/>',
  chevR: '<path d="M9.5 6l6 6-6 6"/>',
  chevL: '<path d="M14.5 6l-6 6 6 6"/>',
  check: '<path d="M5.5 12.5l4.2 4.2L18.5 8"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  upload: '<path d="M12 15V4.5M7.8 8.5L12 4.3l4.2 4.2"/><path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  retry: '<path d="M4.8 12.5A7.3 7.3 0 1 0 7 6.8"/><path d="M4.5 3.8v4.2h4.2"/>',
  book: '<path d="M4.5 5.5c2.8-1 5.3-.8 7.5.8v13c-2.2-1.6-4.7-1.8-7.5-.8zM19.5 5.5c-2.8-1-5.3-.8-7.5.8v13c2.2-1.6 4.7-1.8 7.5-.8z"/>',
  up: '<path d="M12 18.5V6M6.8 11L12 5.8l5.2 5.2"/>',
  down: '<path d="M12 5.5V18M6.8 13l5.2 5.2 5.2-5.2"/>',
  hand: '<path d="M8 12.5V6.2a1.5 1.5 0 0 1 3 0v5M11 11V4.8a1.5 1.5 0 0 1 3 0V11M14 11V6.3a1.5 1.5 0 0 1 3 0v7.2c0 4-2.6 6.5-6 6.5-2.6 0-4-1.2-5.4-3.4L3.8 13a1.4 1.4 0 0 1 2.3-1.6L8 13.8"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  bolt: '<path d="M13 3.5L5.5 13.5H12l-1 7 7.5-10H12z"/>',
  sort: '<path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3"/>',
  eye: '<path d="M2.8 12s3.3-6.5 9.2-6.5 9.2 6.5 9.2 6.5-3.3 6.5-9.2 6.5S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
};
const icon = (n, size = 20, sw = 1.8, extra = '') =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICON[n]}</svg>`;

// ---------------------------------------------------------------------------------------------
// Brand: the Fermata mark and the Maestro wordmark
// ---------------------------------------------------------------------------------------------
let uid = 0;
// The fermata: an arch of light (proscenium / spotlight) held over a single point (the performer, the note).
function fermataPaths(fill, dotFill = fill) {
  return `<path d="M7 44A25 25 0 0 1 57 44H54.2A22.2 19.6 0 0 0 9.8 44Z" fill="${fill}"/><circle cx="32" cy="39.6" r="4.9" fill="${dotFill}"/>`;
}
export function MARK(size = 40, mode = 'gold') {
  const id = `mg${uid++}`;
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#F7E6B4"/><stop offset=".55" stop-color="#D9AE5C"/><stop offset="1" stop-color="#A87A2C"/></linearGradient></defs>`;
  const fill = mode === 'gold' ? `url(#${id})` : mode;
  return `<svg class="mark" width="${size}" height="${size}" viewBox="4 12 56 40" aria-label="Maestro">${defs}${fermataPaths(fill)}</svg>`;
}
export function APP_ICON(size = 120) {
  const id = `ai${uid++}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-label="Maestro app icon">
<defs>
  <linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241D16"/><stop offset="1" stop-color="#0C0A08"/></linearGradient>
  <radialGradient id="${id}sp" cx=".5" cy=".62" r=".5"><stop offset="0" stop-color="#F1C77A" stop-opacity=".42"/><stop offset=".45" stop-color="#C4953E" stop-opacity=".12"/><stop offset="1" stop-color="#C4953E" stop-opacity="0"/></radialGradient>
  <linearGradient id="${id}g" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#F7E6B4"/><stop offset=".55" stop-color="#D9AE5C"/><stop offset="1" stop-color="#A87A2C"/></linearGradient>
</defs>
<rect width="64" height="64" rx="14.2" fill="url(#${id}bg)"/>
<ellipse cx="32" cy="40" rx="26" ry="20" fill="url(#${id}sp)"/>
<g transform="translate(32 34) scale(.74) translate(-32 -34)">${fermataPaths(`url(#${id}g)`)}</g>
<ellipse cx="32" cy="45.2" rx="9" ry="1.1" fill="#F1C77A" opacity=".28"/>
<rect x=".5" y=".5" width="63" height="63" rx="13.7" fill="none" stroke="rgba(255,236,200,.10)"/>
</svg>`;
}
const WM = JSON.parse(fs.readFileSync(path.join(HERE, 'wordmark-outlines.json'), 'utf8'));
// "Maestro" set in Fraunces 600 (opsz 144), outlined; the final o is held under a fermata.
export function WORDMARK(height = 28, { ivory = '#F5EEDF', gold = '#D9AE5C', arc = true } = {}) {
  const o = WM.boxes[6];
  const cx = (o[0] + o[1]) / 2;
  const R = 560;
  const baseY = -690;
  const arcPath = `M${cx - R} ${baseY}A${R} ${R} 0 0 1 ${cx + R} ${baseY}H${cx + R - 62}A${R - 62} ${R - 150} 0 0 0 ${cx - R + 62} ${baseY}Z`;
  const top = arc ? -1400 : -1400;
  const vbH = 1400 + 30;
  const glyphs = WM.paths.map((p, i) => `<path d="${p}" fill="${i === 6 && arc ? gold : ivory}"/>`).join('');
  const width = (WM.advance + 20) * (height / vbH);
  return `<svg class="wordmark" width="${width.toFixed(1)}" height="${height}" viewBox="-10 ${top} ${WM.advance + 20} ${vbH}" aria-label="Maestro">${glyphs}${arc ? `<path d="${arcPath}" fill="${gold}"/>` : ''}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Music helpers
// ---------------------------------------------------------------------------------------------
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parseNote(s) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
  const letter = m[1], acc = m[2] || '', oct = +m[3];
  return { letter, acc, oct, d: oct * 7 + LETTERS.indexOf(letter), midi: 12 * (oct + 1) + PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) };
}
const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const STAFF = { treble: { top: 38, bottom: 30, middle: 34 }, bass: { top: 26, bottom: 18, middle: 22 } };

function glyph(name, x, y, sp, fill) {
  return `<path d="${GLYPHS[name].d}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${sp})" fill="${fill}"/>`;
}

// Engrave one staff system (treble, bass or both) as SVG elements.
// notes: [{ staff, name:'E4', beat, dur, color, glow }]
function engrave({ sp, staves, topY, gap = 9, x0 = 0, width, clefs = true, timeSig = '4/4', ink = '#1D1A16', lineColor = 'rgba(29,26,22,.55)', notes = [], X, barlines = [], contentLeft, measureNumbers = [], finalBar = null, brace = true, fingers = {} }) {
  const out = [];
  const staffTop = {};
  staves.forEach((s, i) => (staffTop[s] = topY + i * (4 * sp + gap * sp)));
  const Y = (staff, d) => staffTop[staff] + ((STAFF[staff].top - d) * sp) / 2;
  const lw = Math.max(1, sp * 0.1);
  // staff lines
  for (const s of staves) for (let i = 0; i < 5; i++) {
    const y = staffTop[s] + i * sp;
    out.push(`<rect x="${x0}" y="${(y - lw / 2).toFixed(2)}" width="${width}" height="${lw}" fill="${lineColor}"/>`);
  }
  if (staves.length === 2 && brace) {
    const yA = staffTop[staves[0]], yB = staffTop[staves[1]] + 4 * sp;
    out.push(`<rect x="${x0}" y="${yA}" width="${lw * 1.3}" height="${yB - yA}" fill="${lineColor}"/>`);
    // a slim engraved brace
    const bx = x0 - sp * 0.9, mid = (yA + yB) / 2;
    out.push(`<path d="M${bx + sp * 0.7} ${yA} C${bx - sp * 0.2} ${yA + sp * 1.5} ${bx + sp * 0.9} ${mid - sp * 1.6} ${bx} ${mid} C${bx + sp * 0.9} ${mid + sp * 1.6} ${bx - sp * 0.2} ${yB - sp * 1.5} ${bx + sp * 0.7} ${yB} C${bx + sp * 0.2} ${yB - sp * 1.6} ${bx + sp * 1.1} ${mid + sp * 1.2} ${bx + sp * 0.18} ${mid} C${bx + sp * 1.1} ${mid - sp * 1.2} ${bx + sp * 0.2} ${yA + sp * 1.6} ${bx + sp * 0.7} ${yA}Z" fill="${ink}"/>`);
  }
  let cx = x0 + sp * 0.8;
  if (clefs) {
    for (const s of staves) {
      if (s === 'treble') out.push(glyph('gClef', cx, Y('treble', 32), sp, ink));
      else out.push(glyph('fClef', cx, Y('bass', 24), sp, ink));
    }
    cx += sp * 3.5;
    if (timeSig) {
      const [a, b] = timeSig.split('/');
      for (const s of staves) {
        const mid = Y(s, STAFF[s].middle);
        out.push(glyph('timeSig' + a, cx, mid - sp, sp, ink));
        out.push(glyph('timeSig' + b, cx, mid + sp, sp, ink));
      }
      cx += sp * 2.4;
    }
  }
  const firstY = staffTop[staves[0]], lastY = staffTop[staves[staves.length - 1]] + 4 * sp;
  for (const bx of barlines) out.push(`<rect x="${bx.toFixed(2)}" y="${firstY}" width="${lw * 1.2}" height="${lastY - firstY}" fill="${lineColor}"/>`);
  if (finalBar != null) {
    out.push(`<rect x="${finalBar - sp * 0.9}" y="${firstY}" width="${lw * 1.2}" height="${lastY - firstY}" fill="${ink}"/>`);
    out.push(`<rect x="${finalBar - sp * 0.5}" y="${firstY}" width="${sp * 0.5}" height="${lastY - firstY}" fill="${ink}"/>`);
  }
  for (const m of measureNumbers) out.push(`<text x="${m.x}" y="${firstY - sp * 0.9}" font-family="Fraunces" font-style="italic" font-size="${sp * 1.15}" fill="rgba(29,26,22,.45)">${m.n}</text>`);
  // notes
  for (const n of notes) {
    const p = parseNote(n.name);
    const staff = n.staff;
    const x = X(n.beat);
    const dotted = [3, 1.5, 0.75].includes(n.dur);
    const base = dotted ? n.dur / 1.5 : n.dur >= 3.5 ? 4 : n.dur >= 2 ? 2 : n.dur >= 1 ? 1 : 0.5;
    const head = base >= 4 ? 'noteheadWhole' : base >= 2 ? 'noteheadHalf' : 'noteheadBlack';
    const hw = GLYPHS[head].w * sp;
    const hx = x - hw / 2;
    const y = Y(staff, p.d);
    const col = n.color || ink;
    if (n.opacity != null) out.push(`<g opacity="${n.opacity.toFixed(2)}">`);
    // ledger lines
    const s = STAFF[staff];
    for (let l = s.top + 2; l <= p.d; l += 2) out.push(`<rect x="${hx - sp * 0.4}" y="${Y(staff, l) - lw / 2}" width="${hw + sp * 0.8}" height="${lw * 1.1}" fill="${ink}"/>`);
    for (let l = s.bottom - 2; l >= p.d; l -= 2) out.push(`<rect x="${hx - sp * 0.4}" y="${Y(staff, l) - lw / 2}" width="${hw + sp * 0.8}" height="${lw * 1.1}" fill="${ink}"/>`);
    if (n.glow) out.push(`<ellipse cx="${x}" cy="${y}" rx="${sp * 1.9}" ry="${sp * 1.6}" fill="url(#noteGlow)"/>`);
    if (p.acc) out.push(glyph(p.acc === '#' ? 'accidentalSharp' : 'accidentalFlat', hx - sp * 1.3, y, sp, col));
    out.push(glyph(head, hx, y, sp, col));
    if (dotted) out.push(glyph('augmentationDot', hx + hw + sp * 0.35, y + (p.d % 2 === 0 ? -sp * 0.5 : 0), sp, col));
    if (base < 4) {
      const up = p.d < s.middle;
      const len = sp * 3.4;
      const sx = up ? hx + hw - sp * 0.06 : hx + sp * 0.06;
      const y1 = up ? y - len : y + len;
      out.push(`<rect x="${sx - sp * 0.06}" y="${Math.min(y, y1)}" width="${sp * 0.12}" height="${len}" fill="${col}"/>`);
      if (base <= 0.5) out.push(glyph(up ? 'flag8thUp' : 'flag8thDown', sx - sp * 0.06, y1, sp, col));
    }
    if (n.opacity != null) out.push('</g>');
    if (fingers[n.beat + n.name]) out.push(`<text x="${x}" y="${Y(staff, Math.max(p.d + 7, s.top + 3))}" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="${sp * 1.2}" fill="#1F4F9A">${fingers[n.beat + n.name]}</text>`);
  }
  return { svg: out.join(''), Y, staffTop, contentX: cx };
}

// ---- keyboard ----
function keyboard({ lo, hi, x0, y0, width, height, states = {}, labels = true }) {
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const ww = width / whites.length;
  const keys = new Map();
  whites.forEach((m, i) => keys.set(m, { x: x0 + i * ww, w: ww, black: false }));
  const OFF = { 1: -0.12, 3: 0.12, 6: -0.14, 8: 0, 10: 0.14 };
  for (let m = lo; m <= hi; m++) if (isBlack(m)) {
    const left = keys.get(m - 1);
    const bw = ww * 0.58;
    keys.set(m, { x: left.x + ww - bw / 2 + OFF[m % 12] * bw, w: bw, black: true });
  }
  const bh = height * 0.62;
  const svg = [];
  svg.push(`<defs>
    <linearGradient id="kWhite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9E0CC"/><stop offset=".08" stop-color="#FBF6EA"/><stop offset=".9" stop-color="#F6EFE0"/><stop offset="1" stop-color="#E3D8C2"/></linearGradient>
    <linearGradient id="kBlack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A241E"/><stop offset=".85" stop-color="#15110E"/><stop offset="1" stop-color="#0B0907"/></linearGradient>
    <linearGradient id="kGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7E2A8"/><stop offset=".6" stop-color="#E7C179"/><stop offset="1" stop-color="#C99A45"/></linearGradient>
    <linearGradient id="kGoldBlack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9C77F"/><stop offset="1" stop-color="#8E6620"/></linearGradient>
    <linearGradient id="kShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
  </defs>`);
  svg.push(`<rect x="${x0 - 6}" y="${y0 - 10}" width="${width + 12}" height="${height + 16}" rx="10" fill="#0B0907"/>`);
  for (const m of whites) {
    const k = keys.get(m);
    const st = states[m];
    const fill = st === 'hit' ? 'url(#kGold)' : 'url(#kWhite)';
    svg.push(`<rect x="${k.x + 1}" y="${y0}" width="${k.w - 2}" height="${height}" rx="6" fill="${fill}"/>`);
    if (st === 'rh' || st === 'lh') {
      const c = st === 'rh' ? '#4F8FEA' : '#E27B52';
      svg.push(`<rect x="${k.x + 5}" y="${y0 + height - 18}" width="${k.w - 10}" height="8" rx="4" fill="${c}"/>`);
    }
    if (labels && m % 12 === 0) svg.push(`<text x="${k.x + k.w / 2}" y="${y0 + height - 26}" text-anchor="middle" font-family="Manrope" font-weight="700" font-size="12" fill="${st === 'hit' ? '#5a4214' : 'rgba(29,26,22,.42)'}">C${m / 12 - 1}</text>`);
  }
  svg.push(`<rect x="${x0}" y="${y0}" width="${width}" height="10" fill="url(#kShade)"/>`);
  for (const [m, k] of keys) if (k.black) {
    const st = states[m];
    svg.push(`<rect x="${k.x}" y="${y0 - 1}" width="${k.w}" height="${bh}" rx="4" fill="${st === 'hit' ? 'url(#kGoldBlack)' : 'url(#kBlack)'}"/>`);
    svg.push(`<rect x="${k.x + 3}" y="${y0 + bh - 12}" width="${k.w - 6}" height="7" rx="3" fill="rgba(255,240,215,.10)"/>`);
  }
  return { svg: svg.join(''), keys, ww };
}

// ---------------------------------------------------------------------------------------------
// The play canvas (sheet card + falling notes + keyboard), shared by Play and Placement
// ---------------------------------------------------------------------------------------------
const EXERCISE = {
  // Level 12 "Dotted rhythms" sight-reading, C major 4/4 (an original exercise)
  rh: [['E4', 0, 1.5], ['F4', 1.5, 0.5], ['G4', 2, 1], ['G4', 3, 1], ['A4', 4, 1.5], ['G4', 5.5, 0.5], ['F4', 6, 2],
    ['E4', 8, 1.5], ['D4', 9.5, 0.5], ['E4', 10, 1], ['G4', 11, 1], ['G4', 12, 2], ['E4', 14, 2],
    ['F4', 16, 1.5], ['E4', 17.5, 0.5], ['D4', 18, 1], ['F4', 19, 1], ['E4', 20, 1.5], ['D4', 21.5, 0.5], ['C4', 22, 2]],
  lh: [['C3', 0, 2], ['E3', 2, 2], ['F3', 4, 2], ['C3', 6, 2], ['C3', 8, 2], ['E3', 10, 2], ['G3', 12, 2], ['E3', 14, 2],
    ['F3', 16, 2], ['G3', 18, 2], ['C3', 20, 4]],
};

function playCanvas({ now, top = 88, sheetH = 206, laneTop = 306, hitY = 650, kbH = 154, results = {}, chips = [], hit = [], hints = {}, overlay = '', pxb = 62, ppb = 78, playheadX = 300 }) {
  const X0 = 16, CW = W - 32;
  // ---- sheet ----
  const sp = 10;
  const Xs = (b) => playheadX + (b - now) * pxb;
  const notes = [];
  for (const [hand, list] of [['R', EXERCISE.rh], ['L', EXERCISE.lh]]) for (const [name, beat, dur] of list) {
    const x = Xs(beat);
    if (x < 100 || x > CW - 12) continue;
    const r = results[hand + beat];
    const color = r === 'perfect' ? '#A07629' : r === 'off' ? '#B85F1A' : r === 'miss' ? '#B8384A' : undefined;
    const opacity = x < 170 ? Math.max(0, (x - 100) / 70) : undefined;
    notes.push({ staff: hand === 'R' ? 'treble' : 'bass', name, beat, dur, color, opacity, glow: Math.abs(beat - now) < 0.01 });
  }
  const bars = [];
  const mnums = [];
  for (let b = 4; b <= 24; b += 4) {
    const x = Xs(b) - pxb * 0.42;
    if (x > 130 && x < CW - 8) { bars.push(x); mnums.push({ x: x + 4, n: b / 4 + 1 }); }
  }
  const eng = engrave({ sp, staves: ['treble', 'bass'], topY: 44, gap: 5, x0: 24, width: CW - 48, notes, X: Xs, barlines: bars, measureNumbers: mnums.filter((m) => m.n <= 6) });
  const sheet = `<div class="sheet paper" style="position:absolute;left:${X0}px;top:${top}px;width:${CW}px;height:${sheetH}px">
    <svg width="${CW}" height="${sheetH}" style="position:absolute;inset:0">
      <defs>
        <radialGradient id="noteGlow"><stop offset="0" stop-color="#E9B95A" stop-opacity=".55"/><stop offset="1" stop-color="#E9B95A" stop-opacity="0"/></radialGradient>
        <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="#FAF4E6" stop-opacity="1"/><stop offset="1" stop-color="#FAF4E6" stop-opacity="0"/></linearGradient>
        <linearGradient id="phBand" x1="0" x2="1"><stop offset="0" stop-color="#D9AE5C" stop-opacity="0"/><stop offset=".5" stop-color="#D9AE5C" stop-opacity=".16"/><stop offset="1" stop-color="#D9AE5C" stop-opacity="0"/></linearGradient>
      </defs>
      <rect x="${playheadX - 26}" y="10" width="52" height="${sheetH - 20}" fill="url(#phBand)"/>
      ${eng.svg}
      <rect x="${playheadX - 1.25}" y="16" width="2.5" height="${sheetH - 32}" rx="1.25" fill="#C4953E"/>
      <path d="M${playheadX - 7} 12h14l-7 8z" fill="#C4953E"/>
    </svg>
  </div>`;

  // ---- lane + keyboard ----
  const kb = keyboard({ lo: 48, hi: 84, x0: X0, y0: hitY + 2, width: CW, height: kbH, states: Object.fromEntries([...hit.map((m) => [m, 'hit']), ...Object.entries(hints)]) });
  const lane = [];
  // octave guides
  for (const [m, k] of kb.keys) if (!k.black && (m % 12 === 0 || m % 12 === 5)) lane.push(`<rect x="${k.x}" y="${laneTop}" width="1" height="${hitY - laneTop}" fill="rgba(245,238,223,${m % 12 === 0 ? 0.07 : 0.035})"/>`);
  // light beams over pressed keys
  for (const m of hit) {
    const k = kb.keys.get(m);
    lane.push(`<rect x="${k.x + 2}" y="${hitY - 230}" width="${k.w - 4}" height="230" fill="url(#beam)"/>`);
  }
  const bar = (hand, name, beat, dur) => {
    const p = parseNote(name);
    const k = kb.keys.get(p.midi);
    if (!k) return '';
    if (beat + dur <= now) return '';
    let yb = hitY - (beat - now) * ppb;
    let yt = yb - dur * ppb + 3;
    if (yb < laneTop + 24) return '';
    yt = Math.max(yt, top + 60);
    const inset = k.black ? 1 : 5;
    const x = k.x + inset, w = k.w - inset * 2;
    const active = beat <= now && beat + dur > now;
    if (active) yb = hitY;
    const grad = hand === 'R' ? (active ? 'url(#rhA)' : 'url(#rh)') : active ? 'url(#lhA)' : 'url(#lh)';
    const h = yb - yt;
    const label = `<text x="${x + w / 2}" y="${yb - 11}" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="15" fill="${hand === 'R' ? '#0E2A57' : '#4A1C09'}">${p.letter}</text>`;
    return `<g ${active ? 'filter="url(#barGlow)"' : ''}><rect x="${x}" y="${yt}" width="${w}" height="${h}" rx="9" fill="${grad}"/>
      <rect x="${x + 1}" y="${yt + 1}" width="${w - 2}" height="${h - 2}" rx="8" fill="none" stroke="${active ? 'rgba(255,240,200,.9)' : 'rgba(255,255,255,.28)'}" stroke-width="${active ? 1.6 : 1}"/>${h > 30 ? label : ''}</g>`;
  };
  for (const [name, beat, dur] of EXERCISE.rh) lane.push(bar('R', name, beat, dur));
  for (const [name, beat, dur] of EXERCISE.lh) lane.push(bar('L', name, beat, dur));
  // sparks & rings
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const m of hit) {
    const k = kb.keys.get(m);
    const cx = k.x + k.w / 2;
    lane.push(`<ellipse cx="${cx}" cy="${hitY}" rx="${k.w * 0.95}" ry="10" fill="none" stroke="rgba(243,221,165,.55)" stroke-width="1.5"/>`);
    lane.push(`<ellipse cx="${cx}" cy="${hitY}" rx="${k.w * 0.7}" ry="16" fill="url(#hitPool)"/>`);
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 1.9;
      const r = 14 + rnd() * 64;
      const s = 1.2 + rnd() * 2.2;
      lane.push(`<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(hitY - 4 + Math.sin(a) * r).toFixed(1)}" r="${s.toFixed(1)}" fill="${rnd() > 0.35 ? '#F7E2A8' : '#FFF6DE'}" opacity="${(0.45 + rnd() * 0.55).toFixed(2)}"/>`);
    }
  }
  const laneSvg = `<svg width="${W}" height="${H}" style="position:absolute;inset:0;pointer-events:none">
    <defs>
      <linearGradient id="rh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8DBBFF"/><stop offset="1" stop-color="#5A96EE"/></linearGradient>
      <linearGradient id="rhA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C3DBFF"/><stop offset="1" stop-color="#8DBBFF"/></linearGradient>
      <linearGradient id="lh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F8B08D"/><stop offset="1" stop-color="#E8865E"/></linearGradient>
      <linearGradient id="lhA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFD3BC"/><stop offset="1" stop-color="#F8B08D"/></linearGradient>
      <linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#F1C77A" stop-opacity=".42"/><stop offset=".5" stop-color="#F1C77A" stop-opacity=".08"/><stop offset="1" stop-color="#F1C77A" stop-opacity="0"/></linearGradient>
      <radialGradient id="hitPool"><stop offset="0" stop-color="#FFE9B5" stop-opacity=".85"/><stop offset="1" stop-color="#F1C77A" stop-opacity="0"/></radialGradient>
      <linearGradient id="laneBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120F0C" stop-opacity=".0"/><stop offset=".75" stop-color="#1A1511" stop-opacity=".6"/><stop offset="1" stop-color="#2A2117" stop-opacity=".9"/></linearGradient>
      <linearGradient id="hitLine" x1="0" x2="1"><stop offset="0" stop-color="#C4953E" stop-opacity=".25"/><stop offset=".5" stop-color="#F1C77A"/><stop offset="1" stop-color="#C4953E" stop-opacity=".25"/></linearGradient>
      <filter id="barGlow" x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="5" in="SourceAlpha" result="b"/><feFlood flood-color="#F1C77A" flood-opacity=".75"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect x="${X0}" y="${laneTop}" width="${CW}" height="${hitY - laneTop}" fill="url(#laneBg)"/>
    ${lane.join('')}
    ${kb.svg}
    <rect x="${X0}" y="${hitY - 1}" width="${CW}" height="2.5" fill="url(#hitLine)"/>
  </svg>`;
  const chipHtml = chips.map((c) => {
    const k = kb.keys.get(parseNote(c.note).midi);
    const x = Math.max(80, k.x + k.w / 2);
    return `<div class="tchip ${c.kind}" style="left:${x}px;top:${c.y ?? hitY - 14}px;opacity:${c.opacity ?? 1}">${c.html}</div>`;
  }).join('');
  return `${laneSvg}${sheet}${chipHtml}${overlay}`;
}

// ---------------------------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------------------------
function page(title, css, body, { height = H } = {}) {
  const base = height === H ? BASE_CSS : BASE_CSS.replace(`height: ${H}px; overflow: hidden; background`, `height: ${height}px; overflow: hidden; background`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${W}">
<title>${title}</title>
${FONTS}
<style>
${TOKENS_CSS}
${base}
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function topbar(active) {
  const tabs = [['Learn', 'book'], ['Songs', 'note'], ['Practice', 'metronome'], ['Free play', 'keys'], ['Progress', 'chart']];
  return `<header class="topbar">
    <div class="lockup">${WORDMARK(30)}</div>
    <nav class="tabs">${tabs.map(([t, i]) => `<a class="${t === active ? 'on' : ''}">${icon(i, 18)}${t}</a>`).join('')}</nav>
    <div class="top-right">
      <span class="stat-chip num">${icon('flame', 19)}12 <small>days</small></span>
      <span class="stat-chip num">${icon('star', 19)}1,240 <small>XP</small></span>
      <button class="icon-btn" aria-label="Settings">${icon('sliders', 20)}</button>
    </div>
  </header>`;
}

// =============================================================================================
// a) HOME
// =============================================================================================
function programmeSVG({ width = 1076, current = 12 }) {
  const stages = [
    { n: 'I', name: 'Beginner', from: 1, to: 8, start: 0 },
    { n: 'II', name: 'Elementary', from: 9, to: 16, start: 1 },
    { n: 'III', name: 'Intermediate', from: 17, to: 26, start: 0 },
    { n: 'IV', name: 'Advanced', from: 27, to: 34, start: 2 },
    { n: 'V', name: 'Master', from: 35, to: 40, start: 4 },
  ];
  const sp = 14;
  const top = 60; // top staff line
  const bottom = top + 4 * sp;
  const yOf = (p) => bottom - (p * sp) / 2; // p = 0 bottom line
  const clefW = 64;
  const gap = 30; // per barline
  const per = (width - clefW - 16 - gap * 4) / 40;
  const out = [];
  out.push(`<defs>
    <radialGradient id="nowGlow"><stop offset="0" stop-color="#F1C77A" stop-opacity=".55"/><stop offset=".5" stop-color="#F1C77A" stop-opacity=".12"/><stop offset="1" stop-color="#F1C77A" stop-opacity="0"/></radialGradient>
    <linearGradient id="nowBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F1C77A" stop-opacity="0"/><stop offset="1" stop-color="#F1C77A" stop-opacity=".2"/></linearGradient>
    <linearGradient id="goldN" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset=".6" stop-color="#D9AE5C"/><stop offset="1" stop-color="#B8893A"/></linearGradient>
  </defs>`);
  for (let i = 0; i < 5; i++) out.push(`<rect x="0" y="${top + i * sp - 0.6}" width="${width}" height="1.2" fill="rgba(245,238,223,.13)"/>`);
  out.push(glyph('gClef', 10, yOf(2), sp, 'rgba(233,199,127,.9)'));
  let x = clefW;
  const labels = [];
  const pos = [];
  stages.forEach((s, si) => {
    const count = s.to - s.from + 1;
    const x0 = x;
    for (let lv = s.from; lv <= s.to; lv++) {
      const p = s.start + (lv - s.from);
      pos.push({ lv, x: x + per / 2, p, si });
      x += per;
    }
    labels.push({ ...s, x0, x1: x, done: Math.max(0, Math.min(count, current - s.from)), count });
    if (si < 4) {
      out.push(`<rect x="${x + gap / 2 - 0.7}" y="${top}" width="1.4" height="${4 * sp}" fill="rgba(245,238,223,.28)"/>`);
      x += gap;
    }
  });
  // final double bar
  out.push(`<rect x="${width - 10}" y="${top}" width="1.4" height="${4 * sp}" fill="rgba(245,238,223,.4)"/><rect x="${width - 6}" y="${top}" width="5" height="${4 * sp}" fill="rgba(245,238,223,.4)"/>`);
  const cur = pos.find((p) => p.lv === current);
  // spotlight on "now"
  out.push(`<path d="M${cur.x - 38} 0H${cur.x + 38}L${cur.x + 18} ${yOf(cur.p) + 8}H${cur.x - 18}Z" fill="url(#nowBeam)"/>`);
  out.push(`<ellipse cx="${cur.x}" cy="${yOf(cur.p)}" rx="34" ry="30" fill="url(#nowGlow)"/>`);
  for (const q of pos) {
    const y = yOf(q.p);
    const done = q.lv < current, now = q.lv === current;
    const scale = now ? 1.55 : 1;
    const hw = GLYPHS.noteheadBlack.w * sp * scale;
    const col = done ? 'url(#goldN)' : now ? 'url(#goldN)' : 'rgba(245,238,223,.34)';
    // ledger lines
    if (q.p >= 10) out.push(`<rect x="${q.x - hw / 2 - 4}" y="${yOf(10) - 0.6}" width="${hw + 8}" height="1.2" fill="rgba(245,238,223,.3)"/>`);
    out.push(`<path d="${GLYPHS[done || now ? 'noteheadBlack' : 'noteheadHalf'].d}" transform="translate(${(q.x - hw / 2).toFixed(2)} ${y}) scale(${sp * scale})" fill="${col}"/>`);
    // stems
    const up = q.p < 4;
    const len = sp * 3.2 * (now ? 1.1 : 1);
    const sx = up ? q.x + hw / 2 - 1 : q.x - hw / 2 + 1;
    out.push(`<rect x="${sx - 0.8}" y="${up ? y - len : y}" width="1.6" height="${len}" fill="${done || now ? 'rgba(217,174,92,.85)' : 'rgba(245,238,223,.26)'}"/>`);
    // level number
    const ny = bottom + 44;
    if (now) {
      out.push(`<rect x="${q.x - 13.5}" y="${ny - 16.5}" width="27" height="23" rx="11.5" fill="url(#goldN)"/>`);
      out.push(`<text x="${q.x}" y="${ny}" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="14" fill="#1E1606">${q.lv}</text>`);
    } else out.push(`<text x="${q.x}" y="${ny}" text-anchor="middle" font-family="Manrope" font-weight="${done ? 700 : 600}" font-size="12.5" fill="${done ? 'rgba(233,199,127,.9)' : 'rgba(245,238,223,.4)'}">${q.lv}</text>`);
    if (done && q.lv >= current - 3) {/* recent */}
  }
  // fermata over level 40
  const last = pos[pos.length - 1];
  out.push(`<g transform="translate(${last.x - 11} ${top - 30}) scale(.34)" opacity=".85"><path d="M7 44A25 25 0 0 1 57 44H54.2A22.2 19.6 0 0 0 9.8 44Z" transform="translate(-7 -20)" fill="#D9AE5C"/><circle cx="25" cy="19.6" r="4.9" fill="#D9AE5C"/></g>`);
  // "now" flag
  out.push(`<g><rect x="${cur.x - 44}" y="2" width="88" height="26" rx="13" fill="#2A2218" stroke="rgba(217,174,92,.6)"/><text x="${cur.x}" y="19.5" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="12" letter-spacing="1.4" fill="#F3DDA5">YOU ARE HERE</text></g>`);
  // stage labels
  for (const l of labels) {
    const cx = (l.x0 + l.x1) / 2;
    const y = bottom + 84;
    out.push(`<text x="${l.x0 + 2}" y="${y}" font-family="Fraunces" font-style="italic" font-size="19" fill="${l.done > 0 ? '#E9C77F' : 'rgba(245,238,223,.5)'}">${l.n}.</text>`);
    out.push(`<text x="${l.x0 + 2 + (l.n.length * 7 + 12)}" y="${y}" font-family="Manrope" font-weight="700" font-size="15" fill="${l.done > 0 ? '#F5EEDF' : 'rgba(245,238,223,.55)'}">${l.name}</text>`);
    out.push(`<text x="${l.x1 - 4}" y="${y}" text-anchor="end" font-family="Manrope" font-weight="700" font-size="13" fill="${l.done === l.count ? '#E9C77F' : 'rgba(245,238,223,.45)'}">${l.done === l.count ? '✓ ' : ''}${l.done}/${l.count}</text>`);
    const bw = l.x1 - l.x0 - 4;
    out.push(`<rect x="${l.x0 + 2}" y="${y + 12}" width="${bw}" height="4" rx="2" fill="rgba(245,238,223,.08)"/>`);
    if (l.done) out.push(`<rect x="${l.x0 + 2}" y="${y + 12}" width="${(bw * l.done) / l.count}" height="4" rx="2" fill="url(#goldN)"/>`);
  }
  return `<svg width="${width}" height="${bottom + 104}" viewBox="0 0 ${width} ${bottom + 104}" style="display:block;overflow:visible">${out.join('')}</svg>`;
}

function heroSnippet() {
  // two bars of the level's rhythm: dotted quarter + eighth, with the counting printed under it
  const sp = 9;
  const notes = [['E4', 0, 1.5], ['F4', 1.5, 0.5], ['G4', 2, 1], ['G4', 3, 1], ['A4', 4, 1.5], ['G4', 5.5, 0.5], ['F4', 6, 2]];
  const X = (b) => 84 + b * 28.5;
  const eng = engrave({ sp, staves: ['treble'], topY: 34, x0: 12, width: 294, notes: notes.map(([name, beat, dur]) => ({ staff: 'treble', name, beat, dur })), X, barlines: [X(4) - 13], finalBar: 306 });
  const counts = [[0, '1'], [1, '2'], [1.5, '&'], [2, '3'], [3, '4'], [4, '1'], [5, '2'], [5.5, '&'], [6, '3']];
  const cnt = counts.map(([b, t]) => `<text x="${X(b)}" y="112" text-anchor="middle" font-family="Fraunces" font-style="italic" font-size="15" fill="${t === '2' ? 'rgba(29,26,22,.32)' : '#5B5346'}">${t}</text>`).join('');
  const hold = (b) => `<rect x="${X(b) + 5}" y="107" width="${X(b + 1) - X(b) - 14}" height="1.6" rx=".8" fill="#C4953E"/>`;
  return `<svg width="318" height="124" viewBox="0 0 318 124">${eng.svg}${hold(0)}${hold(4)}${cnt}</svg>`;
}

function homePage() {
  const css = `
  .grid { position: absolute; left: 28px; right: 28px; top: 86px; bottom: 24px; display: grid; grid-template-columns: 1fr 348px; grid-template-rows: 380px 1fr; gap: 18px; }
  .hero { position: relative; overflow: hidden; padding: 32px 34px; border-radius: var(--r-xl);
    background: radial-gradient(420px 340px at 80% -10%, rgba(241, 199, 122, 0.22), transparent 70%), radial-gradient(520px 260px at 100% 125%, rgba(142,42,59,.30), transparent 70%), linear-gradient(180deg, #221B15, #17130F);
    border: 1px solid rgba(217,174,92,.18); box-shadow: var(--e-2); }
  .hero .beam { position: absolute; right: 60px; top: -30px; width: 300px; height: 330px; background: linear-gradient(180deg, rgba(255,226,160,.14), rgba(255,226,160,0)); clip-path: polygon(40% 0, 60% 0, 100% 100%, 0 100%); }
  .hero .txt { position: relative; max-width: 370px; }
  .hero h1 { font-size: 47px; margin: 16px 0 14px; white-space: nowrap; }
  .hero .lede { font-size: 18px; line-height: 1.5; color: var(--ivory-300); }
  .steps { display: flex; align-items: center; gap: 10px; margin-top: 22px; }
  .step { display: flex; align-items: center; gap: 8px; font: 650 14px/1 var(--font-ui); color: var(--ivory-400); white-space: nowrap; }
  .step i { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--ivory-600); font-style: normal; font-size: 12px; font-weight: 800; }
  .step.done { color: var(--ivory-300); } .step.done i { background: var(--gold-400); border-color: transparent; color: var(--gold-ink); }
  .step.now { color: var(--ivory-50); } .step.now i { border-color: var(--gold-300); color: var(--gold-200); box-shadow: 0 0 0 4px rgba(217,174,92,.16); }
  .step-line { width: 18px; height: 1.5px; background: var(--line-2); }
  .cta-row { position: absolute; left: 34px; bottom: 32px; display: flex; gap: 12px; align-items: center; }
  .snippet { position: absolute; right: 30px; top: 40px; width: 326px; transform: rotate(-1.8deg); padding: 14px 4px 6px; }
  .snippet .tag { position: absolute; left: 16px; top: -12px; background: var(--stage-800); color: var(--gold-200); border: 1px solid var(--line-gold); font: 700 11px/1 var(--font-ui); letter-spacing: .14em; text-transform: uppercase; padding: 6px 10px; border-radius: 99px; }
  .snippet .cap { position: absolute; right: 14px; top: 12px; font: italic 400 13px/1 var(--font-display); color: var(--ink-soft); }
  .mastery { position: absolute; right: 34px; bottom: 40px; width: 300px; }
  .mastery .lab { display: flex; justify-content: space-between; font: 650 13px/1 var(--font-ui); color: var(--ivory-400); margin-bottom: 10px; }
  .mastery .lab b { color: var(--gold-200); font-weight: 800; }
  .bar { height: 8px; border-radius: 4px; background: rgba(245,238,223,.08); overflow: hidden; }
  .bar > span { display: block; height: 100%; border-radius: 4px; background: var(--gold-grad); box-shadow: 0 0 12px rgba(241,199,122,.5); }
  .side { display: grid; grid-template-rows: 186px 1fr; gap: 18px; }
  .today { padding: 18px 22px 16px; display: flex; flex-direction: column; justify-content: space-between; }
  .today .top { display: flex; align-items: center; gap: 16px; }
  .ring { position: relative; width: 92px; height: 92px; flex: none; }
  .ring .c { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
  .ring .c b { font: 560 28px/1 var(--font-display); }
  .ring .c small { font: 700 11px/1.2 var(--font-ui); color: var(--ivory-400); margin-top: 2px; }
  .streak h3 { font: 560 24px/1.1 var(--font-display); display: flex; align-items: center; gap: 8px; }
  .streak h3 .ic { color: var(--gold-300); }
  .streak p { font: 600 13.5px/1.4 var(--font-ui); color: var(--ivory-400); margin-top: 6px; }
  .streak p b { color: var(--ivory-200); }
  .week { display: flex; justify-content: space-between; }
  .week div { display: flex; flex-direction: column; align-items: center; gap: 6px; font: 700 11px/1 var(--font-ui); color: var(--ivory-500); }
  .week i { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--stage-600); color: var(--gold-ink); }
  .week .d i { background: var(--gold-grad); border-color: transparent; }
  .week .t i { border: 1.5px dashed var(--gold-300); box-shadow: 0 0 0 4px rgba(217,174,92,.12); color: var(--gold-200); }
  .week .t { color: var(--gold-200); }
  .picks { padding: 4px 10px; display: flex; flex-direction: column; justify-content: space-around; }
  .pick { display: flex; align-items: center; gap: 14px; padding: 7px 8px; }
  .pick + .pick { border-top: 1px solid var(--line); }
  .pick .pi { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: var(--gold-200); background: rgba(217,174,92,.1); border: 1px solid rgba(217,174,92,.22); flex: none; }
  .pick b { display: block; font: 700 16px/1.2 var(--font-ui); }
  .pick small { display: block; font: 600 13px/1.3 var(--font-ui); color: var(--ivory-400); margin-top: 3px; }
  .pick .ic.chev { margin-left: auto; color: var(--ivory-500); }
  .programme { grid-column: 1 / 3; padding: 18px 24px 16px; position: relative; display: flex; flex-direction: column; justify-content: space-between; }
  .programme header { display: flex; align-items: baseline; gap: 16px; }
  .programme h2 { font: 560 26px/1 var(--font-display); }
  .programme header .sub { font: 600 14px/1 var(--font-ui); color: var(--ivory-400); }
  .programme header .link { margin-left: auto; font: 700 14px/1 var(--font-ui); color: var(--gold-200); display: flex; align-items: center; gap: 4px; }
  `;
  const R = 40, C = 2 * Math.PI * R;
  const ring = `<svg width="92" height="92" viewBox="0 0 92 92"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset="1" stop-color="#C4953E"/></linearGradient></defs>
    <circle cx="46" cy="46" r="${R}" fill="none" stroke="rgba(245,238,223,.08)" stroke-width="8"/>
    <circle cx="46" cy="46" r="${R}" fill="none" stroke="url(#rg)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C * 0.6} ${C}" transform="rotate(-90 46 46)" style="filter:drop-shadow(0 0 6px rgba(241,199,122,.45))"/></svg>`;
  const week = [['M', 'd'], ['T', 'd'], ['W', 'd'], ['T', 'd'], ['F', 't'], ['S', ''], ['S', '']];
  const body = `<div class="screen"><div class="stage-bg"></div>
  ${topbar('Learn')}
  <main class="grid layer">
    <section class="hero">
      <div class="beam"></div>
      <div class="txt">
        <div class="eyebrow">Continue · Level 12 · Elementary</div>
        <h1 class="display">Dotted rhythms</h1>
        <p class="lede">A dot adds half again to a note. Feel the long–short lilt, then play it in time.</p>
        <div class="steps">
          <span class="step done"><i>${icon('check', 14, 2.6)}</i>Warm-up</span><span class="step-line"></span>
          <span class="step now"><i>2</i>Sight-reading</span><span class="step-line"></span>
          <span class="step"><i>3</i>Rhythm</span>
        </div>
      </div>
      <div class="snippet paper"><span class="tag">This level</span><span class="cap">long – short</span>${heroSnippet()}</div>
      <div class="cta-row">
        <button class="btn btn-gold xl"><span class="play-dot">${icon('play', 20)}</span>Continue</button>
        <button class="btn btn-ghost">${icon('speaker', 19)}Hear it first</button>
      </div>
      <div class="mastery"><div class="lab"><span>Level mastery</span><b class="num">62%</b></div><div class="bar"><span style="width:62%"></span></div></div>
    </section>
    <div class="side">
      <section class="card today">
        <div class="top"><div class="ring">${ring}<div class="c"><b class="num">30</b><small>of 50 XP</small></div></div>
          <div class="streak"><h3>${icon('flame', 22)}12-day streak</h3><p><b>20 XP to go today</b><br>about 5 minutes of playing</p></div></div>
        <div class="week">${week.map(([d, s]) => `<div class="${s}"><i>${s === 'd' ? icon('check', 15, 2.6) : ''}</i>${d}</div>`).join('')}</div>
      </section>
      <section class="card picks">
        <div class="pick"><span class="pi">${icon('note', 21)}</span><div><b>Ode to Joy</b><small>Song at your level · Both hands</small></div>${icon('chevR', 18, 2, 'class="ic chev"')}</div>
        <div class="pick"><span class="pi">${icon('metronome', 21)}</span><div><b>Rhythm drill</b><small>Practice · 3 min · any key counts</small></div>${icon('chevR', 18, 2, 'class="ic chev"')}</div>
        <div class="pick"><span class="pi">${icon('keys', 21)}</span><div><b>Free play</b><small>Play anything, see every note</small></div>${icon('chevR', 18, 2, 'class="ic chev"')}</div>
      </section>
    </div>
    <section class="card programme">
      <header><h2>Your programme</h2><span class="sub">40 levels in five movements · 11 complete</span><span class="link">All levels ${icon('chevR', 16, 2.2)}</span></header>
      <div class="svgwrap">${programmeSVG({ width: 1076, current: 12 })}</div>
    </section>
  </main></div>`;
  return page('Maestro · Home (Concert)', css, body);
}

// =============================================================================================
// b) PLACEMENT
// =============================================================================================
function placementStepper(active) {
  const steps = ['About you', 'Short tests', 'Your level'];
  return `<div class="pstep">${steps.map((s, i) => `<span class="ps ${i < active ? 'done' : i === active ? 'now' : ''}"><i>${i < active ? icon('check', 13, 2.8) : i + 1}</i>${s}</span>${i < 2 ? '<span class="pl"></span>' : ''}`).join('')}</div>`;
}
const PLACEMENT_CSS = `
  .pbar { position: absolute; left: 0; right: 0; top: 0; height: 84px; padding: 0 32px; display: flex; align-items: center; z-index: 5; }
  .pstep { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; }
  .ps { display: flex; align-items: center; gap: 9px; font: 650 14px/1 var(--font-ui); color: var(--ivory-500); }
  .ps i { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font: 800 12px/1 var(--font-ui); border: 1.5px solid var(--ivory-600); }
  .ps.done { color: var(--ivory-300); } .ps.done i { background: var(--gold-400); border-color: transparent; color: var(--gold-ink); }
  .ps.now { color: var(--ivory-50); } .ps.now i { border-color: var(--gold-300); color: var(--gold-200); box-shadow: 0 0 0 4px rgba(217,174,92,.15); }
  .pl { width: 36px; height: 1.5px; background: var(--line-2); }
  .pbar .skip { margin-left: auto; }
`;

function specimen(kind) {
  const sp = 7;
  if (kind === 'keys') {
    const kb = keyboard({ lo: 55, hi: 67, x0: 20, y0: 36, width: 184, height: 60, states: { 60: 'hit' }, labels: false });
    return `<svg width="224" height="104" viewBox="0 0 224 104">${kb.svg}<text x="${kb.keys.get(60).x + kb.keys.get(60).w / 2}" y="89" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="12" fill="#5a4214">C</text><text x="112" y="17" text-anchor="middle" font-family="Fraunces" font-style="italic" font-size="14" fill="#5B5346">this is middle C</text></svg>`;
  }
  let staves = ['treble'], notes = [], X, bars = [];
  if (kind === 'melody') {
    X = (b) => 58 + b * 30;
    notes = [['C4', 0, 1], ['D4', 1, 1], ['E4', 2, 1], ['F4', 3, 1], ['G4', 4, 2]].map(([n, b, d]) => ({ staff: 'treble', name: n, beat: b, dur: d }));
    const eng = engrave({ sp: 8, staves, topY: 34, x0: 8, width: 206, notes, X, timeSig: null, finalBar: 214 });
    return `<svg width="224" height="104" viewBox="0 0 224 104">${eng.svg}</svg>`;
  }
  if (kind === 'hands') {
    X = (b) => 58 + b * 38;
    notes = [['E4', 0, 1], ['G4', 1, 1], ['F4', 2, 1], ['D4', 3, 1], ['C3', 0, 2], ['G3', 2, 2]].map(([n, b, d], i) => ({ staff: i < 4 ? 'treble' : 'bass', name: n, beat: b, dur: d }));
    const eng = engrave({ sp, staves: ['treble', 'bass'], topY: 16, gap: 5, x0: 20, width: 190, notes, X, timeSig: null, finalBar: 210 });
    return `<svg width="224" height="104" viewBox="0 0 224 104">${eng.svg}</svg>`;
  }
  // 'pieces': denser, eighths + accidentals
  X = (b) => 54 + b * 36;
  notes = [['E5', 0, 0.5], ['D#5', 0.5, 0.5], ['E5', 1, 0.5], ['B4', 1.5, 0.5], ['D5', 2, 0.5], ['C5', 2.5, 0.5], ['A4', 3, 1], ['A2', 0, 1], ['E3', 1, 1], ['A3', 2, 1], ['C3', 3, 1]].map(([n, b, d], i) => ({ staff: i < 7 ? 'treble' : 'bass', name: n, beat: b, dur: d }));
  const eng = engrave({ sp, staves: ['treble', 'bass'], topY: 18, gap: 5, x0: 20, width: 190, notes, X, timeSig: null, finalBar: 210 });
  return `<svg width="224" height="104" viewBox="0 0 224 104">${eng.svg}</svg>`;
}

function placementExperience() {
  const css = PLACEMENT_CSS + `
  .intro { position: absolute; left: 0; right: 0; top: 118px; text-align: center; }
  .intro h1 { font-size: 50px; margin: 16px 0 14px; }
  .intro p { font: 500 19px/1.5 var(--font-ui); color: var(--ivory-300); }
  .opts { position: absolute; left: 44px; right: 44px; top: 318px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
  .opt { position: relative; border-radius: var(--r-xl); padding: 14px 14px 20px; background: linear-gradient(180deg, rgba(36,30,24,.95), rgba(24,20,16,.95)); border: 1px solid var(--line); box-shadow: var(--e-1); }
  .opt .spec { height: 118px; border-radius: 16px; display: grid; place-items: center; }
  .opt h3 { font: 560 25px/1.1 var(--font-display); margin: 18px 6px 8px; }
  .opt p { font: 550 15px/1.45 var(--font-ui); color: var(--ivory-400); margin: 0 6px; min-height: 44px; }
  .opt .lv { margin: 16px 6px 0; font: 700 12px/1 var(--font-ui); letter-spacing: .12em; text-transform: uppercase; color: var(--ivory-500); }
  .opt.sel { border-color: rgba(233,199,127,.85); box-shadow: 0 0 0 1px rgba(233,199,127,.6), 0 18px 50px rgba(217,174,92,.18), var(--e-1);
    background: radial-gradient(260px 200px at 50% 0%, rgba(241,199,122,.14), transparent 70%), linear-gradient(180deg, rgba(40,33,25,.98), rgba(26,21,16,.98)); }
  .opt.sel .lv { color: var(--gold-300); }
  .opt .tick { position: absolute; right: 12px; top: 12px; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--gold-grad); color: var(--gold-ink); box-shadow: 0 4px 14px rgba(217,174,92,.5); z-index: 2; }
  .foot { position: absolute; left: 0; right: 0; bottom: 42px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .foot .btn { width: 300px; height: 60px; font-size: 19px; }
  .foot p { font: 600 14px/1 var(--font-ui); color: var(--ivory-400); display: flex; align-items: center; gap: 8px; }
  .foot p .ic { color: var(--gold-300); }
  `;
  const opts = [
    ['keys', 'Never', 'I’m brand new. Show me where to start.', 'Starts at Level 1'],
    ['melody', 'A little', 'I can pick out a simple tune with one hand.', 'First test ≈ Level 4', true],
    ['hands', 'Yes, for a while', 'I read music and play with both hands.', 'First test ≈ Level 10'],
    ['pieces', 'Yes, for years', 'I play real pieces: scales, chords, a little Bach.', 'First test ≈ Level 18'],
  ];
  const body = `<div class="screen"><div class="stage-bg"></div>
  <div class="pbar">${WORDMARK(28)}${placementStepper(0)}<button class="btn btn-quiet skip">Skip · start at Level 1</button></div>
  <div class="layer">
    <div class="intro"><div class="eyebrow">Let’s find your level</div><h1 class="display">Have you played piano before?</h1><p>No wrong answers. This only decides where your first short test begins.</p></div>
    <div class="opts">${opts.map(([k, t, d, lv, sel]) => `<div class="opt ${sel ? 'sel' : ''}">${sel ? `<span class="tick">${icon('check', 17, 2.8)}</span>` : ''}<div class="spec paper">${specimen(k)}</div><h3>${t}</h3><p>${d}</p><div class="lv">${lv}</div></div>`).join('')}</div>
    <div class="foot"><button class="btn btn-gold">Continue ${icon('arrowR', 20, 2.2)}</button><p>${icon('mic', 17)}Next: 5–9 short tests, about 4 minutes. Maestro listens through the microphone.</p></div>
  </div></div>`;
  return page('Maestro · Placement: experience (Concert)', css, body);
}

const HUD_CSS = `
  .hud { position: absolute; left: 0; right: 0; top: 0; height: 80px; padding: 0 16px; display: flex; align-items: center; gap: 14px; z-index: 6; }
  .hud .ttl { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .hud .ttl b { font: 560 22px/1 var(--font-display); white-space: nowrap; }
  .hud .ttl small { font: 650 13px/1 var(--font-ui); color: var(--ivory-400); white-space: nowrap; display: flex; align-items: center; gap: 7px; }
  .listen-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--listening); box-shadow: 0 0 0 4px rgba(143,209,166,.18); }
  .hstat { display: flex; flex-direction: column; gap: 5px; padding: 0 16px; border-left: 1px solid var(--line); }
  .hstat small { font: 700 10.5px/1 var(--font-ui); letter-spacing: .16em; text-transform: uppercase; color: var(--ivory-500); }
  .hstat b { font: 800 25px/1 var(--font-ui); font-variant-numeric: tabular-nums; }
  .hstat b .x { color: var(--gold-300); font-size: 19px; margin-right: 1px; }
  .seg { display: inline-flex; padding: 4px; border-radius: var(--r-pill); background: rgba(245,238,223,.05); border: 1px solid var(--line); }
  .seg span { height: 34px; padding: 0 14px; display: grid; place-items: center; border-radius: var(--r-pill); font: 700 14px/1 var(--font-ui); color: var(--ivory-400); }
  .seg span.on { background: var(--gold-grad); color: var(--gold-ink); box-shadow: 0 4px 12px rgba(217,174,92,.3); }
  .tempo { display: inline-flex; align-items: center; height: 44px; border-radius: var(--r-pill); background: rgba(245,238,223,.05); border: 1px solid var(--line); }
  .tempo button { width: 36px; height: 42px; display: grid; place-items: center; font: 600 22px/1 var(--font-ui); color: var(--ivory-300); }
  .tempo b { font: 800 16px/1 var(--font-ui); font-variant-numeric: tabular-nums; padding: 0 2px; display: flex; align-items: center; gap: 4px; }
  .tempo b .q { font-family: var(--font-display); font-size: 20px; color: var(--gold-300); }
  .progress-line { position: absolute; left: 16px; right: 16px; top: 80px; height: 3px; border-radius: 2px; background: rgba(245,238,223,.07); z-index: 6; }
  .progress-line span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--gold-grad); box-shadow: 0 0 10px rgba(241,199,122,.6); }
  .progress-line i { position: absolute; top: -2px; width: 1.5px; height: 7px; background: rgba(245,238,223,.18); }
`;

function placementTest() {
  const css = HUD_CSS + `
  .tprog { display: flex; flex-direction: column; gap: 8px; margin-left: 10px; }
  .segs { display: flex; gap: 6px; }
  .segs i { width: 46px; height: 8px; border-radius: 4px; background: rgba(245,238,223,.08); position: relative; }
  .segs i.done { background: var(--gold-grad); }
  .segs i.now { background: linear-gradient(90deg, #E9C77F 0 30%, rgba(245,238,223,.12) 30%); box-shadow: 0 0 0 3px rgba(217,174,92,.18); }
  .segs i.maybe { background: transparent; border: 1.5px dashed rgba(245,238,223,.2); }
  .tprog .lab { display: flex; gap: 14px; font: 650 13px/1 var(--font-ui); color: var(--ivory-400); }
  .tprog .lab b { color: var(--ivory-200); font-weight: 700; }
  .cue { margin-left: auto; display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 18px 0 8px; border-radius: var(--r-pill);
    background: linear-gradient(180deg, rgba(217,174,92,.16), rgba(217,174,92,.06)); border: 1px solid rgba(217,174,92,.45); }
  .cue .arrow { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--gold-grad); color: var(--gold-ink); }
  .cue b { display: block; font: 800 15px/1.1 var(--font-ui); color: var(--gold-100); }
  .cue small { display: block; font: 600 12.5px/1.2 var(--font-ui); color: var(--ivory-400); margin-top: 2px; }
  .ready { position: absolute; left: 50%; top: 360px; transform: translateX(-50%); z-index: 7; width: 420px; padding: 24px 28px 26px; text-align: center;
    border-radius: var(--r-xl); background: rgba(21,17,14,.86); border: 1px solid rgba(217,174,92,.3); box-shadow: 0 30px 80px rgba(0,0,0,.6); backdrop-filter: blur(10px); }
  .ready .count { position: relative; width: 112px; height: 112px; margin: 16px auto 14px; display: grid; place-items: center; }
  .ready .count b { font: 520 72px/1 var(--font-display); color: var(--gold-200); }
  .ready .count svg { position: absolute; inset: 0; }
  .ready h3 { font: 560 26px/1.1 var(--font-display); }
  .ready .meta { display: flex; justify-content: center; gap: 8px; margin-top: 14px; }
  .ready .meta span { font: 700 13px/1 var(--font-ui); color: var(--ivory-300); padding: 8px 12px; border-radius: 99px; border: 1px solid var(--line-2); display: flex; gap: 6px; align-items: center; }
  .ready .meta .ic { color: var(--gold-300); }
  `;
  const Rr = 52, Cc = 2 * Math.PI * Rr;
  const overlay = `<div class="ready">
    <div class="eyebrow">Test 3 · starts in</div>
    <div class="count"><svg width="112" height="112"><circle cx="56" cy="56" r="${Rr}" fill="none" stroke="rgba(245,238,223,.1)" stroke-width="3"/><circle cx="56" cy="56" r="${Rr}" fill="none" stroke="#E9C77F" stroke-width="3" stroke-linecap="round" stroke-dasharray="${Cc * 0.66} ${Cc}" transform="rotate(-90 56 56)"/></svg><b>2</b></div>
    <h3>Eyes on the music</h3>
    <div class="meta"><span>${icon('hand', 16)}Both hands</span><span>${icon('metronome', 16)}♩ = 84</span><span>${icon('clock', 16)}~30 s</span></div>
  </div>`;
  const body = `<div class="screen"><div class="stage-bg"></div>
  <div class="hud">
    <button class="icon-btn" aria-label="Exit">${icon('close', 20)}</button>
    <div class="ttl"><span class="eyebrow">Placement</span><b>Test 3 of ~7</b></div>
    <div class="tprog"><div class="segs"><i class="done"></i><i class="done"></i><i class="now"></i><i></i><i></i><i></i><i class="maybe"></i></div>
      <div class="lab"><span>${icon('check', 13, 2.6)} Test 1 · Level 4</span><span>${icon('check', 13, 2.6)} Test 2 · Level 8</span><span><b>About 3 min left</b></span></div></div>
    <div class="cue"><span class="arrow">${icon('up', 20, 2.4)}</span><div><b>A little harder</b><small>You aced test 2 · now Level 12 material</small></div></div>
    <span class="stat-chip" style="height:44px"><span class="listen-dot"></span>Listening</span>
  </div>
  <div class="progress-line"><span style="width:0%"></span></div>
  <div class="layer">${playCanvas({ now: -1.2, overlay, hints: { 64: 'rh', 48: 'lh' } })}</div>
  </div>`;
  return page('Maestro · Placement: test (Concert)', css, body);
}

function placementReveal() {
  const css = PLACEMENT_CSS + `
  .spot { position: absolute; inset: 0; background:
      radial-gradient(300px 300px at 50% 44%, rgba(255,222,150,.26), rgba(255,222,150,.06) 60%, transparent 75%),
      linear-gradient(180deg, rgba(255,226,160,.13), rgba(255,226,160,0) 70%); clip-path: polygon(40% 0, 60% 0, 82% 100%, 18% 100%); }
  .floor { position: absolute; left: 50%; top: 560px; width: 560px; height: 90px; transform: translateX(-50%); border-radius: 50%; background: radial-gradient(closest-side, rgba(241,199,122,.22), transparent); }
  .medal { position: absolute; left: 50%; top: 110px; width: 390px; height: 390px; transform: translateX(-50%); }
  .medal .inner { position: absolute; inset: 58px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: radial-gradient(circle at 50% 30%, rgba(60,46,30,.9), rgba(20,16,12,.95)); border: 1px solid rgba(233,199,127,.5); box-shadow: inset 0 0 40px rgba(241,199,122,.12), 0 30px 80px rgba(0,0,0,.6); }
  .medal .inner small { font: 700 12px/1 var(--font-ui); letter-spacing: .18em; text-transform: uppercase; color: var(--ivory-400); }
  .medal .inner .lv { font: italic 400 30px/1 var(--font-display); color: var(--gold-200); margin-top: 12px; }
  .medal .inner .n { font: 560 132px/.9 var(--font-display); background: linear-gradient(180deg, #FBEFCB, #E2B868 60%, #B8893A); -webkit-background-clip: text; background-clip: text; color: transparent; margin-top: 2px; }
  .say { position: absolute; left: 0; right: 0; top: 520px; text-align: center; }
  .say h1 { font-size: 42px; }
  .say p { font: 500 18px/1.5 var(--font-ui); color: var(--ivory-300); margin-top: 10px; }
  .cta { position: absolute; left: 0; right: 0; bottom: 44px; display: flex; justify-content: center; gap: 12px; }
  .cta .btn-gold { height: 60px; padding: 0 30px; font-size: 19px; }
  .panel { position: absolute; top: 150px; width: 300px; height: 306px; padding: 20px 22px; }
  .panel h4 { font: 700 12px/1 var(--font-ui); letter-spacing: .16em; text-transform: uppercase; color: var(--ivory-400); margin-bottom: 14px; }
  .panel.l { left: 36px; } .panel.r { right: 36px; }
  .can li { list-style: none; display: flex; gap: 10px; align-items: flex-start; font: 600 15px/1.35 var(--font-ui); color: var(--ivory-200); padding: 7px 0; }
  .can li .ic { color: var(--gold-300); flex: none; margin-top: 1px; }
  .next { margin-top: 12px; padding-top: 14px; border-top: 1px solid var(--line); }
  .next small { display: block; font: 700 11px/1 var(--font-ui); letter-spacing: .16em; text-transform: uppercase; color: var(--gold-300); }
  .next b { display: block; font: 560 21px/1.2 var(--font-display); margin-top: 8px; }
  .next span { display: block; font: 550 14px/1.4 var(--font-ui); color: var(--ivory-400); margin-top: 4px; }
  `;
  // circular caption
  const ring = `<svg viewBox="0 0 390 390" width="390" height="390" style="position:absolute;inset:0">
    <defs><path id="circ" d="M195,195 m-160,0 a160,160 0 1,1 320,0 a160,160 0 1,1 -320,0"/>
    <linearGradient id="rimG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset="1" stop-color="#A87A2C"/></linearGradient></defs>
    <circle cx="195" cy="195" r="184" fill="none" stroke="rgba(233,199,127,.25)" stroke-width="1"/>
    <circle cx="195" cy="195" r="140" fill="none" stroke="rgba(233,199,127,.18)" stroke-width="1"/>
    <text font-family="Manrope" font-weight="700" font-size="13.5" fill="#E9C77F"><textPath href="#circ" startOffset="0" textLength="1000" lengthAdjust="spacing">STAGE II · ELEMENTARY · LEVEL 12 · DOTTED RHYTHMS · PLACED BY EAR · </textPath></text>
  </svg>`;
  // how-we-found-it step chart
  const tests = [[4, 1], [8, 1], [12, 1], [16, 0], [14, 0], [12, 1], [13, 0]];
  const cw = 256, ch = 128, px = (i) => 12 + i * ((cw - 24) / 6), py = (l) => ch - 10 - ((l - 2) / 16) * (ch - 26);
  const pts = tests.map(([l], i) => `${px(i)},${py(l)}`).join(' ');
  const chart = `<svg width="${cw}" height="${ch + 22}" viewBox="0 0 ${cw} ${ch + 22}">
    <rect x="0" y="${py(12) - 1}" width="${cw}" height="2" fill="rgba(233,199,127,.35)"/>
    <text x="0" y="${py(12) - 8}" font-family="Manrope" font-weight="800" font-size="11" letter-spacing="1" fill="#E9C77F">LEVEL 12</text>
    <polyline points="${pts}" fill="none" stroke="rgba(245,238,223,.45)" stroke-width="1.6" stroke-linejoin="round"/>
    ${tests.map(([l, ok], i) => ok ? `<circle cx="${px(i)}" cy="${py(l)}" r="6.5" fill="#E9C77F"/><path d="M${px(i) - 3} ${py(l)}l2 2.2 4-4.2" fill="none" stroke="#1E1606" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` : `<circle cx="${px(i)}" cy="${py(l)}" r="6" fill="#15110E" stroke="rgba(232,112,126,.9)" stroke-width="1.6"/><path d="M${px(i) - 2.4} ${py(l) - 2.4}l4.8 4.8m0-4.8l-4.8 4.8" stroke="#E8707E" stroke-width="1.5" stroke-linecap="round"/>`).join('')}
    ${tests.map(([l], i) => `<text x="${px(i)}" y="${ch + 18}" text-anchor="middle" font-family="Manrope" font-weight="700" font-size="11" fill="rgba(245,238,223,.45)">${l}</text>`).join('')}
  </svg>`;
  const body = `<div class="screen"><div class="stage-bg"></div><div class="spot"></div><div class="floor"></div>
  <div class="pbar">${WORDMARK(28)}${placementStepper(2)}</div>
  <div class="layer">
    <div class="medal">${ring}<div class="inner"><small>You’re starting at</small><span class="lv">Level</span><span class="n">12</span></div></div>
    <div class="say"><h1 class="display">You read both clefs with confidence.</h1><p>Seven short tests placed you in Elementary. Up next: the long–short lilt of dotted rhythms.</p></div>
    <div class="card panel l"><h4>How we found it</h4>${chart}<p style="font:600 13px/1.45 var(--font-ui);color:var(--ivory-400);margin-top:8px">Each pass stepped up, each stumble stepped down, until the level held.</p>
      <div style="display:flex;gap:16px;margin-top:12px;font:700 12px/1 var(--font-ui);color:var(--ivory-300)"><span style="display:flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:50%;background:#E9C77F"></i>Passed</span><span style="display:flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:50%;border:1.5px solid #E8707E"></i>Too hard, for now</span></div></div>
    <div class="card panel r"><h4>You can already</h4><ul class="can">
      <li>${icon('check', 18, 2.4)}Read treble and bass clef</li>
      <li>${icon('check', 18, 2.4)}Play hands together over long bass notes</li>
      <li>${icon('check', 18, 2.4)}Keep eighth notes steady</li></ul>
      <div class="next"><small>First lesson</small><b>Dotted rhythms</b><span>Levels 1–11 stay open if you want a refresher.</span></div></div>
    <div class="cta"><button class="btn btn-ghost" style="height:60px">Start from Level 1 instead</button><button class="btn btn-gold"><span>Begin Level 12</span>${icon('arrowR', 20, 2.2)}</button></div>
  </div></div>`;
  return page('Maestro · Placement: your level (Concert)', css, body);
}

// =============================================================================================
// c) PLAY
// =============================================================================================
function timingMeter() {
  const w = 236, lo = -200, hi = 200;
  const x = (ms) => ((ms - lo) / (hi - lo)) * w;
  const hits = [[-12, 0.35], [22, 0.45], [8, 0.55], [-40, 0.6], [31, 0.7], [70, 0.8], [15, 0.9], [-150, 0.75], [4, 1], [70, 1]];
  const tierCol = (ms) => (Math.abs(ms) <= 35 ? '#E9C77F' : Math.abs(ms) <= 80 ? '#F3DDA5' : '#F2A65A');
  return `<div class="tmeter">
    <div class="tm-lab"><span>${icon('chevL', 13, 2.6)}Early</span><b>avg +18 ms</b><span>Late${icon('chevR', 13, 2.6)}</span></div>
    <svg width="${w}" height="26" viewBox="0 0 ${w} 26">
      <rect x="0" y="10" width="${w}" height="6" rx="3" fill="rgba(245,238,223,.07)"/>
      <rect x="${x(-150)}" y="10" width="${x(150) - x(-150)}" height="6" fill="rgba(242,166,90,.22)"/>
      <rect x="${x(-80)}" y="10" width="${x(80) - x(-80)}" height="6" fill="rgba(243,221,165,.35)"/>
      <rect x="${x(-35)}" y="9" width="${x(35) - x(-35)}" height="8" rx="2" fill="#D9AE5C"/>
      <rect x="${x(0) - 0.75}" y="4" width="1.5" height="18" fill="rgba(255,248,228,.9)"/>
      ${hits.map(([ms, o]) => `<rect x="${x(ms) - 1.5}" y="6" width="3" height="14" rx="1.5" fill="${tierCol(ms)}" opacity="${o}"/>`).join('')}
      <path d="M${x(18) - 5} 0h10l-5 6z" fill="#FBF0D2"/>
    </svg>
  </div>`;
}

function playPage() {
  const css = HUD_CSS + `
  .tmeter { display: flex; flex-direction: column; gap: 5px; margin: 0 auto; padding: 0 8px; }
  .tm-lab { display: flex; justify-content: space-between; align-items: center; font: 700 11px/1 var(--font-ui); letter-spacing: .12em; text-transform: uppercase; color: var(--ivory-500); }
  .tm-lab span { display: flex; align-items: center; gap: 2px; }
  .tm-lab b { color: var(--gold-200); letter-spacing: .04em; text-transform: none; font-size: 12.5px; font-weight: 800; }
  .hud .right { display: flex; align-items: center; gap: 8px; }
  .listen-btn { height: 44px; padding: 0 16px 0 12px; border-radius: var(--r-pill); display: inline-flex; align-items: center; gap: 8px; font: 700 14px/1 var(--font-ui); color: var(--ivory-100); background: rgba(245,238,223,.05); border: 1px solid var(--line); }
  .listen-btn .ic { color: var(--gold-300); }
  .coach-toast { position: absolute; right: 24px; top: 318px; z-index: 7; display: flex; align-items: center; gap: 10px; padding: 9px 16px 9px 10px; border-radius: 99px; background: rgba(21,17,14,.82); border: 1px solid rgba(217,174,92,.28); font: 600 14px/1.2 var(--font-ui); color: var(--ivory-200); backdrop-filter: blur(8px); }
  .coach-toast .av { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #221B14; border: 1px solid rgba(217,174,92,.4); }
  .combo-pop { position: absolute; left: 958px; top: 420px; transform: translateX(-50%); z-index: 7; text-align: center; }
  .combo-pop b { display: block; font: italic 500 30px/1 var(--font-display); color: var(--gold-200); text-shadow: 0 0 24px rgba(241,199,122,.55); }
  .combo-pop small { font: 700 11px/1 var(--font-ui); letter-spacing: .2em; text-transform: uppercase; color: var(--ivory-400); }
  `;
  const hitY = 650;
  const chips = [
    { note: 'E4', kind: 'perfect', html: 'Perfect', y: hitY - 16 },
    { note: 'E3', kind: 'great', html: 'Great <b>· 70 ms late</b>', y: hitY - 16 },
    { note: 'D4', kind: 'off', html: `${icon('chevL', 14, 2.8)}Early <b>· 150 ms</b>`, y: hitY - 70, opacity: 0.8 },
  ];
  const results = { R0: 'perfect', R1_5: 'perfect', R2: 'perfect', R3: 'perfect', R4: 'perfect', 'R5.5': 'perfect', R6: 'perfect', R8: 'perfect', 'R9.5': 'off', R10: 'perfect',
    L0: 'perfect', L2: 'perfect', L4: 'perfect', L6: 'perfect', L8: 'perfect', L10: 'perfect' };
  const body = `<div class="screen"><div class="stage-bg"></div>
  <div class="hud">
    <button class="icon-btn" aria-label="Exit">${icon('close', 20)}</button>
    <div class="ttl" style="width:196px"><b>Dotted rhythms</b><small><span class="listen-dot"></span>Level 12 · Exercise 2 of 3</small></div>
    <div class="hstat" style="margin-left:6px"><small>Score</small><b>8,420</b></div>
    <div class="hstat"><small>Streak</small><b><span class="x">×</span>14</b></div>
    ${timingMeter()}
    <div class="right">
      <div class="seg"><span class="on">Tempo</span><span>Wait</span></div>
      <div class="tempo"><button aria-label="Slower">−</button><b><span class="q">♩</span>84</b><button aria-label="Faster">+</button></div>
      <button class="listen-btn">${icon('speaker', 19)}Listen</button>
      <button class="icon-btn" aria-label="Pause">${icon('pause', 18)}</button>
    </div>
  </div>
  <div class="progress-line"><span style="width:41%"></span>${[1, 2, 3, 4, 5].map((i) => `<i style="left:${(i / 6) * 100}%"></i>`).join('')}</div>
  <div class="layer">${playCanvas({ now: 10, results, chips, hit: [64, 52], hints: { 67: 'rh', 55: 'lh' } })}
    <div class="combo-pop"><b>14 in a row</b><small>Keep that pulse</small></div>
  </div>
  </div>`;
  return page('Maestro · Play (Concert)', css, body);
}

// =============================================================================================
// d) RESULTS
// =============================================================================================
function starSVG(size, fill, glow) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" ${glow ? 'style="filter:drop-shadow(0 0 14px rgba(241,199,122,.7))"' : ''}><path d="M24 4.5l5.6 11.6 12.7 1.7-9.3 8.9 2.3 12.6L24 33.2l-11.3 6.1L15 26.7l-9.3-8.9 12.7-1.7z" fill="${fill}" stroke="rgba(255,244,214,.35)" stroke-width="1"/></svg>`;
}
function resultsPage() {
  const css = `
  .spot { position: absolute; left: 60px; top: -40px; width: 460px; height: 720px; background: linear-gradient(180deg, rgba(255,226,160,.16), rgba(255,226,160,0) 75%); clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%); }
  .rbar { position: absolute; left: 0; right: 0; top: 0; height: 76px; padding: 0 28px; display: flex; align-items: center; gap: 16px; z-index: 5; }
  .rbar .crumb { font: 650 14px/1 var(--font-ui); color: var(--ivory-400); }
  .rbar .crumb b { color: var(--ivory-200); font-weight: 700; }
  .left { position: absolute; left: 40px; top: 96px; width: 500px; display: flex; flex-direction: column; align-items: center; }
  .stars { display: flex; gap: 10px; align-items: flex-end; }
  .stars .mid { transform: translateY(-10px); }
  .acc { position: relative; width: 250px; height: 250px; margin-top: 10px; }
  .acc .c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .acc .c b { font: 560 88px/.9 var(--font-display); color: var(--ivory-50); }
  .acc .c b sup { font-size: 38px; vertical-align: 32px; margin-left: 2px; color: var(--gold-200); }
  .acc .c small { font: 700 12px/1 var(--font-ui); letter-spacing: .18em; text-transform: uppercase; color: var(--ivory-400); margin-top: 10px; }
  .bravo { font: italic 460 50px/1 var(--font-display); color: var(--gold-200); margin-top: 8px; }
  .left .sub { font: 550 16px/1.4 var(--font-ui); color: var(--ivory-400); margin-top: 8px; }
  .coach { margin-top: 22px; width: 100%; display: flex; gap: 14px; padding: 18px 20px; align-items: flex-start; }
  .coach .av { flex: none; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 50% 35%, #33291d, #17130f); border: 1px solid rgba(217,174,92,.45); box-shadow: 0 0 0 5px rgba(217,174,92,.08); }
  .coach q { quotes: none; font: 500 17.5px/1.5 var(--font-ui); color: var(--ivory-100); }
  .coach .who { display: flex; align-items: center; gap: 8px; font: 700 12px/1 var(--font-ui); letter-spacing: .14em; text-transform: uppercase; color: var(--gold-300); margin-bottom: 8px; }
  .coach .who .ic { color: var(--ivory-400); }
  .right { position: absolute; left: 576px; right: 40px; top: 84px; bottom: 36px; display: flex; flex-direction: column; gap: 14px; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .tile { padding: 16px 18px; display: grid; grid-template-columns: 40px 1fr; column-gap: 14px; align-items: center; }
  .tile .ti { grid-row: span 2; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: rgba(217,174,92,.1); border: 1px solid rgba(217,174,92,.22); color: var(--gold-200); }
  .tile b { font: 800 26px/1 var(--font-ui); font-variant-numeric: tabular-nums; }
  .tile b small { font-size: 16px; color: var(--ivory-400); font-weight: 700; }
  .tile span { font: 600 13px/1.3 var(--font-ui); color: var(--ivory-400); margin-top: 4px; }
  .tile span em { font-style: normal; color: var(--offbeat); font-weight: 700; }
  .hist { padding: 18px 20px 14px; }
  .hist header { display: flex; align-items: baseline; justify-content: space-between; }
  .hist h3 { font: 560 20px/1 var(--font-display); }
  .hist header span { font: 650 13px/1 var(--font-ui); color: var(--ivory-400); }
  .hist .tip { font: 600 13.5px/1.4 var(--font-ui); color: var(--ivory-300); margin-top: 6px; display: flex; gap: 8px; align-items: center; }
  .hist .tip .ic { color: var(--gold-300); }
  .mast { padding: 16px 20px; display: grid; grid-template-columns: 1fr auto; gap: 8px 20px; align-items: center; }
  .mast .lab { display: flex; justify-content: space-between; font: 650 13px/1 var(--font-ui); color: var(--ivory-400); }
  .mast .lab b { color: var(--gold-200); font-weight: 800; }
  .mbar { position: relative; height: 10px; border-radius: 5px; background: rgba(245,238,223,.08); overflow: hidden; }
  .mbar .old { position: absolute; left: 0; top: 0; bottom: 0; width: 62%; background: rgba(217,174,92,.55); }
  .mbar .new { position: absolute; left: 62%; top: 0; bottom: 0; width: 12%; background: var(--gold-grad); box-shadow: 0 0 14px rgba(241,199,122,.8); }
  .xp { grid-row: span 2; display: flex; gap: 10px; }
  .xp span { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 14px; border-radius: 14px; border: 1px solid var(--line-2); font: 800 18px/1 var(--font-ui); color: var(--gold-200); }
  .xp span small { font: 700 10.5px/1 var(--font-ui); letter-spacing: .12em; text-transform: uppercase; color: var(--ivory-500); margin-top: 6px; }
  .actions { margin-top: auto; display: flex; justify-content: flex-end; gap: 12px; }
  .actions .btn { height: 60px; font-size: 18px; }
  .actions .btn-gold { padding: 0 30px; }
  .dust { position: absolute; inset: 0; pointer-events: none; }
  `;
  // circular accuracy ring
  const R = 112, C = 2 * Math.PI * R;
  const acc = `<svg width="250" height="250" viewBox="0 0 250 250"><defs>
    <linearGradient id="ag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset="1" stop-color="#B8893A"/></linearGradient>
    <path id="rtext" d="M125,125 m-98,0 a98,98 0 1,1 196,0 a98,98 0 1,1 -196,0"/></defs>
    <circle cx="125" cy="125" r="${R}" fill="rgba(20,16,12,.6)" stroke="rgba(245,238,223,.08)" stroke-width="6"/>
    <circle cx="125" cy="125" r="${R}" fill="none" stroke="url(#ag)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C * 0.94} ${C}" transform="rotate(-90 125 125)" style="filter:drop-shadow(0 0 8px rgba(241,199,122,.55))"/>
    <text font-family="Manrope" font-weight="700" font-size="10.5" fill="rgba(233,199,127,.72)"><textPath href="#rtext" startOffset="0" textLength="612" lengthAdjust="spacing">LEVEL 12 · DOTTED RHYTHMS · SIGHT-READING 2 OF 3 · BEST TAKE · </textPath></text>
  </svg>`;
  // histogram
  const bins = [0, 1, 1, 3, 5, 9, 12, 8, 5, 2, 1, 0];
  const hw = 504, hh = 178, bw = hw / bins.length;
  const maxB = 12;
  const centers = bins.map((_, i) => -137.5 + i * 25);
  const col = (c) => (Math.abs(c) <= 35 ? 'url(#hg)' : Math.abs(c) <= 80 ? 'rgba(243,221,165,.55)' : 'rgba(242,166,90,.75)');
  const xms = (ms) => ((ms + 150) / 300) * hw;
  const hist = `<svg width="${hw}" height="${hh + 34}" viewBox="0 0 ${hw} ${hh + 34}"><defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset="1" stop-color="#C4953E"/></linearGradient></defs>
    <rect x="${xms(-35)}" y="0" width="${xms(35) - xms(-35)}" height="${hh}" fill="rgba(217,174,92,.07)"/>
    ${[0.25, 0.5, 0.75, 1].map((f) => `<rect x="0" y="${hh - f * (hh - 16)}" width="${hw}" height="1" fill="rgba(245,238,223,.05)"/>`).join('')}
    ${bins.map((b, i) => (b ? `<rect x="${i * bw + 4}" y="${hh - (b / maxB) * (hh - 16)}" width="${bw - 8}" height="${(b / maxB) * (hh - 16)}" rx="5" fill="${col(centers[i])}"/><text x="${i * bw + bw / 2}" y="${hh - (b / maxB) * (hh - 16) - 6}" text-anchor="middle" font-family="Manrope" font-weight="700" font-size="11" fill="rgba(245,238,223,.5)">${b}</text>` : '')).join('')}
    <rect x="0" y="${hh}" width="${hw}" height="1.5" fill="rgba(245,238,223,.2)"/>
    <rect x="${xms(0) - 0.75}" y="6" width="1.5" height="${hh - 6}" fill="rgba(245,238,223,.35)"/>
    <rect x="${xms(18) - 1}" y="0" width="2" height="${hh}" fill="#FBF0D2"/>
    <rect x="${xms(18) - 34}" y="-2" width="68" height="20" rx="10" fill="#FBF0D2"/><text x="${xms(18)}" y="12" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="11.5" fill="#1E1606">avg +18</text>
    <text x="0" y="${hh + 20}" font-family="Manrope" font-weight="700" font-size="12" fill="rgba(245,238,223,.55)">◂ Early  −150 ms</text>
    <text x="${xms(0)}" y="${hh + 20}" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="12" fill="#E9C77F">On the beat</text>
    <text x="${hw}" y="${hh + 20}" text-anchor="end" font-family="Manrope" font-weight="700" font-size="12" fill="rgba(245,238,223,.55)">+150 ms  Late ▸</text>
  </svg>`;
  // gold dust
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dust = Array.from({ length: 46 }, () => {
    const x = 40 + rnd() * 500, y = 60 + rnd() * 560, s = 2 + rnd() * 5, r = rnd() * 180;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${s.toFixed(1)}" height="${(s * 0.55).toFixed(1)}" rx="1" transform="rotate(${r.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${rnd() > 0.5 ? '#F3DDA5' : '#D9AE5C'}" opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`;
  }).join('');
  const body = `<div class="screen"><div class="stage-bg"></div><div class="spot"></div>
  <svg class="dust" width="${W}" height="${H}">${dust}</svg>
  <div class="rbar"><button class="icon-btn" aria-label="Home">${icon('close', 20)}</button><span class="crumb"><b>Level 12 · Dotted rhythms</b> · Sight-reading 2 of 3</span></div>
  <div class="layer">
    <div class="left">
      <div class="stars">${starSVG(58, 'url(#sg)', false).replace('<svg', '<svg')}<span class="mid">${starSVG(74, 'url(#sg)', true)}</span>${starSVG(58, 'url(#sg)', true)}</div>
      <svg width="0" height="0" style="position:absolute"><defs><linearGradient id="sg" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="#FBEFCB"/><stop offset=".55" stop-color="#E2B868"/><stop offset="1" stop-color="#B8893A"/></linearGradient></defs></svg>
      <div class="acc">${acc}<div class="c"><b class="num">94<sup>%</sup></b><small>Accuracy</small></div></div>
      <div class="bravo">Bravo!</div>
      <div class="sub">Your best take of this exercise so far.</div>
      <div class="card coach"><span class="av">${MARK(30)}</span><div><div class="who">Maestro ${icon('speaker', 15)}</div><q>Lovely control of the dotted notes. You rushed the eighths a touch — let them breathe, and the lilt will follow.</q></div></div>
    </div>
    <div class="right">
      <div class="tiles">
        <div class="card tile"><span class="ti">${icon('target', 21)}</span><b>47<small>/50</small></b><span>Notes hit · most missed D4</span></div>
        <div class="card tile"><span class="ti">${icon('metronome', 21)}</span><b>88<small>%</small></b><span>On time (within ±80 ms)</span></div>
        <div class="card tile"><span class="ti">${icon('clock', 21)}</span><b>+18<small> ms</small></b><span>Average offset · <em>slightly late</em></span></div>
        <div class="card tile"><span class="ti">${icon('flame', 21)}</span><b>21</b><span>Best streak · notes in a row</span></div>
      </div>
      <div class="card hist"><header><h3>Your timing</h3><span>47 notes</span></header>${hist}
        <div class="tip">${icon('eye', 17)}Most notes landed on the beat. The late ones were eighths after a dot.</div></div>
      <div class="card mast"><div class="lab"><span>Level 12 mastery</span><b class="num">62% → 74%</b></div>
        <div class="xp"><span>+35<small>XP</small></span><span>${icon('check', 18, 2.6)}<small>Goal met</small></span></div>
        <div class="mbar"><span class="old"></span><span class="new"></span></div></div>
      <div class="actions"><button class="btn btn-ghost">${icon('retry', 20)}Retry</button><button class="btn btn-gold">Next exercise ${icon('arrowR', 20, 2.2)}</button></div>
    </div>
  </div></div>`;
  return page('Maestro · Results (Concert)', css, body);
}

// =============================================================================================
// e) SONGS
// =============================================================================================
const CAT_STYLE = {
  'Kids & folk': { bg: ['#2F3B2A', '#161C14'], ink: '#CFE3BF', accent: '#9FC48A' },
  Holiday: { bg: ['#40171D', '#1A0A0D'], ink: '#F4C9BE', accent: '#E48C7E' },
  'Hymns & ballads': { bg: ['#23284A', '#10122A'], ink: '#D2D1F4', accent: '#A7A4E6' },
  Classical: { bg: ['#3A2A17', '#170F08'], ink: '#F1D7A0', accent: '#D9AE5C' },
  'Ragtime & blues': { bg: ['#13383B', '#081A1C'], ink: '#B9E6DE', accent: '#7CC8BB' },
};
const STAGES = [[1, 8, 'I'], [9, 16, 'II'], [17, 26, 'III'], [27, 34, 'IV'], [35, 40, 'V']];
const stageOf = (lv) => STAGES.findIndex(([a, b]) => lv >= a && lv <= b);

function coverSVG(song, arrId, w, h, big = false) {
  const st = CAT_STYLE[song.category];
  const piece = songPiece(song.id, arrId);
  const notes = piece.notes.filter((n) => n.hand === 'R' || n.staff === 'treble').slice(0, big ? 40 : 26);
  const lh = piece.notes.filter((n) => n.hand === 'L').slice(0, big ? 26 : 16);
  const all = [...notes, ...lh];
  const b0 = Math.min(...all.map((n) => n.beat));
  const b1 = Math.max(...notes.map((n) => n.beat + n.dur));
  const mids = notes.map((n) => n.midi);
  const lo = Math.min(...mids) - 2, hi = Math.max(...mids) + 2;
  const padX = 18, top = big ? 30 : 22, bot = h - (big ? 34 : 26);
  const X = (b) => padX + ((b - b0) / (b1 - b0)) * (w - padX * 2);
  const Y = (m) => bot - ((m - lo) / Math.max(10, hi - lo)) * (bot - top) - 6;
  const id = `cv${uid++}`;
  const rows = notes.map((n) => `<rect x="${X(n.beat).toFixed(1)}" y="${Y(n.midi).toFixed(1)}" width="${Math.max(4, X(n.beat + n.dur) - X(n.beat) - 3).toFixed(1)}" height="${big ? 7 : 5.5}" rx="${big ? 3.5 : 2.75}" fill="${st.ink}" opacity=".92"/>`).join('');
  const lhRows = lh.filter((n) => n.beat <= b1).map((n) => `<rect x="${X(n.beat).toFixed(1)}" y="${(bot + (big ? 10 : 8)).toFixed(1)}" width="${Math.max(4, X(Math.min(b1, n.beat + n.dur)) - X(n.beat) - 3).toFixed(1)}" height="${big ? 4 : 3}" rx="1.5" fill="${st.accent}" opacity=".6"/>`).join('');
  const lines = [0, 1, 2, 3, 4].map((i) => `<rect x="0" y="${(top + ((bot - top) * i) / 4).toFixed(1)}" width="${w}" height=".8" fill="${st.ink}" opacity=".08"/>`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${st.bg[0]}"/><stop offset="1" stop-color="${st.bg[1]}"/></linearGradient>
    <radialGradient id="${id}s" cx=".75" cy="0" r=".9"><stop offset="0" stop-color="#FFE3A8" stop-opacity=".16"/><stop offset="1" stop-color="#FFE3A8" stop-opacity="0"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#${id})"/><rect width="${w}" height="${h}" fill="url(#${id}s)"/>
    ${lines}${rows}${lhRows}
  </svg>`;
}

function songCard(song, arrId, opts = {}) {
  const arr = song.arrangements.find((a) => a.id === arrId);
  const lv = arr.level;
  const si = stageOf(lv);
  const st = CAT_STYLE[song.category];
  const composer = song.composer.replace(/\s*\(.*\)$/, '');
  const pips = [0, 1, 2, 3, 4].map((i) => `<i class="${i <= si ? 'on' : ''}"></i>`).join('');
  return `<article class="song card">
    <div class="cover">${coverSVG(song, arrId, 258, 124)}<span class="cat" style="color:${st.ink}">${song.category}</span>${opts.tag ? `<span class="ftag ${opts.tagKind || ''}">${opts.tag}</span>` : ''}</div>
    <div class="info">
      <h3>${song.title}</h3>
      <p>${composer}</p>
      <div class="meta"><span class="lvl"><b>Lv ${lv}</b><span class="pips">${pips}</span></span><span class="arr">${arr.name}</span></div>
      <div class="foot">${opts.stars != null ? `<span class="st">${[0, 1, 2].map((i) => `<svg width="15" height="15" viewBox="0 0 48 48"><path d="M24 4.5l5.6 11.6 12.7 1.7-9.3 8.9 2.3 12.6L24 33.2l-11.3 6.1L15 26.7l-9.3-8.9 12.7-1.7z" fill="${i < opts.stars ? '#E2B868' : 'rgba(245,238,223,.14)'}"/></svg>`).join('')}</span>` : `<span class="new">Not played yet</span>`}<span class="vers">${song.arrangements.length} version${song.arrangements.length > 1 ? 's' : ''}</span></div>
    </div>
  </article>`;
}

function songsPage() {
  const S = (id) => SONGS.find((s) => s.id === id);
  const css = `
  .wrap { position: absolute; left: 28px; right: 28px; top: 92px; bottom: 0; }
  .head { display: flex; align-items: flex-end; gap: 16px; }
  .head h1 { font-size: 46px; }
  .head p { font: 550 16px/1.4 var(--font-ui); color: var(--ivory-400); margin-top: 8px; }
  .head .tools { margin-left: auto; display: flex; gap: 10px; align-items: center; padding-bottom: 4px; }
  .search { width: 250px; height: 46px; border-radius: 99px; border: 1px solid var(--line-2); background: rgba(245,238,223,.04); display: flex; align-items: center; gap: 10px; padding: 0 16px; color: var(--ivory-500); font: 600 15px/1 var(--font-ui); }
  .head .btn { height: 46px; }
  .filters { display: flex; gap: 8px; margin-top: 20px; align-items: center; }
  .filters .right { margin-left: auto; display: flex; gap: 8px; }
  .toggle { display: inline-flex; align-items: center; gap: 10px; font: 650 14px/1 var(--font-ui); color: var(--ivory-200); height: 38px; padding: 0 6px 0 14px; border-radius: 99px; border: 1px solid rgba(217,174,92,.4); background: rgba(217,174,92,.07); }
  .toggle i { width: 38px; height: 24px; border-radius: 12px; background: var(--gold-grad); position: relative; }
  .toggle i::after { content: ''; position: absolute; right: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--gold-ink); }
  .sect { display: flex; align-items: baseline; gap: 12px; margin: 24px 0 12px; }
  .sect h2 { font: 560 23px/1 var(--font-display); }
  .sect span { font: 600 14px/1 var(--font-ui); color: var(--ivory-400); }
  .sect .more { margin-left: auto; color: var(--gold-200); font: 700 14px/1 var(--font-ui); display: flex; align-items: center; gap: 4px; }
  .row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .song { overflow: hidden; padding: 0; border-radius: 20px; }
  .song .cover { position: relative; height: 124px; overflow: hidden; border-bottom: 1px solid rgba(0,0,0,.4); }
  .song .cat { position: absolute; left: 14px; top: 12px; font: 750 10.5px/1 var(--font-ui); letter-spacing: .16em; text-transform: uppercase; opacity: .85; }
  .song .ftag { position: absolute; right: 10px; top: 9px; font: 800 11px/1 var(--font-ui); letter-spacing: .06em; padding: 6px 9px; border-radius: 99px; background: var(--gold-grad); color: var(--gold-ink); }
  .song .ftag.stretch { background: rgba(21,17,14,.75); color: var(--gold-200); border: 1px solid rgba(217,174,92,.5); }
  .song .info { padding: 13px 16px 14px; }
  .song h3 { font: 560 20px/1.15 var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .song p { font: 600 13.5px/1.3 var(--font-ui); color: var(--ivory-400); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .song .meta { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
  .lvl { display: inline-flex; align-items: center; gap: 8px; padding: 5px 9px 5px 10px; border-radius: 99px; background: rgba(217,174,92,.1); border: 1px solid rgba(217,174,92,.28); }
  .lvl b { font: 800 12.5px/1 var(--font-ui); color: var(--gold-200); }
  .pips { display: inline-flex; gap: 2.5px; }
  .pips i { width: 4px; height: 10px; border-radius: 2px; background: rgba(245,238,223,.16); }
  .pips i.on { background: var(--gold-300); }
  .arr { font: 650 12.5px/1 var(--font-ui); color: var(--ivory-300); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .song .foot { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding-top: 11px; border-top: 1px solid var(--line); font: 650 12.5px/1 var(--font-ui); color: var(--ivory-500); }
  .song .st { display: inline-flex; gap: 2px; }
  .song .new { color: var(--ivory-500); }
  .fade { position: absolute; left: 0; right: 0; bottom: 0; height: 90px; background: linear-gradient(180deg, transparent, #0C0A08 85%); z-index: 3; pointer-events: none; }
  `;
  const cats = [['All', 41], ['Kids & folk', 10], ['Holiday', 9], ['Hymns & ballads', 3], ['Classical', 16], ['Ragtime & blues', 3]];
  const body = `<div class="screen"><div class="stage-bg"></div>
  ${topbar('Songs')}
  <div class="wrap layer">
    <div class="head"><div><h1 class="display">Songs</h1><p>41 public-domain pieces, from first five-note tunes to Joplin rags.</p></div>
      <div class="tools"><div class="search">${icon('search', 19)}Title or composer</div><button class="btn btn-outline-gold">${icon('upload', 19)}Import MIDI</button></div></div>
    <div class="filters">${cats.map(([c, n], i) => `<span class="chip ${i === 0 ? 'on' : ''}">${c}<span class="count">${n}</span></span>`).join('')}
      <div class="right"><span class="toggle">Fits Level 12<i></i></span></div></div>
    <div class="sect"><h2>Right at your level</h2><span>Levels 10–14 · learn these next</span><span class="more">See all 14 ${icon('chevR', 16, 2.2)}</span></div>
    <div class="row">
      ${songCard(S('ode-to-joy'), 'both', { tag: 'Level 12', stars: 2 })}
      ${songCard(S('amazing-grace'), 'both', { stars: 0 })}
      ${songCard(S('frere-jacques'), 'rh', { stars: 3 })}
      ${songCard(S('jingle-bells'), 'both')}
    </div>
    <div class="sect"><h2>Stretch goals</h2><span>A few levels ahead · worth the climb</span><span class="more">See all ${icon('chevR', 16, 2.2)}</span></div>
    <div class="row">
      ${songCard(S('fur-elise'), 'easy', { tag: 'Stretch', tagKind: 'stretch' })}
      ${songCard(S('the-entertainer'), 'theme', { tag: 'Stretch', tagKind: 'stretch' })}
      ${songCard(S('prelude-in-c'), 'both', { tag: 'Stretch', tagKind: 'stretch' })}
      ${songCard(S('silent-night'), 'both', { tag: 'Stretch', tagKind: 'stretch' })}
    </div>
  </div><div class="fade"></div></div>`;
  return page('Maestro · Songs (Concert)', css, body);
}

// =============================================================================================
// Brand sheet (extra): mark, wordmark, icon, palette, type, components
// =============================================================================================
function brandPage() {
  const HB = 1640;
  const sw = (name, hex, fg = '#1E1606') => `<div class="sw"><i style="background:${hex}"></i><b>${name}</b><span>${hex}</span></div>`;
  const noteCols = [['C', '#EE7C7C'], ['D', '#F2A65A'], ['E', '#E9CF6A'], ['F', '#93D29F'], ['G', '#5CC6BE'], ['A', '#7DAEF5'], ['B', '#B596F0']];
  const css = `
  html, body { height: ${HB}px; }
  .screen { height: ${HB}px; }
  .sheet { position: absolute; inset: 0; padding: 48px 56px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-content: start; }
  .blk { padding: 28px; }
  .blk h4 { font: 700 12px/1 var(--font-ui); letter-spacing: .18em; text-transform: uppercase; color: var(--gold-300); margin-bottom: 18px; }
  .hero { grid-column: 1 / 3; display: flex; align-items: center; gap: 48px; padding: 40px 44px; border-radius: var(--r-xl);
    background: radial-gradient(500px 300px at 20% 0%, rgba(241,199,122,.18), transparent 70%), linear-gradient(180deg, #211A14, #15110D); border: 1px solid rgba(217,174,92,.2); }
  .hero .lock { display: flex; align-items: center; gap: 20px; }
  .hero .tag { font: italic 400 22px/1.3 var(--font-display); color: var(--ivory-300); max-width: 300px; }
  .hero .icons { margin-left: auto; display: flex; gap: 18px; align-items: flex-end; }
  .sws { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .sw i { display: block; height: 56px; border-radius: 12px; border: 1px solid var(--line); }
  .sw b { display: block; font: 700 13px/1.2 var(--font-ui); margin-top: 8px; }
  .sw span { font: 600 12px/1 var(--font-ui); color: var(--ivory-500); font-variant-numeric: tabular-nums; }
  .type .d1 { font: 560 64px/1 var(--font-display); }
  .type .d2 { font: italic 420 34px/1.1 var(--font-display); color: var(--gold-200); margin-top: 10px; }
  .type .d3 { font: 560 24px/1.2 var(--font-display); margin-top: 14px; }
  .type .b1 { font: 500 19px/1.5 var(--font-ui); color: var(--ivory-300); margin-top: 14px; }
  .type .b2 { font: 800 26px/1 var(--font-ui); margin-top: 14px; font-variant-numeric: tabular-nums; }
  .type .meta { font: 600 12.5px/1.5 var(--font-ui); color: var(--ivory-500); margin-top: 16px; }
  .comp { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .scale { margin-top: 22px; border-top: 1px solid var(--line); }
  .scale div { display: grid; grid-template-columns: 44px 1fr auto; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .scale span { font: 700 12px/1 var(--font-ui); color: var(--ivory-500); font-variant-numeric: tabular-nums; }
  .scale em { font: 600 12px/1 var(--font-ui); font-style: normal; color: var(--ivory-500); }
  .tchip { position: relative; transform: none; }
  .tchip::after { display: none; }
  .cue { display: inline-flex; align-items: center; gap: 9px; height: 40px; padding: 0 16px 0 6px; border-radius: 99px; font: 800 14px/1 var(--font-ui); }
  .cue i { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; }
  .cue.up { color: var(--gold-100); background: rgba(217,174,92,.12); border: 1px solid rgba(217,174,92,.45); } .cue.up i { background: var(--gold-grad); color: var(--gold-ink); }
  .cue.same { color: var(--ivory-200); background: rgba(245,238,223,.05); border: 1px solid var(--line-2); } .cue.same i { background: rgba(245,238,223,.12); color: var(--ivory-100); }
  .cue.down { color: #CFE6D6; background: rgba(143,209,166,.08); border: 1px solid rgba(143,209,166,.4); } .cue.down i { background: #8FD1A6; color: #0F2417; }
  .notes { display: flex; gap: 10px; }
  .notes div { flex: 1; text-align: center; }
  .notes i { display: block; height: 70px; border-radius: 10px; }
  .notes b { display: block; font: 800 14px/1 var(--font-ui); margin-top: 8px; }
  .mono { display: grid; grid-template-columns: repeat(3, 1fr) 150px; gap: 16px; align-items: stretch; }
  .mono > div { height: 104px; border-radius: 16px; display: flex; align-items: center; justify-content: center; }
  .markbox { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-right: 18px; }
  .markbox small { font: 700 11px/1 var(--font-ui); letter-spacing: .16em; text-transform: uppercase; color: var(--ivory-500); }
  `;
  const body = `<div class="screen"><div class="stage-bg"></div><div class="sheet layer">
    <section class="hero"><div><div class="lock">${WORDMARK(84)}</div><p class="tag" style="margin-top:20px">The fermata: an arch of light held over a single note. The hall holds its breath.</p></div>
      <div class="icons"><div class="markbox">${MARK(96)}<small>Mark</small></div>${APP_ICON(150)}${APP_ICON(76)}${APP_ICON(40)}</div></section>
    <section class="card blk"><h4>Stage &amp; ivory</h4><div class="sws">
      ${sw('Stage 900', '#0F0C0A')}${sw('Stage 800', '#1B1612')}${sw('Stage 700', '#2C251E')}${sw('Stage 600', '#3A3128')}
      ${sw('Ivory 100', '#F5EEDF')}${sw('Ivory 300', '#D4C9B4')}${sw('Ivory 500', '#8F8574')}${sw('Paper', '#FBF6EA')}</div></section>
    <section class="card blk"><h4>Gold, velvet &amp; hands</h4><div class="sws">
      ${sw('Gold 200', '#F3DDA5')}${sw('Gold 300', '#E9C77F')}${sw('Gold 400', '#D9AE5C')}${sw('Gold 600', '#A07629')}
      ${sw('Velvet 500', '#8E2A3B')}${sw('Right hand', '#7DB0FF')}${sw('Left hand', '#F6A07A')}${sw('Listening', '#8FD1A6')}</div></section>
    <section class="card blk type"><h4>Type · Fraunces + Manrope</h4>
      <div class="d1">Dotted rhythms</div><div class="d2">Bravo! Level 13 unlocked.</div><div class="d3">Your programme · I. Beginner</div>
      <div class="b1">A dot adds half again to a note. Feel the long–short lilt, then play it in time.</div>
      <div class="b2">8,420 · ♩ 84 · +18 ms</div>
      <div class="meta">Fraunces (OFL) 560 roman / 420 italic, optical size auto · Manrope (OFL) 500–800, tabular figures for live numbers. Self-host via @fontsource-variable/fraunces and @fontsource-variable/manrope.</div>
      <div class="scale">
        <div><span>132</span><b style="font:560 44px/1 var(--font-display)">12</b><em>Numeral XL · reveal</em></div>
        <div><span>50</span><b style="font:560 30px/1 var(--font-display)">Have you played?</b><em>Display L</em></div>
        <div><span>26</span><b style="font:560 22px/1 var(--font-display)">Your programme</b><em>Heading</em></div>
        <div><span>18</span><b style="font:500 17px/1 var(--font-ui)">A dot adds half again</b><em>Body L</em></div>
        <div><span>16</span><b style="font:800 16px/1 var(--font-ui)">Great · 70 ms late</b><em>Chip</em></div>
        <div><span>12</span><b style="font:700 12px/1 var(--font-ui);letter-spacing:.16em;color:var(--gold-300)">EYEBROW LABEL</b><em>Label</em></div>
      </div></section>
    <section class="card blk"><h4>Components</h4>
      <div class="comp"><button class="btn btn-gold xl"><span class="play-dot">${icon('play', 20)}</span>Continue</button><button class="btn btn-ghost">${icon('retry', 19)}Retry</button><button class="btn btn-outline-gold">${icon('upload', 19)}Import MIDI</button></div>
      <div class="comp" style="margin-top:18px"><span class="chip on">All<span class="count">41</span></span><span class="chip">Classical<span class="count">16</span></span><span class="stat-chip">${icon('flame', 19)}12 <small>days</small></span></div>
      <h4 style="margin-top:26px">Timing chips (tier colours)</h4>
      <div class="comp"><span class="tchip perfect">Perfect</span><span class="tchip great">Great <b>· 70 ms late</b></span><span class="tchip off">${icon('chevL', 14, 2.8)}Early <b>· 150 ms</b></span><span class="tchip off">Late <b>· 120 ms</b>${icon('chevR', 14, 2.8)}</span><span class="tchip miss">Missed</span></div>
      <h4 style="margin-top:26px">Placement cues</h4>
      <div class="comp"><span class="cue up"><i>${icon('up', 16, 2.6)}</i>A little harder</span><span class="cue same"><i>${icon('check', 16, 2.6)}</i>Same level again</span><span class="cue down"><i>${icon('down', 16, 2.6)}</i>A little easier</span></div>
      <h4 style="margin-top:26px">Beginner note colours (optional)</h4>
      <div class="notes">${noteCols.map(([n, c]) => `<div><i style="background:linear-gradient(180deg, ${c}, ${c}cc)"></i><b style="color:${c}">${n}</b></div>`).join('')}</div>
    </section>
    <section class="card blk" style="grid-column:1 / 3"><h4>Lockups &amp; single colour</h4><div class="mono">
      <div style="background:#FBF6EA">${WORDMARK(44, { ivory: '#1D1A16', gold: '#A07629' })}</div>
      <div style="background:#0F0C0A;border:1px solid var(--line)">${WORDMARK(44, { ivory: '#F5EEDF', gold: '#F5EEDF' })}</div>
      <div style="background:linear-gradient(180deg,#F4DC9F,#C4953E)">${WORDMARK(44, { ivory: '#1E1606', gold: '#1E1606' })}</div>
      <div style="background:radial-gradient(circle at 50% 30%, #6A1E2C, #2A0B12)">${MARK(62)}</div>
    </div></section>
  </div></div>`;
  return page('Maestro · Brand sheet (Concert)', css, body, { height: HB });
}

// =============================================================================================
// Main
// =============================================================================================
const PAGES = [
  ['home', homePage],
  ['placement-1-experience', placementExperience],
  ['placement-2-test', placementTest],
  ['placement-3-reveal', placementReveal],
  ['play', playPage],
  ['results', resultsPage],
  ['songs', songsPage],
  ['brand', brandPage, 1640],
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
fs.writeFileSync(path.join(OUT, 'tokens.css'), `/* Maestro · Concert direction · design tokens */\n${TOKENS_CSS}`);
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets', 'maestro-mark.svg'), MARK(256).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
fs.writeFileSync(path.join(OUT, 'assets', 'maestro-wordmark.svg'), WORDMARK(128).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
fs.writeFileSync(path.join(OUT, 'assets', 'maestro-app-icon.svg'), APP_ICON(1024).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
const lock = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="140" viewBox="0 0 440 140"><rect width="440" height="140" rx="20" fill="#0F0C0A"/><g transform="translate(${(440 - (WM.advance + 20) * (72 / 1430)) / 2} 34)">${WORDMARK(72)}</g></svg>`;
fs.writeFileSync(path.join(OUT, 'assets', 'maestro-lockup-dark.svg'), lock);

for (const [name, fn] of PAGES) {
  if (only.length && !only.includes(name)) continue;
  fs.writeFileSync(path.join(OUT, `${name}.html`), fn());
}
if (!process.argv.includes('--html')) {
  const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  for (const [name, , hh] of PAGES) {
    if (only.length && !only.includes(name)) continue;
    const page = await browser.newPage({ viewport: { width: W, height: hh || H }, deviceScaleFactor: 1 });
    // Fetch fonts through Playwright's network stack (it trusts the environment's CA bundle).
    await page.route(/^https:\/\//, async (route) => {
      try { await route.fulfill({ response: await route.fetch() }); } catch { await route.abort(); }
    });
    await page.goto('file://' + path.join(OUT, `${name}.html`), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await page.close();
    console.log('rendered', name);
  }
  await browser.close();
}
