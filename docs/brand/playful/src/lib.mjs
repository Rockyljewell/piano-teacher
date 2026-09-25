// Helpers shared by the mockup pages: page wrapper, wordmark, piano keyboard, falling notes,
// sheet music, confetti. Everything returns plain HTML/SVG strings so each page is self-contained.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
export { pip, pipFace } from './mascot.mjs';
export { icon, bars } from './icons.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = readFileSync(join(here, '..', 'tokens.css'), 'utf8');
const SHARED = readFileSync(join(here, 'shared.css'), 'utf8');

export const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Fredoka:wght@400..700&family=Nunito:wght@500..900&family=Noto+Music&display=block';

export function page({ title, css = '', body, tall = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1180, initial-scale=1">
<title>${title}</title>
<!-- Mockup only. Fonts are OFL-1.1 and published as @fontsource-variable/fredoka, @fontsource-variable/nunito, @fontsource/noto-music for self-hosting. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}">
<style>
${TOKENS}
${SHARED}
${css}
</style>
</head>
<body class="${tall ? 'tall' : ''}">
${body}
</body>
</html>
`;
}

/* ---------------------------------------------------------------- wordmark */
// "maestro" in Fredoka Bold (700, -0.02em). The stem of the t grows up into the stem and flag of an
// eighth note: the same flag Pip wears as a tuft. Geometry is in 1/100 em, measured from Fredoka's t
// (advance 43, stem x 10..27, top 67 above the baseline, x-height 52).
export function wordmark(size = 40, color = 'var(--brand)', cls = '') {
  return `<span class="wordmark ${cls}" style="font-size:${size}px;color:${color}" role="img" aria-label="Maestro"><span aria-hidden="true">maest</span><svg aria-hidden="true" viewBox="0 0 50 110" style="width:.5em;height:1.1em;margin-left:-.41em;margin-right:-.09em;vertical-align:baseline;overflow:visible">
    <path d="M10 60 V20.5 A8.5 8.5 0 0 1 27 20.5 V60 Z" fill="currentColor"/>
    <path d="M24 12 C39 15 57 26 52 50 C48 40.5 38 35 25 34 Z" fill="currentColor"/>
  </svg><span aria-hidden="true">ro</span></span>`;
}

/* ---------------------------------------------------------------- music helpers */
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  const [, l, acc, oct] = m;
  return (Number(oct) + 1) * 12 + SEMI[l] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
}
const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
export function letterOf(m) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[((m % 12) + 12) % 12];
}
function diatonic(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  return Number(m[3]) * 7 + LETTERS.indexOf(m[1]);
}
export const PITCH = {
  C: ['var(--pc-c)', 'var(--pc-c-edge)'], D: ['var(--pc-d)', 'var(--pc-d-edge)'], E: ['var(--pc-e)', 'var(--pc-e-edge)'],
  F: ['var(--pc-f)', 'var(--pc-f-edge)'], G: ['var(--pc-g)', 'var(--pc-g-edge)'], A: ['var(--pc-a)', 'var(--pc-a-edge)'],
  B: ['var(--pc-b)', 'var(--pc-b-edge)'],
};

/* ---------------------------------------------------------------- keyboard */
export function keyGeometry({ from = 'C3', to = 'C6', x = 0, width = 1140 }) {
  const lo = midi(from), hi = midi(to);
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const ww = width / whites.length;
  const bw = ww * 0.6;
  const off = { 1: -0.08, 3: 0.08, 6: -0.1, 8: 0, 10: 0.1 };
  const keys = {};
  whites.forEach((m, i) => { keys[m] = { x: x + i * ww, w: ww, cx: x + i * ww + ww / 2, black: false }; });
  for (let m = lo; m <= hi; m++) {
    if (!isBlack(m)) continue;
    const left = keys[m - 1];
    if (!left) continue;
    const cx = left.x + ww + off[m % 12] * ww;
    keys[m] = { x: cx - bw / 2, w: bw, cx, black: true };
  }
  return { lo, hi, whites, ww, bw, keys, x, width };
}

// pressed: { 'A4': 'hit' | 'held' | 'hint' | 'wrong' }
export function keyboard({ from = 'C3', to = 'C6', width = 1140, height = 168, pressed = {}, labels = true, hintLetters = [], colorMode = 'pitch' }) {
  const g = keyGeometry({ from, to, x: 0, width });
  const H = height, felt = 7, bh = Math.round(H * 0.6);
  const press = Object.fromEntries(Object.entries(pressed).map(([k, v]) => [midi(k), v]));
  const hints = new Set(hintLetters.map(midi));
  let s = `<svg class="keyboard" width="${width}" height="${H + 10}" viewBox="0 -2 ${width} ${H + 12}" aria-hidden="true">
  <defs>
    <linearGradient id="wk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4EEE3"/><stop offset=".12" stop-color="#fff"/></linearGradient>
    <linearGradient id="bk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E3A78"/><stop offset="1" stop-color="#27244F"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".1" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="0" y="-2" width="${width}" height="${felt + 2}" rx="3" fill="var(--brand)"/>`;
  for (const m of g.whites) {
    const k = g.keys[m];
    const st = press[m];
    const L = letterOf(m)[0];
    const [pc, pcEdge] = colorMode === 'hand' ? ['var(--rh)', 'var(--rh-edge)'] : PITCH[L];
    const fill = st === 'hit' || st === 'held' ? pc : st === 'wrong' ? 'var(--coral-soft)' : 'url(#wk)';
    const edge = st === 'hit' || st === 'held' ? pcEdge : '#E3D3B8';
    const dy = st ? 3 : 0;
    s += `<g transform="translate(0 ${dy})"><rect x="${k.x + 1.5}" y="${felt}" width="${k.w - 3}" height="${H - felt - dy}" rx="9" fill="${edge}"/>
      <rect x="${k.x + 1.5}" y="${felt - 6}" width="${k.w - 3}" height="${H - felt - 5}" rx="9" fill="${fill}"/>`;
    if (st === 'hit') s += `<rect x="${k.x + 1.5}" y="${felt}" width="${k.w - 3}" height="${H * 0.5}" rx="9" fill="url(#glow)" opacity=".55"/>`;
    s += `</g>`;
    if (hints.has(m) || st) {
      // Key letters: ink on a white disc; hints add a ring in the pitch colour.
      const cy = H - 28 + dy;
      s += `<circle cx="${k.cx}" cy="${cy}" r="14" fill="#fff" ${st ? '' : `stroke="${pc}" stroke-width="4"`}/>
        <text x="${k.cx}" y="${cy + 6}" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="18" fill="var(--ink)">${L}</text>`;
    }
    if (labels && m % 12 === 0 && !hints.has(m) && !st) {
      s += `<text x="${k.cx}" y="${H - 18}" text-anchor="middle" font-family="Nunito" font-weight="800" font-size="14" fill="#A79B86">C${m / 12 - 1}</text>`;
    }
  }
  for (let m = g.lo; m <= g.hi; m++) {
    const k = g.keys[m];
    if (!k || !k.black) continue;
    const st = press[m];
    s += `<rect x="${k.x}" y="${felt - 2}" width="${k.w}" height="${bh + 4}" rx="6" fill="#1B1938"/>
      <rect x="${k.x + 1}" y="${felt - 4}" width="${k.w - 2}" height="${bh - 3}" rx="6" fill="${st ? 'var(--brand)' : 'url(#bk)'}"/>
      <rect x="${k.x + 4}" y="${felt + bh - 20}" width="${k.w - 8}" height="6" rx="3" fill="#fff" opacity=".10"/>`;
  }
  s += `</svg>`;
  return s;
}

/* ---------------------------------------------------------------- falling notes */
// notes: [{ p:'E4', t: beats, d: beats, hand:'R'|'L' }]; now in beats; lanes aligned to keyGeometry.
export function falling({ from = 'C3', to = 'C6', width = 1140, height = 300, now = 0, ppb = 80, notes = [], colorMode = 'pitch', active = [] }) {
  const g = keyGeometry({ from, to, x: 0, width });
  const hitY = height;
  let s = `<svg class="falling" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
  <defs>
    <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bg-sunk)" stop-opacity="1"/><stop offset=".14" stop-color="var(--bg-sunk)" stop-opacity="0"/></linearGradient>
    <linearGradient id="hitGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--mint)" stop-opacity="0"/><stop offset="1" stop-color="var(--mint)" stop-opacity=".45"/></linearGradient>
  </defs>`;
  // octave guide lanes (C and F lines)
  for (const m of g.whites) {
    const k = g.keys[m];
    if (m % 12 === 0) s += `<rect x="${k.x - 1}" y="0" width="2" height="${height}" fill="#E9DCC6"/>`;
    else if (m % 12 === 5) s += `<rect x="${k.x - 0.5}" y="0" width="1" height="${height}" fill="#EFE4D2"/>`;
  }
  // beat lines
  const first = Math.ceil(now);
  for (let b = first; b < now + height / ppb; b++) {
    const y = hitY - (b - now) * ppb;
    s += `<rect x="0" y="${y - (b % 4 === 0 ? 1.5 : 0.5)}" width="${width}" height="${b % 4 === 0 ? 3 : 1}" fill="${b % 4 === 0 ? '#E4D5BC' : '#EFE5D5'}"/>`;
  }
  const act = new Set(active.map(midi));
  for (const n of notes) {
    const m = midi(n.p);
    const k = g.keys[m];
    const L = letterOf(m)[0];
    const [c, ce] = colorMode === 'hand' ? (n.hand === 'L' ? ['var(--lh)', 'var(--lh-edge)'] : ['var(--rh)', 'var(--rh-edge)']) : PITCH[L];
    const y1 = hitY - (n.t + n.d - now) * ppb + 3;
    let y2 = hitY - (n.t - now) * ppb - 3;
    if (y1 > height || y2 < -40) continue;
    const isActive = act.has(m) && n.t <= now && n.t + n.d > now;
    y2 = Math.min(y2, hitY - 2);
    const w = k.black ? g.bw - 2 : g.ww - 10;
    const x = k.cx - w / 2;
    const h = Math.max(y2 - y1, 18);
    s += `<g${isActive ? ' class="note-active"' : ''}>
      <rect x="${x}" y="${y1 + 4}" width="${w}" height="${h}" rx="12" fill="${ce}"/>
      <rect x="${x}" y="${y1}" width="${w}" height="${h}" rx="12" fill="${c}"/>
      <rect x="${x + 6}" y="${y1 + 5}" width="${Math.max(w - 12, 4)}" height="5" rx="2.5" fill="#fff" opacity=".35"/>`;
    if (h >= 34) {
      // Letters are always ink on a white disc: legible on every pitch colour (14:1).
      const r = k.black ? 10 : 12.5;
      s += `<circle cx="${k.cx}" cy="${y2 - r - 5}" r="${r}" fill="#fff"/>
        <text x="${k.cx}" y="${y2 - r - 5 + (k.black ? 5 : 6.5)}" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="${k.black ? 14 : 18}" fill="var(--ink)">${letterOf(m).replace('#', '♯')}</text>`;
    }
    s += `</g>`;
  }
  s += `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#fadeTop)"/>`;
  s += `</svg>`;
  return s;
}

