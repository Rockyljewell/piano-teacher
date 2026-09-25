// Procedural exercise generator. Turns a curriculum level recipe + a seed into a playable
// piece: harmony first (a cadential chord progression), then a right-hand melody that favours
// chord tones on strong beats, then a left-hand accompaniment in the level's style.
import { Key, diatonicChord } from './theory.js';
import { makeRng } from './rng.js';
import { levelInfo } from './curriculum.js';

const T = 1 / 3;
export const CELLS = {
  w: [4], dh: [3], h: [2], q: [1],
  ee: [0.5, 0.5], dqe: [1.5, 0.5], ssss: [0.25, 0.25, 0.25, 0.25],
  ess: [0.5, 0.25, 0.25], sse: [0.25, 0.25, 0.5], des: [0.75, 0.25],
  trip: [T, T, T], syn: [0.5, 1, 0.5],
  // compound (6/8) cells, one dotted-quarter group each
  eee: [0.5, 0.5, 0.5], qe: [1, 0.5], dq: [1.5], dh68: [3],
};
const COMPOUND = new Set(['eee', 'qe', 'dq', 'dh68']);

export const TIME_SIGS = {
  '4/4': { num: 4, den: 4, beats: 4, compound: false },
  '3/4': { num: 3, den: 4, beats: 3, compound: false },
  '2/4': { num: 2, den: 4, beats: 2, compound: false },
  '6/8': { num: 6, den: 8, beats: 3, compound: true },
};

const PROGRESSIONS = {
  major: [[0, 3, 4, 0], [0, 5, 3, 4], [0, 4, 5, 3], [0, 3, 0, 4], [1, 4, 0, 0], [0, 5, 1, 4], [0, 2, 3, 4]],
  minor: [[0, 3, 4, 0], [0, 5, 2, 4], [0, 3, 6, 2], [0, 4, 0, 4], [0, 5, 3, 4]],
};

let nextId = 1;

// Pitch classes of a diatonic chord (with raised leading tone for V/vii in minor).
function chordPcs(key, degree, seventh = false) {
  const pcs = key.scalePcs();
  const out = [pcs[degree % 7], pcs[(degree + 2) % 7], pcs[(degree + 4) % 7]];
  if (seventh) out.push(pcs[(degree + 6) % 7]);
  if (key.mode === 'minor' && (degree === 4 || degree === 6)) {
    const lead = (pcs[6] + 1) % 12;
    for (let i = 0; i < out.length; i++) if (out[i] === pcs[6]) out[i] = lead;
  }
  return out;
}

function nearestWithPc(pc, near, lo, hi) {
  let best = null;
  for (let m = lo; m <= hi; m++) if (((m % 12) + 12) % 12 === pc && (best === null || Math.abs(m - near) < Math.abs(best - near))) best = m;
  return best;
}

// Fill `beats` with rhythm cells. Returns [{beat, dur, tuplet}] relative to measure start.
function measureRhythm(rng, weights, beats, compound, simple, last) {
  const out = [];
  let pos = 0;
  let w = { ...weights };
  if (compound) {
    const c = {};
    for (const k of Object.keys(w)) if (COMPOUND.has(k)) c[k] = w[k];
    w = Object.keys(c).length ? c : { eee: 3, qe: 3, dq: 2 };
  } else {
    for (const k of Object.keys(w)) if (COMPOUND.has(k)) delete w[k];
    if (!Object.keys(w).length) w = { q: 1 };
  }
  // Final measure: end on a long note where possible.
  if (last) {
    const lastLen = compound ? 1.5 : beats >= 4 ? (rng.chance(0.5) ? 2 : 4) : beats === 3 ? rng.pick([1, 3]) : 2;
    const head = beats - lastLen;
    const r = head > 0 ? measureRhythm(rng, weights, head, compound, simple, false) : [];
    const end = compound ? [{ beat: head, dur: lastLen }] : [{ beat: head, dur: lastLen }];
    return [...r.filter((x) => x.beat < head), ...end];
  }
  let guard = 0;
  while (pos < beats - 1e-9 && guard++ < 50) {
    const rem = beats - pos;
    const ok = Object.entries(w).filter(([k]) => {
      const cell = CELLS[k];
      const len = cell.reduce((a, b) => a + b, 0);
      if (len > rem + 1e-9) return false;
      if (k === 'w' && (beats !== 4 || pos !== 0)) return false;
      if ((k === 'dh' || k === 'dh68') && pos !== 0) return false;
      if (simple && len === 2 && pos % 2 !== 0) return false;
      return true;
    });
    if (!ok.length) {
      out.push({ beat: pos, dur: rem });
      break;
    }
    const k = rng.weighted(ok);
    for (const d of CELLS[k]) {
      out.push({ beat: pos, dur: d, tuplet: k === 'trip' ? 3 : undefined });
      pos += d;
    }
    pos = Math.round(pos * 1e6) / 1e6;
    if (Math.abs(pos - Math.round(pos * 3) / 3) < 1e-6) pos = Math.round(pos * 3) / 3;
  }
  return out;
}

