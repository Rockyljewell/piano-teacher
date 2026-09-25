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
  paper: '#fbf7ee',
  ink: '#1d1b26',
  inkSoft: 'rgba(29,27,38,0.35)',
  rh: '#3b8cff',
  lh: '#ff9f1c',
  hit: '#1fbf6a',
  near: '#e0a800',
  miss: '#ef476f',
  wrong: '#ef476f',
  playhead: '#3b8cff',
  bg: '#0e1120',
  lane: '#151a2e',
  laneLine: 'rgba(255,255,255,0.05)',
};

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
    this.opts = { showStaff: true, showFalling: true, showNames: false, showFingers: true, showHints: true };
    this.keyFlash = new Map();
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
    const kbH = Math.min(H * 0.26, Math.max(90, (W / this._whiteCount()) * 5.2));
    let staffH = 0;
    if (showStaff) {
      const two = piece.staves.length === 2;
      staffH = showFall ? H * (two ? 0.5 : 0.36) : H - kbH;
      if (!two && piece.staves[0] === 'rhythm') staffH = showFall ? H * 0.28 : H - kbH;
    }
    const fallH = H - kbH - staffH;
    this.L = {
      staff: { x: 0, y: 0, w: W, h: staffH },
      fall: { x: 0, y: staffH, w: W, h: Math.max(0, fallH) },
      kb: { x: 0, y: H - kbH, w: W, h: kbH },
    };
    if (showStaff) {
      const two = piece.staves.length === 2;
      // staff space: grand staff spans ~ (4 + gap + 4) spaces plus room for ledger lines.
      const spans = two ? 22 : piece.staves[0] === 'rhythm' ? 8 : 13;
      this.sp = Math.max(7, Math.min(16, staffH / spans));
      const sp = this.sp;
      const midY = staffH / 2;
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
      this.playheadX = Math.max(this.headerW + sp * 6, W * 0.24);
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
    if (this.piece && this.opts.showStaff && this.L.staff.h > 0) this._drawStaff(state);
    if (this.opts.showFalling && this.L.fall.h > 0) this._drawFalling(state);
    this._drawKeyboard(state);
  }

  _noteColor(state, e, n) {
    const st = state.status && state.status.get(`${e.id}:${n.midi}`);
    if (st) {
      if (st.s === 'hit') return st.grade === 'perfect' || st.grade === 'great' || state.waitMode ? COLORS.hit : COLORS.near;
      if (st.s === 'miss') return COLORS.miss;
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
    ctx.fillStyle = 'rgba(59,140,255,0.10)';
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
    grad.addColorStop(1, 'rgba(251,247,238,0)');
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

    // playhead line
    ctx.strokeStyle = COLORS.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.playheadX, sp * 0.5);
    ctx.lineTo(this.playheadX, h - sp * 0.5);
    ctx.stroke();
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
        ctx.font = `700 ${Math.round(sp * 0.82)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.name, x + offsets[i] + hw / 2, y + sp * 0.04);
      }
    }
    // fingering
    if (this.opts.showFingers && e.fingers && e.fingers.some((f) => f)) {
      ctx.fillStyle = e.hand === 'R' ? '#1a5fd0' : '#c46a00';
      ctx.font = `700 ${Math.round(sp * 1.1)}px system-ui, sans-serif`;
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
    const { y: fy, w, h } = this.L.fall;
    const bottom = fy + h;
    ctx.fillStyle = COLORS.lane;
    ctx.fillRect(0, fy, w, h);
    // lanes for C and F (octave landmarks)
    ctx.strokeStyle = COLORS.laneLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [m, k] of this.keys) {
      if (m % 12 === 0 || m % 12 === 5) {
        ctx.moveTo(k.x + 0.5, fy);
        ctx.lineTo(k.x + 0.5, bottom);
      }
    }
    ctx.stroke();
    const p = this.piece;
    if (!p) {
      // Free play: everything heard rises up from the keys like a piano roll.
      const pps = h / 5;
      const now = state.nowSec || 0;
      const r = Math.max(3, this.whiteW * 0.18);
      for (const n of state.history || []) {
        const k = this.keys.get(n.midi);
        if (!k) continue;
        const yTop = bottom - (now - n.on) * pps; // the attack rises first
        const yBot = bottom - (now - (n.off ?? now)) * pps;
        if (yBot < fy) continue;
        const top = Math.max(fy, yTop);
        ctx.fillStyle = isBlack(n.midi) ? '#6b7cff' : '#9fb3ff';
        ctx.globalAlpha = n.off ? 0.7 : 1;
        roundRect(ctx, k.x + 2, top, k.w - 4, Math.max(3, yBot - top), r);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      this._drawTrails(state, fy, bottom);
      return;
    }
    const now = state.nowBeat;
    const lookBeats = Math.max(2, (state.lookaheadSec || 3) * (p.bpm / 60));
    const pxb = h / lookBeats;
    // beat / bar lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    for (let b = Math.ceil(now); b < now + lookBeats; b++) {
      const y = bottom - (b - now) * pxb;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    for (let m = Math.ceil(now / p.beatsPer); m * p.beatsPer < now + lookBeats; m++) {
      const y = bottom - (m * p.beatsPer - now) * pxb;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    const r = Math.max(3, this.whiteW * 0.18);
    for (const n of p.notes) {
      if (n.beat > now + lookBeats || n.beat + n.dur < now - 0.5) continue;
      const k = this.keys.get(n.midi);
      if (!k) continue;
      const y1 = bottom - (n.beat - now) * pxb;
      const y0 = bottom - (n.beat + n.dur - now) * pxb;
      const st = state.status && state.status.get(n.id);
      let col = n.hand === 'L' ? COLORS.lh : COLORS.rh;
      if (p.rhythmOnly) col = COLORS.rh;
      if (st && st.s === 'hit') col = COLORS.hit;
      if (st && st.s === 'miss') col = COLORS.miss;
      const pad = k.black ? 1 : 2;
      const x = k.x + pad,
        ww = k.w - pad * 2;
      const top = Math.max(fy, y0 + 1),
        bot = Math.min(bottom, y1 - 1);
      if (bot <= top) continue;
      ctx.fillStyle = col;
      ctx.globalAlpha = st && st.s === 'hit' ? 0.55 : 0.95;
      roundRect(ctx, x, top, ww, bot - top, r);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (this.opts.showNames && bot - top > 16 && ww > 12) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = `700 ${Math.round(Math.min(ww * 0.55, 14))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(noteName(n.midi, p.key).replace(/-?\d+$/, ''), x + ww / 2, bot - 3);
      }
    }
    // now line
    ctx.fillStyle = COLORS.playhead;
    ctx.fillRect(0, bottom - 2, w, 3);
    this._drawTrails(state, fy, bottom);
  }

  // Short upward "sparks" for notes the listener hears right now.
  _drawTrails(state, fy, bottom) {
    if (!state.heard) return;
    const ctx = this.ctx;
    for (const [m, info] of state.heard) {
      const k = this.keys.get(m);
      if (!k) continue;
      const col = info.kind === 'good' ? COLORS.hit : info.kind === 'bad' ? COLORS.wrong : '#9fb3ff';
      const g = ctx.createLinearGradient(0, bottom - 60, 0, bottom);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, col);
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(k.x + 1, Math.max(fy, bottom - 60), k.w - 2, Math.min(60, bottom - fy));
      ctx.globalAlpha = 1;
    }
  }

  _drawKeyboard(state) {
    const ctx = this.ctx;
    const { y, h, w } = this.L.kb;
    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, y, w, h);
    const hints = state.hints || new Map();
    const heard = state.heard || new Map();
    const bh = h * 0.62;
    const drawKey = (m, k) => {
      const heardInfo = heard.get(m);
      const hint = this.opts.showHints ? hints.get(m) : null;
      let fill = k.black ? '#16161c' : '#f7f7f2';
      if (hint) fill = hint === 'L' ? (k.black ? '#a35f00' : '#ffd29a') : k.black ? '#1c56b8' : '#b9d6ff';
      if (heardInfo) fill = heardInfo.kind === 'good' ? COLORS.hit : heardInfo.kind === 'bad' ? COLORS.wrong : k.black ? '#6b7cff' : '#a9b6ff';
      ctx.fillStyle = fill;
      if (k.black) {
        roundRect(ctx, k.x, y, k.w, bh, [0, 0, 3, 3]);
        ctx.fill();
        if (!heardInfo) {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(k.x + k.w * 0.18, y, k.w * 0.64, bh * 0.9);
        }
      } else {
        roundRect(ctx, k.x + 1, y, k.w - 2, h - 2, [0, 0, 5, 5]);
        ctx.fill();
        if (m % 12 === 0 && k.w > 14) {
          ctx.fillStyle = heardInfo ? '#fff' : '#8a8a99';
          ctx.font = `600 ${Math.round(Math.min(k.w * 0.42, 13))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`C${m / 12 - 1}`, k.x + k.w / 2, y + h - 6);
        }
      }
    };
    for (const [m, k] of this.keys) if (!k.black) drawKey(m, k);
    for (const [m, k] of this.keys) if (k.black) drawKey(m, k);
    // top felt strip
    ctx.fillStyle = '#7a1120';
    ctx.fillRect(0, y, w, 3);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
