// Procedural exercise generator. Turns a curriculum level recipe + a seed into a playable
// piece: harmony first (a cadential chord progression), then a right-hand melody that favours
// chord tones on strong beats, then a left-hand accompaniment in the level's style.
//
// Every piece also carries `prep`: where the hands go before it starts (see buildPrep).
import { Key, diatonic, diatonicToMidi, noteName, pcName, findableName, middleCRelative, spokenPc, chordName, isBlack } from './theory.js';
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

const FINGER_WORD = { 1: 'thumb', 2: 'pointer finger', 3: 'middle finger', 4: 'ring finger', 5: 'pinky' };
const HAND_WORD = { R: 'right', L: 'left' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pcOf = (m) => ((m % 12) + 12) % 12;

let nextId = 1;

// Pitch classes of a diatonic chord. In minor, V gets the raised leading tone (harmonic minor);
// VII stays the natural subtonic (it leads to III in these progressions, not to i).
function chordPcs(key, degree, seventh = false) {
  const pcs = key.scalePcs();
  const out = [pcs[degree % 7], pcs[(degree + 2) % 7], pcs[(degree + 4) % 7]];
  if (seventh) out.push(pcs[(degree + 6) % 7]);
  if (key.mode === 'minor' && degree === 4) {
    const lead = (pcs[6] + 1) % 12;
    for (let i = 0; i < out.length; i++) if (out[i] === pcs[6]) out[i] = lead;
  }
  return out;
}

function nearestWithPc(pc, near, lo, hi) {
  let best = null;
  for (let m = lo; m <= hi; m++) if (pcOf(m) === pc && (best === null || Math.abs(m - near) < Math.abs(best - near))) best = m;
  return best;
}

// Fill `beats` with rhythm cells. Returns [{beat, dur, tuplet}] relative to measure start, with
// `.cells` listing the cells used.
function measureRhythm(rng, weights, beats, compound, simple, last) {
  const out = [];
  out.cells = [];
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
  // Final measure: a long note that starts on a strong beat (the downbeat in 3/4 and 6/8,
  // beat 1 or 3 in 4/4), so the piece comes to rest.
  if (last) {
    const lastLen = compound ? 3 : beats >= 4 ? (rng.chance(0.5) ? 2 : 4) : beats;
    const head = beats - lastLen;
    const r = head > 0 ? measureRhythm(rng, weights, head, compound, simple, false) : [];
    const res = [...r.filter((x) => x.beat < head), { beat: head, dur: lastLen }];
    res.cells = r.cells || [];
    return res;
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
    out.cells.push(k);
    for (const d of CELLS[k]) {
      out.push({ beat: pos, dur: d, tuplet: k === 'trip' ? 3 : undefined });
      pos += d;
    }
    pos = Math.round(pos * 1e6) / 1e6;
    if (Math.abs(pos - Math.round(pos * 3) / 3) < 1e-6) pos = Math.round(pos * 3) / 3;
  }
  return out;
}

// Rhythm of a whole part: measures of cells. The level's new cell (`must`) appears at least
// once, and no measure copies the one before it when that can be helped.
function partRhythm(rng, weights, measures, beatsPer, compound, simple, must) {
  const bars = [];
  const sig = (b) => b.map((c) => `${c.beat}:${c.dur}`).join(',');
  for (let m = 0; m < measures; m++) {
    const last = m === measures - 1;
    let b = measureRhythm(rng, weights, beatsPer, compound, simple, last);
    for (let t = 0; t < 4 && m > 0 && sig(b) === sig(bars[m - 1]) && (b.length > 1 || last); t++) b = measureRhythm(rng, weights, beatsPer, compound, simple, last);
    bars.push(b);
  }
  if (must && CELLS[must] && measures > 1 && !bars.some((b) => b.cells.includes(must))) {
    const boosted = { ...weights, [must]: 50 };
    const m = rng.int(0, measures - 2);
    for (let t = 0; t < 20; t++) {
      const b = measureRhythm(rng, boosted, beatsPer, compound, simple, false);
      if (b.cells.includes(must)) {
        bars[m] = b;
        break;
      }
    }
  }
  return bars;
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

// Melody line generator over the given rhythm, returns an array of midi numbers.
//   opts.startTonic   start on the tonic (beginners)
//   opts.endTonic     end on the tonic, approached by at most `endStep` scale steps
//   opts.allowDominant  the note before the final tonic may also be the dominant (sol-do)
//   opts.recoverLeaps after a leap of a fourth or more, step back the other way
//   opts.noTritone    no melodic tritones
//   opts.wantAltered  make sure a key-signature note (F♯ in G, B♭ in F) appears
function melodyLine(rng, key, lo, hi, motion, rhythm, harmonyAt, opts = {}) {
  const pcs = key.scalePcs();
  const allowed = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(pcOf(m))) allowed.push(m);
  if (!allowed.length) for (let m = lo; m <= hi; m++) allowed.push(m);
  const mw = { step: 6, skip: 3, leap: 0, repeat: 1, ...motion };
  const maxLeap = opts.maxLeap || 5;
  // The widest move the level's motion allows, in scale steps (a strong-beat correction
  // must not create a bigger jump than the level teaches).
  const maxMove = mw.leap > 0 ? maxLeap : mw.skip > 0 ? 2 : 1;
  const tonicPcs = chordPcs(key, 0);
  const mid = (lo + hi) / 2;
  let startCands = allowed.filter((m) => (opts.startTonic ? pcOf(m) === key.tonicPc : tonicPcs.includes(pcOf(m))));
  if (!startCands.length) startCands = allowed;
  startCands.sort((a, b) => Math.abs(a - (opts.startNear ?? mid)) - Math.abs(b - (opts.startNear ?? mid)));
  let idx = allowed.indexOf(startCands[Math.min(startCands.length - 1, rng.int(0, 1))]);
  const ids = [];
  let dir = rng.chance(0.5) ? 1 : -1;
  let leapDir = 0;
  const tritone = (a, b) => opts.noTritone && Math.abs(allowed[a] - allowed[b]) === 6;
  rhythm.forEach((r, i) => {
    if (i > 0) {
      const prev = idx;
      let kind = rng.weighted(Object.entries(mw).filter(([, x]) => x > 0));
      // Never four of the same note in a row.
      if (kind === 'repeat' && i >= 2 && ids[i - 1] === ids[i - 2]) kind = 'step';
      const recovering = !!(leapDir && opts.recoverLeaps);
      if (recovering) kind = 'step';
      const size = kind === 'step' ? 1 : kind === 'skip' ? 2 : kind === 'leap' ? rng.int(3, maxLeap) : 0;
      // Tend back toward the middle of the range.
      const pos = (allowed[idx] - lo) / Math.max(1, hi - lo);
      if (pos > 0.8) dir = -1;
      else if (pos < 0.2) dir = 1;
      else if (rng.chance(0.3)) dir = -dir;
      if (leapDir && opts.recoverLeaps) dir = -leapDir;
      let ni = idx + dir * size;
      if (ni < 0 || ni >= allowed.length) ni = idx - dir * size;
      idx = Math.max(0, Math.min(allowed.length - 1, ni));
      // Strong beats: prefer a chord tone of the current harmony (within the level's reach).
      if (r.strong) {
        const ch = harmonyAt(r.abs);
        if (!ch.includes(pcOf(allowed[idx])) && rng.chance(0.75)) {
          for (const d of [1, -1, 2, -2]) {
            const j = idx + d;
            if (j >= 0 && j < allowed.length && ch.includes(pcOf(allowed[j])) && Math.abs(j - prev) <= (recovering ? 1 : maxMove) && !tritone(j, prev)) {
              idx = j;
              break;
            }
          }
        }
      }
      if (tritone(idx, prev)) {
        const alt = [idx - Math.sign(idx - prev), idx + Math.sign(idx - prev)].find((j) => j >= 0 && j < allowed.length && j !== prev && !tritone(j, prev));
        if (alt != null) idx = alt;
      }
      leapDir = Math.abs(idx - prev) >= 3 ? Math.sign(idx - prev) : 0;
    }
    ids.push(idx);
  });

  // Key-signature notes: at the level that teaches them, make sure one is actually played.
  if (opts.wantAltered && key.fifths !== 0) {
    const altered = (k) => {
      const sp = key.spell(allowed[k]);
      return sp.alter !== 0;
    };
    const has = ids.some((k) => altered(k));
    const cands = allowed.map((_, k) => k).filter(altered);
    if (!has && cands.length) {
      for (let i = 1; i < ids.length - 2; i++) {
        if (rhythm[i].strong) continue;
        const c = cands.find((k) => Math.abs(k - ids[i]) === 1 && Math.abs(k - ids[i - 1]) <= 2 && Math.abs(k - ids[i + 1]) <= 2);
        if (c != null) {
          ids[i] = c;
          break;
        }
      }
    }
  }

  // Only the notes this hand actually plays (hands take turns: the other hand has the rest).
  const played = rhythm.map((r, i) => i).filter((i) => !opts.plays || opts.plays(rhythm[i].measure));

  // Beginners: each entry of a hand starts on a note of the tonic chord.
  if (opts.startTonic && played.length) {
    const entries = played.filter((i, k) => k === 0 || i !== played[k - 1] + 1);
    for (const i of entries) {
      if (i === 0 || tonicPcs.includes(pcOf(allowed[ids[i]]))) continue;
      const j = [ids[i] - 1, ids[i] + 1].find((x) => x >= 0 && x < allowed.length && tonicPcs.includes(pcOf(allowed[x])));
      if (j != null) ids[i] = j;
    }
  }

  // Final note: the tonic, reached smoothly (re-do, ti-do; later also sol-do).
  if (opts.endTonic && played.length) {
    const P = played;
    const last = P.length - 1;
    const tIdx = allowed.map((m, k) => (pcOf(m) === key.tonicPc ? k : -1)).filter((k) => k >= 0);
    if (tIdx.length) {
      const ref = ids[P[Math.max(0, last - 1)]];
      ids[P[last]] = tIdx.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
      const maxEnd = opts.endStep ?? 2;
      const win = opts.endWindow ?? 4;
      // A tonic repeated into the final note is static: approach it from the step above.
      if (last >= 1 && ids[P[last - 1]] === ids[P[last]] && (opts.endStep ?? 2) <= 2) {
        const up = ids[P[last]] + 1;
        const down = ids[P[last]] - 1;
        if (up < allowed.length) ids[P[last - 1]] = up;
        else if (down >= 0) ids[P[last - 1]] = down;
      }
      for (let k = last - 1; k >= Math.max(0, last - win); k--) {
        if (P[k] === 0 && opts.startTonic) break;
        const gap = ids[P[k]] - ids[P[k + 1]];
        const dominant = opts.allowDominant && k === last - 1 && pcOf(allowed[ids[P[k]]]) === pcs[4] && Math.abs(allowed[ids[P[k]]] - allowed[ids[P[k + 1]]]) <= 7;
        if (Math.abs(gap) <= maxEnd || dominant) break;
        const j = ids[P[k + 1]] + Math.sign(gap);
        if (j < 0 || j >= allowed.length) break;
        ids[P[k]] = j;
      }
    }
  }

  // Consecutive identical measures (same rhythm and notes) sound stuck: vary one note (never
  // the first note or the last two, which carry the start and the cadence).
  const lastM = rhythm.length ? rhythm[rhythm.length - 1].measure : 0;
  const protect = new Set([0, played[played.length - 1], played[played.length - 2]]);
  for (let m = 1; m <= lastM; m++) {
    const cur = [];
    const prv = [];
    rhythm.forEach((r, i) => (r.measure === m ? cur : r.measure === m - 1 ? prv : []).push(i));
    if (!cur.length || cur.length !== prv.length) continue;
    const same = cur.every((i, k) => ids[i] === ids[prv[k]] && Math.abs(rhythm[i].beat - rhythm[prv[k]].beat) < 1e-6 && Math.abs(rhythm[i].dur - rhythm[prv[k]].dur) < 1e-6);
    if (!same) continue;
    const pick = (list) => list.find((j) => !protect.has(j) && !rhythm[j].strong) ?? list.find((j) => !protect.has(j));
    const i = pick(cur) ?? pick(prv);
    if (i == null) continue;
    const d = allowed[ids[i]] > mid ? -1 : 1;
    const j = ids[i] + d;
    if (j >= 0 && j < allowed.length) ids[i] = j;
  }

  // Last polish over the notes the hand plays: no run of four equal notes, no tritone leaps.
  for (let k = 3; k < played.length; k++) {
    const [a, b, c, d] = [played[k - 3], played[k - 2], played[k - 1], played[k]];
    if (ids[a] === ids[b] && ids[b] === ids[c] && ids[c] === ids[d]) {
      const i = !protect.has(c) ? c : !protect.has(b) ? b : null;
      if (i == null) continue;
      const dir2 = allowed[ids[i]] > mid ? -1 : 1;
      if (ids[i] + dir2 >= 0 && ids[i] + dir2 < allowed.length) ids[i] += dir2;
    }
  }
  if (opts.noTritone) {
    for (let k = 1; k < played.length; k++) {
      const a = played[k - 1],
        b = played[k];
      if (Math.abs(allowed[ids[a]] - allowed[ids[b]]) !== 6) continue;
      const i = !protect.has(b) ? b : !protect.has(a) ? a : null;
      if (i == null) continue;
      const other = i === b ? a : b;
      const nb = [played[k - 2], played[k + 1]].filter((x) => x != null && x !== other);
      const ok = (j) => j >= 0 && j < allowed.length && Math.abs(allowed[j] - allowed[ids[other]]) !== 6 && nb.every((x) => Math.abs(allowed[j] - allowed[ids[x]]) !== 6);
      const j = [ids[i] + Math.sign(ids[other] - ids[i]), ids[i] - Math.sign(ids[other] - ids[i])].find(ok);
      if (j != null) ids[i] = j;
    }
  }
  return ids.map((k) => allowed[k]);
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

// Finger for a note in a five-finger position whose lowest key is `lo` (RH thumb / LH pinky).
// Notes just outside the position (a half step below the LH pinky, e.g. F♯ in G position)
// are played by the reaching pinky.
function positionFingers(key, lo, midi, hand) {
  const d = diatonic(key.spell(midi)) - diatonic(key.spell(lo));
  if (d < 0) return hand === 'L' && d === -1 ? 5 : null;
  if (d > 4) return hand === 'R' && d === 5 ? 5 : null;
  return hand === 'R' ? d + 1 : 5 - d;
}

// Fingering for a part (one hand's events, sorted): the hand sits over five neighbouring
// notes of the scale and moves when a note falls outside them. Returns per event
// {fingers, shift, winLo} (winLo = diatonic index of the note under RH thumb / LH pinky).
export function fingerPart(evs, key, hand) {
  const dOf = (m) => diatonic(key.spell(m));
  const out = [];
  let lo = null;
  for (let i = 0; i < evs.length; i++) {
    const ds = evs[i].midis.map(dOf);
    const mn = Math.min(...ds),
      mx = Math.max(...ds);
    let shift = false;
    if (lo == null || mn < lo || mx > lo + 4) {
      // Look ahead: which notes can one hand position cover from here?
      let a = mn,
        b = mx;
      for (let j = i + 1; j < evs.length && j < i + 12; j++) {
        const dj = evs[j].midis.map(dOf);
        const na = Math.min(a, ...dj),
          nb = Math.max(b, ...dj);
        if (nb - na > 4) break;
        a = na;
        b = nb;
      }
      const goingDown = lo != null && mx < lo;
      const nlo = b - a > 4 ? a : goingDown ? b - 4 : a;
      shift = lo != null && nlo !== lo;
      lo = nlo;
    }
    let fingers;
    if (mx - mn > 4) {
      // Wider than a hand position (an octave, a sixth): outer fingers.
      fingers = ds.map((d, k) => (k === 0 ? (hand === 'R' ? 1 : 5) : k === ds.length - 1 ? (hand === 'R' ? 5 : 1) : hand === 'R' ? Math.min(4, 1 + d - mn) : Math.max(2, 5 - (d - mn))));
      lo = null;
    } else fingers = ds.map((d) => (hand === 'R' ? d - lo + 1 : 5 - (d - lo)));
    out.push({ fingers, shift, winLo: lo ?? mn });
  }
  return out;
}

// Standard fingering for a block triad: LH 5-3-1 (5-2-1 when the lower interval is a fourth),
// RH 1-3-5 (1-2-5 when the upper interval is a fourth).
function chordFingers(midis, hand) {
  if (midis.length === 1) return [hand === 'R' ? 1 : 5];
  if (midis.length === 2) return midis[1] - midis[0] > 9 ? (hand === 'R' ? [1, 5] : [5, 1]) : hand === 'R' ? [1, midis[1] - midis[0] >= 7 ? 5 : 3] : [midis[1] - midis[0] >= 7 ? 5 : 3, 1];
  if (midis.length === 3) {
    if (hand === 'L') return midis[1] - midis[0] === 5 ? [5, 2, 1] : [5, 3, 1];
    return midis[2] - midis[1] === 5 ? [1, 2, 5] : [1, 3, 5];
  }
  return hand === 'L' ? [5, 3, 2, 1].slice(-midis.length) : [1, 2, 3, 5].slice(0, midis.length);
}

// Levels 9-16: finger numbers where they help (a hand's first note, after a position shift,
// and when a hand comes back in after a rest of a bar or more), not on every note.
function hintFingers(events, key, hand, beatsPer) {
  const evs = events.filter((e) => e.hand === hand && !e.rest && !e.tiedFrom && e.midis.length).sort((a, b) => a.beat - b.beat);
  const f = fingerPart(evs, key, hand);
  let prevEnd = -Infinity;
  evs.forEach((e, i) => {
    const reentry = e.beat - prevEnd >= beatsPer - 1e-6;
    e.fingers = i === 0 || f[i].shift || reentry ? f[i].fingers : null;
    prevEnd = e.beat + e.dur;
  });
}

function pickKey(rng, lv) {
  const pool = lv.focusKeys && lv.focusKeys.length && rng.chance(0.6) ? lv.focusKeys : lv.keys;
  const [f, mode] = rng.pick(pool);
  return new Key(f, mode);
}

// Five-finger range above a position's lowest key.
function positionRange(key, lo) {
  return [lo, diatonicToMidi(diatonic(key.spell(lo)) + 4, key)];
}

// The recipe for a level, or its both-hands variant for the placement test. One-hand levels
// (1-3) become "hands take turns" in C position: both hands play, never at the same time,
// so a beginner is tested fairly.
function recipe(levelN, opts) {
  let lv = levelInfo(levelN);
  if (opts.bothHands && (lv.hands === 'R' || lv.hands === 'L')) {
    const src = lv.rh || lv.lh;
    const part = { motion: src.motion, rhythm: src.rhythm };
    lv = {
      ...lv,
      hands: 'alt',
      altFirst: lv.hands,
      rh: lv.rh || { lo: 60, hi: 67, ...part },
      lh: lv.lh && lv.lh.style === 'melody' ? lv.lh : { style: 'melody', lo: 48, hi: 55, ...part },
      pos: { R: 60, L: 48 },
      minRests: 0,
    };
  }
  return lv;
}

export function generate(levelN, opts = {}) {
  const lv = recipe(levelN, opts);
  const seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
  const rng = makeRng(seed);
  const kind = opts.kind || 'sight';
  if (kind === 'scale' || kind === 'arpeggio') return techniquePiece(lv, rng, seed, kind, opts);
  if (kind === 'fivefinger') return fiveFingerPiece(lv, rng, seed, opts);
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
  const add = (e) => {
    const ev = { id: nextId++, ...e };
    events.push(ev);
    return ev;
  };

  // --- rhythm skeletons -------------------------------------------------------------------
  const mkRhythm = (weights, must) => {
    const rr = [];
    const bars = partRhythm(rng, weights, measures, beatsPer, ts.compound, simpleRhythm, must);
    bars.forEach((cells, m) => {
      for (const c of cells) {
        const abs = m * beatsPer + c.beat;
        const strong = Math.abs(c.beat) < 1e-6 || (!ts.compound && beatsPer === 4 && Math.abs(c.beat - 2) < 1e-6) || (ts.compound && Math.abs(c.beat - 1.5) < 1e-6);
        rr.push({ ...c, abs, measure: m, strong });
      }
    });
    return rr;
  };

  const hands = lv.hands;
  const staves = hands === 'R' ? ['treble'] : hands === 'L' ? ['bass'] : ['treble', 'bass'];
  const rhLo = lv.rh ? lv.rh.lo : 60,
    rhHi = lv.rh ? lv.rh.hi : 72;

  // Position levels are defined in C; move them to the key's tonic.
  let rhRange = [rhLo, rhHi];
  let lhRange = lv.lh ? [lv.lh.lo, lv.lh.hi] : [48, 55];
  if (lv.fingers && !lv.pos && key.fifths !== 0 && key.fifths !== 1) {
    const shift = ((key.tonicPc - 0 + 12) % 12) > 6 ? ((key.tonicPc + 12) % 12) - 12 : (key.tonicPc + 12) % 12;
    rhRange = [rhLo + shift, rhHi + shift];
    lhRange = [lhRange[0] + shift, lhRange[1] + shift];
  }
  // Five-finger positions (levels 1-8): the lowest key under each hand.
  const pos = lv.pos ? { R: lv.pos.R ?? null, L: lv.pos.L ?? null } : null;
  const positions = {};
  if (pos) for (const h of ['R', 'L']) if (pos[h] != null) positions[h] = positionRange(key, pos[h]);

  // Which measures each hand plays in 'alt' mode: phrases of 1-2 measures.
  const phraseLen = measures >= 6 ? 2 : 1;
  const firstPhrase = lv.altFirst === 'L' ? 1 : 0;
  const rhPlays = (m) => hands !== 'alt' || Math.floor(m / phraseLen) % 2 === firstPhrase;
  const lhPlays = (m) => hands === 'alt' && !rhPlays(m);
  const melodyOpts = (hand) => ({
    startTonic: lv.n <= 8,
    maxLeap: lv.n >= 30 ? 7 : 5,
    recoverLeaps: lv.n < 27,
    noTritone: lv.n < 29,
    endStep: lv.n <= 4 ? 1 : 2,
    allowDominant: lv.n >= 9,
    wantAltered: lv.n >= 8 && lv.n <= 21 && hand === 'R',
  });

  // --- right hand -------------------------------------------------------------------------
  if (hands !== 'L' && lv.rh) {
    const rr = mkRhythm(lv.rh.rhythm, lv.newRhythm);
    const line = melodyLine(rng, key, rhRange[0], rhRange[1], lv.rh.motion, rr, harmonyAt, {
      ...melodyOpts('R'),
      endTonic: hands !== 'alt' || rhPlays(measures - 1),
      plays: rhPlays,
    });
    if (key.mode === 'minor') fixMinorSeventh(key, line, rr, harmonyDegreeAt, rhRange[0], rhRange[1]);
    if (lv.chromatic || lv.rh.chromatic) addChromatic(rng, line, rr, lv.chromatic || lv.rh.chromatic);
    const chordOk = (r) => (lv.n < 17 ? r.dur >= 1 : r.dur >= 0.5);
    const floor = lv.n < 17 ? Math.max(lhRange[1] + 1, rhRange[0]) : Math.max(lhRange[1] + 1, rhRange[0] - 5);
    const rhEvents = [];
    const rhIdx = rr.map((r, i) => i).filter((i) => rhPlays(rr[i].measure));
    const rhEdge = new Set([rhIdx[0], ...rhIdx.slice(-2)]);
    rr.forEach((r, i) => {
      if (!rhPlays(r.measure)) return;
      const isEdge = rhEdge.has(i);
      const rest = !isEdge && lv.rests && !r.strong && rng.chance(lv.rests);
      let midis = rest ? [] : [line[i]];
      if (!rest && lv.rh.chords && chordOk(r) && rng.chance(lv.rh.chords)) {
        midis = buildRhChord(key, line[i], lv.rh.chordSize || 2, harmonyAt(r.abs), floor, lv.n);
      }
      rhEvents.push(add({ staff: 'treble', hand: 'R', beat: r.abs, dur: r.dur, midis, rest, tuplet: r.tuplet, fingers: null, _r: r }));
    });
    // The level that teaches rests / intervals always has some.
    ensureRests(rhEvents, lv.minRests || 0, rng);
    if (lv.minChords) {
      let have = rhEvents.filter((e) => e.midis.length >= 2).length;
      // First as written, then letting the melody note move one scale step to a chord tone
      // that can carry the interval (never the first or last note).
      for (const nudge of [false, true]) {
        for (const e of shuffled(rng, rhEvents)) {
          if (have >= lv.minChords) break;
          if (e.rest || e.midis.length !== 1 || !chordOk(e._r)) continue;
          const i = rhEvents.indexOf(e);
          const tops = [e.midis[0]];
          if (nudge && i > 0 && i < rhEvents.length - 1) {
            for (const d of [1, -1, 2, -2]) {
              const m = e.midis[0] + d;
              if (m >= rhRange[0] && m <= rhRange[1] && key.inKey(m)) tops.push(m);
            }
          }
          for (const top of tops) {
            const m = buildRhChord(key, top, lv.rh.chordSize || 2, harmonyAt(e.beat), floor, lv.n);
            if (m.length > 1) {
              e.midis = m;
              have++;
              break;
            }
          }
        }
      }
    }
    for (const e of rhEvents) delete e._r;
    breakRuns(rhEvents, key, rhRange[0], rhRange[1]);
    if (positions.R) for (const e of rhEvents) if (!e.rest) e.fingers = e.midis.map((m) => positionFingers(key, pos.R, m, 'R'));
    if (hands === 'alt') fillRests(add, 'treble', 'R', measures, beatsPer, (m) => !rhPlays(m));
  }

  // --- left hand --------------------------------------------------------------------------
  if (lv.lh && (hands === 'L' || hands === 'alt' || hands === 'both')) {
    const style = hands === 'L' || hands === 'alt' ? 'melody' : lv.lh.style;
    if (style === 'melody' || style === 'counter') {
      const rr = mkRhythm(lv.lh.rhythm || { h: 2, q: 3 }, hands === 'L' ? lv.newRhythm : null);
      const line = melodyLine(rng, key, lhRange[0], lhRange[1], lv.lh.motion || { step: 6, skip: 3 }, rr, harmonyAt, {
        ...melodyOpts('L'),
        endTonic: true,
        plays: hands === 'alt' ? lhPlays : null,
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
      } else if (key.mode === 'minor') fixMinorSeventh(key, line, rr, harmonyDegreeAt, lhRange[0], lhRange[1]);
      const lhEvents = [];
      const lhIdx = rr.map((r, i) => i).filter((i) => hands !== 'alt' || lhPlays(rr[i].measure));
      const lhEdge = new Set([lhIdx[0], ...lhIdx.slice(-2)]);
      rr.forEach((r, i) => {
        if (hands === 'alt' && !lhPlays(r.measure)) return;
        const isEdge = lhEdge.has(i);
        const rest = !isEdge && lv.rests && !r.strong && rng.chance(lv.rests);
        const midis = rest ? [] : [line[i]];
        lhEvents.push(add({ staff: 'bass', hand: 'L', beat: r.abs, dur: r.dur, midis, rest, tuplet: r.tuplet, fingers: null, _r: r }));
      });
      if (hands === 'L') ensureRests(lhEvents, lv.minRests || 0, rng);
      for (const e of lhEvents) delete e._r;
      if (style === 'melody') breakRuns(lhEvents, key, lhRange[0], lhRange[1]);
      if (positions.L) for (const e of lhEvents) if (!e.rest) e.fingers = e.midis.map((m) => positionFingers(key, pos.L, m, 'L'));
      if (hands === 'alt') fillRests(add, 'bass', 'L', measures, beatsPer, (m) => !lhPlays(m));
    } else {
      accompaniment(rng, add, style, key, prog, perMeasure, measures, beatsPer, ts, lhRange, lv, pos);
    }
  }

  // Optional ties (syncopation levels): tie the last note of a measure into the next downbeat.
  if (lv.rh && lv.rh.rhythm && lv.rh.rhythm.syn) addTies(rng, events, beatsPer);

  // Elementary levels: finger numbers at the start and wherever the hand has to move.
  if (lv.n >= 9 && lv.n <= 16) {
    if (lv.rh && hands !== 'L') hintFingers(events, key, 'R', beatsPer);
    if (lv.lh && (hands === 'alt' || lv.lh.style === 'counter')) hintFingers(events, key, 'L', beatsPer);
  }

  const extensions = [];
  if (pos && pos.L != null) {
    const ext = events.find((e) => e.hand === 'L' && !e.rest && e.midis.some((m) => m < positions.L[0]));
    if (ext) {
      const m = Math.min(...ext.midis);
      const five = pcName(key.degreeToMidi(4, key.tonicNear(60)), key);
      extensions.push({ hand: 'L', midi: m, finger: 5, name: noteName(m, key), why: `the ${five} chord` });
    }
  }

  return finish({
    seed, level: lv.n, kind, title: lv.title, key, ts, tsName, bpm, measures, beatsPer, staves, events,
    harmony: prog.map((d, i) => ({ beat: (i * beatsPer) / perMeasure, degree: d })),
    fingers: lv.fingers,
  }, { level: lv.n, positions: posCtx(key, positions, pos), extensions });
}

function posCtx(key, positions, pos) {
  const out = {};
  for (const h of Object.keys(positions)) out[h] = { lo: positions[h][0], hi: positions[h][1], anchor: { midi: pos[h], finger: h === 'R' ? 1 : 5 } };
  return out;
}

function shuffled(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Turn weak-beat notes into rests until there are at least `n` (never the first or last note).
function ensureRests(evs, n, rng) {
  let have = evs.filter((e) => e.rest && !e.measureRest).length;
  if (have >= n) return;
  const cands = evs.filter((e, i) => i > 0 && i < evs.length - 2 && !e.rest && e.dur <= 1 && !isStrong(e) && !evs[i - 1].rest && !(evs[i + 1] && evs[i + 1].rest));
  for (const e of shuffled(rng, cands)) {
    if (have >= n) break;
    e.rest = true;
    e.midis = [];
    e.fingers = null;
    have++;
  }
}
function isStrong(e) {
  return !e._r || e._r.strong;
}

// Minor keys: the melody avoids the natural 7th over V (it clashes with the raised leading
// tone in the bass). It takes the leading tone instead, or the nearest chord tone when the
// leading tone would make an augmented second.
function fixMinorSeventh(key, line, rr, degreeAt, lo = 0, hi = 127) {
  const pcs = key.scalePcs();
  const nat7 = pcs[6];
  for (let i = 0; i < line.length; i++) {
    if (pcOf(line[i]) !== nat7 || degreeAt(rr[i].abs) !== 4) continue;
    const nb = [line[i - 1], line[i + 1]].filter((x) => x != null);
    const awkward = (m) => nb.some((x) => (Math.abs(x - m) === 3 && (pcOf(x) === pcs[5] || pcOf(m) === pcs[5])) || Math.abs(x - m) === 6);
    // The raised leading tone, else a chord tone of V close by (dominant below or above).
    const dom = (d) => [1, 2, 3, 4, 5].map((k) => line[i] + d * k).find((m) => pcOf(m) === pcs[4]);
    const cands = [line[i] + 1, dom(-1), dom(1)].filter((m) => m != null && m >= lo && m <= hi);
    line[i] = cands.find((m) => !awkward(m)) ?? cands[0] ?? line[i];
  }
}

// Four equal notes in a row (a rest in between doesn't help) sound stuck: move the third one
// a scale step (never the first note or the last two).
function breakRuns(evs, key, lo, hi) {
  const sounding = evs.filter((e) => !e.rest && e.midis.length === 1);
  for (let k = 3; k < sounding.length - 2; k++) {
    const [a, b, c, d] = sounding.slice(k - 3, k + 1).map((e) => e.midis[0]);
    if (!(a === b && b === c && c === d)) continue;
    const e = sounding[k - 1];
    const m = e.midis[0];
    const up = [m + 1, m + 2].find((x) => key.inKey(x) && x <= hi);
    const down = [m - 1, m - 2].find((x) => key.inKey(x) && x >= lo);
    const next = m > (lo + hi) / 2 ? down ?? up : up ?? down;
    if (next != null) e.midis = [next];
  }
}

function buildRhChord(key, top, size, harmonyPcs, floor, level = 20) {
  const notes = [top];
  const pcs = key.scalePcs();
  if (size === 2) {
    // A third or fifth below (the intervals the level teaches); sixths from level 17. The
    // lower note belongs to the harmony, so the interval never clashes with the chord.
    const ivs = level < 17 ? [3, 4, 7] : [3, 4, 8, 9];
    const opts = [];
    for (let m = top - 3; m >= top - 9; m--) if (m >= floor && pcs.includes(pcOf(m)) && ivs.includes(top - m) && harmonyPcs.includes(pcOf(m))) opts.push(m);
    if (opts.length) notes.unshift(opts[0]);
    return notes;
  }
  let m = top - 1;
  while (notes.length < size && m > top - 12 && m >= floor) {
    if (harmonyPcs.includes(pcOf(m)) && notes[0] - m >= 3) notes.unshift(m);
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

function accompaniment(rng, add, style, key, prog, perMeasure, measures, beatsPer, ts, [lo, hi], lv, pos) {
  const span = beatsPer / perMeasure;
  let prevVoicing = null;
  const posL = pos && pos.L != null ? pos.L : null;
  const fingersFor = (midis, i) => {
    if (posL != null) return midis.map((m) => positionFingers(key, posL, m, 'L'));
    if (lv.n > 16) return null;
    // Elementary levels: finger the first chord, and every chord at the level that
    // introduces left-hand triads.
    if (i === 0 || (midis.length >= 3 && lv.n <= 16)) return chordFingers(midis, 'L');
    return null;
  };
  for (let i = 0; i < prog.length; i++) {
    const deg = prog[i];
    const start = i * span;
    const pcs = chordPcs(key, deg, style === 'seventh' || (lv.sevenths && style === 'walking'));
    const rootBase = nearestWithPc(pcs[0], lo + 5, lo, hi) ?? lo;
    let first = true;
    const emit = (beat, dur, midis) => {
      const ms = midis.filter((m) => m != null);
      add({ staff: 'bass', hand: 'L', beat, dur, midis: ms, rest: false, fingers: first ? fingersFor(ms, i) : posL != null ? fingersFor(ms, i) : null });
      first = false;
    };
    const last = i === prog.length - 1;
    switch (style) {
      case 'pedal': {
        // G position (level 8): the pinky reaches down to the leading tone (F♯) under the
        // cadence's V chord.
        let m = rootBase;
        if (lv.lh.leading && deg === 4 && i === prog.length - 2) {
          const lead = nearestWithPc((key.tonicPc + 11) % 12, lo - 1, lo - 2, lo);
          if (lead != null) m = lead;
        }
        emit(start, span, [m]);
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
        // The final chord is in root position so the piece really ends.
        const voicing = voiceLead(pcs, prevVoicing, lo + 4, hi, last);
        prevVoicing = voicing;
        if (span >= 4 && lv.n >= 20 && !last) {
          emit(start, 2, voicing);
          emit(start + 2, 2, voicing);
        } else emit(start, span, voicing);
        break;
      }
      case 'broken': {
        let pattern, r;
        if (lv.n < 20) {
          // Close position under one hand: root, third, fifth, third (fingers 5-3-1-3).
          r = nearestWithPc(pcs[0], lo + 8, lo, hi) ?? rootBase;
          const t = nearestWithPc(pcs[1], r + 4, r + 1, r + 5);
          const f = nearestWithPc(pcs[2], r + 7, r + 5, r + 8);
          pattern = [r, t, f, t];
        } else {
          r = rootBase;
          const f = nearestWithPc(pcs[2], r + 7, r, r + 12);
          let t = nearestWithPc(pcs[1], r + 15, r + 12, r + 17);
          if (t == null || t > hi + 2) t = nearestWithPc(pcs[1], r + 4, r, r + 12);
          pattern = [r, f, t, f];
        }
        if (ts.compound) {
          const pat = [...pattern, pattern[2], pattern[1]];
          if (last) emit(start, span, [r]);
          else pat.forEach((m, k) => emit(start + k * 0.5, 0.5, [m]));
        } else if (last) emit(start, span, [r]);
        else for (let k = 0; k < span; k++) emit(start + k, 1, [pattern[k % 4]]);
        break;
      }
      case 'alberti': {
        // Keep the broken chord on the bass staff (top note at most middle C).
        const v = voiceLead(pcs.slice(0, 3), prevVoicing, lo + 5, Math.min(hi, 60) - 2);
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
// `rootPosition` (final chords) keeps the root in the bass.
function voiceLead(pcs, prev, lo, hi, rootPosition = false) {
  const candidates = [];
  for (let bass = lo - 6; bass <= hi; bass++) {
    const pcb = pcOf(bass);
    if (!pcs.includes(pcb)) continue;
    const v = [bass];
    let m = bass;
    const remaining = pcs.filter((p, i) => i !== pcs.indexOf(pcb));
    while (v.length < pcs.length) {
      m++;
      if (remaining.includes(pcOf(m))) v.push(m);
      if (m > bass + 14) break;
    }
    if (v.length === pcs.length && v[v.length - 1] <= hi + 2 && v[0] >= lo - 6) candidates.push(v);
  }
  if (!candidates.length) return pcs.map((p) => nearestWithPc(p, lo + 6, lo - 6, hi + 6));
  const root = candidates.filter((v) => pcOf(v[0]) === pcs[0]);
  if (!prev) {
    // Start in root position if possible.
    const target = (lo + hi) / 2 - 4;
    return (root.length ? root : candidates).sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0];
  }
  const cost = (v) => v.reduce((a, m, i) => a + Math.abs(m - (prev[i] ?? prev[prev.length - 1])), 0);
  const pool = rootPosition && root.length ? root : candidates;
  return pool.sort((a, b) => cost(a) - cost(b))[0];
}

// --- technique ----------------------------------------------------------------------------
// One-octave scale fingerings, ascending (the descent reverses them).
const SCALE_FINGERS = {
  white: { R: [1, 2, 3, 1, 2, 3, 4, 5], L: [5, 4, 3, 2, 1, 3, 2, 1] },
  '-1major': { R: [1, 2, 3, 4, 1, 2, 3, 4], L: [5, 4, 3, 2, 1, 3, 2, 1] },
  '-2major': { R: [4, 1, 2, 3, 1, 2, 3, 4], L: [3, 2, 1, 4, 3, 2, 1, 3] },
  '-3major': { R: [3, 1, 2, 3, 4, 1, 2, 3], L: [3, 2, 1, 4, 3, 2, 1, 3] },
  '-4major': { R: [3, 4, 1, 2, 3, 1, 2, 3], L: [3, 2, 1, 4, 3, 2, 1, 3] },
};
const WHITE_START = new Set(['0major', '1major', '2major', '3major', '4major', '0minor', '1minor', '-1minor', '-2minor', '-3minor']);
function scaleFingering(key, hand) {
  const k = `${key.fifths}${key.mode}`;
  if (WHITE_START.has(k)) return SCALE_FINGERS.white[hand];
  return SCALE_FINGERS[k] ? SCALE_FINGERS[k][hand] : null;
}

// Tonic of `key` in [lo, hi] (the octave window a part should start in).
function tonicIn(key, lo, hi) {
  for (let m = lo; m <= hi; m++) if (pcOf(m) === key.tonicPc) return m;
  return key.tonicNear(lo);
}

function padRests(events, handsList, measures, beatsPer) {
  for (const hand of handsList) {
    const staff = hand === 'R' ? 'treble' : 'bass';
    const mine = events.filter((e) => e.hand === hand);
    let pos = mine.length ? Math.max(...mine.map((e) => e.beat + e.dur)) : 0;
    while (pos < measures * beatsPer - 1e-9) {
      const d = Math.min(measures * beatsPer - pos, pos % 1 === 0 && measures * beatsPer - pos >= 2 && pos % 2 === 0 ? 2 : 1 - (pos % 1) || 1);
      events.push({ id: nextId++, staff, hand, beat: pos, dur: d, midis: [], rest: true });
      pos += d;
    }
  }
}

function techniquePiece(lv, rng, seed, kind, opts) {
  const key = opts.key || pickKey(rng, lv);
  const octaves = lv.n >= 25 ? 2 : 1;
  // Scales are introduced one hand at a time; hands together from level 20.
  const oneHand = lv.hands === 'L' ? 'L' : lv.hands === 'R' ? 'R' : lv.n < 20 ? (rng.chance(0.5) ? 'R' : 'L') : null;
  const handsList = oneHand ? [oneHand] : ['R', 'L'];
  const dur = lv.n < 20 ? 1 : lv.n < 30 ? 0.5 : 0.25;
  const beatsPer = 4;
  const events = [];
  let bpm = opts.bpm || Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * (opts.tempoFactor ?? 0.5));
  if (dur === 1) bpm = Math.round(lv.bpm[0] * 0.95);
  const firstFingers = {};
  for (const hand of handsList) {
    // Start where the staff needs few ledger lines: RH from the tonic above middle C, LH from
    // the tonic in the bass staff's middle.
    const tonic = hand === 'R' ? (octaves === 2 ? tonicIn(key, 55, 66) : tonicIn(key, 60, 71)) : octaves === 2 ? tonicIn(key, 34, 45) : tonicIn(key, 40, 51);
    let up = [];
    if (kind === 'scale') {
      for (let d = 0; d <= 7 * octaves; d++) up.push(key.degreeToMidi(d, tonic));
      if (key.mode === 'minor' && lv.n >= 15) {
        // Harmonic minor: raise the 7th.
        const pcs = key.scalePcs();
        up = up.map((m) => (pcOf(m) === pcs[6] ? m + 1 : m));
      }
    } else {
      const deg = [0, 2, 4];
      for (let o = 0; o < octaves; o++) for (const d of deg) up.push(key.degreeToMidi(d + 7 * o, tonic));
      up.push(key.degreeToMidi(7 * octaves, tonic));
    }
    const seq = [...up, ...up.slice(0, -1).reverse()];
    let fingers = null;
    if (kind === 'scale' && octaves === 1) {
      const upF = scaleFingering(key, hand);
      if (upF) fingers = [...upF, ...upF.slice(0, -1).reverse()];
    } else if (kind === 'arpeggio' && octaves === 1) {
      const upF = hand === 'R' ? [1, 2, 3, 5] : [5, 4, 2, 1];
      fingers = [...upF, ...upF.slice(0, -1).reverse()];
    }
    if (fingers) firstFingers[hand] = fingers[0];
    seq.forEach((m, i) => {
      events.push({ id: nextId++, staff: hand === 'R' ? 'treble' : 'bass', hand, beat: i * dur, dur: i === seq.length - 1 ? Math.max(dur, 1) : dur, midis: [m], rest: false, fingers: fingers ? [fingers[i]] : null });
    });
  }
  const total = Math.max(...events.map((e) => e.beat + e.dur));
  const measures = Math.ceil(total / beatsPer - 1e-9);
  padRests(events, handsList, measures, beatsPer);
  return finish({
    seed, level: lv.n, kind, title: `${key.name} ${kind === 'scale' ? 'scale' : 'arpeggio'}${oneHand ? `, ${HAND_WORD[oneHand]} hand` : ''}`,
    key, ts: TIME_SIGS['4/4'], tsName: '4/4', bpm, measures, beatsPer,
    staves: handsList.length === 2 ? ['treble', 'bass'] : handsList[0] === 'R' ? ['treble'] : ['bass'],
    events, harmony: [], fingers: !!events.find((e) => e.fingers),
  }, { level: lv.n });
}

// Five-finger warm-up: up and down the hand position, then a broken triad (1-3-5-3-1).
// Levels 1-8 use their own positions; later levels a position on the key's tonic. Hands play
// one after the other until level 9, together after that.
function fiveFingerPiece(lv, rng, seed, opts) {
  const key = opts.key || pickKey(rng, lv);
  const beatsPer = 4;
  const used = lv.hands === 'R' ? ['R'] : lv.hands === 'L' ? ['L'] : ['R', 'L'];
  const together = used.length === 2 && lv.n >= 9;
  const posOf = (h) => (lv.pos && lv.pos[h] != null ? lv.pos[h] : h === 'R' ? tonicIn(key, 60, 71) : tonicIn(key, 41, 52));
  const eighths = lv.n >= 12;
  const d = eighths ? 0.5 : 1;
  const shape = rng.pick(eighths ? [[0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 2, 0, 1, 2, 1], [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 2, 0, 2]] : [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 4, 2, 0, 1, 2, 1]]);
  const events = [];
  const positions = {};
  let beat = 0;
  const phraseLen = shape.length * d + 4; // pattern, then a whole-note tonic
  const bars = Math.ceil(phraseLen / beatsPer);
  used.forEach((h, k) => {
    const lo = posOf(h);
    const [, hi] = positionRange(key, lo);
    positions[h] = { lo, hi, anchor: { midi: lo, finger: h === 'R' ? 1 : 5 } };
    const start = together ? 0 : k * bars * beatsPer;
    const staff = h === 'R' ? 'treble' : 'bass';
    const base = diatonic(key.spell(lo));
    shape.forEach((deg, i) => {
      const m = diatonicToMidi(base + deg, key);
      events.push({ id: nextId++, staff, hand: h, beat: start + i * d, dur: d, midis: [m], rest: false, fingers: [h === 'R' ? deg + 1 : 5 - deg] });
    });
    const end = start + shape.length * d;
    events.push({ id: nextId++, staff, hand: h, beat: end, dur: bars * beatsPer - shape.length * d, midis: [lo], rest: false, fingers: [h === 'R' ? 1 : 5] });
    beat = Math.max(beat, start + bars * beatsPer);
  });
  const measures = Math.ceil(beat / beatsPer);
  // The waiting hand rests.
  if (!together && used.length === 2) {
    fillRests((e) => events.push({ id: nextId++, ...e }), 'bass', 'L', bars, beatsPer, () => true);
    for (let m = bars; m < measures; m++) events.push({ id: nextId++, staff: 'treble', hand: 'R', beat: m * beatsPer, dur: beatsPer, midis: [], rest: true, measureRest: true });
  }
  const bpm = opts.bpm || Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * Math.min(0.5, opts.tempoFactor ?? 0.3));
  const name = lv.pos ? `${noteName(posOf(used[0]), key).replace(/-?\d+$/, '')} position` : `${key.name.replace(' major', '').replace(' minor', ' minor')} five-finger`;
  return finish({
    seed, level: lv.n, kind: 'fivefinger', title: `${name} warm-up`, key, ts: TIME_SIGS['4/4'], tsName: '4/4', bpm, measures, beatsPer,
    staves: used.length === 2 ? ['treble', 'bass'] : used[0] === 'R' ? ['treble'] : ['bass'], events, harmony: [], fingers: true,
  }, { level: lv.n, positions });
}

// Chord warm-up. Until right-hand chords arrive (level 20), the left hand practises the I, IV
// and V triads with fingering; from level 20 the right hand plays triads over bass roots.
function chordPiece(lv, rng, seed, opts) {
  const key = opts.key || pickKey(rng, lv);
  const prog = key.mode === 'major' ? rng.pick([[0, 3, 4, 0], [0, 5, 3, 4, 0], [0, 3, 0, 4, 0]]) : [0, 3, 4, 0];
  const events = [];
  let prev = null;
  const dur = 2;
  const lhChords = lv.n < 20;
  prog.forEach((deg, i) => {
    const pcs = chordPcs(key, deg);
    const last = i === prog.length - 1;
    if (lhChords) {
      const v = voiceLead(pcs, prev, 47, 59, last);
      prev = v;
      events.push({ id: nextId++, staff: 'bass', hand: 'L', beat: i * dur, dur, midis: v, rest: false, fingers: lv.n <= 26 ? chordFingers(v, 'L') : null });
    } else {
      const v = voiceLead(pcs, prev, 64, 74, last);
      prev = v;
      events.push({ id: nextId++, staff: 'treble', hand: 'R', beat: i * dur, dur, midis: v, rest: false, fingers: lv.n <= 26 ? chordFingers(v, 'R') : null });
      const root = nearestWithPc(pcs[0], 48, 41, 55);
      if (lv.hands === 'both') events.push({ id: nextId++, staff: 'bass', hand: 'L', beat: i * dur, dur, midis: [root], rest: false });
    }
  });
  const beatsPer = 4;
  const total = prog.length * dur;
  const measures = Math.ceil(total / beatsPer);
  const staves = lhChords ? ['bass'] : lv.hands === 'both' ? ['treble', 'bass'] : ['treble'];
  if (total < measures * beatsPer) {
    for (const staff of staves) events.push({ id: nextId++, staff, hand: staff === 'treble' ? 'R' : 'L', beat: total, dur: measures * beatsPer - total, midis: [], rest: true });
  }
  const bpm = opts.bpm || Math.round(lv.bpm[0] * 0.9);
  return finish({
    seed, level: lv.n, kind: 'chords', title: `${key.name} chords${lhChords ? ', left hand' : ''}`, key, ts: TIME_SIGS['4/4'], tsName: '4/4', bpm, measures, beatsPer,
    staves, events, harmony: prog.map((d, i) => ({ beat: i * dur, degree: d })), fingers: lv.n <= 26,
  }, { level: lv.n });
}

function noteReadingPiece(lv, rng, seed, opts) {
  const key = opts.key || pickKey(rng, lv);
  const pcs = key.scalePcs();
  const count = opts.count || 12;
  const events = [];
  const pools = [];
  if (lv.hands !== 'L' && lv.rh) pools.push(['treble', 'R', lv.rh.lo, lv.rh.hi]);
  if (lv.hands !== 'R' && lv.lh) pools.push(['bass', 'L', lv.lh.lo, Math.min(lv.lh.hi, 60)]);
  const pos = lv.pos || null;
  const positions = {};
  if (pos) for (const h of ['R', 'L']) if (pos[h] != null) {
    const [lo, hi] = positionRange(key, pos[h]);
    positions[h] = { lo, hi, anchor: { midi: pos[h], finger: h === 'R' ? 1 : 5 } };
  }
  let prev = null;
  for (let i = 0; i < count; i++) {
    const [staff, hand, lo, hi] = rng.pick(pools);
    let m;
    let guard = 0;
    do {
      m = rng.int(lo, hi);
    } while ((!pcs.includes(pcOf(m)) || m === prev) && guard++ < 50);
    prev = m;
    const fingers = pos && pos[hand] != null ? [positionFingers(key, pos[hand], m, hand)] : null;
    events.push({ id: nextId++, staff, hand, beat: i * 2, dur: 2, midis: [m], rest: false, fingers });
    const other = staff === 'treble' ? 'bass' : 'treble';
    if (pools.length > 1) events.push({ id: nextId++, staff: other, hand: hand === 'R' ? 'L' : 'R', beat: i * 2, dur: 2, midis: [], rest: true });
  }
  return finish({
    seed, level: lv.n, kind: 'notes', title: 'Note reading', key, ts: TIME_SIGS['4/4'], tsName: '4/4', bpm: 60,
    measures: Math.ceil((count * 2) / 4), beatsPer: 4, staves: pools.length > 1 ? ['treble', 'bass'] : [pools[0][0]], events, harmony: [],
    waitOnly: true, fingers: !!pos,
  }, { level: lv.n, positions });
}

// Which key a rhythm drill suggests: the key under the level's hand position (right thumb on
// middle C, left pinky on C3, right thumb on G4 in G position), or later the tonic of one of
// the level's keys near middle C. Any key counts; this one just keeps the hand in place.
function rhythmKeyFor(lv, rng) {
  const p = lv.pos || {};
  let hand = lv.hands === 'L' ? 'L' : 'R';
  if (lv.hands === 'alt' && p.L != null && rng.chance(0.5)) hand = 'L';
  if (p[hand] != null) return { midi: p[hand], hand, finger: hand === 'R' ? 1 : 5 };
  if (lv.n <= 8) return hand === 'L' ? { midi: 48, hand, finger: 5 } : { midi: 60, hand, finger: 1 };
  const key = pickKey(rng, lv);
  const t = tonicIn(key, 60, 71);
  return isBlack(t) ? { midi: 60, hand: 'R', finger: 1 } : { midi: t, hand: 'R', finger: 1 };
}

// Rhythm drill: the level's rhythm vocabulary on a single line; any key counts.
export function generateRhythm(levelN, opts = {}) {
  const lv = levelInfo(levelN);
  const seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
  const rng = makeRng(seed);
  const tsName = opts.time || rng.pick(lv.time);
  const ts = TIME_SIGS[tsName];
  const measures = opts.measures || 4;
  const weights = { ...(lv.rh && lv.hands !== 'L' ? lv.rh.rhythm : lv.lh.rhythm) };
  const sk = rhythmKeyFor(lv, rng);
  const key = new Key(0);
  const events = [];
  // Rests only from the level that teaches them: quarter rests on weak beats, eighth rests
  // (off-beats) from level 12.
  const restP = lv.rests ? Math.min(0.2, lv.rests * 2) : 0;
  const bars = partRhythm(rng, weights, measures, ts.beats, ts.compound, lv.n < 17, lv.newRhythm);
  let rests = 0;
  bars.forEach((cells, m) => {
    cells.forEach((c, i) => {
      const edge = (m === 0 && i === 0) || (m === measures - 1 && i === cells.length - 1);
      const offbeat = c.beat % 1 !== 0;
      const weakBeat = !offbeat && c.beat % 2 !== 0 && Math.abs(c.dur - 1) < 1e-6;
      let rest = false;
      if (!edge && restP) {
        if (offbeat) rest = lv.n >= 12 && rng.chance(0.1);
        else if (weakBeat) rest = rng.chance(restP);
      }
      if (rest) rests++;
      events.push({ id: nextId++, staff: 'rhythm', hand: sk.hand, beat: m * ts.beats + c.beat, dur: c.dur, midis: rest ? [] : [sk.midi], rest, tuplet: c.tuplet });
    });
  });
  if (lv.minRests && rests < lv.minRests) {
    const cands = events.filter((e, i) => i > 0 && i < events.length - 1 && !e.rest && e.beat % 1 === 0 && (e.beat % ts.beats) % 2 === 1 && e.dur === 1);
    const e = cands.length ? cands[rng.int(0, cands.length - 1)] : null;
    if (e) (e.rest = true), (e.midis = []);
  }
  const bpm = opts.bpm || Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * (opts.tempoFactor ?? 0.5));
  const name = noteName(sk.midi, key);
  const handWord = HAND_WORD[sk.hand];
  const fw = FINGER_WORD[sk.finger];
  const suggestKey = {
    midi: sk.midi, name, hand: sk.hand, finger: sk.finger,
    text: `Any key works: only your rhythm counts. Try ${findableName(sk.midi, key, lv.n)} with your ${handWord} ${fw}.`,
    say: `Any key works. Try ${sayName(sk.midi, key, lv.n)} with your ${handWord} ${fw}.`,
  };
  return finish({
    seed, level: lv.n, kind: 'rhythm', title: 'Rhythm drill', key, ts, tsName, bpm, measures, beatsPer: ts.beats,
    staves: ['rhythm'], events, harmony: [], rhythmOnly: true, anyKey: true, suggestKey,
  }, { level: lv.n });
}

export function finish(p, ctx) {
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
    // Show the suggested key with middle C for orientation.
    const s = p.suggestKey ? p.suggestKey.midi : 60;
    lo = Math.min(s, 60) - 5;
    hi = Math.max(s, 60) + 7;
  }
  // Keyboard range: at least two octaves, snapped to C..B boundaries.
  lo = Math.floor((lo - 2) / 12) * 12;
  hi = Math.ceil((hi + 2) / 12) * 12;
  while (hi - lo < 24) {
    if (lo > 21) lo -= 12;
    if (hi - lo < 24 && hi < 108) hi += 12;
  }
  p.range = [Math.max(21, lo), Math.min(108, hi)];
  if (p.notes.length) {
    try {
      p.prep = buildPrep(p, ctx || {});
    } catch {
      p.prep = null; // never let the "get ready" hint break a piece
    }
  }
  return p;
}

export function describePiece(p) {
  return `${p.title} · ${p.key.name} · ${p.tsName} · ♩=${p.bpm}`;
}

// ---- "get ready" -----------------------------------------------------------------------------
// A short spoken name: "middle C", "the G above middle C", "low G"; later levels just "F sharp".
function sayName(midi, key, level) {
  if (midi === 60) return 'middle C';
  if (level <= 8) {
    const rel = middleCRelative(midi, key);
    if (rel && !rel.includes('second') && !rel.includes('third') && !rel.includes('fourth')) return rel.replace(/♯/g, ' sharp').replace(/♭/g, ' flat');
    return `${midi < 60 ? 'low' : 'high'} ${spokenPc(midi, key)}`;
  }
  return spokenPc(midi, key);
}

// Where the hands go before a piece starts, and what to play first.
//   hands[]        { hand, position: {lo, hi}, anchor: {midi, finger, name} }
//   first[]        { hand, midis, fingers, names, beat } (the first note or chord per hand)
//   outOfPosition  the piece needs notes outside one five-finger position
//   extensions[]   notes just outside a position that a finger reaches for (F♯ in G position)
//   say / text     a short spoken line and a slightly longer on-screen line
// ctx: { level, positions: {R|L: {lo, hi, anchor}}, extensions }
export function buildPrep(p, ctx = {}) {
  const level = ctx.level ?? p.level ?? 99;
  const key = p.key || new Key(0);
  const beginner = level <= 8;
  if (p.rhythmOnly && p.suggestKey) {
    const s = p.suggestKey;
    const firstEv = p.events.find((e) => !e.rest);
    return {
      level, anyKey: true,
      hands: [{ hand: s.hand, position: { lo: s.midi, hi: s.midi }, anchor: { midi: s.midi, finger: s.finger, name: s.name } }],
      first: [{ hand: s.hand, midis: [s.midi], fingers: [s.finger], names: [s.name], beat: firstEv ? firstEv.beat : 0 }],
      outOfPosition: false, extensions: [], say: s.say, text: s.text,
    };
  }
  const hands = [];
  const first = [];
  let outOfPosition = false;
  const extensions = ctx.extensions || [];
  for (const h of ['R', 'L']) {
    const evs = p.events.filter((e) => (e.hand || 'R') === h && !e.rest && !e.tiedFrom && e.midis && e.midis.length).sort((a, b) => a.beat - b.beat);
    if (!evs.length) continue;
    const given = ctx.positions && ctx.positions[h];
    let position, anchor, firstFingers;
    const f0 = evs[0];
    const sortedFirst = [...f0.midis].sort((a, b) => a - b);
    const eventFingers = f0.fingers && f0.fingers.length === f0.midis.length && f0.fingers.every(Boolean) ? f0.midis.map((m, i) => [m, f0.fingers[i]]).sort((a, b) => a[0] - b[0]).map((x) => x[1]) : null;
    if (given) {
      position = { lo: given.lo, hi: given.hi };
      anchor = { ...given.anchor, name: noteName(given.anchor.midi, key) };
      firstFingers = eventFingers || sortedFirst.map((m) => positionFingers(key, given.lo, m, h));
    } else {
      const fp = fingerPart(evs, key, h);
      const w = fp[0].winLo;
      position = { lo: diatonicToMidi(w, key), hi: diatonicToMidi(w + 4, key) };
      firstFingers = eventFingers || fp[0].fingers.map((x, i) => [f0.midis[i], x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      anchor = { midi: sortedFirst[0], finger: firstFingers[0] ?? null, name: noteName(sortedFirst[0], key) };
    }
    const extra = new Set(extensions.filter((x) => x.hand === h).map((x) => x.midi));
    if (evs.some((e) => e.midis.some((m) => (m < position.lo || m > position.hi) && !extra.has(m)))) outOfPosition = true;
    hands.push({ hand: h, position, anchor, fixed: !!given });
    first.push({ hand: h, midis: sortedFirst, fingers: firstFingers, names: sortedFirst.map((m) => noteName(m, key)), beat: f0.beat });
  }
  // Lines, in the order the hands come in.
  const order = [...first].sort((a, b) => a.beat - b.beat || (a.hand === 'R' ? -1 : 1));
  const byHand = (h) => hands.find((x) => x.hand === h);
  const textParts = [];
  const sayParts = [];
  let saidMiddleC = false;
  for (const fr of order) {
    const hd = byHand(fr.hand);
    const H = cap(HAND_WORD[fr.hand]);
    const a = hd.anchor;
    const chord = fr.midis.length > 1;
    if (hd.fixed) {
      const letters = [];
      for (let m = hd.position.lo; m <= hd.position.hi; m++) if (key.inKey(m)) letters.push(noteName(m, key).replace(/-?\d+$/, ''));
      const span = fr.hand === 'R' ? '1 to 5' : '5 to 1';
      // One hand: spell out the position. Two hands: the keyboard shows it; keep it short.
      const where = order.length === 1 ? `: fingers ${span} on ${letters.join(' ')}` : '';
      const firstNote = fr.midis[0] !== a.midi || chord ? `, first note ${fr.names.map((n) => (beginner ? n.replace(/-?\d+$/, '') : n)).join(' + ')} (finger ${fr.fingers.filter(Boolean).join(' ')})` : '';
      textParts.push(`${H} ${FINGER_WORD[a.finger]} on ${findableName(a.midi, key, level)}${where}${firstNote}.`);
      let sn = sayName(a.midi, key, level);
      if (saidMiddleC && sn.endsWith(' middle C') && sn !== 'middle C') sn = sn.replace(' middle C', '');
      if (sn.includes('middle C')) saidMiddleC = true;
      sayParts.push(`${H} ${FINGER_WORD[a.finger]} on ${sn}.`);
    } else if (chord) {
      const cn = fr.midis.length >= 3 ? chordName(fr.midis, key) : null;
      const fingersTxt = fr.fingers.every(Boolean) ? `, fingers ${fr.fingers.join(' ')}` : '';
      if (cn) {
        textParts.push(`${H} hand starts with a ${cn} chord: ${fr.names.join(' ')}${fingersTxt}.`);
        sayParts.push(`${H} hand starts with a ${spokenChord(cn)} chord.`);
      } else {
        textParts.push(`${H} hand starts with ${fr.names.join(' and ')} together${fingersTxt}.`);
        sayParts.push(`${H} hand starts with ${fr.midis.map((m) => spokenPc(m, key)).join(' and ')} together.`);
      }
    } else {
      const fw = fr.fingers[0] ? ` with finger ${fr.fingers[0]}` : '';
      textParts.push(`${H} hand starts on ${findableName(fr.midis[0], key, level)}${fw}.`);
      sayParts.push(`${H} hand on ${sayName(fr.midis[0], key, level)}${fr.fingers[0] ? `, finger ${fr.fingers[0]}` : ''}.`);
    }
  }
  if (order.length === 2 && Math.abs(order[0].beat - order[1].beat) > 1e-6) textParts.push(`The ${HAND_WORD[order[0].hand]} hand plays first.`);
  for (const x of extensions) textParts.push(`${cap(HAND_WORD[x.hand])} ${FINGER_WORD[x.finger]} reaches down to ${x.name}${x.why ? ` for ${x.why}` : ''}.`);
  if (outOfPosition && level <= 16) textParts.push('The hand moves later: read ahead.');
  // Keep the spoken line short: at most two hands, no extras.
  let say = sayParts.join(' ');
  if (say.split(/\s+/).length > 16 && sayParts.length === 2) say = sayParts.map((s) => s.replace(/, finger \d/, '')).join(' ');
  return { level, anyKey: false, hands, first, outOfPosition, extensions, say, text: textParts.join(' ') };
}

function spokenChord(name) {
  return name
    .replace(/^([A-G])♯/, '$1 sharp')
    .replace(/^([A-G])♭/, '$1 flat')
    .replace(/\/.*$/, '')
    .replace(/m$/, ' minor')
    .replace(/°$/, ' diminished');
}