function progression(rng, key, measures, simpleHarmony, perMeasure = 1) {
  const n = measures * perMeasure;
  let seq = [];
  if (simpleHarmony) {
    for (let i = 0; i < n; i++) seq.push(i === n - 1 ? 0 : i === n - 2 ? 4 : rng.chance(0.65) ? 0 : 4);
    seq[0] = 0;
    return seq;
  }
  const pool = PROGRESSIONS[key.mode];
  while (seq.length < n) seq.push(...rng.pick(pool));
  seq = seq.slice(0, n);
  seq[0] = 0;
  if (n >= 2) seq[n - 2] = 4;
  seq[n - 1] = 0;
  return seq;
}

// Melody line generator over the given rhythm, returns array of midi (or null for rest).
function melodyLine(rng, key, lo, hi, motion, rhythm, harmonyAt, opts = {}) {
  const pcs = key.scalePcs();
  const allowed = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) allowed.push(m);
  if (!allowed.length) for (let m = lo; m <= hi; m++) allowed.push(m);
  const mw = { step: 6, skip: 3, leap: 0, repeat: 1, ...motion };
  // Start on a tonic-chord tone near the middle (beginners: the tonic itself).
  const tonicPcs = chordPcs(key, 0);
  const mid = (lo + hi) / 2;
  let startCands = allowed.filter((m) => (opts.startTonic ? ((m % 12) + 12) % 12 === key.tonicPc : tonicPcs.includes(((m % 12) + 12) % 12)));
  if (!startCands.length) startCands = allowed;
  startCands.sort((a, b) => Math.abs(a - (opts.startNear ?? mid)) - Math.abs(b - (opts.startNear ?? mid)));
  let idx = allowed.indexOf(startCands[Math.min(startCands.length - 1, rng.int(0, 1))]);
  const out = [];
  let dir = rng.chance(0.5) ? 1 : -1;
  rhythm.forEach((r, i) => {
    if (i > 0) {
      const kind = rng.weighted(Object.entries(mw).filter(([, x]) => x > 0));
      let size = kind === 'step' ? 1 : kind === 'skip' ? 2 : kind === 'leap' ? rng.int(3, opts.maxLeap || 5) : 0;
      // Tend back toward the middle of the range.
      const pos = (allowed[idx] - lo) / Math.max(1, hi - lo);
      if (pos > 0.8) dir = -1;
      else if (pos < 0.2) dir = 1;
      else if (rng.chance(0.3)) dir = -dir;
      let ni = idx + dir * size;
      if (ni < 0 || ni >= allowed.length) ni = idx - dir * size;
      idx = Math.max(0, Math.min(allowed.length - 1, ni));
      // Strong beats: prefer a chord tone of the current harmony.
      if (r.strong) {
        const ch = harmonyAt(r.abs);
        if (!ch.includes(((allowed[idx] % 12) + 12) % 12) && rng.chance(0.75)) {
          for (const d of [1, -1, 2, -2]) {
            const j = idx + d;
            if (j >= 0 && j < allowed.length && ch.includes(((allowed[j] % 12) + 12) % 12)) {
              idx = j;
              break;
            }
          }
        }
      }
    }
    out.push(allowed[idx]);
  });
  // Final note: tonic nearest to where we are.
  if (opts.endTonic && out.length) {
    const last = out[out.length - 1];
    const t = allowed.filter((m) => ((m % 12) + 12) % 12 === key.tonicPc);
    if (t.length) out[out.length - 1] = t.reduce((a, b) => (Math.abs(b - last) < Math.abs(a - last) ? b : a));
  }
  return out;
}

