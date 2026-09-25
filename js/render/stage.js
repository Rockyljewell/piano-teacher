// The play surface: a scrolling grand staff with a fixed playhead (top), falling notes (middle)
// and a piano keyboard (bottom), all moving on one shared musical clock.
import { GLYPHS } from './glyphs.js';
import { diatonic, isBlack, STEP_NAMES, noteName } from '../music/theory.js';

const PATHS = {};
function glyph(name) {
  if (!PATHS[name]) PATHS[name] = new Path2D(GLYPHS[name].d);
  return PATHS[name];
}

export const COLORS = {
  paper: '#FFFCF4',
  paperLine: '#EADBBE',
  paperEdge: '#E3CFAD',
  ink: '#2A2346',
  staffInk: '#3B3552',
  inkSoft: 'rgba(42,35,70,0.35)',
  rh: '#6F4BF2',
  rhEdge: '#4F30C9',
  lh: '#14B8A6',
  lhEdge: '#0B8C7E',
  hit: '#20C07A',
  near: '#FF9A2E',
  miss: '#FF5A6A',
  wrong: '#FF5A6A',
  playhead: '#6F4BF2',
  bg: '#FFF7EA',
  lane: '#FBEEDA',
  laneLine: '#EFE4D2',
  laneC: '#E6D6BC',
  sun: '#FFC23D',
  sunEdge: '#E09A0B',
  mint: '#20C07A',
  mintEdge: '#12985C',
  early: '#2F9BFF',
  earlyEdge: '#1673D1',
  earlyInk: '#1463B8',
  late: '#FF9A2E',
  lateEdge: '#D9760C',
  lateInk: '#A65400',
  coral: '#FF5A6A',
  coralEdge: '#D93A4C',
  brandSoft: '#EEE8FF',
  keyEdge: '#E3D3B8',
  blackKey: '#2E2B5F',
  font: '"Nunito", ui-rounded, system-ui, sans-serif',
  fontDisplay: '"Fredoka", "Nunito", ui-rounded, system-ui, sans-serif',
};

// Per-pitch colours ("by pitch" mode, Levels 1-16): C red, D orange, E yellow, F green, G teal,
// A blue, B violet. Sharps take their letter's colour (C# = C) unless a key spells them as flats.
export const LETTER_COLORS = { C: ['#F2545B', '#C73840'], D: ['#FF9A2E', '#D9760C'], E: ['#FFC93D', '#DDA10E'], F: ['#3CC46F', '#229A51'], G: ['#22B8CF', '#148FA3'], A: ['#3E7BFA', '#2358CC'], B: ['#A45CF0', '#7D38C9'] };
const PC_LETTER = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
export const NOTE_COLORS = PC_LETTER.map((l) => LETTER_COLORS[l][0]);
function letterFor(midi, key) {
  if (key && typeof key.spell === 'function') {
    try {
      const sp = key.spell(midi);
      if (sp && STEP_NAMES[sp.step]) return STEP_NAMES[sp.step][0];
    } catch {
      /* fall back */
    }
  }
  return PC_LETTER[((midi % 12) + 12) % 12];
}
export function noteColor(midi, key) {
  return LETTER_COLORS[letterFor(midi, key)][0];
}
export function noteEdge(midi, key) {
  return LETTER_COLORS[letterFor(midi, key)][1];
}
// Staff noteheads take their grade colour once played (dark shades read well on paper).
const STAFF_GRADE = { perfect: '#E09A0B', great: '#12985C', early: '#1673D1', late: '#D9760C', miss: '#D93A4C' };

// Staff geometry in diatonic steps (C4 = 28).
const STAFF = {
  treble: { top: 38, bottom: 30, middle: 34 },
  bass: { top: 26, bottom: 18, middle: 22 },
  rhythm: { top: 34, bottom: 34, middle: 34 },
};
const SHARP_POS = { treble: [38, 35, 39, 36, 33, 37, 34], bass: [24, 21, 25, 22, 19, 23, 20] };
const FLAT_POS = { treble: [34, 37, 33, 36, 32, 35, 31], bass: [20, 23, 19, 22, 18, 21, 17] };