/* ---------------------------------------------------------------- sheet music */
// A grand staff drawn in SVG. notes: [{ p, t, d:'q'|'h'|'w'|'8'|'q.'|'h.', hand, grade }]
// grade: 'perfect'|'great'|'early'|'late'|'miss' (played) or undefined (upcoming).
const GRADE = { perfect: 'var(--sun-edge)', great: 'var(--mint)', early: 'var(--early)', late: 'var(--late)', miss: 'var(--coral)' };
export function staff({ width = 1100, height = 210, top = 44, sp = 12, playX = 330, now = 0, ppb = 70, notes = [], clefW = 150, beatsPerBar = 4, bars = 0, from = null, showPlayhead = true, keySig = '', timeSig = ['4', '4'] }) {
  const T = top;                      // treble top line
  const Bt = T + 4 * sp + 4 * sp;     // bass top line (gap of 4 spaces)
  const yT = (name) => T + 4 * sp - (diatonic(name) - diatonic('E4')) * (sp / 2);
  const yB = (name) => Bt + 4 * sp - (diatonic(name) - diatonic('G2')) * (sp / 2);
  const xOf = (t) => playX + (t - now) * ppb;
  const ink = 'var(--paper-line)';
  let s = `<svg class="staff" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
  <defs><clipPath id="music"><rect x="${clefW}" y="0" width="${width - clefW}" height="${height}"/></clipPath>
  <linearGradient id="clefFade" x1="0" x2="1"><stop offset="0" stop-color="var(--paper)"/><stop offset="1" stop-color="var(--paper)" stop-opacity="0"/></linearGradient></defs>`;
  for (let i = 0; i < 5; i++) {
    s += `<rect x="18" y="${T + i * sp - 0.75}" width="${width - 36}" height="1.5" fill="${ink}" opacity=".8"/>`;
    s += `<rect x="18" y="${Bt + i * sp - 0.75}" width="${width - 36}" height="1.5" fill="${ink}" opacity=".8"/>`;
  }
  // system line + brace
  s += `<rect x="30" y="${T}" width="2.5" height="${Bt + 4 * sp - T}" fill="${ink}"/>`;
  s += `<path d="M26 ${T} C12 ${T + 14} 22 ${(T + Bt + 4 * sp) / 2 - 16} 10 ${(T + Bt + 4 * sp) / 2} C22 ${(T + Bt + 4 * sp) / 2 + 16} 12 ${Bt + 4 * sp - 14} 26 ${Bt + 4 * sp}" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
  // clefs (Noto Music)
  s += `<text x="40" y="${T + 3 * sp + 1}" font-family="Noto Music" font-size="${sp * 4.1}" fill="${ink}">𝄞</text>`;
  s += `<text x="42" y="${Bt + sp + 1}" font-family="Noto Music" font-size="${sp * 4.1}" fill="${ink}">𝄢</text>`;
  // time signature
  const tsx = keySig ? 118 : 104;
  s += `<g font-family="Fredoka" font-weight="700" font-size="${sp * 2.3}" fill="${ink}" text-anchor="middle">
    <text x="${tsx}" y="${T + 2 * sp - 1}">${timeSig[0]}</text><text x="${tsx}" y="${T + 4 * sp - 1}">${timeSig[1]}</text>
    <text x="${tsx}" y="${Bt + 2 * sp - 1}">${timeSig[0]}</text><text x="${tsx}" y="${Bt + 4 * sp - 1}">${timeSig[1]}</text></g>`;
  if (showPlayhead) {
    s += `<rect x="${playX - 13}" y="${T - 18}" width="26" height="${Bt + 4 * sp - T + 36}" rx="13" fill="var(--brand)" opacity=".10"/>
      <rect x="${playX - 2}" y="${T - 16}" width="4" height="${Bt + 4 * sp - T + 32}" rx="2" fill="var(--brand)"/>
      <path d="M${playX - 9} ${T - 24} h18 l-9 10 Z" fill="var(--brand)"/>`;
  }
  s += `<g clip-path="url(#music)">`;
  // bar lines
  for (let b = 1; b <= bars; b++) {
    const x = xOf(b * beatsPerBar) - sp * 1.7; // bar lines sit a little before the downbeat
    if (x < clefW - 4 || x > width - 10) continue;
    s += `<rect x="${x - 1}" y="${T}" width="2" height="${Bt + 4 * sp - T}" fill="${ink}" opacity=".85"/>`;
    if (b === bars) s += `<rect x="${x + 4}" y="${T}" width="5" height="${Bt + 4 * sp - T}" fill="${ink}"/>`;
  }
  // notes
  for (const n of notes) {
    const x = xOf(n.t);
    const treble = n.hand !== 'L';
    const y = treble ? yT(n.p) : yB(n.p);
    const col = n.grade ? GRADE[n.grade] : ink;
    const open = n.d.startsWith('h') || n.d.startsWith('w');
    const dotted = n.d.endsWith('.');
    const midLine = treble ? T + 2 * sp : Bt + 2 * sp;
    const up = y >= midLine;
    // ledger lines
    const top = treble ? T : Bt, bottom = (treble ? T : Bt) + 4 * sp;
    for (let ly = bottom + sp; ly <= y + 0.1; ly += sp) s += `<rect x="${x - 13}" y="${ly - 0.9}" width="26" height="1.8" fill="${ink}"/>`;
    for (let ly = top - sp; ly >= y - 0.1; ly -= sp) s += `<rect x="${x - 13}" y="${ly - 0.9}" width="26" height="1.8" fill="${ink}"/>`;
    if (n.now) s += `<circle cx="${x}" cy="${y}" r="16" fill="#fff" stroke="var(--sun)" stroke-width="3"/>`;
    const rx = sp * 0.68, ry = sp * 0.5;
    if (open) {
      s += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(-22 ${x} ${y})" fill="none" stroke="${col}" stroke-width="${sp * 0.2}"/>`;
    } else {
      s += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(-22 ${x} ${y})" fill="${col}"/>`;
    }
    if (!n.d.startsWith('w')) {
      const sx = up ? x + rx - 1.2 : x - rx + 1.2;
      const sy2 = up ? y - sp * 3.4 : y + sp * 3.4;
      s += `<rect x="${sx - 1}" y="${Math.min(y, sy2)}" width="2.2" height="${Math.abs(sy2 - y)}" fill="${col}"/>`;
      if (n.d.startsWith('8')) {
        s += up
          ? `<path d="M${sx + 1} ${sy2} c1 ${sp * 1.1} ${sp * 1.3} ${sp * 1.2} ${sp * 0.9} ${sp * 2.6} c${sp * 0.1} -${sp * 1} -${sp * 0.5} -${sp * 1.4} -${sp * 0.9} -${sp * 1.5} Z" fill="${col}"/>`
          : `<path d="M${sx - 1} ${sy2} c1 -${sp * 1.1} ${sp * 1.3} -${sp * 1.2} ${sp * 0.9} -${sp * 2.6} c${sp * 0.1} ${sp * 1} -${sp * 0.5} ${sp * 1.4} -${sp * 0.9} ${sp * 1.5} Z" fill="${col}"/>`;
      }
    }
    if (dotted) {
      const onLine = Math.round((y - (treble ? T : Bt)) / (sp / 2)) % 2 === 0;
      s += `<circle cx="${x + rx + 6}" cy="${onLine ? y - sp / 2 : y}" r="2.4" fill="${col}"/>`;
    }
    if (n.finger) {
      s += `<text x="${x}" y="${treble ? Math.min(y - sp * 1.2, T - 8) : Math.max(y + sp * 1.9, Bt + 4 * sp + 18)}" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="13" fill="var(--ink-3)">${n.finger}</text>`;
    }
  }
  s += `</g>`;
  s += `<rect x="${clefW - 4}" y="${T - 20}" width="36" height="${Bt + 4 * sp - T + 40}" fill="url(#clefFade)"/>`;
  s += `</svg>`;
  return { svg: s, xOf, yT, yB, T, Bt };
}