function addChromatic(rng, line, rhythm, prob) {
  for (let i = 1; i < line.length - 1; i++) {
    if (line[i] == null || line[i - 1] == null || line[i + 1] == null || rhythm[i].strong) continue;
    if (!rng.chance(prob)) continue;
    const a = line[i - 1],
      b = line[i + 1];
    if (Math.abs(b - a) === 2) line[i] = (a + b) / 2; // chromatic passing tone
    else if (a === b) line[i] = a + (rng.chance(0.5) ? 1 : -1); // chromatic neighbour
  }
}

function positionFingers(key, lo, midi, hand) {
  // 5-finger position starting at `lo` on scale degrees.
  const pcs = key.scalePcs();
  let idx = 0;
  for (let m = lo; m < midi; m++) if (pcs.includes(((m + 1) % 12 + 12) % 12)) idx++;
  if (idx > 4) return null;
  return hand === 'R' ? idx + 1 : 5 - idx;
}

function pickKey(rng, lv) {
  const [f, mode] = rng.pick(lv.keys);
  return new Key(f, mode);
}

function transposeRange(key, lo, hi, lv) {
  // Five-finger position levels are written for their own key; others keep the range.
  return [lo, hi];
}

export function generate(levelN, opts = {}) {
  const lv = levelInfo(levelN);
  const seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
  const rng = makeRng(seed);
  const kind = opts.kind || 'sight';
  if (kind === 'scale' || kind === 'arpeggio') return techniquePiece(lv, rng, seed, kind, opts);
  if (kind === 'chords') return chordPiece(lv, rng, seed, opts);
  if (kind === 'notes') return noteReadingPiece(lv, rng, seed, opts);

  const key = opts.key || pickKey(rng, lv);
  const tsName = opts.time || rng.pick(lv.time);
  const ts = TIME_SIGS[tsName];
  const measures = opts.measures || lv.measures;
  const beatsPer = ts.beats;
  const simpleRhythm = lv.n < 17;
  const bpm = opts.bpm || Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * (opts.tempoFactor ?? 0.5));

  const perMeasure = !ts.compound && beatsPer === 4 && lv.n >= 17 && rng.chance(0.4) ? 2 : 1;
  const prog = progression(rng, key, measures, lv.n <= 8, perMeasure);
  const harmonyDegreeAt = (beat) => prog[Math.min(prog.length - 1, Math.floor(beat / (beatsPer / perMeasure)))];
  const harmonyAt = (beat) => chordPcs(key, harmonyDegreeAt(beat), lv.sevenths);

  const events = [];
  const add = (e) => events.push({ id: nextId++, ...e });

  // --- rhythm skeletons -------------------------------------------------------------------
  const mkRhythm = (weights) => {
    const rr = [];
    for (let m = 0; m < measures; m++) {
      const cells = measureRhythm(rng, weights, beatsPer, ts.compound, simpleRhythm, m === measures - 1);
      for (const c of cells) {
        const abs = m * beatsPer + c.beat;
        const strong = Math.abs(c.beat) < 1e-6 || (!ts.compound && beatsPer === 4 && Math.abs(c.beat - 2) < 1e-6) || (ts.compound && Math.abs(c.beat - 1.5) < 1e-6);
        rr.push({ ...c, abs, measure: m, strong });
      }
    }
    return rr;
  };

  const hands = lv.hands;
  const staves = hands === 'R' ? ['treble'] : hands === 'L' ? ['bass'] : ['treble', 'bass'];
  const rhLo = lv.rh ? lv.rh.lo : 60,
    rhHi = lv.rh ? lv.rh.hi : 72;

  // Position levels are defined in C; move them to the key's tonic.
  let rhRange = [rhLo, rhHi];
  let lhRange = lv.lh ? [lv.lh.lo, lv.lh.hi] : [48, 55];
  if (lv.fingers && key.fifths !== 0 && key.fifths !== 1) {
    const shift = ((key.tonicPc - 0 + 12) % 12) > 6 ? ((key.tonicPc + 12) % 12) - 12 : (key.tonicPc + 12) % 12;
    rhRange = [rhLo + shift, rhHi + shift];
    lhRange = [lhRange[0] + shift, lhRange[1] + shift];
  }

  // Which measures each hand plays in 'alt' mode: phrases of 1-2 measures.
  const phraseLen = measures >= 6 ? 2 : 1;
  const rhPlays = (m) => hands !== 'alt' || Math.floor(m / phraseLen) % 2 === 0;
  const lhPlays = (m) => hands === 'alt' && !rhPlays(m);

  // --- right hand -------------------------------------------------------------------------
  if (hands !== 'L' && lv.rh) {
    const rr = mkRhythm(lv.rh.rhythm);
    const line = melodyLine(rng, key, rhRange[0], rhRange[1], lv.rh.motion, rr, harmonyAt, {
      startTonic: lv.n <= 8,
      endTonic: hands !== 'alt' || rhPlays(measures - 1),
      maxLeap: lv.n >= 30 ? 7 : 5,
    });
    if (lv.chromatic || lv.rh.chromatic) addChromatic(rng, line, rr, lv.chromatic || lv.rh.chromatic);
    rr.forEach((r, i) => {
      if (!rhPlays(r.measure)) return;
      const isEdge = i === 0 || i === rr.length - 1;
      const rest = !isEdge && lv.rests && !r.strong && rng.chance(lv.rests);
      let midis = rest ? [] : [line[i]];
      if (!rest && lv.rh.chords && r.dur >= 0.5 && rng.chance(lv.rh.chords)) {
        midis = buildRhChord(key, line[i], lv.rh.chordSize || 2, harmonyAt(r.abs), Math.max(lhRange[1] + 1, rhRange[0] - 5));
      }
      const fingers = lv.fingers && !rest ? midis.map((m) => positionFingers(key, rhRange[0], m, 'R')) : null;
      add({ staff: 'treble', hand: 'R', beat: r.abs, dur: r.dur, midis, rest, tuplet: r.tuplet, fingers });
    });
    if (hands === 'alt') fillRests(add, 'treble', 'R', measures, beatsPer, (m) => !rhPlays(m));
  }

  // --- left hand --------------------------------------------------------------------------
  if (lv.lh && (hands === 'L' || hands === 'alt' || hands === 'both')) {
    const style = hands === 'L' || hands === 'alt' ? 'melody' : lv.lh.style;
    if (style === 'melody' || style === 'counter') {
      const rr = mkRhythm(lv.lh.rhythm || { h: 2, q: 3 });
      const line = melodyLine(rng, key, lhRange[0], lhRange[1], lv.lh.motion || { step: 6, skip: 3 }, rr, harmonyAt, {
        startTonic: lv.n <= 8,
        endTonic: true,
        startNear: style === 'counter' ? lhRange[0] + 4 : undefined,
      });
      if (style === 'counter') {
        // Bass lines land on chord roots at the start of each harmony.
        rr.forEach((r, i) => {
          if (r.strong) {
            const root = chordPcs(key, harmonyDegreeAt(r.abs))[0];
            const m = nearestWithPc(root, line[i], lhRange[0], lhRange[1]);
            if (m != null) line[i] = m;
          }
        });
      }
      rr.forEach((r, i) => {
        if (hands === 'alt' && !lhPlays(r.measure)) return;
        const isEdge = i === 0 || i === rr.length - 1;
        const rest = !isEdge && lv.rests && !r.strong && rng.chance(lv.rests);
        const midis = rest ? [] : [line[i]];
        const fingers = lv.fingers && !rest ? midis.map((m) => positionFingers(key, lhRange[0], m, 'L')) : null;
        add({ staff: 'bass', hand: 'L', beat: r.abs, dur: r.dur, midis, rest, tuplet: r.tuplet, fingers });
      });
      if (hands === 'alt') fillRests(add, 'bass', 'L', measures, beatsPer, (m) => !lhPlays(m));
    } else {
      accompaniment(rng, add, style, key, prog, perMeasure, measures, beatsPer, ts, lhRange, lv);
    }
  }

  // Optional ties (syncopation levels): tie the last note of a measure into the next downbeat.
  if (lv.rh && lv.rh.rhythm && lv.rh.rhythm.syn) addTies(rng, events, beatsPer);

  return finish({
    seed, level: lv.n, kind, title: lv.title, key, ts, tsName, bpm, measures, beatsPer, staves, events,
    harmony: prog.map((d, i) => ({ beat: (i * beatsPer) / perMeasure, degree: d })),
    fingers: lv.fingers,
  });
}