function baseDuration(dur, tuplet) {
  if (tuplet) return { base: dur * 1.5, dots: 0 };
  const eps = 1e-6;
  for (const b of [4, 2, 1, 0.5, 0.25, 0.125]) {
    if (Math.abs(dur - b) < eps) return { base: b, dots: 0 };
    if (Math.abs(dur - b * 1.5) < eps) return { base: b, dots: 1 };
  }
  return { base: dur >= 4 ? 4 : dur >= 2 ? 2 : dur >= 1 ? 1 : dur >= 0.5 ? 0.5 : 0.25, dots: 0 };
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.piece = null;
    this.layout = null;
    this.opts = { showStaff: true, showFalling: true, showNames: false, showFingers: true, showHints: true, noteColors: false };
    this.keyFlash = new Map();
    this.particles = [];
    this.chips = [];
    this.rings = [];
  }

  // Override any of COLORS (brand theme).
  setTheme(colors) {
    Object.assign(COLORS, colors);
  }

  // ---- effects ------------------------------------------------------------------------------
  clearFx() {
    this.particles = [];
    this.chips = [];
    this.rings = [];
  }

  // Hit feedback at a key: a soft glow (sun for Perfect) and a few sparks in the note's colour.
  burst(midi, color = COLORS.hit, count = 8, opts = {}) {
    const k = this.keys && this.keys.get(midi);
    if (!k || !this.L) return;
    const x = k.x + k.w / 2,
      y = this.L.kb.y;
    const now = performance.now();
    const perfect = opts.grade === 'perfect';
    const col = this.opts.noteColors ? noteColor(midi, this.piece && this.piece.key) : color;
    this.particles.push({ glow: true, x, y, t0: now, life: 300, color: perfect ? COLORS.sun : color, r: Math.max(26, k.w * 0.9) });
    if (perfect) this.particles.push({ shock: true, x, y: y - 6, t0: now, life: 260, color: COLORS.sun, r: 46 });
    const n = Math.min(10, count);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const v = 120 + Math.random() * 140;
      this.particles.push({ x, y: y - 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: now, life: 450, color: i % 3 === 0 && perfect ? COLORS.sun : col, r: 2.5 + Math.random() * 2.5, star: i % 2 === 0 });
    }
    if (this.particles.length > 120) this.particles.splice(0, this.particles.length - 120);
  }

  // A timing chip: "Perfect", "Great · 70 ms late", "Early · 150 ms", "Oops · E4". With a staff,
  // it points at the note just played near the playhead and drifts left with the music;
  // otherwise it floats above the key.
  chip(midi, text, color = COLORS.hit, opts = {}) {
    if (!this.L) return;
    const now = performance.now();
    const parts = String(text).split(' · ');
    const c = { midi, main: parts[0], detail: parts.slice(1).join(' · '), color, grade: opts.grade || 'great', errMs: opts.errMs || 0, t0: now, life: 1300 };
    const k = this.keys && this.keys.get(midi);
    let anchored = false;
    if (opts.eventId != null && this.piece && this.opts.showStaff && this.L.staff.h > 0) {
      const e = this.piece.events.find((x) => x.id === opts.eventId);
      if (e && e._notes) {
        const n = e._notes.find((x) => x.midi === midi) || e._notes[e._notes.length - 1];
        c.beat = e.beat;
        c.staff = e.staff;
        c.d = n.d;
        anchored = true;
      }
    }
    if (!anchored) {
      if (!k) return;
      c.x = k.x + k.w / 2;
      const same = this.chips.filter((x) => x.x != null && Math.abs(x.x - c.x) < 60 && now - x.t0 < 500).length;
      c.y = this.L.kb.y - 30 - same * 44;
    }
    this.chips.push(c);
    if (this.chips.length > 8) this.chips.shift();
  }

  // An expanding ring on the staff at a note that was just played correctly.
  ring(eventId, midi, color = COLORS.hit) {
    if (!this.piece || !this.opts.showStaff || !this.L.staff.h) return;
    const e = this.piece.events.find((x) => x.id === eventId);
    if (!e || !e._notes) return;
    const n = e._notes.find((x) => x.midi === midi) || e._notes[0];
    this.rings.push({ beat: e.beat, staff: e.staff, d: n.d, color, t0: performance.now(), life: 500 });
  }

  // Global canvas x of a notehead centre at `beat` (staff coordinates live inside the paper card).
  _staffX(beat) {
    const sp = this.sp;
    const hw = GLYPHS.noteheadBlack.w * sp;
    return this.L.staff.x + this.playheadX + (beat - (this._now || 0)) * this.pxPerBeat - sp * 0.59 + hw / 2;
  }

  _drawFx() {
    const ctx = this.ctx;
    const now = performance.now();
    this.particles = this.particles.filter((p) => now - p.t0 < p.life);
    for (const p of this.particles) {
      const k = (now - p.t0) / p.life;
      if (p.glow) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * (1 + k * 0.4));
        g.addColorStop(0, hexA(p.color, 0.55 * (1 - k)));
        g.addColorStop(1, hexA(p.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.r * 1.5, p.y - p.r * 1.5, p.r * 3, p.r * 3);
        continue;
      }
      if (p.shock) {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      const t = (now - p.t0) / 1000;
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.fillStyle = p.color;
      const x = p.x + p.vx * t,
        y = p.y + p.vy * t + 300 * t * t,
        r = p.r * (1 - 0.6 * k);
      if (p.star) sparkle(ctx, x, y, r * 1.8);
      else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (this.piece && this.opts.showStaff && this.L.staff.h > 0 && this.sp) {
      this.rings = this.rings.filter((r) => now - r.t0 < r.life);
      const card = this.L.staff;
      ctx.save();
      ctx.beginPath();
      ctx.rect(card.x + this.headerW, card.y, card.w - this.headerW, card.h);
      ctx.clip();
      for (const r of this.rings) {
        const k = (now - r.t0) / r.life;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(this._staffX(r.beat), card.y + this._y(r.staff, r.d), this.sp * (0.9 + 1.6 * k), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    this.chips = this.chips.filter((c) => now - c.t0 < c.life);
    // Staff chips: one row above the treble staff, one below the bass staff. The newest chip is
    // centred on its note; older ones are pushed left so they never overlap.
    const rows = new Map();
    for (const c of this.chips) {
      if (c.beat == null) continue;
      const below = c.staff === 'bass' && this.piece.staves.length > 1;
      const key = below ? 'below' : 'above';
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(c);
    }
    const card = this.L.staff;
    for (const [key, list] of rows) {
      list.sort((a, b) => b.t0 - a.t0);
      let leftLimit = Infinity;
      const topStaff = this.piece.staves[0];
      const botStaff = this.piece.staves[this.piece.staves.length - 1];
      const y = key === 'above' ? card.y + this._y(topStaff, STAFF[topStaff].top) - this.sp * 1.2 - 18 : card.y + this._y(botStaff, STAFF[botStaff].bottom) + this.sp * 1.2 + 18;
      for (const c of list) {
        const w = this._chipWidth(c);
        const nx = this._staffX(c.beat);
        let x = nx - w / 2;
        if (x + w > leftLimit - 6) x = leftLimit - 6 - w;
        leftLimit = x;
        if (x < card.x + this.headerW - 10) continue;
        this._drawChip(c, x, y, w, now, nx, key === 'above' ? 1 : -1);
      }
    }
    for (const c of this.chips) {
      if (c.beat != null) continue;
      const w = this._chipWidth(c);
      const x = Math.max(8, Math.min(this.w - w - 8, c.x - w / 2));
      const k = (now - c.t0) / c.life;
      this._drawChip(c, x, c.y - 26 * Math.min(1, k * 1.4), w, now, null, 0);
    }
    ctx.globalAlpha = 1;
  }

  _chipWidth(c) {
    const ctx = this.ctx;
    ctx.font = `600 17px ${COLORS.fontDisplay}`;
    let w = ctx.measureText(c.main).width + 50;
    if (c.detail) {
      ctx.font = `800 13px ${COLORS.font}`;
      w += ctx.measureText(`· ${c.detail}`).width + 6;
    }
    return w;
  }

  _drawChip(c, x, y, w, now, noteX, dir) {
    const ctx = this.ctx;
    const k = (now - c.t0) / c.life;
    const pop = k < 0.1 ? 0.65 + (k / 0.1) * 0.43 : k < 0.18 ? 1.08 - ((k - 0.1) / 0.08) * 0.08 : 1;
    const alpha = k > 0.72 ? Math.max(0, 1 - (k - 0.72) / 0.28) : 1;
    const h = 34;
    const rise = dir ? -8 * dir * Math.min(1, k) : 0;
    ctx.save();
    ctx.globalAlpha = alpha * (c === this.chips[this.chips.length - 1] ? 1 : 0.9);
    ctx.translate(x + w / 2, y + rise);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);
    const col = c.color;
    const edge = c.grade === 'perfect' ? COLORS.sunEdge : c.grade === 'great' ? COLORS.mintEdge : c.grade === 'wrong' ? COLORS.coralEdge : c.errMs < 0 ? COLORS.earlyEdge : COLORS.lateEdge;
    // pointer towards the note
    if (noteX != null && dir) {
      const px = Math.max(16, Math.min(w - 16, noteX - x));
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (dir > 0) {
        ctx.moveTo(px - 7, h - 1);
        ctx.lineTo(px, h + 8);
        ctx.lineTo(px + 7, h - 1);
      } else {
        ctx.moveTo(px - 7, 1);
        ctx.lineTo(px, -8);
        ctx.lineTo(px + 7, 1);
      }
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = edge;
    roundRect(ctx, 0, 4, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    roundRect(ctx, 0, 0, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    roundRect(ctx, 1.25, 1.25, w - 2.5, h - 2.5, (h - 2.5) / 2);
    ctx.stroke();
    // icon disc
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(19, h / 2, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.grade === 'perfect' ? COLORS.ink : '#fff';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (c.grade === 'perfect') sparkle(ctx, 19, h / 2, 8);
    else if (c.grade === 'great') {
      ctx.moveTo(13.5, h / 2);
      ctx.lineTo(17.5, h / 2 + 4);
      ctx.lineTo(24.5, h / 2 - 4);
      ctx.stroke();
    } else if (c.grade === 'wrong') {
      ctx.moveTo(15, h / 2 - 4);
      ctx.lineTo(23, h / 2 + 4);
      ctx.moveTo(23, h / 2 - 4);
      ctx.lineTo(15, h / 2 + 4);
      ctx.stroke();
    } else {
      const s = c.errMs < 0 ? -1 : 1;
      ctx.moveTo(19 - 5 * s, h / 2);
      ctx.lineTo(19 + 5 * s, h / 2);
      ctx.moveTo(19 + 1 * s, h / 2 - 4);
      ctx.lineTo(19 + 5 * s, h / 2);
      ctx.lineTo(19 + 1 * s, h / 2 + 4);
      ctx.stroke();
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 17px ${COLORS.fontDisplay}`;
    ctx.fillText(c.main, 37, h / 2 + 1);
    if (c.detail) {
      const mw = ctx.measureText(c.main).width;
      ctx.font = `800 13px ${COLORS.font}`;
      ctx.fillStyle = '#5E5775';
      ctx.fillText(`· ${c.detail}`, 37 + mw + 6, h / 2 + 1);
    }
    ctx.restore();
  }

  // Early / late meter: a pill docked in the paper card's top-right corner (or in the status
  // strip when the sheet music is hidden). Ticks = recent notes, triangle = their average.
  _drawTimingMeter(tm) {
    if (!tm || !tm.profile) return;
    const ctx = this.ctx;
    const p = tm.profile;
    let onCard = this.piece && this.opts.showStaff && this.L.staff.h > 0;
    if (onCard) {
      // Dock on the paper unless notes climb well above the top staff (or it is a rhythm line).
      const top = this.piece.staves[0];
      const high = this._maxD != null ? this._maxD : STAFF[top].top;
      if (top === 'rhythm' || high > STAFF[top].top + 2 || this._y(top, STAFF[top].top) < 46) onCard = false;
    }
    const trackW = Math.max(120, Math.min(220, this.w * 0.2));
    ctx.font = `800 14px ${COLORS.font}`;
    const recent = (tm.recent || []).filter((r) => performance.now() - r.t < 6000);
    const avg = recent.length ? recent.reduce((a, r) => a + r.errMs, 0) / recent.length : null;
    const avgTxt = avg == null ? 'avg –' : `avg ${avg >= 0 ? '+' : '−'}${Math.abs(Math.round(avg))} ms`;
    const wEarly = ctx.measureText('Early').width + 22;
    const wLate = ctx.measureText('Late').width + 22;
    const wAvg = ctx.measureText('avg +000 ms').width + 18;
    const W = 16 + wEarly + 10 + trackW + 10 + wLate + 12 + wAvg + 8;
    const H = 38;
    let x0, y0;
    if (onCard) {
      x0 = this.L.staff.x + this.L.staff.w - W - 14;
      y0 = this.L.staff.y + 10;
    } else {
      x0 = (this.w - W) / 2;
      y0 = this.L.strip.y + (this.L.strip.h - H) / 2;
    }
    // pill
    ctx.fillStyle = onCard ? COLORS.paperEdge : '#E6D6BC';
    roundRect(ctx, x0, y0 + 3, W, H, H / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    roundRect(ctx, x0, y0, W, H, H / 2);
    ctx.fill();
    ctx.strokeStyle = onCard ? COLORS.paperLine : '#F0E3CD';
    ctx.lineWidth = 2;
    roundRect(ctx, x0 + 1, y0 + 1, W - 2, H - 2, (H - 2) / 2);
    ctx.stroke();
    const cy = y0 + H / 2;
    let x = x0 + 16;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.earlyInk;
    arrow(ctx, x + 5, cy, -1, COLORS.earlyInk);
    ctx.fillText('Early', x + 14, cy + 1);
    x += wEarly + 10;
    // track
    const tx = x,
      tw = trackW,
      th = 14;
    const g = ctx.createLinearGradient(tx, 0, tx + tw, 0);
    g.addColorStop(0, COLORS.early);
    g.addColorStop(0.42, '#DDEEFF');
    g.addColorStop(0.5, '#FFFFFF');
    g.addColorStop(0.58, '#FFE9CF');
    g.addColorStop(1, COLORS.late);
    ctx.fillStyle = g;
    roundRect(ctx, tx, cy - th / 2, tw, th, th / 2);
    ctx.fill();
    const range = p.ok;
    const X = (ms) => tx + tw / 2 + (Math.max(-range, Math.min(range, ms)) / range) * (tw / 2 - 6);
    ctx.fillStyle = COLORS.mint;
    ctx.fillRect(X(-p.perfect), cy - th / 2, X(p.perfect) - X(-p.perfect), th);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(X(0) - 1.5, cy - th / 2 - 3, 3, th + 6);
    const now = performance.now();
    recent.slice(-8).forEach((r, i, arr) => {
      const age = (now - r.t) / 6000;
      ctx.globalAlpha = Math.max(0.2, (0.35 + (0.65 * (i + 1)) / arr.length) * (1 - age * 0.7));
      ctx.fillStyle = COLORS.ink;
      roundRect(ctx, X(r.errMs) - 2, cy - th / 2 + 3, 4, th - 6, 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (avg != null) {
      const ax = X(avg);
      ctx.fillStyle = COLORS.playhead;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ax - 7, cy - th / 2 - 11);
      ctx.lineTo(ax + 7, cy - th / 2 - 11);
      ctx.lineTo(ax, cy - th / 2 - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    x += tw + 10;
    ctx.fillStyle = COLORS.lateInk;
    ctx.fillText('Late', x, cy + 1);
    arrow(ctx, x + ctx.measureText('Late').width + 9, cy, 1, COLORS.lateInk);
    x += wLate + 6;
    ctx.fillStyle = '#F0E3CD';
    ctx.fillRect(x, cy - 10, 2, 20);
    ctx.fillStyle = '#5E5775';
    ctx.font = `600 15px ${COLORS.fontDisplay}`;
    ctx.fillText(avgTxt, x + 10, cy + 1);
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    this._computeLayout();
  }

  setOptions(o) {
    Object.assign(this.opts, o);
    this._computeLayout();
  }

  setPiece(piece, range) {
    this.piece = piece;
    this.range = range || (piece ? piece.range : [21, 108]);
    if (piece) this._prepareNotation();
    this._computeLayout();
  }

  setRange(range) {
    this.range = range;
    this._computeLayout();
  }

  // ------------------------------------------------------------------------------------------
  _computeLayout() {
    if (!this.w) return;
    const W = this.w,
      H = this.h;
    const piece = this.piece;
    const showStaff = this.opts.showStaff && piece;
    const showFall = this.opts.showFalling;
    const pad = W < 700 ? 4 : 8;
    const stripH = 44;
    const kbH = Math.min(H * 0.23, Math.max(90, ((W - 2 * pad) / this._whiteCount()) * 5.2));
    let staffH = 0;
    if (showStaff) {
      const two = piece.staves.length === 2;
      staffH = showFall ? H * (two ? 0.37 : 0.28) : H - kbH - stripH - 8;
      if (!two && piece.staves[0] === 'rhythm') staffH = showFall ? H * 0.22 : H - kbH - stripH - 8;
    }
    // Paper card (sheet music) on top, the status strip, falling notes, then the keyboard.
    const cardH = Math.max(0, staffH - 6);
    const stripY = showStaff ? staffH + 2 : 0;
    const fallY = stripY + stripH;
    const fallH = H - kbH - fallY;
    this.L = {
      staff: { x: pad, y: 0, w: W - 2 * pad, h: cardH },
      strip: { y: stripY, h: stripH },
      fall: { x: pad, y: fallY, w: W - 2 * pad, h: Math.max(0, fallH) },
      kb: { x: pad, y: H - kbH, w: W - 2 * pad, h: kbH },
    };
    if (!showFall) {
      this.L.fall.h = 0;
      this.L.strip.y = showStaff ? staffH + 2 : 0;
    }
    if (showStaff) {
      const two = piece.staves.length === 2;
      // staff space: grand staff spans ~ (4 + gap + 4) spaces plus room for chips and ledger lines.
      const spans = two ? 22 : piece.staves[0] === 'rhythm' ? 8 : 13;
      this.sp = Math.max(7, Math.min(16, cardH / spans));
      const sp = this.sp;
      const midY = cardH / 2 + sp * 0.4;
      this.staffY = {};
      if (two) {
        const gap = 6 * sp;
        const total = 8 * sp + gap;
        this.staffY.treble = midY - total / 2;
        this.staffY.bass = this.staffY.treble + 4 * sp + gap;
      } else {
        this.staffY[piece.staves[0]] = midY - 2 * sp;
      }
      this.headerW = sp * (piece.key.fifths ? 7 + Math.abs(piece.key.fifths) * 1.1 : 7);
      this.playheadX = Math.max(this.headerW + sp * 6, this.L.staff.w * 0.26);
      // Horizontal zoom: shortest note gets enough room.
      const minDur = Math.min(...piece.events.map((e) => e.dur));
      this.pxPerBeat = Math.min(sp * 16, Math.max(sp * 8, (sp * 3.8) / Math.max(0.2, minDur)));
    }
    this._layoutKeys();
  }

  _whiteCount() {
    const [lo, hi] = this.range || [21, 108];
    let n = 0;
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) n++;
    return Math.max(1, n);
  }

  _layoutKeys() {
    const [lo, hi] = this.range || [21, 108];
    const { x, w } = this.L.kb;
    const whites = this._whiteCount();
    const ww = w / whites;
    this.keys = new Map();
    let wi = 0;
    for (let m = lo; m <= hi; m++) {
      if (!isBlack(m)) {
        this.keys.set(m, { x: x + wi * ww, w: ww, black: false });
        wi++;
      }
    }
    const bw = ww * 0.6;
    const off = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };
    for (let m = lo; m <= hi; m++) {
      if (isBlack(m)) {
        const left = this.keys.get(m - 1);
        if (!left) continue;
        const cx = left.x + left.w + off[m % 12] * bw;
        this.keys.set(m, { x: cx - bw / 2, w: bw, black: true });
      }
    }
    this.whiteW = ww;
  }

  keyCenter(midi) {
    const k = this.keys && this.keys.get(midi);
    return k ? k.x + k.w / 2 : null;
  }

  // Which key is at a canvas point (for touch input).
  keyAt(px, py) {
    const { y, h } = this.L.kb;
    if (py < y || py > y + h) return null;
    for (const [m, k] of this.keys) if (k.black && py < y + h * 0.62 && px >= k.x && px <= k.x + k.w) return m;
    for (const [m, k] of this.keys) if (!k.black && px >= k.x && px <= k.x + k.w) return m;
    return null;
  }

  // ------------------------------------------------------------------------------------------
  _prepareNotation() {
    const p = this.piece;
    const key = p.key;
    const evs = p.events;
    // Spell notes, work out accidentals per measure and staff.
    const acc = {};
    for (const e of evs) {
      e._m = Math.floor(e.beat / p.beatsPer + 1e-6);
      const staffKey = `${e.staff}:${e._m}`;
      if (!acc[staffKey]) acc[staffKey] = {};
      const state = acc[staffKey];
      e._notes = e.midis.map((m) => {
        if (e.staff === 'rhythm') return { midi: m, d: 34, acc: null };
        const sp = key.spell(m);
        const d = diatonic(sp);
        const id = `${sp.step}:${sp.octave}`;
        const current = id in state ? state[id] : key.alter[sp.step];
        let a = null;
        if (sp.alter !== current && !e.tiedFrom) a = sp.alter === 1 ? 'accidentalSharp' : sp.alter === -1 ? 'accidentalFlat' : 'accidentalNatural';
        state[id] = sp.alter;
        return { midi: m, d, acc: a, name: STEP_NAMES[sp.step] };
      });
      e._notes.sort((a, b) => a.d - b.d);
      const { base, dots } = baseDuration(e.measureRest ? 4 : e.dur, e.tuplet);
      e._base = base;
      e._dots = e.measureRest ? 0 : dots;
    }
    // Beam groups: consecutive short notes inside the same beat group.
    const groupLen = p.ts.compound ? 1.5 : 1;
    for (const staff of p.staves) {
      const list = evs.filter((e) => e.staff === staff);
      let cur = [];
      const flush = () => {
        if (cur.length >= 2) {
          const g = { events: cur };
          for (const e of cur) e._beam = g;
        }
        cur = [];
      };
      for (const e of list) {
        const beamable = !e.rest && e._base <= 0.5;
        const grp = Math.floor(e.beat / groupLen + 1e-6);
        if (!beamable) {
          flush();
          continue;
        }
        if (cur.length && Math.floor(cur[0].beat / groupLen + 1e-6) !== grp) flush();
        cur.push(e);
      }
      flush();
      // Stem directions.
      const mid = STAFF[staff].middle;
      for (const e of list) {
        if (e.rest) continue;
        const group = e._beam ? e._beam.events : [e];
        if (staff === 'rhythm') {
          e._up = true;
          continue;
        }
        let far = 0;
        for (const g of group) for (const n of g._notes) if (Math.abs(n.d - mid) > Math.abs(far)) far = n.d - mid;
        e._up = far <= 0;
      }
    }
    // Highest note on the top staff (the timing meter docks above it when there is room).
    this._maxD = null;
    for (const e of evs) if (e.staff === p.staves[0] && !e.rest && e._notes) for (const n of e._notes) this._maxD = Math.max(this._maxD ?? -99, n.d);
    // Ties
    const byId = new Map(evs.map((e) => [e.id, e]));
    for (const e of evs) if (e.tieNext) e._tieTo = byId.get(e.tieNext);
  }

  _y(staff, d) {
    const s = STAFF[staff];
    return this.staffY[staff] + ((s.top - d) * this.sp) / 2;
  }

  // ------------------------------------------------------------------------------------------
  draw(state) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    this._now = state.nowBeat;
    if (this.piece && this.opts.showStaff && this.L.staff.h > 0) {
      const c = this.L.staff;
      // paper card with a 3D bottom edge
      ctx.fillStyle = COLORS.paperEdge;
      roundRect(ctx, c.x, c.y + 5, c.w, c.h, 22);
      ctx.fill();
      ctx.fillStyle = COLORS.paper;
      roundRect(ctx, c.x, c.y, c.w, c.h, 22);
      ctx.fill();
      ctx.save();
      roundRect(ctx, c.x + 1, c.y + 1, c.w - 2, c.h - 2, 21);
      ctx.clip();
      ctx.translate(c.x, c.y);
      this._drawStaff(state);
      ctx.restore();
      ctx.strokeStyle = COLORS.paperLine;
      ctx.lineWidth = 2;
      roundRect(ctx, c.x + 1, c.y + 1, c.w - 2, c.h - 2, 21);
      ctx.stroke();
    }
    if (this.opts.showFalling && this.L.fall.h > 0) this._drawFalling(state);
    this._drawKeyboard(state);
    if (state.timingMeter) this._drawTimingMeter(state.timingMeter);
    this._drawFx();
  }

  _noteColor(state, e, n) {
    const st = state.status && state.status.get(`${e.id}:${n.midi}`);
    if (st) {
      if (st.s === 'hit') {
        if (state.waitMode) return STAFF_GRADE.great;
        if (st.grade === 'perfect') return STAFF_GRADE.perfect;
        if (st.grade === 'great') return STAFF_GRADE.great;
        return st.err < 0 ? STAFF_GRADE.early : STAFF_GRADE.late;
      }
      if (st.s === 'miss') return STAFF_GRADE.miss;
    }
    return null;
  }

  _drawStaff(state) {
    const ctx = this.ctx;
    const p = this.piece;
    const { w, h } = this.L.staff;
    const sp = this.sp;
    // paper
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    const now = state.nowBeat;
    // Noteheads are centred on their moment in time; bar lines sit just before the downbeat.
    const X = (beat) => this.playheadX + (beat - now) * this.pxPerBeat - sp * 0.59;

    // staff lines
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(1, sp * 0.1);
    for (const staff of p.staves) {
      const s = STAFF[staff];
      ctx.beginPath();
      if (staff === 'rhythm') {
        const y = this._y(staff, 34);
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      } else
        for (let d = s.bottom; d <= s.top; d += 2) {
          const y = this._y(staff, d);
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
      ctx.stroke();
    }
    const topY = this._y(p.staves[0], STAFF[p.staves[0]].top);
    const botStaff = p.staves[p.staves.length - 1];
    const botY = this._y(botStaff, STAFF[botStaff].bottom);

    // bar lines
    ctx.lineWidth = Math.max(1, sp * 0.12);
    for (let m = 0; m <= p.measures; m++) {
      const x = X(m * p.beatsPer) - sp * (m === p.measures ? 0.2 : 2.0);
      if (x < this.headerW - 4 || x > w + 4) continue;
      const y0 = p.staves[0] === 'rhythm' ? topY - 2 * sp : topY;
      const y1 = p.staves[0] === 'rhythm' ? botY + 2 * sp : botY;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
      if (m === p.measures) {
        ctx.fillStyle = COLORS.ink;
        ctx.fillRect(x + sp * 0.35, y0, sp * 0.45, y1 - y0);
      }
    }

    // playhead band
    ctx.fillStyle = 'rgba(111,75,242,0.10)';
    ctx.fillRect(this.playheadX - sp * 1.2, 0, sp * 2.4, h);

    // events
    const visLo = now - (this.playheadX - this.headerW) / this.pxPerBeat - 1;
    const visHi = now + (w - this.playheadX) / this.pxPerBeat + 1;
    const drawn = [];
    for (const e of p.events) {
      if (e.beat + e.dur < visLo || e.beat > visHi) continue;
      const x = X(e.beat) + (e.measureRest ? ((p.beatsPer / 2) * this.pxPerBeat - sp * 0.6) : 0);
      if (e.rest) this._drawRest(e, x);
      else drawn.push(this._drawChord(state, e, x));
    }
    // beams (after heads so we know stem ends)
    const beams = new Set(drawn.filter((d) => d && d.e._beam).map((d) => d.e._beam));
    for (const g of beams) this._drawBeam(state, g, X);
    // flags / stems for unbeamed
    for (const d of drawn) if (d && !d.e._beam) this._drawStemFlag(d);
    // ties
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(1, sp * 0.14);
    for (const d of drawn) {
      if (!d || !d.e._tieTo) continue;
      const x1 = X(d.e._tieTo.beat);
      for (const n of d.e._notes) {
        const y = this._y(d.e.staff, n.d);
        const dir = d.e._up ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(d.x + sp * 1.3, y + dir * sp * 0.6);
        ctx.quadraticCurveTo((d.x + x1) / 2 + sp * 0.6, y + dir * sp * 1.6, x1 - sp * 0.1, y + dir * sp * 0.6);
        ctx.stroke();
      }
    }

    // wrong-note ghosts (what the player actually played)
    if (state.wrongMarks) {
      for (const wm of state.wrongMarks) {
        const x = X(wm.beat);
        if (x < this.headerW || x > w) continue;
        const staff = p.staves.includes('treble') && (wm.midi >= 60 || !p.staves.includes('bass')) ? 'treble' : p.staves.includes('bass') ? 'bass' : p.staves[0];
        const d = staff === 'rhythm' ? 34 : diatonic(p.key.spell(wm.midi));
        const y = this._y(staff, d);
        ctx.globalAlpha = Math.max(0, 1 - wm.age / 2.5) * 0.85;
        this._ledger(staff, d, x, COLORS.wrong);
        ctx.fillStyle = COLORS.wrong;
        this._glyph('noteheadBlack', x, y);
        ctx.globalAlpha = 1;
      }
    }

    // header: clefs, key and time signature on a fixed panel
    const hw = this.headerW;
    const grad = ctx.createLinearGradient(hw - sp, 0, hw + sp * 2, 0);
    grad.addColorStop(0, COLORS.paper);
    grad.addColorStop(1, 'rgba(255,252,244,0)');
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, hw - sp, h);
    ctx.fillStyle = grad;
    ctx.fillRect(hw - sp, 0, sp * 3, h);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(1, sp * 0.1);
    for (const staff of p.staves) {
      const s = STAFF[staff];
      ctx.beginPath();
      if (staff === 'rhythm') {
        const y = this._y(staff, 34);
        ctx.moveTo(0, y);
        ctx.lineTo(hw, y);
      } else
        for (let d = s.bottom; d <= s.top; d += 2) {
          const y = this._y(staff, d);
          ctx.moveTo(sp * 0.6, y);
          ctx.lineTo(hw, y);
        }
      ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      let x = sp * 1.1;
      if (staff === 'treble') this._glyph('gClef', x, this._y(staff, 32));
      else if (staff === 'bass') this._glyph('fClef', x, this._y(staff, 24));
      else {
        ctx.fillRect(x + sp * 0.5, this._y(staff, 34) - sp, sp * 0.35, sp * 2);
        ctx.fillRect(x + sp * 1.2, this._y(staff, 34) - sp, sp * 0.35, sp * 2);
      }
      x += sp * 3.4;
      const f = p.key.fifths;
      if (staff !== 'rhythm' && f !== 0) {
        const list = f > 0 ? SHARP_POS[staff] : FLAT_POS[staff];
        for (let i = 0; i < Math.abs(f); i++) {
          this._glyph(f > 0 ? 'accidentalSharp' : 'accidentalFlat', x, this._y(staff, list[i]));
          x += sp * 1.05;
        }
        x += sp * 0.4;
      }
      // time signature
      const cy = staff === 'rhythm' ? this._y(staff, 34) : this._y(staff, s.middle);
      this._digits(String(p.ts.num), x, cy - sp);
      this._digits(String(p.ts.den), x, cy + sp);
    }
    // brace-ish connector
    if (p.staves.length === 2) {
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(sp * 0.45, topY, sp * 0.18, botY - topY);
    }

    // playhead line with a small marker on top
    const phTop = Math.max(sp * 0.5, topY - sp * 1.6),
      phBot = Math.min(h - sp * 0.5, botY + sp * 1.6);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = COLORS.playhead;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.playheadX, phTop);
    ctx.lineTo(this.playheadX, phBot);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.playhead;
    ctx.beginPath();
    ctx.moveTo(this.playheadX - 8, phTop - 8);
    ctx.lineTo(this.playheadX + 8, phTop - 8);
    ctx.lineTo(this.playheadX, phTop + 1);
    ctx.closePath();
    ctx.fill();
  }

  _digits(str, x, cy) {
    let xx = x;
    for (const ch of str) {
      const g = `timeSig${ch}`;
      if (!GLYPHS[g]) continue;
      this._glyph(g, xx, cy);
      xx += GLYPHS[g].w * this.sp;
    }
  }

  _glyph(name, x, y, scale = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(this.sp * scale, this.sp * scale);
    ctx.fill(glyph(name));
    ctx.restore();
  }

  _ledger(staff, d, x, color) {
    if (staff === 'rhythm') return;
    const s = STAFF[staff];
    const ctx = this.ctx;
    const sp = this.sp;
    ctx.strokeStyle = color || COLORS.ink;
    ctx.lineWidth = Math.max(1, sp * 0.11);
    ctx.beginPath();
    for (let l = s.top + 2; l <= d; l += 2) {
      const y = this._y(staff, l);
      ctx.moveTo(x - sp * 0.4, y);
      ctx.lineTo(x + sp * 1.6, y);
    }
    for (let l = s.bottom - 2; l >= d; l -= 2) {
      const y = this._y(staff, l);
      ctx.moveTo(x - sp * 0.4, y);
      ctx.lineTo(x + sp * 1.6, y);
    }
    ctx.stroke();
  }

  _drawChord(state, e, x) {
    const ctx = this.ctx;
    const sp = this.sp;
    const staff = e.staff;
    const head = e._base >= 4 ? 'noteheadWhole' : e._base >= 2 ? 'noteheadHalf' : 'noteheadBlack';
    const hw = GLYPHS[head].w * sp;
    const notes = e._notes;
    // Seconds within a chord: displace alternate heads to the other side of the stem.
    const offsets = notes.map(() => 0);
    for (let i = 1; i < notes.length; i++) {
      if (notes[i].d - notes[i - 1].d === 1 && offsets[i - 1] === 0) offsets[i] = e._up ? hw - sp * 0.1 : -(hw - sp * 0.1);
    }
    let accCol = 0;
    let lastAccD = null;
    const inWait = state.waitMode && state.waitEvents && state.waitEvents.has(e.id);
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const y = this._y(staff, n.d);
      const col = this._noteColor(state, e, n) || (inWait ? COLORS.playhead : COLORS.ink);
      this._ledger(staff, n.d, x + offsets[i], COLORS.ink);
      ctx.fillStyle = col;
      if (n.acc) {
        if (lastAccD !== null && lastAccD - n.d < 6) accCol++;
        else accCol = 0;
        lastAccD = n.d;
        this._glyph(n.acc, x - sp * (1.35 + accCol * 1.1), y);
      }
      this._glyph(head, x + offsets[i], y);
      if (e._dots) {
        const dy = n.d % 2 === 0 ? -sp * 0.5 : 0;
        this._glyph('augmentationDot', x + hw + sp * 0.35, y + dy);
      }
      if (this.opts.showNames && staff !== 'rhythm') {
        ctx.fillStyle = head === 'noteheadBlack' ? '#fff' : col;
        ctx.font = `800 ${Math.round(sp * 0.82)}px ${COLORS.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.name, x + offsets[i] + hw / 2, y + sp * 0.04);
      }
    }
    // fingering
    if (this.opts.showFingers && e.fingers && e.fingers.some((f) => f)) {
      ctx.fillStyle = e.hand === 'R' ? '#4F30C9' : '#0B8C7E';
      ctx.font = `600 ${Math.round(sp * 1.15)}px ${COLORS.fontDisplay}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const s = STAFF[staff];
      if (e.hand === 'R') {
        const top = Math.max(notes[notes.length - 1].d + (e._up ? 8 : 3), s.top + 3);
        ctx.fillText(e.fingers.filter(Boolean).join(''), x + hw / 2, this._y(staff, top));
      } else {
        const bot = Math.min(notes[0].d - (e._up ? 3 : 8), s.bottom - 3);
        ctx.fillText(e.fingers.filter(Boolean).join(''), x + hw / 2, this._y(staff, bot));
      }
    }
    if (e._base >= 4) return null;
    const colTop = this._noteColor(state, e, notes[notes.length - 1]) || (inWait ? COLORS.playhead : COLORS.ink);
    return {
      e, x, hw,
      yTop: this._y(staff, notes[notes.length - 1].d),
      yBot: this._y(staff, notes[0].d),
      color: colTop,
    };
  }

  _stemX(d) {
    return d.e._up ? d.x + d.hw - this.sp * 0.06 : d.x + this.sp * 0.06;
  }

  _drawStemFlag(d) {
    const ctx = this.ctx;
    const sp = this.sp;
    const e = d.e;
    const len = sp * 3.4;
    const sx = this._stemX(d);
    const y0 = e._up ? d.yBot : d.yTop;
    const y1 = e._up ? d.yTop - len : d.yBot + len;
    ctx.fillStyle = d.color;
    ctx.fillRect(sx - sp * 0.06, Math.min(y0, y1), sp * 0.12, Math.abs(y1 - y0));
    if (e._base <= 0.5) {
      const fl = e._base <= 0.25 ? (e._up ? 'flag16thUp' : 'flag16thDown') : e._up ? 'flag8thUp' : 'flag8thDown';
      this._glyph(fl, sx - sp * 0.06, y1);
    }
  }

  _drawBeam(state, g, X) {
    const ctx = this.ctx;
    const sp = this.sp;
    const evs = g.events;
    const up = evs[0]._up;
    const pts = evs.map((e) => {
      const hw = GLYPHS.noteheadBlack.w * sp;
      const x = X(e.beat);
      const top = this._y(e.staff, e._notes[e._notes.length - 1].d);
      const bot = this._y(e.staff, e._notes[0].d);
      return { e, x: up ? x + hw - sp * 0.06 : x + sp * 0.06, top, bot };
    });
    const len = sp * 3.3;
    let y0 = up ? pts[0].top - len : pts[0].bot + len;
    let y1 = up ? pts[pts.length - 1].top - len : pts[pts.length - 1].bot + len;
    const maxSlope = sp * 1;
    if (y1 - y0 > maxSlope) y1 = y0 + maxSlope;
    if (y0 - y1 > maxSlope) y1 = y0 - maxSlope;
    const xa = pts[0].x,
      xb = pts[pts.length - 1].x;
    const at = (x) => (xb === xa ? y0 : y0 + ((y1 - y0) * (x - xa)) / (xb - xa));
    // make sure every stem is long enough
    let shift = 0;
    for (const p of pts) {
      const by = at(p.x);
      if (up) shift = Math.min(shift, p.top - sp * 2.5 - by);
      else shift = Math.max(shift, p.bot + sp * 2.5 - by);
    }
    y0 += shift;
    y1 += shift;
    const beamY = (x) => (xb === xa ? y0 : y0 + ((y1 - y0) * (x - xa)) / (xb - xa));
    const color = COLORS.ink;
    // stems
    for (const p of pts) {
      const col = this._noteColor(state, p.e, p.e._notes[p.e._notes.length - 1]) || color;
      ctx.fillStyle = col;
      const yStart = up ? p.bot : p.top;
      const yEnd = beamY(p.x);
      ctx.fillRect(p.x - sp * 0.06, Math.min(yStart, yEnd), sp * 0.12, Math.abs(yEnd - yStart));
    }
    ctx.fillStyle = color;
    const th = sp * 0.5;
    const beam = (xA, xB, off) => {
      const d = up ? off : -off;
      ctx.beginPath();
      ctx.moveTo(xA - sp * 0.06, beamY(xA) + d);
      ctx.lineTo(xB + sp * 0.06, beamY(xB) + d);
      ctx.lineTo(xB + sp * 0.06, beamY(xB) + d + (up ? th : -th));
      ctx.lineTo(xA - sp * 0.06, beamY(xA) + d + (up ? th : -th));
      ctx.closePath();
      ctx.fill();
    };
    beam(xa, xb, 0);
    // secondary beams for sixteenths
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].e._base > 0.25) continue;
      const prev = i > 0 && pts[i - 1].e._base <= 0.25;
      const next = i < pts.length - 1 && pts[i + 1].e._base <= 0.25;
      if (next) beam(pts[i].x, pts[i + 1].x, sp * 0.75);
      else if (!prev) {
        const stub = sp * 1.1;
        if (i > 0) beam(pts[i].x - stub, pts[i].x, sp * 0.75);
        else beam(pts[i].x, pts[i].x + stub, sp * 0.75);
      }
    }
    // tuplet number
    if (evs[0].tuplet) {
      ctx.font = `italic 700 ${Math.round(sp * 1.2)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const mx = (xa + xb) / 2;
      ctx.fillText('3', mx, beamY(mx) + (up ? -sp * 0.9 : sp * 0.9));
    }
  }

  _drawRest(e, x) {
    const sp = this.sp;
    const staff = e.staff;
    const s = STAFF[staff];
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.inkSoft.replace('0.35', '0.9');
    const b = e._base;
    const mid = this._y(staff, s.middle);
    let g;
    let y = mid;
    if (b >= 4 || e.measureRest) {
      g = 'restWhole';
      y = this._y(staff, staff === 'rhythm' ? 34 : s.middle + 2);
    } else if (b >= 2) g = 'restHalf';
    else if (b >= 1) g = 'restQuarter';
    else if (b >= 0.5) g = 'rest8th';
    else g = 'rest16th';
    this._glyph(g, x, y);
    if (e._dots) this._glyph('augmentationDot', x + GLYPHS[g].w * sp + sp * 0.3, mid - sp * 0.5);
  }

  // ------------------------------------------------------------------------------------------
  _drawFalling(state) {
    const ctx = this.ctx;
    const { x: fx, y: fy, w, h } = this.L.fall;
    const bottom = fy + h;
    // lane bed with rounded top corners
    ctx.fillStyle = COLORS.lane;
    roundRect(ctx, fx, fy, w, h + 2, [22, 22, 0, 0]);
    ctx.fill();
    ctx.save();
    roundRect(ctx, fx, fy, w, h + 2, [22, 22, 0, 0]);
    ctx.clip();
    // octave (C) and F guide lanes
    for (const [m, k] of this.keys) {
      if (m % 12 === 0) {
        ctx.fillStyle = COLORS.laneC;
        ctx.fillRect(k.x - 1, fy, 2, h);
      } else if (m % 12 === 5) {
        ctx.fillStyle = COLORS.laneLine;
        ctx.fillRect(k.x - 0.5, fy, 1, h);
      }
    }
    const p = this.piece;
    const r = Math.max(4, Math.min(12, this.whiteW * 0.24));
    if (!p) {
      // Free play: everything heard rises up from the keys like a piano roll.
      const pps = h / 5;
      const now = state.nowSec || 0;
      for (const n of state.history || []) {
        const k = this.keys.get(n.midi);
        if (!k) continue;
        const yTop = bottom - (now - n.on) * pps; // the attack rises first
        const yBot = bottom - (now - (n.off ?? now)) * pps;
        if (yBot < fy) continue;
        const top = Math.max(fy, yTop);
        ctx.globalAlpha = n.off ? 0.75 : 1;
        this._noteBlock(k, top, Math.max(6, yBot - top), noteColor(n.midi), noteEdge(n.midi), r);
        ctx.globalAlpha = 1;
      }
      this._drawTrails(state, fy, bottom);
      ctx.restore();
      this._hitLine(bottom);
      return;
    }
    const now = state.nowBeat;
    const lookBeats = Math.max(2, (state.lookaheadSec || 3) * (p.bpm / 60));
    const pxb = h / lookBeats;
    // beat / bar lines
    for (let b = Math.ceil(now); b < now + lookBeats; b++) {
      const y = bottom - (b - now) * pxb;
      const bar = b % p.beatsPer === 0;
      ctx.fillStyle = bar ? '#E4D5BC' : '#EFE5D5';
      ctx.fillRect(fx, y - (bar ? 1.5 : 0.5), w, bar ? 3 : 1);
    }
    const key = p.key;
    for (const n of p.notes) {
      if (n.beat > now + lookBeats || n.beat + n.dur < now - 0.5) continue;
      const k = this.keys.get(n.midi);
      if (!k) continue;
      const y1 = bottom - (n.beat - now) * pxb;
      const y0 = bottom - (n.beat + n.dur - now) * pxb;
      const st = state.status && state.status.get(n.id);
      let col, edge;
      if (p.rhythmOnly) [col, edge] = [COLORS.rh, COLORS.rhEdge];
      else if (this.opts.noteColors) [col, edge] = [noteColor(n.midi, key), noteEdge(n.midi, key)];
      else [col, edge] = n.hand === 'L' ? [COLORS.lh, COLORS.lhEdge] : [COLORS.rh, COLORS.rhEdge];
      if (st && st.s === 'miss') [col, edge] = [COLORS.coral, COLORS.coralEdge];
      const top = Math.max(fy - 20, y0 + 2),
        bot = Math.min(bottom, y1 - 2);
      if (bot <= top) continue;
      ctx.globalAlpha = st && st.s === 'hit' ? 0.35 : st && st.s === 'miss' ? 0.6 : 1;
      this._noteBlock(k, top, bot - top, col, edge, r);
      // left-hand notes in colour mode get a small dark stripe
      if (this.opts.noteColors && n.hand === 'L' && !p.rhythmOnly && bot - top > 12) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        roundRect(ctx, k.x + (k.black ? 2 : 6), top + 6, 3, bot - top - 12, 1.5);
        ctx.fill();
      }
      if (this.opts.showNames && !p.rhythmOnly && bot - top >= 30 && k.w > 14) {
        const rr = Math.min(12.5, k.w * 0.3);
        const cx = k.x + k.w / 2,
          cy = bot - rr - 5;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.ink;
        ctx.font = `600 ${Math.round(rr * 1.4)}px ${COLORS.fontDisplay}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(noteName(n.midi, key).replace(/-?\d+$/, ''), cx, cy + 1);
      }
      ctx.globalAlpha = 1;
    }
    // fade notes in at the top of the lanes
    const g = ctx.createLinearGradient(0, fy, 0, fy + Math.min(40, h * 0.14));
    g.addColorStop(0, hexA(COLORS.lane, 1));
    g.addColorStop(1, hexA(COLORS.lane, 0));
    ctx.fillStyle = g;
    ctx.fillRect(fx, fy, w, Math.min(40, h * 0.14));
    this._drawTrails(state, fy, bottom);
    ctx.restore();
    this._hitLine(bottom);
  }

  _noteBlock(k, top, hh, col, edge, r) {
    const ctx = this.ctx;
    const pad = k.black ? 1 : Math.max(2, k.w * 0.1);
    const x = k.x + pad,
      ww = k.w - pad * 2;
    const rr = Math.min(r, ww / 2, hh / 2);
    ctx.fillStyle = edge;
    roundRect(ctx, x, top + 3, ww, hh, rr);
    ctx.fill();
    ctx.fillStyle = col;
    roundRect(ctx, x, top, ww, Math.max(2, hh - 1), rr);
    ctx.fill();
    if (hh > 14 && ww > 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, x + 5, top + 4, Math.max(2, ww - 10), 4, 2);
      ctx.fill();
    }
  }

  _hitLine(y) {
    const ctx = this.ctx;
    const { x, w } = this.L.fall;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(111,75,242,0.35)');
    g.addColorStop(0.5, 'rgba(111,75,242,0.75)');
    g.addColorStop(1, 'rgba(111,75,242,0.35)');
    ctx.fillStyle = g;
    roundRect(ctx, x, y - 3, w, 5, 2.5);
    ctx.fill();
  }

  // Short upward glows for notes the listener hears right now.
  _drawTrails(state, fy, bottom) {
    if (!state.heard) return;
    const ctx = this.ctx;
    for (const [m, info] of state.heard) {
      const k = this.keys.get(m);
      if (!k) continue;
      const col = info.kind === 'good' ? COLORS.mint : info.kind === 'bad' ? COLORS.coral : this.opts.noteColors ? noteColor(m) : COLORS.rh;
      const g = ctx.createLinearGradient(0, bottom - 70, 0, bottom);
      g.addColorStop(0, hexA(col, 0));
      g.addColorStop(1, hexA(col, 0.45));
      ctx.fillStyle = g;
      ctx.fillRect(k.x + 1, Math.max(fy, bottom - 70), k.w - 2, Math.min(70, bottom - fy));
    }
  }

  _drawKeyboard(state) {
    const ctx = this.ctx;
    const { x: kx, y, h, w } = this.L.kb;
    const hints = state.hints || new Map();
    const heard = state.heard || new Map();
    const felt = 6;
    const bh = h * 0.6;
    const key = this.piece && this.piece.key;
    ctx.fillStyle = COLORS.playhead;
    roundRect(ctx, kx, y - 2, w, felt + 2, 3);
    ctx.fill();
    const prep = state.prep || null;
    const drawWhite = (m, k) => {
      const info = heard.get(m);
      const hint = this.opts.showHints ? hints.get(m) : null;
      const pk = prep ? prep.keys.get(m) : null;
      const pressed = !!info;
      const dy = pressed ? 3 : 0;
      let fill = '#fff',
        edge = COLORS.keyEdge;
      if (pressed) {
        if (info.kind === 'bad') [fill, edge] = ['#FFE3E6', COLORS.coralEdge];
        else if (info.kind === 'good') [fill, edge] = this.opts.noteColors ? [noteColor(m, key), noteEdge(m, key)] : hint === 'L' ? [COLORS.lh, COLORS.lhEdge] : [COLORS.rh, COLORS.rhEdge];
        else [fill, edge] = [COLORS.brandSoft, '#C9BCF5'];
      } else if (pk) fill = pk.hand === 'L' ? '#D5F5F1' : COLORS.brandSoft;
      else if (hint && !this.opts.noteColors) fill = hint === 'L' ? '#D5F5F1' : COLORS.brandSoft;
      ctx.fillStyle = edge;
      roundRect(ctx, k.x + 1.5, y + felt + dy, k.w - 3, h - felt - dy, [0, 0, 9, 9]);
      ctx.fill();
      ctx.fillStyle = fill;
      roundRect(ctx, k.x + 1.5, y + felt - 2 + dy, k.w - 3, h - felt - 5, [0, 0, 9, 9]);
      ctx.fill();
      if (!pressed) {
        const g = ctx.createLinearGradient(0, y + felt, 0, y + felt + 14);
        g.addColorStop(0, 'rgba(42,35,70,0.07)');
        g.addColorStop(1, 'rgba(42,35,70,0)');
        ctx.fillStyle = g;
        ctx.fillRect(k.x + 1.5, y + felt, k.w - 3, 14);
      }
      if (pk && !pressed && k.w > 16) {
        this._fingerDisc(m, k, pk, y + h - Math.min(14, k.w * 0.3) - 12, key);
        return;
      }
      const showDisc = (hint && this.opts.showHints) || (pressed && info.kind === 'good');
      if (showDisc && k.w > 16) {
        const rr = Math.min(14, k.w * 0.3);
        const cx = k.x + k.w / 2,
          cy = y + h - rr - 12 + dy;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fill();
        if (!pressed) {
          ctx.strokeStyle = this.opts.noteColors ? noteColor(m, key) : hint === 'L' ? COLORS.lh : COLORS.rh;
          ctx.lineWidth = 3.5;
          ctx.stroke();
        }
        ctx.fillStyle = COLORS.ink;
        ctx.font = `600 ${Math.round(rr * 1.25)}px ${COLORS.fontDisplay}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(key ? noteName(m, key).replace(/-?\d+$/, '') : STEP_LETTERS[m % 12], cx, cy + 1);
      } else if (m % 12 === 0 && k.w > 14) {
        ctx.fillStyle = pressed ? COLORS.ink : '#A79B86';
        ctx.font = `800 ${Math.round(Math.min(k.w * 0.34, 13))}px ${COLORS.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`C${m / 12 - 1}`, k.x + k.w / 2, y + h - 12 + dy);
      }
    };
    const drawBlack = (m, k) => {
      const info = heard.get(m);
      const hint = this.opts.showHints ? hints.get(m) : null;
      let top = '#3E3A78',
        bottomCol = '#27244F';
      if (info) {
        const c = info.kind === 'bad' ? COLORS.coral : info.kind === 'good' ? (this.opts.noteColors ? noteColor(m, key) : COLORS.rh) : '#8F7BF5';
        top = bottomCol = c;
      } else if (prep && prep.keys.get(m)) top = bottomCol = prep.keys.get(m).hand === 'L' ? COLORS.lhEdge : COLORS.rhEdge;
      else if (hint) top = bottomCol = this.opts.noteColors ? noteEdge(m, key) : hint === 'L' ? COLORS.lhEdge : COLORS.rhEdge;
      ctx.fillStyle = '#1B1938';
      roundRect(ctx, k.x, y + felt - 2, k.w, bh + 4, [0, 0, 6, 6]);
      ctx.fill();
      const g = ctx.createLinearGradient(0, y, 0, y + bh);
      g.addColorStop(0, top);
      g.addColorStop(1, bottomCol);
      ctx.fillStyle = g;
      roundRect(ctx, k.x + 1, y + felt - 3, k.w - 2, bh - 3, [0, 0, 6, 6]);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, k.x + 4, y + felt + bh - 20, Math.max(1, k.w - 8), 5, 2.5);
      ctx.fill();
      const pk = prep && !info ? prep.keys.get(m) : null;
      if (pk && pk.finger && k.w > 10) {
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.round(Math.min(18, k.w * 0.62))}px ${COLORS.fontDisplay}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(pk.finger), k.x + k.w / 2, y + felt + bh - 34);
      }
    };
    for (const [m, k] of this.keys) if (!k.black) drawWhite(m, k);
    if (prep) this._prepGlow(prep, false);
    for (const [m, k] of this.keys) if (k.black) drawBlack(m, k);
    if (prep) {
      this._prepGlow(prep, true);
      this._drawPrep(prep);
    }
  }

  // Pulsing outline on the first notes to play (white keys under the black ones).
  _prepGlow(prep, black) {
    const ctx = this.ctx;
    const { y } = this.L.kb;
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 5);
    for (const [m, pk] of prep.keys) {
      const k = this.keys.get(m);
      if (!pk.first || !k || k.black !== black) continue;
      const col = prep.anyKey != null ? COLORS.sun : pk.hand === 'L' ? COLORS.lh : COLORS.rh;
      const bh = this.L.kb.h * (k.black ? 0.6 : 1);
      ctx.strokeStyle = hexA(col, 0.45 + 0.45 * pulse);
      ctx.lineWidth = 3 + 3 * pulse;
      roundRect(ctx, k.x - 1, y + 2, k.w + 2, bh - 4, [4, 4, 10, 10]);
      ctx.stroke();
    }
  }

  // A white key in the "get ready" hand position: finger number in a disc of the hand's colour,
  // with the note's letter above it.
  _fingerDisc(m, k, pk, cy, key) {
    const ctx = this.ctx;
    const col = pk.hand === 'L' ? COLORS.lh : COLORS.rh;
    const rr = Math.min(15, k.w * 0.32);
    const cx = k.x + k.w / 2;
    ctx.fillStyle = pk.finger ? col : '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
    if (!pk.finger) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pk.finger ? '#fff' : COLORS.ink;
    ctx.font = `700 ${Math.round(rr * 1.25)}px ${COLORS.fontDisplay}`;
    ctx.fillText(pk.finger ? String(pk.finger) : key ? noteName(m, key).replace(/-?\d+$/, '') : STEP_LETTERS[m % 12], cx, cy + 1);
    if (pk.finger) {
      ctx.fillStyle = COLORS.ink;
      ctx.font = `800 ${Math.round(Math.min(16, k.w * 0.3))}px ${COLORS.font}`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(key ? noteName(m, key).replace(/-?\d+$/, '') : STEP_LETTERS[m % 12], cx, cy - rr - 5);
    }
  }

  // "Get ready" extras: a bracket naming each hand over its position, an "ANY KEY" tag for
  // rhythm drills and a "middle C" flag for beginners.
  _drawPrep(prep) {
    const ctx = this.ctx;
    const { y } = this.L.kb;
    // Bracket per hand above its keys.
    const byHand = new Map();
    for (const [m, pk] of prep.keys) {
      const k = this.keys.get(m);
      if (!k) continue;
      const b = byHand.get(pk.hand) || { x0: Infinity, x1: -Infinity };
      b.x0 = Math.min(b.x0, k.x);
      b.x1 = Math.max(b.x1, k.x + k.w);
      byHand.set(pk.hand, b);
    }
    const by = y - 34;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [hand, b] of byHand) {
      if (prep.anyKey != null) break;
      const col = hand === 'L' ? COLORS.lh : COLORS.rh;
      const label = hand === 'L' ? 'LEFT HAND' : 'RIGHT HAND';
      ctx.font = `800 13px ${COLORS.font}`;
      const lw = ctx.measureText(label).width + 22;
      const x0 = b.x0 + 3;
      const x1 = Math.max(b.x1 - 3, x0 + lw);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, by + 18);
      ctx.lineTo(x0, by + 11);
      ctx.lineTo(x1, by + 11);
      ctx.lineTo(x1, by + 18);
      ctx.stroke();
      const cx = (x0 + x1) / 2;
      ctx.fillStyle = col;
      roundRect(ctx, cx - lw / 2, by, lw, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, cx, by + 11.5);
    }
    if (prep.anyKey != null) {
      const k = this.keys.get(prep.anyKey);
      if (k) this._flag(k.x + k.w / 2, by, 'ANY KEY', COLORS.sun, COLORS.ink);
    }
    if (prep.middleC && this.keys.get(60) && !(prep.keys.has(60) && prep.anyKey == null)) {
      const k = this.keys.get(60);
      this._flag(k.x + k.w / 2, by, 'MIDDLE C', '#fff', COLORS.ink, COLORS.inkSoft);
    }
  }

  _flag(cx, y, text, bg, ink, stroke) {
    const ctx = this.ctx;
    ctx.font = `800 13px ${COLORS.font}`;
    const w = ctx.measureText(text).width + 22;
    ctx.fillStyle = bg;
    roundRect(ctx, cx - w / 2, y, w, 22, 11);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - 6, y + 21);
    ctx.lineTo(cx + 6, y + 21);
    ctx.lineTo(cx, y + 29);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + 11.5);
  }
}

const STEP_LETTERS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
  else ctx.rect(x, y, w, h);
}

// '#RRGGBB' + alpha -> rgba()
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// A 4-point sparkle centred at (x, y).
function sparkle(ctx, x, y, r) {
  const q = r * 0.3;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + q, y - q);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + q, y + q);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - q, y + q);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - q, y - q);
  ctx.closePath();
  ctx.fill();
}

// A small arrow for the meter labels (dir -1 = left / early, +1 = right / late).
function arrow(ctx, x, y, dir, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 5 * dir * -1, y);
  ctx.lineTo(x + 5 * dir, y);
  ctx.moveTo(x + 1 * dir, y - 4);
  ctx.lineTo(x + 5 * dir, y);
  ctx.lineTo(x + 1 * dir, y + 4);
  ctx.stroke();
  ctx.restore();
}
