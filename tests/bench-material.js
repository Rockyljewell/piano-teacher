// Test material for the listening benchmark (tests/bench-listen.js). Deterministic (seeded).
//
// Every material is { name, family, notes, pedal, segs, length }:
//   notes: [{ midi, t, dur, vel, tn, g, level }]
//     t     true onset (seconds, after human timing jitter / chord spread) - what is scored
//     tn    nominal (score) time - what the practice engine would call "due" (lesson hints)
//     g     group id: notes struck together (a chord, both hands on one beat)
//     level curriculum level for lesson pieces
//   pedal:  [[down, up], ...] sustain pedal, or null
//   segs:   [{ t0, t1, range: [lo, hi], level, kind }] pieces (the lesson hint range is per piece)
//
// Families: singles, chords (dyads, triads, tetrads, octaves, octmelody, bothhands, repchords),
// lesson (the app's own generated pieces, warm-ups and rhythm drills), fast (16th scales,
// repeated notes, trills, arpeggios), pedal (broken chords under the sustain pedal).
import { rng as rng0 } from './synth-piano.js';
import { generate, generateRhythm } from '../js/music/generator.js';

const LEAD = 1.2; // seconds of room before the first note (the listener calibrates on 0..0.4 s)
let SEED = 0; // materials({ seed }): a different but equivalent set (e.g. for fitting)
const rng = (n) => rng0(n + SEED * 7919);

function finishMat(name, family, notes, { pedal = null, segs = null, tail = 1.5 } = {}) {
  notes.sort((a, b) => a.t - b.t);
  const lo = Math.min(...notes.map((n) => n.midi)),
    hi = Math.max(...notes.map((n) => n.midi));
  const end = Math.max(...notes.map((n) => n.t + n.dur));
  if (!segs) segs = [{ t0: 0, t1: end + tail, range: [lo, hi] }];
  return { name, family, notes, pedal, segs, length: end + tail };
}

let gid = 1;
const chordAt = (r, t, midis, vel, dur, spread = 0.015) => {
  const g = gid++;
  return midis.map((m) => ({ midi: m, t: t + (r() * 2 - 1) * spread, tn: t, dur, vel: Math.max(0.15, Math.min(0.95, vel + (r() * 2 - 1) * 0.08)), g }));
};

// ---- singles ------------------------------------------------------------------------------------
function singles(quick) {
  const r = rng(101);
  const notes = [];
  let t = LEAD;
  const vels = [0.3, 0.55, 0.8];
  if (quick) {
    // every key once, velocities cycling
    for (let m = 21; m <= 108; m++) {
      notes.push({ midi: m, t, tn: t, dur: 0.35, vel: vels[m % 3] + (r() - 0.5) * 0.06, g: gid++ });
      t += 0.6;
    }
  } else
    for (const v of vels)
      for (let m = 21; m <= 108; m++) {
        notes.push({ midi: m, t, tn: t, dur: 0.35, vel: v + (r() - 0.5) * 0.06, g: gid++ });
        t += 0.6;
      }
  return finishMat('singles', 'singles', notes);
}

// ---- chords -------------------------------------------------------------------------------------
const REG = { low: [36, 47], mid: [48, 64], high: [65, 79] };
function chords(quick) {
  const out = [];
  const k = quick ? 0.5 : 1;
  const mk = (name, seed, count, voicings, regs, { gap = 0.9, dur = 0.6 } = {}) => {
    const r = rng(seed);
    const notes = [];
    let t = LEAD;
    for (let i = 0; i < Math.round(count * k); i++) {
      const reg = REG[regs[i % regs.length]];
      const v = voicings[i % voicings.length];
      const root = reg[0] + Math.floor(r() * (reg[1] - reg[0] + 1));
      notes.push(...chordAt(r, t, v.map((x) => root + x), 0.5 + r() * 0.25, dur));
      t += gap;
    }
    out.push(finishMat(name, 'chords', notes));
  };
  mk('dyads', 201, 30, [[0, 3], [0, 4], [0, 7], [0, 8], [0, 9]], ['mid', 'low', 'mid', 'high']);
  mk('triads', 202, 36, [[0, 4, 7], [0, 3, 7], [0, 3, 8], [0, 4, 9], [0, 5, 9], [0, 5, 8]], ['mid', 'low', 'mid', 'high']);
  mk('tetrads', 203, 16, [[0, 4, 7, 10], [0, 4, 7, 11], [0, 3, 7, 10], [0, 4, 7, 12]], ['mid', 'low', 'high', 'mid']);
  mk('octaves', 204, 20, [[0, 12]], ['low', 'mid', 'high', 'mid']);
  // melodies doubled in octaves (quarter notes, one hand or both hands an octave apart)
  {
    const r = rng(205);
    const notes = [];
    let t = LEAD;
    for (let phrase = 0; phrase < (quick ? 1 : 2); phrase++) {
      let m = phrase ? 43 + Math.floor(r() * 5) : 55 + Math.floor(r() * 5);
      for (let i = 0; i < 12; i++) {
        notes.push(...chordAt(r, t, [m, m + 12], 0.55 + r() * 0.2, 0.42, 0.012));
        m += [-2, -1, 1, 2, 2, 3, -3][Math.floor(r() * 7)];
        t += 0.45;
      }
      t += 1;
    }
    out.push(finishMat('octmelody', 'chords', notes));
  }
  // both hands: LH root + fifth (or tenth), RH close triad
  {
    const r = rng(206);
    const notes = [];
    let t = LEAD;
    for (let i = 0; i < (quick ? 8 : 16); i++) {
      const root = 36 + Math.floor(r() * 10);
      const minor = r() < 0.4;
      const lh = r() < 0.7 ? [root, root + 7] : [root, root + (minor ? 15 : 16)];
      const rt = root + 24;
      const inv = [[0, minor ? 3 : 4, 7], [minor ? 3 : 4, 7, 12], [7, 12, minor ? 15 : 16]][i % 3];
      notes.push(...chordAt(r, t, [...lh, ...inv.map((x) => rt + x)], 0.5 + r() * 0.25, 0.7));
      t += 1.0;
    }
    out.push(finishMat('bothhands', 'chords', notes));
  }
  // repeated chords: a triad struck 4 times in eighths (~100 bpm)
  {
    const r = rng(207);
    const notes = [];
    let t = LEAD;
    for (let i = 0; i < (quick ? 3 : 6); i++) {
      const root = 50 + Math.floor(r() * 14);
      const v = [[0, 4, 7], [0, 3, 7], [0, 5, 9]][i % 3];
      for (let j = 0; j < 4; j++) {
        notes.push(...chordAt(r, t, v.map((x) => root + x), 0.5 + r() * 0.25, 0.26, 0.012));
        t += 0.3;
      }
      t += 0.8;
    }
    out.push(finishMat('repchords', 'chords', notes));
  }
  return out;
}