function buildRhChord(key, top, size, harmonyPcs, floor) {
  const notes = [top];
  const pcs = key.scalePcs();
  if (size === 2) {
    // A third or sixth below, in key.
    const opts = [];
    for (let m = top - 9; m <= top - 3; m++) if (pcs.includes(((m % 12) + 12) % 12) && [3, 4, 8, 9].includes(top - m)) opts.push(m);
    const ch = opts.filter((m) => harmonyPcs.includes(((m % 12) + 12) % 12));
    const pick = (ch.length ? ch : opts)[0];
    if (pick != null && pick >= floor) notes.unshift(pick);
    return notes;
  }
  let m = top - 1;
  while (notes.length < size && m > top - 12 && m >= floor) {
    if (harmonyPcs.includes(((m % 12) + 12) % 12) && notes[0] - m >= 3) notes.unshift(m);
    m--;
  }
  return notes;
}

function fillRests(add, staff, hand, measures, beatsPer, restIn) {
  for (let m = 0; m < measures; m++) if (restIn(m)) add({ staff, hand, beat: m * beatsPer, dur: beatsPer, midis: [], rest: true, measureRest: true });
}

function addTies(rng, events, beatsPer) {
  const rh = events.filter((e) => e.hand === 'R' && !e.rest).sort((a, b) => a.beat - b.beat);
  for (let i = 0; i < rh.length - 1; i++) {
    const e = rh[i],
      n = rh[i + 1];
    const endBeat = e.beat + e.dur;
    const isBar = Math.abs(endBeat / beatsPer - Math.round(endBeat / beatsPer)) < 1e-6;
    if (isBar && Math.abs(n.beat - endBeat) < 1e-6 && e.midis.length === 1 && n.midis.length === 1 && !e.tuplet && !n.tuplet && i + 2 < rh.length && rng.chance(0.3)) {
      n.midis = [...e.midis];
      n.tiedFrom = e.id;
      e.tieNext = n.id;
    }
  }
}