/* ---------------------------------------------------------------- confetti */
export function confetti(seed = 7, count = 60, box = { w: 1180, h: 820 }, palette = ['#6F4BF2', '#FFC23D', '#20C07A', '#FF5A6A', '#2F9BFF', '#FF9A2E'], avoid = []) {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  let s = `<svg class="confetti" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}" aria-hidden="true">`;
  for (let i = 0; i < count; i++) {
    const x = rnd() * box.w, y = rnd() * box.h, rot = rnd() * 360, c = palette[i % palette.length];
    if (avoid.some(([ax, ay, aw, ah]) => x > ax - 14 && x < ax + aw + 14 && y > ay - 14 && y < ay + ah + 14)) continue;
    const kind = i % 4;
    const d = (rnd() * 2.5).toFixed(2);
    s += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)})" style="animation-delay:-${d}s">`;
    if (kind === 0) s += `<rect x="-5" y="-9" width="10" height="18" rx="3" fill="${c}"/>`;
    else if (kind === 1) s += `<circle r="5.5" fill="${c}"/>`;
    else if (kind === 2) s += `<path d="M-10 0 q5 -8 10 0 t10 0" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
    else s += `<path d="M0 -8 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 Z" fill="${c}"/>`;
    s += `</g>`;
  }
  return s + `</svg>`;
}

// Early/late meter: hits are offsets in ms (negative = early).
export function meter({ width = 360, hits = [], avg = 0, range = 200, label = true }) {
  const w = width, h = 18, cx = w / 2;
  const xs = (ms) => cx + (Math.max(-range, Math.min(range, ms)) / range) * (w / 2 - 10);
  const win = (40 / range) * (w / 2 - 10);
  let s = `<svg class="meter" width="${w}" height="${h + 26}" viewBox="0 -12 ${w} ${h + 26}" aria-hidden="true">
  <defs><linearGradient id="mt" x1="0" x2="1"><stop offset="0" stop-color="var(--early)"/><stop offset=".42" stop-color="var(--early-soft)"/><stop offset=".5" stop-color="#fff"/><stop offset=".58" stop-color="var(--late-soft)"/><stop offset="1" stop-color="var(--late)"/></linearGradient></defs>
  <rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}" fill="url(#mt)"/>
  <rect x="${cx - win}" y="0" width="${win * 2}" height="${h}" fill="var(--mint)" opacity=".9"/>
  <rect x="${cx - 1.5}" y="-3" width="3" height="${h + 6}" rx="1.5" fill="var(--ink)"/>`;
  hits.forEach((ms, i) => {
    const op = 0.35 + (0.65 * (i + 1)) / hits.length;
    s += `<rect x="${xs(ms) - 2}" y="3" width="4" height="${h - 6}" rx="2" fill="var(--ink)" opacity="${op.toFixed(2)}"/>`;
  });
  const ax = xs(avg);
  s += `<path d="M${ax - 8} -11 h16 l-8 10 Z" fill="var(--brand)" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
  s += `</svg>`;
  return s;
}

/* ---------------------------------------------------------------- navigation rail */
import { icon as _icon } from './icons.mjs';
import { pipFace as _face } from './mascot.mjs';
export function rail(active = 'learn') {
  const items = [
    ['learn', 'Learn', 'home'],
    ['songs', 'Songs', 'note'],
    ['practice', 'Practice', 'target'],
    ['free', 'Free play', 'pianokeys'],
    ['progress', 'Progress', 'chart'],
  ];
  const nav = ([id, label, ic]) =>
    `<a class="nav${id === active ? ' on' : ''}"><span class="tile t-${id}">${_icon(ic, 24)}</span>${label}</a>`;
  return `<nav class="rail" aria-label="Main">
    <div class="logo">${wordmark(40)}</div>
    ${items.map(nav).join('')}
    <div class="spacer"></div>
    ${nav(['settings', 'Settings', 'gear'])}
    <div class="me">${_face({ size: 44, bg: '#EEE8FF' })}<div><b>Sam</b><small>Level 12</small></div></div>
  </nav>`;
}