// ---- the app's lesson material --------------------------------------------------------------------
export const LESSON_LEVELS = [1, 3, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24];
function pieceNotes(p, t0, r, level) {
  const spb = 60 / p.bpm;
  const byBeat = new Map();
  for (const n of p.notes) {
    if (!byBeat.has(n.beat)) byBeat.set(n.beat, []);
    byBeat.get(n.beat).push(n);
  }
  const out = [];
  const base = 0.5 + r() * 0.2;
  for (const [beat, ns] of byBeat) {
    const tn = t0 + beat * spb;
    const jit = (r() * 2 - 1) * 0.025; // human timing
    const g = gid++;
    const accent = beat % p.beatsPer === 0 ? 0.06 : 0;
    for (const n of ns) {
      const spread = ns.length > 1 ? (r() * 2 - 1) * 0.01 : 0;
      out.push({
        midi: n.midi,
        t: tn + jit + spread,
        tn,
        dur: Math.max(0.12, n.dur * spb * 0.92),
        vel: Math.max(0.2, Math.min(0.9, base + accent + (r() * 2 - 1) * 0.1)),
        g,
        level,
      });
    }
  }
  return { notes: out, end: t0 + p.totalBeats * spb };
}

function lessons(quick) {
  const parts = [];
  const seeds = quick ? [1] : [1, 2, 3];
  const levels = quick ? [1, 6, 10, 14, 18, 20] : LESSON_LEVELS;
  for (const seed of seeds) {
    const r = rng(300 + seed);
    const notes = [];
    const segs = [];
    let t = LEAD;
    const add = (p, level, kind) => {
      const { notes: ns, end } = pieceNotes(p, t, r, level);
      notes.push(...ns);
      const midis = ns.map((n) => n.midi);
      segs.push({ t0: t - 0.5, t1: end + 1.0, range: [Math.min(...midis), Math.max(...midis)], level, kind });
      t = end + 1.5;
    };
    for (const L of levels) add(generate(L, { seed: seed * 1000 + L + SEED * 100003 }), L, 'sight');
    // warm-ups and rhythm drills (one set per seed, different levels)
    if (!quick || seed === 1) {
      const wu = [
        [[4, 'scale'], [12, 'arpeggio'], [10, 'chords'], [2, 'fivefinger']],
        [[14, 'scale'], [20, 'arpeggio'], [16, 'chords'], [6, 'notes']],
        [[8, 'scale'], [18, 'arpeggio'], [12, 'chords'], [3, 'fivefinger']],
      ][seed - 1];
      for (const [L, kind] of quick ? wu.slice(0, 2) : wu) add(generate(L, { seed: seed * 77 + L + SEED * 100003, kind }), L, kind);
      for (const L of quick ? [12] : [4, 12, 20]) add(generateRhythm(L, { seed: seed * 55 + L + SEED * 100003 }), L, 'rhythm');
    }
    const m = finishMat('lesson', 'lesson', notes, { segs, tail: 1.0 });
    m.part = seed;
    parts.push(m);
  }
  return parts;
}