function accompaniment(rng, add, style, key, prog, perMeasure, measures, beatsPer, ts, [lo, hi], lv) {
  const span = beatsPer / perMeasure;
  let prevVoicing = null;
  for (let i = 0; i < prog.length; i++) {
    const deg = prog[i];
    const start = i * span;
    const pcs = chordPcs(key, deg, style === 'seventh' || (lv.sevenths && style === 'walking'));
    const rootBase = nearestWithPc(pcs[0], lo + 5, lo, hi) ?? lo;
    const emit = (beat, dur, midis) => add({ staff: 'bass', hand: 'L', beat, dur, midis: midis.filter((m) => m != null), rest: false });
    const last = i === prog.length - 1;
    switch (style) {
      case 'pedal': {
        emit(start, span, [rootBase]);
        break;
      }
      case 'roots': {
        const fifth = nearestWithPc(pcs[2], rootBase + 7, lo, hi);
        if (span >= 4 && !last) {
          emit(start, 2, [rootBase]);
          emit(start + 2, 2, [fifth ?? rootBase]);
        } else emit(start, span, [rootBase]);
        break;
      }
      case 'fifths': {
        const fifth = nearestWithPc(pcs[2], rootBase + 7, rootBase + 1, hi + 2);
        emit(start, span, [rootBase, fifth]);
        break;
      }
      case 'octaves': {
        const r = Math.min(rootBase, hi - 12);
        if (span >= 4 && !last) {
          emit(start, 2, [r, r + 12]);
          const f = nearestWithPc(pcs[2], r + 7, lo, hi - 12);
          emit(start + 2, 2, f != null ? [f, f + 12] : [r, r + 12]);
        } else emit(start, span, [r, r + 12]);
        break;
      }
      case 'block':
      case 'seventh': {
        const voicing = voiceLead(pcs, prevVoicing, lo + 4, hi);
        prevVoicing = voicing;
        if (span >= 4 && lv.n >= 20 && !last) {
          emit(start, 2, voicing);
          emit(start + 2, 2, voicing);
        } else emit(start, span, voicing);
        break;
      }
      case 'broken': {
        const r = rootBase;
        const f = nearestWithPc(pcs[2], r + 7, r, r + 12);
        const t = nearestWithPc(pcs[1], r + 15, r + 12, r + 17) ?? nearestWithPc(pcs[1], r + 4, r, r + 12);
        const pattern = [r, f, t, f];
        if (ts.compound) {
          const pat = [r, f, t, f, t, f];
          pat.forEach((m, k) => (last && k > 0 ? null : emit(start + k * 0.5, last ? span : 0.5, [m])));
        } else if (last) emit(start, span, [r]);
        else for (let k = 0; k < span; k++) emit(start + k, 1, [pattern[k % 4]]);
        break;
      }
      case 'alberti': {
        const v = voiceLead(pcs.slice(0, 3), prevVoicing, lo + 5, hi);
        prevVoicing = v;
        const [a, b, c] = v;
        if (last) emit(start, span, [a, b, c]);
        else for (let k = 0; k < span * 2; k++) emit(start + k * 0.5, 0.5, [[a, c, b, c][k % 4]]);
        break;
      }
      case 'walking': {
        const nextRoot = i + 1 < prog.length ? nearestWithPc(chordPcs(key, prog[i + 1])[0], rootBase, lo, hi) : rootBase;
        if (last) {
          emit(start, span, [rootBase]);
          break;
        }
        const tones = [rootBase, nearestWithPc(pcs[1], rootBase + 4, lo, hi), nearestWithPc(pcs[2], rootBase + 7, lo, hi)];
        for (let k = 0; k < span; k++) {
          let m;
          if (k === 0) m = rootBase;
          else if (k === span - 1) m = nextRoot + (rng.chance(0.5) ? 1 : -1); // chromatic approach
          else m = rng.pick(tones.filter((x) => x != null));
          emit(start + k, 1, [Math.max(lo - 2, Math.min(hi + 2, m))]);
        }
        break;
      }
      default:
        emit(start, span, [rootBase]);
    }
  }
}

// Close-position voicing of the chord's pitch classes, moving as little as possible.
function voiceLead(pcs, prev, lo, hi) {
  const candidates = [];
  for (let bass = lo - 6; bass <= hi; bass++) {
    const pcb = ((bass % 12) + 12) % 12;
    if (!pcs.includes(pcb)) continue;
    const v = [bass];
    let m = bass;
    const remaining = pcs.filter((p, i) => i !== pcs.indexOf(pcb));
    while (v.length < pcs.length) {
      m++;
      if (remaining.includes(((m % 12) + 12) % 12)) v.push(m);
      if (m > bass + 14) break;
    }
    if (v.length === pcs.length && v[v.length - 1] <= hi + 2 && v[0] >= lo - 6) candidates.push(v);
  }
  if (!candidates.length) return pcs.map((p) => nearestWithPc(p, lo + 6, lo - 6, hi + 6));
  if (!prev) {
    // Start in root position if possible.
    const root = candidates.filter((v) => ((v[0] % 12) + 12) % 12 === pcs[0]);
    const target = (lo + hi) / 2 - 4;
    return (root.length ? root : candidates).sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0];
  }
  const cost = (v) => v.reduce((a, m, i) => a + Math.abs(m - (prev[i] ?? prev[prev.length - 1])), 0);
  return candidates.sort((a, b) => cost(a) - cost(b))[0];
}

// --- technique ----------------------------------------------------------------------------
const WHITE_START = new Set(['0major', '1major', '2major', '3major', '4major', '0minor', '1minor', '-1minor']);
function scaleFingering(key, hand, n) {
  const k = `${key.fifths}${key.mode}`;
  let pattern;
  if (WHITE_START.has(k)) pattern = hand === 'R' ? [1, 2, 3, 1, 2, 3, 4] : [5, 4, 3, 2, 1, 3, 2];
  else if (k === '-1major') pattern = hand === 'R' ? [1, 2, 3, 4, 1, 2, 3] : [5, 4, 3, 2, 1, 3, 2];
  else return null;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pattern[i % 7]);
  return out;
}