// ---- fast ----------------------------------------------------------------------------------------
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
function fast(quick) {
  const out = [];
  // 16th-note two-octave scales up and down at 100-140 bpm, right hand and left hand
  {
    const r = rng(401);
    const notes = [];
    let t = LEAD;
    const runs = quick
      ? [[60, 120], [48, 140]]
      : [[60, 100], [67, 120], [62, 140], [48, 120], [41, 100], [65, 140]];
    for (const [tonic, bpm] of runs) {
      const dt = 60 / bpm / 4;
      const up = [];
      for (let o = 0; o < 2; o++) for (const s of MAJOR) up.push(tonic + 12 * o + s);
      up.push(tonic + 24);
      const seq = [...up, ...up.slice(0, -1).reverse()];
      for (const m of seq) {
        notes.push({ midi: m, t: t + (r() * 2 - 1) * 0.008, tn: t, dur: dt * 1.05, vel: 0.5 + r() * 0.2, g: gid++ });
        t += dt;
      }
      t += 1.2;
    }
    out.push(finishMat('scales16', 'fast', notes));
  }
  // repeated notes at ~8/s
  {
    const r = rng(402);
    const notes = [];
    let t = LEAD;
    for (const m of quick ? [55, 72] : [48, 55, 67, 72, 84]) {
      for (let i = 0; i < 12; i++) {
        notes.push({ midi: m, t: t + (r() * 2 - 1) * 0.008, tn: t, dur: 0.09, vel: 0.5 + r() * 0.2, g: gid++ });
        t += 0.125;
      }
      t += 1.0;
    }
    out.push(finishMat('repeated8', 'fast', notes));
  }
  // trills (whole and half steps) ~9 notes/s
  {
    const r = rng(403);
    const notes = [];
    let t = LEAD;
    for (const [a, b] of quick ? [[64, 65], [72, 74]] : [[64, 65], [72, 74], [57, 59], [79, 80], [52, 53]]) {
      for (let i = 0; i < 14; i++) {
        notes.push({ midi: i % 2 ? b : a, t: t + (r() * 2 - 1) * 0.008, tn: t, dur: 0.11, vel: 0.45 + r() * 0.2, g: gid++ });
        t += 0.11;
      }
      t += 1.0;
    }
    out.push(finishMat('trills', 'fast', notes));
  }
  // arpeggios: broken triads over two octaves, 16ths at 120 bpm
  {
    const r = rng(404);
    const notes = [];
    let t = LEAD;
    for (const [root, minor] of quick ? [[48, 0], [57, 1]] : [[48, 0], [57, 1], [53, 0], [43, 1], [62, 0]]) {
      const tri = [0, minor ? 3 : 4, 7];
      const up = [];
      for (let o = 0; o < 2; o++) for (const x of tri) up.push(root + 12 * o + x);
      up.push(root + 24);
      const seq = [...up, ...up.slice(0, -1).reverse()];
      for (const m of seq) {
        notes.push({ midi: m, t: t + (r() * 2 - 1) * 0.008, tn: t, dur: 0.13, vel: 0.5 + r() * 0.2, g: gid++ });
        t += 0.125;
      }
      t += 1.0;
    }
    out.push(finishMat('arpeggios', 'fast', notes));
  }
  return out;
}

// ---- pedal ---------------------------------------------------------------------------------------
function pedal(quick) {
  const r = rng(501);
  const notes = [];
  const ped = [];
  let t = LEAD;
  const bars = quick ? 6 : 12;
  for (let bar = 0; bar < bars; bar++) {
    const root = 43 + Math.floor(r() * 12);
    // left-hand broken chord (root, fifth, octave, tenth, twelfth, double octave)
    const ch = bar % 2 ? [0, 7, 12, 16, 19, 24] : [0, 7, 16, 12, 19, 28];
    ped.push([t + 0.03, t + 1.6 - 0.03]);
    for (let k = 0; k < 6; k++) notes.push({ midi: root + ch[k], t: t + k * 0.25 + (r() * 2 - 1) * 0.01, tn: t + k * 0.25, dur: 0.2, vel: 0.45 + r() * 0.3, g: gid++ });
    t += 1.6;
  }
  return finishMat('pedal', 'pedal', notes, { pedal: ped });
}

export function materials({ quick = false, seed = 0 } = {}) {
  gid = 1;
  SEED = seed;
  return [singles(quick), ...chords(quick), ...lessons(quick), ...fast(quick), pedal(quick)];
}

// Groups of notes struck together (>= 2 notes) and octave pairs inside them.
export function groupsOf(notes) {
  const G = new Map();
  notes.forEach((n, i) => {
    if (!G.has(n.g)) G.set(n.g, []);
    G.get(n.g).push(i);
  });
  const chords = [...G.values()].filter((ix) => ix.length >= 2);
  const octaves = [];
  for (const ix of chords)
    for (const a of ix)
      for (const b of ix)
        if (notes[b].midi - notes[a].midi === 12) octaves.push([a, b]);
  return { chords, octaves };
}