function techniquePiece(lv, rng, seed, kind, opts) {
  const key = opts.key || pickKey(rng, lv);
  const octaves = lv.n >= 25 ? 2 : 1;
  const bothHands = lv.n >= 16 && lv.hands === 'both';
  const handsList = lv.hands === 'L' ? ['L'] : bothHands ? ['R', 'L'] : ['R'];
  const dur = lv.n < 10 ? 1 : lv.n < 30 ? 0.5 : 0.25;
  const beatsPer = 4;
  const events = [];
  let bpm = opts.bpm || Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * (opts.tempoFactor ?? 0.5));
  if (dur === 1) bpm = Math.round(bpm * 1.2);
  for (const hand of handsList) {
    const baseTonic = hand === 'R' ? key.tonicNear(66) : key.tonicNear(54);
    const tonic = hand === 'R' ? (baseTonic < 60 && octaves === 1 ? baseTonic + 12 : baseTonic) : baseTonic - 12 * (octaves - 1);
    let up = [];
    if (kind === 'scale') {
      for (let d = 0; d <= 7 * octaves; d++) up.push(key.degreeToMidi(d, tonic));
      if (key.mode === 'minor' && lv.n >= 15) {
        // Harmonic minor: raise the 7th.
        const pcs = key.scalePcs();
        up = up.map((m) => (((m % 12) + 12) % 12 === pcs[6] ? m + 1 : m));
      }
    } else {
      const deg = [0, 2, 4];
      for (let o = 0; o < octaves; o++) for (const d of deg) up.push(key.degreeToMidi(d + 7 * o, tonic));
      up.push(key.degreeToMidi(7 * octaves, tonic));
    }
    const seq = [...up, ...up.slice(0, -1).reverse()];
    let fingers = null;
    if (kind === 'scale' && octaves === 1) {
      const f = scaleFingering(key, hand, 8);
      if (f) {
        const upF = hand === 'R' ? [...f.slice(0, 7), key.fifths === -1 && key.mode === 'major' ? 4 : 5] : [5, 4, 3, 2, 1, 3, 2, 1];
        fingers = [...upF, ...upF.slice(0, -1).reverse()];
      }
    }
    seq.forEach((m, i) => {
      events.push({ id: nextId++, staff: hand === 'R' ? 'treble' : 'bass', hand, beat: i * dur, dur: i === seq.length - 1 ? Math.max(dur, 1) : dur, midis: [m], rest: false, fingers: fingers ? [fingers[i]] : null });
    });
  }
  const total = Math.max(...events.map((e) => e.beat + e.dur));
  const measures = Math.ceil(total / beatsPer - 1e-9);
  // pad the final measure with rests
  for (const hand of handsList) {
    const staff = hand === 'R' ? 'treble' : 'bass';
    const end = Math.max(...events.filter((e) => e.hand === hand).map((e) => e.beat + e.dur));
    let pos = end;
    while (pos < measures * beatsPer - 1e-9) {
      const d = Math.min(measures * beatsPer - pos, pos % 1 === 0 && measures * beatsPer - pos >= 2 && pos % 2 === 0 ? 2 : 1 - (pos % 1) || 1);
      events.push({ id: nextId++, staff, hand, beat: pos, dur: d, midis: [], rest: true });
      pos += d;
    }
  }
  return finish({
    seed, level: lv.n, kind, title: `${key.name} ${kind === 'scale' ? 'scale' : 'arpeggio'}`,
    key, ts: TIME_SIGS['4/4'], tsName: '4/4', bpm, measures, beatsPer,
    staves: handsList.length === 2 ? ['treble', 'bass'] : handsList[0] === 'R' ? ['treble'] : ['bass'],
    events, harmony: [], fingers: !!events.find((e) => e.fingers),
  });
}

function chordPiece(lv, rng, seed, opts) {
  const key = opts.key || pickKey(rng, lv);
  const prog = key.mode === 'major' ? rng.pick([[0, 3, 4, 0], [0, 5, 3, 4, 0], [0, 3, 0, 4, 0]]) : [0, 3, 4, 0];
  const events = [];
  let prev = null;
  const dur = 2;
  prog.forEach((deg, i) => {
    const pcs = chordPcs(key, deg);
    const v = voiceLead(pcs, prev, 60, 72);
    prev = v;
    events.push({ id: nextId++, staff: 'treble', hand: 'R', beat: i * dur, dur, midis: v, rest: false });
    const root = nearestWithPc(pcs[0], 48, 41, 55);
    if (lv.hands === 'both') events.push({ id: nextId++, staff: 'bass', hand: 'L', beat: i * dur, dur, midis: [root], rest: false });
  });
  const beatsPer = 4;
  const total = prog.length * dur;
  const measures = Math.ceil(total / beatsPer);
  if (total < measures * beatsPer) {
    events.push({ id: nextId++, staff: 'treble', hand: 'R', beat: total, dur: measures * beatsPer - total, midis: [], rest: true });
    if (lv.hands === 'both') events.push({ id: nextId++, staff: 'bass', hand: 'L', beat: total, dur: measures * beatsPer - total, midis: [], rest: true });
  }
  const bpm = opts.bpm || Math.round(lv.bpm[0] * 0.9);
  return finish({
    seed, level: lv.n, kind: 'chords', title: `${key.name} chord progression`, key, ts: TIME_SIGS['4/4'], tsName: '4/4', bpm, measures, beatsPer,
    staves: lv.hands === 'both' ? ['treble', 'bass'] : ['treble'], events,
    harmony: prog.map((d, i) => ({ beat: i * dur, degree: d })),
  });
}

function noteReadingPiece(lv, rng, seed, opts) {
  const key = opts.key || pickKey(rng, lv);
  const pcs = key.scalePcs();
  const count = opts.count || 12;
  const events = [];
  const pools = [];
  if (lv.hands !== 'L' && lv.rh) pools.push(['treble', 'R', lv.rh.lo, lv.rh.hi]);
  if (lv.hands !== 'R' && lv.lh) pools.push(['bass', 'L', lv.lh.lo, Math.min(lv.lh.hi, 60)]);
  let prev = null;
  for (let i = 0; i < count; i++) {
    const [staff, hand, lo, hi] = rng.pick(pools);
    let m;
    let guard = 0;
    do {
      m = rng.int(lo, hi);
    } while ((!pcs.includes(((m % 12) + 12) % 12) || m === prev) && guard++ < 50);
    prev = m;
    events.push({ id: nextId++, staff, hand, beat: i * 2, dur: 2, midis: [m], rest: false });
    const other = staff === 'treble' ? 'bass' : 'treble';
    if (pools.length > 1) events.push({ id: nextId++, staff: other, hand: hand === 'R' ? 'L' : 'R', beat: i * 2, dur: 2, midis: [], rest: true });
  }
  return finish({
    seed, level: lv.n, kind: 'notes', title: 'Note reading', key, ts: TIME_SIGS['4/4'], tsName: '4/4', bpm: 60,
    measures: Math.ceil((count * 2) / 4), beatsPer: 4, staves: pools.length > 1 ? ['treble', 'bass'] : [pools[0][0]], events, harmony: [],
    waitOnly: true,
  });
}

// Rhythm drill: the level's rhythm vocabulary on a single line; any key counts.
export function generateRhythm(levelN, opts = {}) {
  const lv = levelInfo(levelN);
  const seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
  const rng = makeRng(seed);
  const tsName = opts.time || rng.pick(lv.time);
  const ts = TIME_SIGS[tsName];
  const measures = opts.measures || 4;
  const weights = { ...(lv.rh ? lv.rh.rhythm : lv.lh.rhythm) };
  const events = [];
  for (let m = 0; m < measures; m++) {
    const cells = measureRhythm(rng, weights, ts.beats, ts.compound, lv.n < 17, m === measures - 1);
    cells.forEach((c, i) => {
      const rest = !(m === 0 && i === 0) && !(m === measures - 1 && i === cells.length - 1) && c.beat % 1 !== 0 && rng.chance(0.1);
      events.push({ id: nextId++, staff: 'rhythm', hand: 'R', beat: m * ts.beats + c.beat, dur: c.dur, midis: rest ? [] : [72], rest, tuplet: c.tuplet });
    });
  }
  const bpm = opts.bpm || Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * (opts.tempoFactor ?? 0.5));
  return finish({
    seed, level: lv.n, kind: 'rhythm', title: 'Rhythm drill', key: new Key(0), ts, tsName, bpm, measures, beatsPer: ts.beats,
    staves: ['rhythm'], events, harmony: [], rhythmOnly: true,
  });
}

function finish(p) {
  p.events.sort((a, b) => a.beat - b.beat || (a.staff < b.staff ? -1 : 1));
  p.totalBeats = p.measures * p.beatsPer;
  // Flatten into gradable notes (tied continuations are held, not struck).
  p.notes = [];
  for (const e of p.events) {
    if (e.rest || e.tiedFrom) continue;
    for (const m of e.midis) p.notes.push({ id: `${e.id}:${m}`, eventId: e.id, midi: m, beat: e.beat, dur: e.dur, staff: e.staff, hand: e.hand });
  }
  const all = p.notes.map((n) => n.midi);
  let lo = Math.min(...all),
    hi = Math.max(...all);
  if (p.rhythmOnly) {
    lo = 48;
    hi = 84;
  }
  // Keyboard range: at least two octaves, snapped to C..B boundaries.
  lo = Math.floor((lo - 2) / 12) * 12;
  hi = Math.ceil((hi + 2) / 12) * 12;
  while (hi - lo < 24) {
    if (lo > 21) lo -= 12;
    if (hi - lo < 24 && hi < 108) hi += 12;
  }
  p.range = [Math.max(21, lo), Math.min(108, hi)];
  return p;
}

export function describePiece(p) {
  return `${p.title} · ${p.key.name} · ${p.tsName} · ♩=${p.bpm}`;
}
